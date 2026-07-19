#!/usr/bin/env node
/**
 * ClaudeClaw Hive CLI — the canonical, store-aware hive-mind accessor.
 *
 * Agents use this via the Bash tool to read/write their hive mind. It is the
 * ONLY sanctioned way to touch hive_mind — never a raw `sqlite3` call against a
 * build-relative path.
 *
 * WHY THIS EXISTS (load-bearing): the store path is resolved by config.ts as
 *   process.env.CLAUDECLAW_STORE_DIR || envConfig.CLAUDECLAW_STORE_DIR (.env) || PROJECT_ROOT/store
 * The `.env` (envConfig) branch is invisible to a bash `sqlite3`/`find` — only a
 * Node process that loads config.ts can honor it. So this CLI imports STORE_DIR
 * from config.ts and NEVER re-derives the path from process.env. A raw shell
 * command against $PROJECT_ROOT/store can silently hit the WRONG (e.g. live)
 * database when the store is relocated via .env.
 *
 * Usage:
 *   node dist/hive-cli.js path
 *   node dist/hive-cli.js read [--limit N]
 *   node dist/hive-cli.js log --action <a> --summary <s> [--agent <id>]
 */

import path from 'path';

import { STORE_DIR } from './config.js';
import {
  initDatabase,
  logToHiveMind,
  getHiveMindEntries,
} from './db.js';
import { renderHelp } from './cli-reference.js';
import { hiveDescriptor as descriptor } from './cli-descriptors.js';

// Canonical DB path — derived from config.ts's STORE_DIR (which honors the
// .env-based CLAUDECLAW_STORE_DIR pin), NOT from process.env directly.
const DB_PATH = path.join(STORE_DIR, 'claudeclaw.db');

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

const command = process.argv[2];

switch (command) {
  // Print the resolved DB absolute path. Deliberately does NOT open the DB, so
  // it works without a DB_ENCRYPTION_KEY — it just answers "where is my store?".
  case 'path': {
    console.log(DB_PATH);
    break;
  }

  case 'read': {
    initDatabase();
    const limitArg = getFlag('--limit');
    const limit = limitArg ? parseInt(limitArg, 10) : 10;
    const entries = getHiveMindEntries(Number.isFinite(limit) && limit > 0 ? limit : 10);
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
    const agentId = getFlag('--agent') ?? process.env.CLAUDECLAW_AGENT_ID ?? 'main';
    initDatabase();
    // chat_id is NOT NULL in the schema; CLI-originated logs use a 'cli' marker.
    logToHiveMind(agentId, 'cli', action, summary);
    console.log(`Logged to hive mind as @${agentId}: ${action}`);
    break;
  }

  default:
    console.error('Commands: path | read [--limit N] | log --action <a> --summary <s> [--agent <id>]');
    process.exit(1);
}
