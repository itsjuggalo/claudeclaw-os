#!/usr/bin/env node
/**
 * ClaudeClaw Mission CLI
 *
 * Used by Claude assistants to create and manage one-shot mission tasks
 * that are picked up and executed by the target agent's scheduler.
 *
 * Usage:
 *   node dist/mission-cli.js create --agent research --title "Label" "Full prompt"
 *   node dist/mission-cli.js handback <task-id> "Report text"   (replies to the task's originator)
 *   node dist/mission-cli.js list [--status queued]
 *   node dist/mission-cli.js result <id>
 *   node dist/mission-cli.js cancel <id>
 *   node dist/mission-cli.js gather --summary-agent research --title "Label" \
 *     --task "agentA:prompt for A" --task "agentB:prompt for B" "Join/summary prompt"
 *     (fan out N tasks, park a join mission the scheduler releases once all children finish)
 */

import { randomBytes } from 'crypto';
import { pathToFileURL } from 'url';

import {
  initDatabase,
  createMissionTask,
  getMissionTasks,
  getMissionTask,
  cancelMissionTask,
} from './db.js';
import {
  resolveHandbackDestination,
  MAIN_AGENT_ID,
} from './routing.js';
import { renderHelp } from './cli-reference.js';
import { missionDescriptor as descriptor } from './cli-descriptors.js';

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

function runCli(): void {
initDatabase();

// Parse --agent flag (null = unassigned, use auto-assign on dashboard)
const agentFlagIdx = process.argv.indexOf('--agent');
const targetAgent = agentFlagIdx !== -1
  ? process.argv[agentFlagIdx + 1] ?? null
  : null;

// Parse --title flag
const titleFlagIdx = process.argv.indexOf('--title');
const titleArg = titleFlagIdx !== -1
  ? process.argv[titleFlagIdx + 1] ?? ''
  : '';

// Parse --status flag
const statusFlagIdx = process.argv.indexOf('--status');
const statusFilter = statusFlagIdx !== -1
  ? process.argv[statusFlagIdx + 1] ?? undefined
  : undefined;

// Parse --priority flag
const priorityFlagIdx = process.argv.indexOf('--priority');
const priorityArg = priorityFlagIdx !== -1
  ? parseInt(process.argv[priorityFlagIdx + 1] ?? '0', 10)
  : 5;

// Parse --summary-agent flag (gather command's join assignee)
const summaryAgentFlagIdx = process.argv.indexOf('--summary-agent');
const summaryAgentArg = summaryAgentFlagIdx !== -1
  ? process.argv[summaryAgentFlagIdx + 1] ?? null
  : null;

/**
 * Collect every occurrence of a repeated flag (e.g. `--task "a:b"` used
 * multiple times) and return its indices so they can be stripped from argv
 * before positional parsing, along with the collected values in order.
 */
function collectRepeatedFlag(argv: string[], flag: string): { values: string[]; indices: number[] } {
  const values: string[] = [];
  const indices: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      indices.push(i, i + 1);
      values.push(argv[i + 1] ?? '');
    }
  }
  return { values, indices };
}

const { values: taskArgs, indices: taskFlagIndices } = collectRepeatedFlag(process.argv, '--task');

// Who created this task
const createdBy = process.env.CLAUDECLAW_AGENT_ID ?? 'main';

// Clean argv: remove all flag pairs
const flagIndices = new Set<number>();
[agentFlagIdx, titleFlagIdx, statusFlagIdx, priorityFlagIdx, summaryAgentFlagIdx].forEach(idx => {
  if (idx !== -1) { flagIndices.add(idx); flagIndices.add(idx + 1); }
});
taskFlagIndices.forEach((idx) => flagIndices.add(idx));
const cleanedArgv = process.argv.filter((_, i) => !flagIndices.has(i));
const [, , command, ...rest] = cleanedArgv;

function formatDate(unix: number | null): string {
  if (!unix) return '-';
  return new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

switch (command) {
  case 'create': {
    const prompt = rest[0];
    if (!prompt) {
      console.error('Usage: mission-cli create --agent <id> --title "Label" "Full prompt text"');
      process.exit(1);
    }
    const title = titleArg || prompt.slice(0, 60);
    const id = randomBytes(4).toString('hex');
    createMissionTask(id, title, prompt, targetAgent ?? null, createdBy, priorityArg);

    console.log(`Mission task created: ${id}`);
    console.log(`  Title:    ${title}`);
    console.log(`  Agent:    ${targetAgent || 'unassigned (use dashboard to assign)'}`);
    console.log(`  Priority: ${priorityArg}`);
    console.log(`  Prompt:   ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
    break;
  }

  case 'handback': {
    const parentId = rest[0];
    const report = rest[1];
    if (!parentId || !report) {
      console.error('Usage: mission-cli handback <task-id> "Report text"');
      process.exit(1);
    }
    const parent = getMissionTask(parentId);
    if (!parent) { console.error(`Task not found: ${parentId}`); process.exit(1); }

    const dest = resolveHandbackDestination(parent.created_by);
    const id = randomBytes(4).toString('hex');
    const title = `Handback: ${parent.title}`.slice(0, 80);

    if (dest.kind === 'agent') {
      const body = [
        `Handback report for task ${parent.id} ("${parent.title}").`,
        `From: @${createdBy}`,
        '',
        report,
      ].join('\n');
      createMissionTask(id, title, body, dest.agent, createdBy, priorityArg, parent.id);
      console.log(`Handback delivered to @${dest.agent} (originator of ${parent.id}).`);
      console.log(`  Mission: ${id}`);
    } else {
      // Reserved origin (dashboard/human/scheduled) has no mission inbox —
      // surface to the human via the runtime's primary agent. Make the relay
      // explicit and actionable so the turn produces real output (an empty turn
      // would otherwise be suppressed and the report never reach the human).
      const body = [
        `Relay the following handback report to the user on Telegram.`,
        `Reply with the report (lightly cleaned up if useful) so it is delivered — do not just acknowledge it.`,
        `Context: ${dest.reason} (task originator was "${parent.created_by}").`,
        `Handback for task ${parent.id} ("${parent.title}"), from @${createdBy}:`,
        '',
        report,
      ].join('\n');
      createMissionTask(id, title, body, dest.via ?? MAIN_AGENT_ID, createdBy, priorityArg, parent.id);
      console.log(`Handback routed to @${dest.via} to surface to the human (${dest.reason}).`);
      console.log(`  Mission: ${id}`);
    }
    break;
  }

  case 'list': {
    const tasks = getMissionTasks(undefined, statusFilter);
    if (tasks.length === 0) {
      console.log('No mission tasks' + (statusFilter ? ` with status "${statusFilter}"` : '') + '.');
      break;
    }
    console.log(`${tasks.length} mission task${tasks.length === 1 ? '' : 's'}:\n`);
    for (const t of tasks) {
      console.log(`${t.id} [${t.status}] @${t.assigned_agent}`);
      console.log(`  Title:   ${t.title}`);
      console.log(`  Created: ${formatDate(t.created_at)}`);
      if (t.completed_at) console.log(`  Done:    ${formatDate(t.completed_at)}`);
      console.log();
    }
    break;
  }

  case 'result': {
    const id = rest[0];
    if (!id) { console.error('Usage: mission-cli result <id>'); process.exit(1); }
    const task = getMissionTask(id);
    if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
    console.log(`Task:   ${task.id} [${task.status}]`);
    console.log(`Title:  ${task.title}`);
    console.log(`Agent:  ${task.assigned_agent}`);
    if (task.result) {
      console.log(`\nResult:\n${task.result}`);
    } else if (task.error) {
      console.log(`\nError: ${task.error}`);
    } else {
      console.log('\nNo result yet.');
    }
    break;
  }

  case 'cancel': {
    const id = rest[0];
    if (!id) { console.error('Usage: mission-cli cancel <id>'); process.exit(1); }
    const ok = cancelMissionTask(id);
    console.log(ok ? `Cancelled task: ${id}` : `Could not cancel (may already be completed): ${id}`);
    break;
  }

  case 'gather': {
    if (!summaryAgentArg) {
      console.error('Usage: mission-cli gather --summary-agent <agent> --title "Label" --task "agent:prompt" [--task ...] "join/summary prompt"');
      process.exit(1);
    }
    if (taskArgs.length === 0) {
      console.error('gather requires at least one --task "agent:prompt"');
      process.exit(1);
    }

    const groupId = randomBytes(4).toString('hex');
    const title = titleArg || 'Gather';
    const joinPrompt = rest[0] || 'All grouped tasks are complete. Produce ONE consolidated summary of the collected results below.';

    const childIds: string[] = [];
    for (const taskArg of taskArgs) {
      const sepIdx = taskArg.indexOf(':');
      if (sepIdx === -1) {
        console.error(`Invalid --task value (expected "agent:prompt"): ${taskArg}`);
        process.exit(1);
      }
      const childAgent = taskArg.slice(0, sepIdx);
      const childPrompt = taskArg.slice(sepIdx + 1);
      const childId = randomBytes(4).toString('hex');
      const childTitle = `${title} (${childAgent})`.slice(0, 80);
      const body = [
        childPrompt,
        '',
        'Complete this mission with your findings as your final output. Do NOT fire a handback.',
      ].join('\n');
      createMissionTask(childId, childTitle, body, childAgent, createdBy, priorityArg, null, groupId, 'task');
      childIds.push(childId);
    }

    const joinId = randomBytes(4).toString('hex');
    const joinTitle = `${title} (join)`.slice(0, 80);
    createMissionTask(joinId, joinTitle, joinPrompt, summaryAgentArg, createdBy, priorityArg, null, groupId, 'join', 'waiting');

    console.log(`Gather group created: ${groupId}`);
    console.log(`  Children: ${childIds.join(', ')}`);
    console.log(`  Join (parked, waiting): ${joinId} -> @${summaryAgentArg}`);
    break;
  }

  default:
    console.error('Commands: create | handback | list | result | cancel | gather');
    process.exit(1);
}
}
