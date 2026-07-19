#!/usr/bin/env node
// bunker-add.mjs — drop an HTML artifact onto the CCOS Mission Control Bunker.
//
// Instead of spinning a throwaway server on a random port, write the artifact
// here; it appears as the Bunker tab entry, served from the dashboard origin.
//
// Usage:
//   node scripts/bunker-add.mjs --title "My Report" [--task "..."] [--tags a,b] report.html
//   cat report.html | node scripts/bunker-add.mjs --title "My Report"   # from stdin
//
//   --slug <stable>   use a fixed slug instead of the default title+HH-MM. Lets a
//                     recurring artifact (e.g. the daily morning review) own ONE card.
//   --replace         overwrite an existing entry at that slug in place (refresh the
//                     same card daily instead of stacking a new one). Preserves `pinned`.
//
// Default behavior (no --slug) is unchanged: every call mints a new timestamped card.
//
// Env: BUNKER_DIR overrides the storage dir (default ~/.claudeclaw/bunker).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

function expandHome(p) {
  return p && (p.startsWith('~/') || p === '~') ? path.join(os.homedir(), p.slice(1)) : p;
}

// Resolve CLAUDECLAW_CONFIG the same way src/config.ts does — process.env, then
// the repo .env, then the ~/.claudeclaw default — so this standalone CLI's
// bunker dir stays in lockstep with the server (src/bunker.ts). Avoids a rogue
// hardcoded path divorced from the configured root.
function resolveConfigDir() {
  if (process.env.CLAUDECLAW_CONFIG) return expandHome(process.env.CLAUDECLAW_CONFIG);
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const m = env.match(/^\s*CLAUDECLAW_CONFIG\s*=\s*(.+?)\s*$/m);
    if (m) return expandHome(m[1].replace(/^["']|["']$/g, ''));
  } catch {
    /* no .env readable; fall through to default */
  }
  return expandHome('~/.claudeclaw');
}

const BUNKER_DIR = process.env.BUNKER_DIR
  ? expandHome(process.env.BUNKER_DIR)
  : path.join(resolveConfigDir(), 'bunker');

function parseArgs(argv) {
  const out = { title: null, task: null, tags: [], file: null, slug: null, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') out.title = argv[++i];
    else if (a === '--task') out.task = argv[++i];
    else if (a === '--tags') out.tags = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--slug') out.slug = argv[++i];
    else if (a === '--replace') out.replace = true;
    else if (!a.startsWith('--')) out.file = a;
  }
  return out;
}

function slugify(s) {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'
  );
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const args = parseArgs(process.argv.slice(2));
const html = args.file ? fs.readFileSync(args.file, 'utf8') : readStdin();

if (!html.trim()) {
  console.error('No HTML provided (pass a file or pipe via stdin).');
  process.exit(2);
}

const title = args.title ?? (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? 'Untitled');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(11, 16);
// A stable --slug lets a recurring artifact own one card; otherwise mint a fresh
// timestamped slug exactly as before (unchanged default).
const slug = args.slug ? slugify(args.slug) : `${slugify(title)}-${stamp}`;
const dir = path.join(BUNKER_DIR, slug);
const existed = fs.existsSync(dir);

// Guard: refuse to clobber an existing entry unless --replace was passed. This
// only triggers on a stable --slug collision; the default timestamped path is
// effectively unique so it never hits this.
if (existed && !args.replace) {
  console.error(`Entry "${slug}" already exists. Pass --replace to overwrite it in place.`);
  process.exit(3);
}

// On replace, carry the prior `pinned` state forward so a refresh never silently
// unpins a card the user pinned.
let pinned = false;
if (existed && args.replace) {
  try {
    pinned = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).pinned ?? false;
  } catch {
    /* missing/corrupt meta — fall back to unpinned */
  }
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), html);
fs.writeFileSync(
  path.join(dir, 'meta.json'),
  JSON.stringify(
    { title, task: args.task ?? undefined, tags: args.tags, created: new Date().toISOString(), pinned },
    null,
    2,
  ),
);

console.log(`${existed && args.replace ? 'Replaced on' : 'Added to'} Bunker: ${title}`);
console.log(`  Open the CCOS Mission Control dashboard and click the Bunker tab (g b).`);
console.log(`  Slug: ${slug}`);
