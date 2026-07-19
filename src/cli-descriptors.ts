/**
 * Registry of every shipped agent CLI descriptor — a self-contained LEAF DATA
 * module. Each descriptor object is defined DIRECTLY here as a `const`, so this
 * file imports ONLY the `CliDescriptor` type. It deliberately does NOT import
 * any CLI module (which would pull in db.ts and close a config → descriptors →
 * *-cli → db → config import cycle). The CLIs import their descriptor FROM here.
 *
 * This is the single list of documented CLIs, shared by:
 *   - the generator (`scripts/gen-cli-reference.ts`) and the drift/coverage
 *     guard test (`src/cli-reference.test.ts`), and
 *   - `src/config.ts`, which injects a compact CLI index into every agent's
 *     system prompt via `renderCliIndex(allDescriptors)`.
 *
 * To document a NEW CLI: define its `descriptor` here, add it to
 * `allDescriptors`, and import it in the CLI's source for `--help`. The
 * coverage guard test fails if a `src/*-cli.ts` file has no matching entry, so
 * a new CLI cannot ship undocumented.
 */

import type { CliDescriptor } from './cli-reference.js';

export const agentCreateDescriptor: CliDescriptor = {
  name: 'agent-create-cli',
  binary: 'dist/agent-create-cli.js',
  summary: 'Non-interactively create a ClaudeClaw agent (used by the Telegram agent or CI).',
  ship: true,
  commands: [
    {
      usage:
        'agent-create-cli --id ID --name NAME --description DESC --token TOKEN [--model MODEL] [--template TEMPLATE] [--activate]',
      description:
        'Create an agent. --model defaults to claude-sonnet-4-6, --template to _template. --activate installs the launchd/systemd service and starts it immediately.',
    },
    {
      usage: '--validate --token TOKEN',
      description: 'Only validate the Telegram bot token, then exit.',
    },
    {
      usage: '--suggest --id ID',
      description: 'Print suggested bot names for the given --id as JSON, then exit.',
    },
    {
      usage: '--templates',
      description: 'List available templates, then exit.',
    },
  ],
  notes: [
    '--id must be lowercase with no spaces; --name, --description, and --token are required for creation.',
    '--token is a Telegram bot token from @BotFather.',
  ],
};

export const meetDescriptor: CliDescriptor = {
  name: 'meet-cli',
  binary: 'dist/meet-cli.js',
  summary: 'Send an agent into a video meeting as a real-time AI avatar (Pika or Daily.co).',
  ship: true,
  commands: [
    {
      usage:
        'join --meet-url <url> [--agent <id>] [--brief <file>] [--auto-brief] [--context <hint>] [--bot-name <name>] [--voice-id <id>] [--meeting-password <pw>]',
      description:
        'Pika avatar mode: the bot joins an existing Google Meet / Zoom URL with a real-time AI avatar. --agent defaults to main.',
    },
    {
      usage:
        'join-daily [--agent <id>] [--mode direct|auto] [--brief <file>] [--auto-brief] [--context <hint>] [--bot-name <name>] [--room-name <slug>] [--ttl-sec <seconds>]',
      description:
        'Daily.co mode: create a new Daily room, spawn a Pipecat agent in it, and return the room URL to share. Requires DAILY_API_KEY and GOOGLE_API_KEY.',
    },
    {
      usage: 'brief --meet-url <url> [--agent <id>] [--context <hint>]',
      description:
        'Run the pre-flight research pipeline and write a system-prompt brief file to the temp dir using the agent\'s full stack.',
    },
    { usage: 'leave --session-id <id>', description: 'Make the bot leave a meeting / tear down the Daily room.' },
    { usage: 'list [--active]', description: 'List recent meet sessions, or only live ones with --active.' },
    { usage: 'show --session-id <id>', description: 'Show full detail for one meet session.' },
  ],
  notes: [
    'Output is JSON on stdout: {"ok": true, ...} on success or {"ok": false, "error": ...} on failure.',
    'Pika mode requires PIKA_DEV_KEY and resolves avatars from warroom/avatars/<agent>-meet.png (falling back to <agent>.png).',
  ],
};

export const hiveDescriptor: CliDescriptor = {
  name: 'hive-cli',
  binary: 'dist/hive-cli.js',
  summary: 'Store-aware hive-mind accessor — the ONLY sanctioned way to read/write hive_mind.',
  ship: true,
  commands: [
    {
      usage: 'path',
      description:
        'Print the resolved hive-mind DB absolute path. Does NOT open the DB (works without DB_ENCRYPTION_KEY) — answers "where is my store?".',
    },
    {
      usage: 'read [--limit N]',
      description: 'Print the most recent hive_mind entries (default 10).',
    },
    {
      usage: 'log --action <action> --summary <summary> [--agent <id>]',
      description:
        'Append a hive_mind entry. --agent defaults to CLAUDECLAW_AGENT_ID (or "main"). Log after any meaningful action so the fleet can see it.',
    },
  ],
  notes: [
    'Resolves the store via config.ts STORE_DIR (honors the .env CLAUDECLAW_STORE_DIR pin) — never re-derives from process.env.',
    'Never touch hive_mind with a raw sqlite3 call against a build-relative path; it can silently hit the wrong (e.g. live) DB when the store is relocated.',
  ],
};

export const missionDescriptor: CliDescriptor = {
  name: 'mission-cli',
  binary: 'dist/mission-cli.js',
  summary: 'Create and manage one-shot mission tasks executed by a target agent.',
  ship: true,
  commands: [
    {
      usage: 'create [--agent <id>] [--title "Label"] [--priority N] "Full prompt text"',
      description:
        'Queue a one-shot mission task. --agent assigns it (omit to leave unassigned for dashboard auto-assign); --title defaults to the first 60 chars of the prompt; --priority defaults to 5.',
    },
    {
      usage: 'handback <task-id> "Report text"',
      description:
        'Report back on a task you were assigned. Routes deterministically to the task\'s originator (created_by) — another agent, or the human via the primary agent. Use this to close the loop; never guess the recipient.',
    },
    {
      usage:
        'gather --summary-agent <id> --title "Label" --task "agent:prompt" [--task "agent:prompt" ...] "join/summary prompt"',
      description:
        'Non-blocking fan-out: queue one child task per --task, then a parked join task for --summary-agent. The scheduler releases the join with all child results once the last child finishes, producing ONE consolidated summary. Children finish with their findings as output — they do NOT handback.',
    },
    {
      usage: 'list [--status <status>]',
      description: 'List mission tasks, optionally filtered by status (e.g. queued).',
    },
    {
      usage: 'result <id>',
      description: 'Show a task with its status and result (or error) once it has run.',
    },
    {
      usage: 'cancel <id>',
      description: 'Cancel a queued task (no-op if it already completed).',
    },
  ],
  notes: [
    'The target agent claims it within ~60s, runs in their process, self-completes, auto-purges after 7 days.',
    'The creating agent is recorded from CLAUDECLAW_AGENT_ID (defaults to "main").',
    'Orchestration modes: delegate (create, 1->1 async), await (orchestrator fires N creates and waits inline — no CLI verb), gather (1->N non-blocking join). Handbacks resolve to the originator.',
  ],
};

export const scheduleDescriptor: CliDescriptor = {
  name: 'schedule-cli',
  binary: 'dist/schedule-cli.js',
  summary: 'Manage RECURRING scheduled tasks (cron) that fire in an agent process.',
  ship: true,
  commands: [
    {
      usage: 'create "prompt text" "cron expression" [--agent <id>]',
      description:
        'Create a recurring task from a prompt and a cron expression. Rejects invalid cron. --agent defaults to CLAUDECLAW_AGENT_ID or "main".',
    },
    {
      usage: 'list [--agent <id>]',
      description:
        'List scheduled tasks with next/last run times. "main" lists all agents; any other --agent scopes to that agent.',
    },
    { usage: 'delete <id>', description: 'Delete a scheduled task.' },
    { usage: 'pause <id>', description: 'Pause a scheduled task without deleting it.' },
    { usage: 'resume <id>', description: 'Resume a paused scheduled task.' },
  ],
  notes: [
    'For RECURRING jobs (cron). For one-shot tasks, use mission-cli instead.',
    'Cron examples: "0 9 * * 1" (Mon 9am), "0 8 * * *" (daily 8am), "0 */4 * * *" (every 4h).',
    'Tasks fire from the resolved agent\'s scheduler, not the main bot.',
  ],
};

export const slackDescriptor: CliDescriptor = {
  name: 'slack-cli',
  binary: 'dist/slack-cli.js',
  summary: 'Read and post to Slack from an agent (JSON output).',
  ship: true,
  commands: [
    {
      usage: 'list [--limit N]',
      description: 'List Slack conversations (default limit 20). Prints JSON.',
    },
    {
      usage: 'read <channel_id> [--limit N]',
      description: 'Read recent messages from a channel (default limit 15). Prints JSON.',
    },
    {
      usage: 'send <channel_id> "message" [--thread-ts TS]',
      description: 'Send a message to a channel, optionally replying in a thread.',
    },
    {
      usage: 'search <query>',
      description: 'Find conversations whose name contains the query (case-insensitive). Prints JSON.',
    },
  ],
};

export const allDescriptors: CliDescriptor[] = [
  agentCreateDescriptor,
  hiveDescriptor,
  meetDescriptor,
  missionDescriptor,
  scheduleDescriptor,
  slackDescriptor,
];
