#!/usr/bin/env node
/**
 * ClaudeClaw Hive CLI — the canonical, store-aware hive-mind accessor.
 *
 * Agents use this via the Bash tool to read/write their hive mind. It is the
 * ONLY sanctioned way to touch hive_mind — never a raw `sqlite3` call against a
 * build-relative path.
 *
 * This is a THIN argv front-end: the business logic lives in `cli-actions.ts` —
 * the SAME functions the in-process dispatch tools call, so the CLI and the tool
 * can never drift. The store path is resolved inside the action layer from
 * config.ts's STORE_DIR (which honors the `.env` CLAUDECLAW_STORE_DIR pin);
 * `path` deliberately does not open the DB, so it works without DB_ENCRYPTION_KEY.
 *
 * Usage:
 *   node dist/hive-cli.js path
 *   node dist/hive-cli.js read [--limit N]
 *   node dist/hive-cli.js log --action <a> --summary <s> [--agent <id>]
 */

import { renderHelp } from './cli-reference.js';
import { hiveDescriptor as descriptor } from './cli-descriptors.js';
import { CliActionError, actionHiveLog, actionHivePath, actionHiveRead } from './cli-actions.js';

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function formatDate(unix: number | null): string {
  if (!unix) return '-';
  return new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(renderHelp(descriptor));
  process.exit(0);
}

try {
  const command = process.argv[2];

  switch (command) {
    // Print the resolved DB absolute path. Deliberately does NOT open the DB, so
    // it works without a DB_ENCRYPTION_KEY — it just answers "where is my store?".
    case 'path': {
      console.log(actionHivePath());
      break;
    }

    case 'read': {
      const limitArg = getFlag('--limit');
      const entries = actionHiveRead({ limit: limitArg ? parseInt(limitArg, 10) : undefined });
      if (entries.length === 0) {
        console.log('Hive mind is empty.');
        break;
      }
      console.log(`${entries.length} recent hive_mind entr${entries.length === 1 ? 'y' : 'ies'}:\n`);
      for (const e of entries) {
        console.log(`[${formatDate(e.created_at)}] @${e.agent_id} — ${e.action}`);
        console.log(`  ${e.summary}`);
        if (e.artifacts) console.log(`  artifacts: ${e.artifacts}`);
        console.log();
      }
      break;
    }

    case 'log': {
      const action = getFlag('--action');
      const summary = getFlag('--summary');
      if (!action || !summary) {
        console.error('Usage: hive-cli log --action <action> --summary <summary> [--agent <id>]');
        process.exit(1);
      }
      const r = actionHiveLog({ action, summary, agent: getFlag('--agent') });
      console.log(`Logged to hive mind as @${r.agent}: ${r.action}`);
      break;
    }

    default:
      console.error('Commands: path | read [--limit N] | log --action <a> --summary <s> [--agent <id>]');
      process.exit(1);
  }
} catch (err) {
  if (err instanceof CliActionError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
