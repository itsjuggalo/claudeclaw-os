import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// The Bunker is the ad-hoc report surface for Mission Control: instead of
// spinning a throwaway server on a random port for each artifact, work drops an
// HTML file here and it shows up as a tab entry served from the dashboard's own
// origin (no orphan ports to hunt down).
//
// Storage lives OUTSIDE the repo work-tree on purpose: these are disposable
// artifacts and claudeclaw-os is under the WIP-snapshot cron + gitleaks, so they
// must never be sweepable into git. Override the locations with env if needed.
export const BUNKER_DIR =
  process.env.BUNKER_DIR ?? path.join(os.homedir(), '.claudeclaw', 'bunker');
export const ARCHIVE_DIR =
  process.env.BUNKER_ARCHIVE_DIR ?? path.join(os.homedir(), '.claudeclaw', 'bunker-archive');
// Promote target: the vault, where it becomes grep/context-search/Perceptor visible.
export const VAULT_BUNKER_DIR =
  process.env.BUNKER_VAULT_DIR ?? path.join(os.homedir(), 'vault', 'bunker');

const EXPIRE_DAYS = parseInt(process.env.BUNKER_EXPIRE_DAYS ?? '7', 10);
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Scoped artifact capability ──────────────────────────────────────────────
// We must NOT put the master dashboard token in artifact URLs: an artifact is
// attacker-influenceable HTML (pipelines/agents drop reports built from scraped
// content), and any script inside it could read its own location.search and
// recover a token that authorizes the WHOLE /api surface. Instead the server
// signs a short-lived capability bound to ONE slug, keyed by the dashboard
// secret. A leak from inside an artifact then only authorizes that slug's
// files. The slug is bound into the MAC input, so a token minted for slug A
// fails verification against slug B automatically.
const ARTIFACT_TTL_MS = 6 * 60 * 60 * 1000; // 6h: long enough for a left-open tab

function artifactKey(secret: string): Buffer {
  // Derive a sub-key so the raw DASHBOARD_TOKEN is never the literal HMAC key.
  return crypto.createHmac('sha256', secret).update('bunker-artifact-v1').digest();
}

export function signArtifact(slug: string, secret: string, exp?: number): { t: string; exp: number } {
  const expMs = exp ?? Date.now() + ARTIFACT_TTL_MS;
  const t = crypto
    .createHmac('sha256', artifactKey(secret))
    .update(`${slug}\n${expMs}`)
    .digest('hex');
  return { t, exp: expMs };
}

export function verifyArtifact(slug: string, exp: number, t: string, secret: string): boolean {
  if (!secret || !slug || !t || !Number.isFinite(exp)) return false;
  if (Date.now() > exp) return false;
  const expected = signArtifact(slug, secret, exp).t;
  const a = Buffer.from(t);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return crypto.timingSafeEqual(a, b);
}

export interface BunkerMeta {
  title?: string;
  task?: string;
  tags?: string[];
  created?: string; // ISO
  pinned?: boolean;
  promoted?: string; // vault path once promoted (absent = still transient)
}

export interface BunkerEntry {
  slug: string;
  title: string;
  task: string | null;
  tags: string[];
  created: string; // ISO
  pinned: boolean;
  url: string; // same-origin, token-gated path under /api/bunker-files
  archived: boolean;
  promoted: boolean; // true once saved to the vault (searchable)
}

function ensureDirs(): void {
  fs.mkdirSync(BUNKER_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function safeSlug(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]/g, '');
}

function listSlugs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);
}

function entryFile(dir: string): string | null {
  if (fs.existsSync(path.join(dir, 'index.html'))) return 'index.html';
  try {
    return fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.html')) ?? null;
  } catch {
    return null;
  }
}

function readMeta(dir: string): BunkerMeta {
  const p = path.join(dir, 'meta.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as BunkerMeta;
  } catch {
    return {};
  }
}

function writeMeta(dir: string, meta: BunkerMeta): void {
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

function titleFromHtml(file: string): string | null {
  try {
    const html = fs.readFileSync(file, 'utf8').slice(0, 8192);
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function buildEntry(root: string, slug: string, archived: boolean, secret: string): BunkerEntry | null {
  const dir = path.join(root, slug);
  const file = entryFile(dir);
  if (!file) return null;
  const meta = readMeta(dir);
  const stat = fs.statSync(path.join(dir, file));
  const created = meta.created ?? new Date(stat.mtimeMs).toISOString();
  const title = meta.title ?? titleFromHtml(path.join(dir, file)) ?? slug;
  const base = archived ? '/api/bunker-files/_archive' : '/api/bunker-files';
  // Per-slug scoped capability instead of the master token (see signArtifact).
  const { t, exp } = signArtifact(slug, secret);
  return {
    slug,
    title,
    task: meta.task ?? null,
    tags: meta.tags ?? [],
    created,
    pinned: meta.pinned ?? false,
    url: `${base}/${encodeURIComponent(slug)}/${file}?t=${t}&exp=${exp}`,
    archived,
    promoted: Boolean(meta.promoted),
  };
}

function refTimeMs(dir: string, meta: BunkerMeta): number {
  if (meta.created) {
    const t = Date.parse(meta.created);
    if (!Number.isNaN(t)) return t;
  }
  const file = entryFile(dir);
  if (file) return fs.statSync(path.join(dir, file)).mtimeMs;
  return Date.now();
}

// Move unpinned entries older than EXPIRE_DAYS into the archive (recoverable,
// not deleted). Runs lazily on each list call so no extra cron is needed.
export function sweepExpired(): string[] {
  ensureDirs();
  const cutoff = Date.now() - EXPIRE_DAYS * DAY_MS;
  const moved: string[] = [];
  for (const slug of listSlugs(BUNKER_DIR)) {
    const dir = path.join(BUNKER_DIR, slug);
    const meta = readMeta(dir);
    if (meta.pinned) continue;
    if (refTimeMs(dir, meta) < cutoff) {
      const dest = path.join(ARCHIVE_DIR, slug);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(dir, dest);
      moved.push(slug);
    }
  }
  return moved;
}

// `secret` signs each entry's scoped artifact capability (pass DASHBOARD_TOKEN).
export function listEntries(secret: string): BunkerEntry[] {
  ensureDirs();
  sweepExpired();
  return listSlugs(BUNKER_DIR)
    .map((slug) => buildEntry(BUNKER_DIR, slug, false, secret))
    .filter((e): e is BunkerEntry => e !== null)
    .sort((a, b) =>
      a.pinned === b.pinned ? b.created.localeCompare(a.created) : a.pinned ? -1 : 1,
    );
}

export function listArchived(secret: string): BunkerEntry[] {
  ensureDirs();
  return listSlugs(ARCHIVE_DIR)
    .map((slug) => buildEntry(ARCHIVE_DIR, slug, true, secret))
    .filter((e): e is BunkerEntry => e !== null)
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function setPinned(slug: string, pinned: boolean): boolean {
  const dir = path.join(BUNKER_DIR, safeSlug(slug));
  if (!fs.existsSync(dir)) return false;
  const meta = readMeta(dir);
  meta.pinned = pinned;
  writeMeta(dir, meta);
  return true;
}

export function archiveEntry(slug: string): boolean {
  const s = safeSlug(slug);
  const dir = path.join(BUNKER_DIR, s);
  if (!fs.existsSync(dir)) return false;
  ensureDirs();
  const dest = path.join(ARCHIVE_DIR, s);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(dir, dest);
  return true;
}

// Plain-text extraction so the promoted markdown is grep/context-searchable.
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Promote a transient artifact into the vault: copies the rendered HTML and
// writes a searchable markdown note (frontmatter + extracted text) next to it.
// Looks in both the active and archive dirs. Idempotent: re-promoting overwrites.
// Returns the vault markdown path, or null if the slug is not found.
export function promoteEntry(slug: string): { vaultPath: string } | null {
  const s = safeSlug(slug);
  let dir = path.join(BUNKER_DIR, s);
  if (!fs.existsSync(dir)) dir = path.join(ARCHIVE_DIR, s);
  if (!fs.existsSync(dir)) return null;
  const file = entryFile(dir);
  if (!file) return null;

  const meta = readMeta(dir);
  const htmlPath = path.join(dir, file);
  const title = meta.title ?? titleFromHtml(htmlPath) ?? s;
  const created = meta.created ?? new Date(fs.statSync(htmlPath).mtimeMs).toISOString();
  const html = fs.readFileSync(htmlPath, 'utf8');
  const text = stripHtml(html).slice(0, 20000);

  const destDir = path.join(VAULT_BUNKER_DIR, `${created.slice(0, 10)}-${s}`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, file), html);

  const tags = (meta.tags ?? []).map((t) => JSON.stringify(t)).join(', ');
  const fm = [
    '---',
    `title: ${JSON.stringify(title)}`,
    'source: ccos-bunker',
    `slug: ${s}`,
    meta.task ? `task: ${JSON.stringify(meta.task)}` : undefined,
    `tags: [${tags}]`,
    `created: ${created}`,
    `promoted: ${new Date().toISOString()}`,
    '---',
  ].filter((l): l is string => l !== undefined).join('\n');
  const md =
    `${fm}\n\n# ${title}\n\n` +
    (meta.task ? `**Task:** ${meta.task}\n\n` : '') +
    `Rendered artifact: [${file}](./${file})\n\n## Extracted text\n\n${text}\n`;
  const mdPath = path.join(destDir, `${s}.md`);
  fs.writeFileSync(mdPath, md);

  meta.promoted = mdPath;
  writeMeta(dir, meta);
  return { vaultPath: mdPath };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// Resolve a request sub-path (everything after /api/bunker-files/) to a file
// on disk, with a traversal guard. Supports the `_archive/...` prefix.
export function resolveArtifact(
  subPath: string,
): { data: Buffer; contentType: string } | null {
  let root = BUNKER_DIR;
  let rel = subPath.replace(/^\/+/, '');
  if (rel === '_archive' || rel.startsWith('_archive/')) {
    root = ARCHIVE_DIR;
    rel = rel.slice('_archive'.length).replace(/^\/+/, '');
  }
  rel = decodeURIComponent(rel);
  const filePath = path.join(root, rel);
  if (!filePath.startsWith(root + path.sep)) return null; // lexical traversal guard
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;

  // Symlink-traversal guard: the lexical check above can't see a symlink whose
  // target escapes the root (statSync follows links). Resolve both sides to
  // their real on-disk paths and re-check containment. realpathSync throws if a
  // path is missing/broken, so treat any throw as "not found" -> null.
  let realFile: string;
  let realRoot: string;
  try {
    realFile = fs.realpathSync(filePath);
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }
  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) return null;

  const ext = path.extname(realFile).toLowerCase();
  return {
    data: fs.readFileSync(realFile),
    contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
  };
}
