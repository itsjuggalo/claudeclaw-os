import { AGENT_ID, ALLOWED_CHAT_ID, agentMcpAllowlist, agentDefaultModel } from './config.js';
import { isEnabled } from './kill-switches.js';
import { computeNextRun } from './cron.js';
import { ingestConversationTurn } from './memory-ingest.js';
import {
  getDueTasks,
  getSession,
  logConversationTurn,
  markTaskRunning,
  updateTaskAfterRun,
  resetStuckTasks,
  claimNextMissionTask,
  completeMissionTask,
  resetStuckMissionTasks,
  getMissionTask,
  insertAuditLog,
  areAllGroupChildrenTerminal,
  getGroupChildren,
  getJoinMission,
  releaseJoinMission,
  updateMissionPrompt,
  type MissionTask,
} from './db.js';
import { logger } from './logger.js';
import { messageQueue } from './message-queue.js';
import { runAgent } from './agent.js';
import { formatForTelegram, splitMessage } from './bot.js';
import { getSelectedProviderConfig } from './active-provider.js';
import { evaluateAcceptance } from './acceptance.js';

type Sender = (text: string) => Promise<void>;

/** Max time (ms) a scheduled task can run before being killed. */
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let sender: Sender;

/**
 * Tier 3 gather/join: when a group-tagged 'task' mission reaches a terminal
 * status, check whether every sibling in its group is now terminal too. If
 * so, assemble the children's results into the parked 'waiting' join
 * mission's prompt and atomically release it (waiting -> queued). Defensive:
 * a non-grouped mission, or a group with no join mission, is a no-op.
 */
function maybeReleaseJoinForMission(mission: MissionTask): void {
  if (!mission.group_id || mission.role !== 'task') return;
  if (!areAllGroupChildrenTerminal(mission.group_id)) return;

  const join = getJoinMission(mission.group_id);
  if (!join) {
    logger.warn({ groupId: mission.group_id }, 'Gather group has no join mission to release');
    return;
  }

  const children = getGroupChildren(mission.group_id);
  const assembled = children
    .map((c) => `=== ${c.title} (@${c.assigned_agent ?? 'unassigned'}) ===\n${c.result ?? c.error ?? '(no output)'}`)
    .join('\n\n');
  updateMissionPrompt(join.id, `${join.prompt}\n\n--- Collected results ---\n${assembled}`);

  const released = releaseJoinMission(mission.group_id);
  if (released) {
    logger.info({ groupId: mission.group_id, joinId: join.id }, 'Released join mission for gather group');
  }
  // If released === false, another completing sibling already won the race;
  // this caller does nothing further (the prompt write above is idempotent-safe
  // since it re-derives from current child state each time it runs).
}

/**
 * In-memory set of task IDs currently being executed.
 * Acts as a fast-path guard alongside the DB-level lock in markTaskRunning.
 */
const runningTaskIds = new Set<string>();

/**
 * Initialise the scheduler. Call once after the Telegram bot is ready.
 * @param send  Function that sends a message to the user's Telegram chat.
 */
let schedulerAgentId = 'main';

export function initScheduler(send: Sender, agentId = 'main'): void {
  if (!ALLOWED_CHAT_ID) {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler will not send results');
  }
  sender = send;
  schedulerAgentId = agentId;

  // Recover tasks stuck in 'running' from a previous crash
  const recovered = resetStuckTasks(agentId);
  if (recovered > 0) {
    logger.warn({ recovered, agentId }, 'Reset stuck tasks from previous crash');
  }
  const recoveredMission = resetStuckMissionTasks(agentId);
  if (recoveredMission > 0) {
    logger.warn({ recovered: recoveredMission, agentId }, 'Reset stuck mission tasks from previous crash');
  }

  setInterval(() => void runDueTasks(), 60_000);
  logger.info({ agentId }, 'Scheduler started (checking every 60s)');
}

// Logged once per disable window so the journal shows a single line, not
// one per 60s tick while an incident is in progress.
let _scheduledTasksDisabledLogged = false;
let _missionTasksDisabledLogged = false;

async function runDueTasks(): Promise<void> {
  if (!isEnabled('SCHEDULER_ENABLED')) {
    if (!_scheduledTasksDisabledLogged) {
      logger.warn('SCHEDULER_ENABLED=false — skipping due scheduled tasks (set to true in .env to resume)');
      _scheduledTasksDisabledLogged = true;
    }
    return;
  }
  _scheduledTasksDisabledLogged = false;

  const tasks = getDueTasks(schedulerAgentId);

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, 'Running due scheduled tasks');
  }

  for (const task of tasks) {
    // In-memory guard: skip if already running in this process
    if (runningTaskIds.has(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already running, skipping duplicate fire');
      continue;
    }

    // Compute next occurrence BEFORE executing so we can lock the task
    // in the DB immediately, preventing re-fire on subsequent ticks.
    const nextRun = computeNextRun(task.schedule);
    runningTaskIds.add(task.id);
    markTaskRunning(task.id, nextRun);

    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Firing task');

    // Route through the message queue so scheduled tasks wait for any
    // in-flight user message to finish before running. This prevents
    // two Claude processes from hitting the same session simultaneously.
    const chatId = ALLOWED_CHAT_ID || 'scheduler';
    messageQueue.enqueue(chatId, async () => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

      try {
        // 2026-07-29: this used to announce every scheduled task by echoing its raw PROMPT
        // ("Scheduled task running: \"[brief:premarket] You are Boba, lead AI t...\""). That is
        // plumbing, not information — Mike gets the finished output a minute later either way.
        // The fire is still recorded in the log line above and in the audit table; only the
        // phone notification is gone. Failures and timeouts below still speak.

        // Run as a fresh agent call (no session — scheduled tasks are autonomous)
        const result = await runAgent(
          task.prompt,
          undefined,
          () => {},
          undefined,
          agentDefaultModel,
          abortController,
          undefined,
          agentMcpAllowlist,
          getSelectedProviderConfig(),
        );
        clearTimeout(timeout);

        if (result.aborted) {
          updateTaskAfterRun(task.id, nextRun, 'Timed out after 10 minutes', 'timeout');
          insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'scheduled_task_run', `${task.id}: timeout (10m)`, true);
          await sender(`⏱ Task timed out after 10m: "${task.prompt.slice(0, 60)}..." — killed.`);
          logger.warn({ taskId: task.id }, 'Task timed out');
          return;
        }

        const text = result.text?.trim() || 'Task completed with no output.';
        const acceptancePassed = evaluateAcceptance(task.acceptance_check, result.text ?? '');
        const lastStatus: 'success' | 'failed' = acceptancePassed ? 'success' : 'failed';
        const resultText = acceptancePassed
          ? text
          : `Acceptance check not met: output did not contain "${task.acceptance_check}".\n\n${text}`;
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }
        if (!acceptancePassed) {
          await sender(`⚠ Acceptance check not met: expected output to contain "${task.acceptance_check}".`);
        }

        // Inject task output into the active chat session so user replies have context
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', `[Scheduled task]: ${task.prompt}`, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        // Fire-and-forget memory extraction. Synthetic chat_id when this agent has no
        // user-facing Telegram chat (specialists usually don't). Memory is valuable
        // even on background tasks — they produce content worth remembering, just
        // grouped under a per-agent synthetic thread instead of a real user chat.
        const ingestChatId = ALLOWED_CHAT_ID || `scheduled-${schedulerAgentId}`;
        void ingestConversationTurn(ingestChatId, `[Scheduled task]: ${task.prompt}`, text, schedulerAgentId).catch((err) => {
          logger.error({ err, taskId: task.id }, 'Memory ingestion fire-and-forget failed (scheduled task)');
        });

        updateTaskAfterRun(task.id, nextRun, resultText, lastStatus);
        insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'scheduled_task_run', `${task.id}: ${lastStatus} (${text.length} chars)`, !acceptancePassed);

        logger.info({ taskId: task.id, nextRun }, 'Task complete, next run scheduled');
      } catch (err) {
        clearTimeout(timeout);
        const errMsg = err instanceof Error ? err.message : String(err);
        updateTaskAfterRun(task.id, nextRun, errMsg.slice(0, 500), 'failed');
        insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'scheduled_task_run', `${task.id}: failed — ${errMsg.slice(0, 200)}`, true);

        logger.error({ err, taskId: task.id }, 'Scheduled task failed');
        try {
          await sender(`❌ Task failed: "${task.prompt.slice(0, 60)}..." — ${errMsg.slice(0, 200)}`);
        } catch {
          // ignore send failure
        }
      } finally {
        runningTaskIds.delete(task.id);
      }
    });
  }

  // Also check for queued mission tasks (one-shot async tasks from Mission Control)
  await runDueMissionTasks();
}

async function runDueMissionTasks(): Promise<void> {
  if (!isEnabled('SCHEDULER_ENABLED')) {
    if (!_missionTasksDisabledLogged) {
      logger.warn('SCHEDULER_ENABLED=false — skipping mission task claims');
      _missionTasksDisabledLogged = true;
    }
    return;
  }
  _missionTasksDisabledLogged = false;

  const mission = claimNextMissionTask(schedulerAgentId);
  if (!mission) return;

  const missionKey = 'mission-' + mission.id;
  if (runningTaskIds.has(missionKey)) return;
  runningTaskIds.add(missionKey);

  logger.info({ missionId: mission.id, title: mission.title }, 'Running mission task');

  const chatId = ALLOWED_CHAT_ID || 'mission';
  messageQueue.enqueue(chatId, async () => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

    // Cross-process cancel signal: dashboard flips status to 'cancelled' in
    // SQLite, this poll picks it up within 5s and aborts the runAgent call.
    let cancelledByUser = false;
    const cancelPoll = setInterval(() => {
      const current = getMissionTask(mission.id);
      if (current?.status === 'cancelled') {
        cancelledByUser = true;
        abortController.abort();
        clearInterval(cancelPoll);
      }
    }, 5_000);

    try {
      const result = await runAgent(
        mission.prompt,
        undefined,
        () => {},
        undefined,
        agentDefaultModel,
        abortController,
        undefined,
        agentMcpAllowlist,
        getSelectedProviderConfig(),
      );
      clearTimeout(timeout);
      clearInterval(cancelPoll);

      if (result.aborted) {
        if (cancelledByUser) {
          // Status is already 'cancelled' from the dashboard write — leave it.
          insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'mission_task_run', `${mission.id}: cancelled-by-user`, false);
          logger.info({ missionId: mission.id }, 'Mission task cancelled by user');
        } else {
          completeMissionTask(mission.id, null, 'failed', 'Timed out after 10 minutes');
          insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'mission_task_run', `${mission.id}: timeout (10m)`, true);
          maybeReleaseJoinForMission({ ...mission, status: 'failed' });
          logger.warn({ missionId: mission.id }, 'Mission task timed out');
          try {
            await sender('Mission task timed out: "' + mission.title + '"');
          } catch (sendErr) {
            // Sender can fail for Telegram API blips or chat-not-found. We
            // still want to see it so the user isn't silently unnotified.
            logger.warn({ err: sendErr, missionId: mission.id }, 'Failed to send mission timeout notification');
          }
        }
      } else {
        // A mission can finish with nothing to say — most often an FYI handback
        // that landed on this agent's board (e.g. a report routed back to the
        // originator). We still want a closure signal (silence reads as an
        // unresponsive bot), but not the noisy "Task completed with no output."
        // wall. So: real output goes through as-is; an empty turn gets a compact
        // completion marker, and doesn't pollute conversation context/memory.
        const rawText = result.text?.trim() ?? '';
        const hasOutput = rawText.length > 0;
        const text = hasOutput ? rawText : 'Task completed with no output.';
        completeMissionTask(mission.id, text, 'completed');
        insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'mission_task_run', `${mission.id}: completed (${text.length} chars)`, false);
        maybeReleaseJoinForMission({ ...mission, status: 'completed' });
        logger.info({ missionId: mission.id, hasOutput }, 'Mission task completed');

        // Always give a closure signal: full output when there is any,
        // otherwise a compact one-line marker instead of the noisy placeholder.
        if (hasOutput) {
          for (const chunk of splitMessage(formatForTelegram(text))) {
            await sender(chunk);
          }
        } else {
          await sender(`✓ ${mission.title} — done`);
        }

        // Inject into conversation context so agent can reference it (skip empty turns).
        if (ALLOWED_CHAT_ID && hasOutput) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', '[Mission task: ' + mission.title + ']: ' + mission.prompt, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        // Fire-and-forget memory extraction. Synthetic chat_id when this agent has no
        // user-facing Telegram chat (specialists usually don't). Mission tasks produce
        // content worth remembering, grouped under a per-agent synthetic thread.
        // Skip when there was no output — nothing worth remembering.
        if (hasOutput) {
          const ingestChatId = ALLOWED_CHAT_ID || `mission-${schedulerAgentId}`;
          void ingestConversationTurn(ingestChatId, '[Mission task: ' + mission.title + ']: ' + mission.prompt, text, schedulerAgentId).catch((err) => {
            logger.error({ err, missionId: mission.id }, 'Memory ingestion fire-and-forget failed (mission task)');
          });
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      clearInterval(cancelPoll);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (cancelledByUser) {
        insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'mission_task_run', `${mission.id}: cancelled-by-user (threw on abort)`, false);
        logger.info({ missionId: mission.id }, 'Mission task cancelled by user (threw on abort)');
      } else {
        completeMissionTask(mission.id, null, 'failed', errMsg.slice(0, 500));
        insertAuditLog(schedulerAgentId, ALLOWED_CHAT_ID || '', 'mission_task_run', `${mission.id}: failed — ${errMsg.slice(0, 200)}`, true);
        maybeReleaseJoinForMission({ ...mission, status: 'failed' });
        logger.error({ err, missionId: mission.id }, 'Mission task failed');
      }
    } finally {
      clearInterval(cancelPoll);
      runningTaskIds.delete(missionKey);
    }
  });
}

// Re-exported from the leaf `cron.ts` so the historical `./scheduler.js` import
// path (dashboard.ts, etc.) keeps working while the single implementation lives
// in a module the dispatch action layer can import without a cycle.
export { computeNextRun } from './cron.js';
