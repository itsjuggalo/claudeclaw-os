#!/usr/bin/env node
/**
 * ClaudeClaw Schedule CLI
 *
 * Used by your Claude assistant via the Bash tool to manage scheduled tasks.
 *
 * This is a THIN argv front-end: it parses flags and formats output, but the
 * business logic lives in `cli-actions.ts` — the SAME functions the in-process
 * dispatch tools call, so the CLI and the tool can never drift. Recoverable
 * failures (unknown agent, invalid cron) come back as `CliActionError`, printed
 * to stderr with a non-zero exit, writing nothing.
 *
 * Usage:
 *   node dist/schedule-cli.js create "prompt text" "0 9 * * 1"
 *   node dist/schedule-cli.js list
 *   node dist/schedule-cli.js delete <id>
 *   node dist/schedule-cli.js pause <id>
 *   node dist/schedule-cli.js resume <id>
 */

import { pathToFileURL } from 'url';

import { renderHelp } from './cli-reference.js';
import { scheduleDescriptor as descriptor } from './cli-descriptors.js';
import {
  CliActionError,
  actionCreateSchedule,
  actionDeleteSchedule,
  actionListSchedules,
  actionPauseSchedule,
  actionResumeSchedule,
} from './cli-actions.js';

// Only run the CLI when invoked directly, so importing `descriptor` (for docs
// generation and the drift-guard test) does not trigger DB init or arg parsing.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(renderHelp(descriptor));
    process.exit(0);
  }
  runCli();
}

function formatDate(unix: number | null): string {
  if (!unix) return 'never';
  return new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function runCli(): void {
  try {
    dispatch();
  } catch (err) {
    if (err instanceof CliActionError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

function dispatch(): void {
  // Parse --agent flag from anywhere in argv, fall back to CLAUDECLAW_AGENT_ID.
  // Resolution (including reject-unknown) happens inside the action.
  const agentFlagIdx = process.argv.indexOf('--agent');
  const rawAgentId = agentFlagIdx !== -1
    ? process.argv[agentFlagIdx + 1] ?? 'main'
    : process.env.CLAUDECLAW_AGENT_ID ?? 'main';
  // Remove --agent and its value from rest args (only filter when flag is present)
  const cleanedArgv = agentFlagIdx !== -1
    ? process.argv.filter((_, i) => i !== agentFlagIdx && i !== agentFlagIdx + 1)
    : [...process.argv];
  const [, , command, ...rest] = cleanedArgv;

  switch (command) {
    case 'create': {
      const prompt = rest[0];
      const cron = rest[1];

      if (!prompt || !cron) {
        console.error('Usage: schedule-cli create "prompt" "cron expression"');
        console.error('Example: schedule-cli create "Summarise AI news" "0 9 * * 1"');
        process.exit(1);
      }

      const r = actionCreateSchedule({ prompt, cron, agent: rawAgentId });
      console.log(`Task created: ${r.id}`);
      console.log(`Agent:        ${r.agent}`);
      console.log(`Prompt:       ${r.prompt}`);
      console.log(`Schedule:     ${r.cron}`);
      console.log(`Next run:     ${formatDate(r.nextRun)}`);
      break;
    }

    case 'list': {
      const tasks = actionListSchedules({ agent: rawAgentId });
      if (tasks.length === 0) {
        console.log('No scheduled tasks.');
        break;
      }
      console.log(`${tasks.length} scheduled task${tasks.length === 1 ? '' : 's'}:\n`);
      for (const t of tasks) {
        const status = t.status === 'paused' ? ' [PAUSED]' : '';
        console.log(`${t.id}${status}`);
        console.log(`  Prompt:   ${t.prompt}`);
        console.log(`  Schedule: ${t.schedule}`);
        console.log(`  Next run: ${formatDate(t.next_run)}`);
        console.log(`  Last run: ${formatDate(t.last_run)}`);
        console.log();
      }
      break;
    }

    case 'delete': {
      const id = rest[0];
      if (!id) { console.error('Usage: schedule-cli delete <id>'); process.exit(1); }
      actionDeleteSchedule({ id });
      console.log(`Deleted task: ${id}`);
      break;
    }

    case 'pause': {
      const id = rest[0];
      if (!id) { console.error('Usage: schedule-cli pause <id>'); process.exit(1); }
      actionPauseSchedule({ id });
      console.log(`Paused task: ${id}`);
      break;
    }

    case 'resume': {
      const id = rest[0];
      if (!id) { console.error('Usage: schedule-cli resume <id>'); process.exit(1); }
      actionResumeSchedule({ id });
      console.log(`Resumed task: ${id}`);
      break;
    }

    default:
      console.error('Commands: create | list | delete | pause | resume');
      process.exit(1);
  }
}
