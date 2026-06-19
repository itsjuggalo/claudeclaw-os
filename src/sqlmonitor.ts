// SQL Monitor — read-only inventory + browse surface for the operational SQLite
// DBs on the laptop, served to the LOCAL-ONLY claudeclaw dashboard (:3141).
//
// DELIBERATELY SELF-CONTAINED: this module shares NO code with databases.ts. It
// duplicates a handful of small read-only helpers on purpose so the existing
// /databases catalog page can never be affected by changes here (Mike's ask:
// "a new page so we're not messing anything up in the database page").
//
// SECURITY MODEL (identical posture to databases.ts): only ids registered in
// SQL_REGISTRY below ever resolve to a path — the client passes an id, never a
// path, so there is no traversal surface. Every DB is opened readonly and SQL is
// SELECT-only (guarded). No write/action routes exist — these are system DBs.
import { existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);
const HOME = '/home/itsju';

// ── Registry ─────────────────────────────────────────────────────────
export type SqlGroup = 'pipeline' | 'state' | 'tooling' | 'internals';

interface SqlEntry {
  id: string;
  label: string;
  subtitle?: string;
  group: SqlGroup;
  path: string;
  /** Expected to be written continuously — gets a "stale" badge if quiet >24h. */
  live?: boolean;
  /** Plumbing (own UI / agent memory / watchdog): collected under "Internals". */
  infra?: boolean;
}

const RAW_REGISTRY: SqlEntry[] = [
  // Trade & Pipeline
  { id: 'desk-pipeline', label: 'Desk Pipeline', subtitle: 'trade events + flow alerts', group: 'pipeline', path: `${HOME}/LapClaw/pipeline/desk_pipeline.sqlite`, live: true },
  { id: 'flow', label: 'Flow Data (live)', subtitle: 'options flow stream', group: 'pipeline', path: `${HOME}/02_DATA/flow-data/flow.db`, live: true },
  { id: 'flow-archive', label: 'Flow Data (archive)', subtitle: 'rolled-off flow', group: 'pipeline', path: `${HOME}/02_DATA/flow-data/flow_archive.db` },

  // App & Agent State
  { id: 'claudeclaw', label: 'ClaudeClaw App DB', subtitle: 'gens / sessions / store', group: 'state', path: `${HOME}/agents/claudeclaw/store/claudeclaw.db` },
  { id: 'hermes', label: 'Hermes State', subtitle: 'gateway harness state', group: 'state', path: `${HOME}/.hermes/state.db` },
  { id: 'openclaw', label: 'OpenClaw State', subtitle: 'agent harness state', group: 'state', path: `${HOME}/.openclaw/state/openclaw.sqlite` },

  // Tooling & Logs
  { id: 'metrics', label: 'Metrics', subtitle: 'system metrics', group: 'tooling', path: `${HOME}/metrics/metrics.db`, live: true },
  { id: 'n8n', label: 'n8n', subtitle: 'workflow automation', group: 'tooling', path: `${HOME}/.n8n/database.sqlite` },
  { id: 'robinhood', label: 'Robinhood CLI', subtitle: 'printing-press RH cache', group: 'tooling', path: `${HOME}/.local/share/robinhood-pp-cli/data.db` },
  { id: 'codex-logs', label: 'Codex Logs', subtitle: 'codex CLI history', group: 'tooling', path: `${HOME}/.codex/logs_2.sqlite` },

  // Internals (infra) — collected behind a toggle
  { id: 'kuma', label: 'Uptime Kuma', subtitle: 'has its own UI', group: 'internals', path: `${HOME}/uptime-kuma/data/kuma.db`, infra: true },
  { id: 'mem-boba', label: 'Boba — agent memory', group: 'internals', path: `${HOME}/.openclaw/memory/boba.sqlite`, infra: true },
  { id: 'mem-jazzy', label: 'JazzyHazzy — agent memory', group: 'internals', path: `${HOME}/.openclaw/memory/jazzyhazzy.sqlite`, infra: true },
  { id: 'mem-main', label: 'Main — agent memory', group: 'internals', path: `${HOME}/.openclaw/memory/main.sqlite`, infra: true },
  { id: 'background-tasks', label: 'Background Tasks (watchdog)', group: 'internals', path: `${HOME}/background_tasks.sqlite`, infra: true },
];

// Skip any path that doesn't exist so a missing file never crashes the catalog.
const SQL_REGISTRY: SqlEntry[] = RAW_REGISTRY.filter((e) => existsSync(e.path));

function getEntry(id: string): SqlEntry | null {
  return SQL_REGISTRY.find((e) => e.id === id) ?? null;
}

const GROUP_ORDER: Array<{ id: SqlGroup; label: string }> = [
  { id: 'pipeline', label: 'Trade & Pipeline' },
  { id: 'state', label: 'App & Agent State' },
  { id: 'tooling', label: 'Tooling & Logs' },
  { id: 'internals', label: 'Internals' },
];

// ── Small read-only helpers (duplicated on purpose; see header) ───────
async function duSize(target: string): Promise<{ size: string; bytes: number }> {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', target], { timeout: 5000 });
    const bytes = parseInt(stdout.split(/\s+/)[0] || '', 10);
    const b = Number.isFinite(bytes) ? bytes : 0;
    return { size: formatSize(b), bytes: b };
  } catch {
    return { size: '—', bytes: 0 };
  }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes < 1) return '—';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return (n < 10 && u > 0 ? n.toFixed(1) : Math.round(n)) + units[u];
}

/** Most-recent write across the main file AND its -wal sibling (WAL mode commits
 *  land in -wal and the main file's mtime doesn't move until a checkpoint). */
function lastWrite(path: string): { iso: string | null; walBytes: number } {
  let main = 0;
  let wal = 0;
  let walBytes = 0;
  try { main = statSync(path).mtimeMs; } catch { /* ignore */ }
  try { const s = statSync(path + '-wal'); wal = s.mtimeMs; walBytes = s.size; } catch { /* no wal */ }
  const ms = Math.max(main, wal);
  return { iso: ms > 0 ? new Date(ms).toISOString() : null, walBytes };
}

function statSig(path: string): string {
  try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; } catch { return 'na'; }
}

/** User-meaningful tables: skip sqlite_* and FTS5 shadow tables (the virtual
 *  table itself stays listed; only its _data/_idx/etc. shadows are hidden). */
function listUserTables(dbh: Database.Database): string[] {
  const rows = dbh
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string; sql: string | null }>;
  const ftsVirtual = new Set(
    rows.filter((r) => /CREATE\s+VIRTUAL\s+TABLE\b[\s\S]*\bUSING\s+fts/i.test(r.sql || '')).map((r) => r.name),
  );
  const shadow = /^(.*)_(data|idx|docsize|config|content)$/;
  return rows
    .filter((r) => {
      const m = shadow.exec(r.name);
      return !(m && ftsVirtual.has(m[1]));
    })
    .map((r) => r.name);
}

function tableCount(path: string): number {
  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(path, { readonly: true });
    dbh.pragma('busy_timeout = 4000');
    return listUserTables(dbh).length;
  } catch {
    return -1;
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

// ── Warm cache (stale-while-revalidate) ──────────────────────────────
interface WarmEntry { value: unknown; ts: number; sig: string; building: boolean; }
const _warm = new Map<string, WarmEntry>();

async function warmAsync<T>(key: string, sig: string, ttl: number, compute: () => Promise<T>): Promise<T> {
  const e = _warm.get(key);
  if (e) {
    const fresh = Date.now() - e.ts < ttl && e.sig === sig;
    if (!fresh && !e.building) {
      e.building = true;
      compute()
        .then((v) => _warm.set(key, { value: v, ts: Date.now(), sig, building: false }))
        .catch(() => { e.building = false; });
    }
    return e.value as T; // serve last good immediately
  }
  const value = await compute();
  _warm.set(key, { value, ts: Date.now(), sig, building: false });
  return value;
}

// ── Catalog ──────────────────────────────────────────────────────────
export interface SqlDbInfo {
  id: string;
  label: string;
  subtitle?: string;
  group: SqlGroup;
  size: string;
  bytes: number;
  tables: number;       // table count (-1 if the DB couldn't be opened)
  walSize: string;      // formatted -wal sibling size, '' if none
  updated: string | null;
  live: boolean;
  stale: boolean;       // live && no write in >24h
  infra: boolean;
}
export interface SqlCatalogGroup { id: SqlGroup; label: string; items: SqlDbInfo[]; }
export interface SqlCatalog { groups: SqlCatalogGroup[]; totalBytes: number; generatedAt: number; }

const STALE_MS = 24 * 60 * 60 * 1000;

async function buildInfo(e: SqlEntry): Promise<SqlDbInfo> {
  const { size, bytes } = await duSize(e.path);
  const { iso, walBytes } = lastWrite(e.path);
  const ageMs = iso ? Date.now() - Date.parse(iso) : Infinity;
  return {
    id: e.id,
    label: e.label,
    subtitle: e.subtitle,
    group: e.group,
    size,
    bytes,
    tables: tableCount(e.path),
    walSize: walBytes > 0 ? formatSize(walBytes) : '',
    updated: iso,
    live: !!e.live,
    stale: !!e.live && ageMs > STALE_MS,
    infra: !!e.infra,
  };
}

async function buildCatalog(): Promise<SqlCatalog> {
  const infos = await Promise.all(SQL_REGISTRY.map(buildInfo));
  const byId = new Map<string, SqlDbInfo>(infos.map((i) => [i.id, i]));
  const groups: SqlCatalogGroup[] = GROUP_ORDER.map((g) => ({
    id: g.id,
    label: g.label,
    items: SQL_REGISTRY.filter((e) => e.group === g.id)
      .map((e) => byId.get(e.id))
      .filter((i): i is SqlDbInfo => Boolean(i)),
  })).filter((g) => g.items.length > 0);
  const totalBytes = infos.reduce((sum, i) => sum + i.bytes, 0);
  return { groups, totalBytes, generatedAt: Date.now() };
}

let _cache: { catalog: SqlCatalog; ts: number } | null = null;
const CACHE_TTL = 30 * 1000;
let _building = false;

export async function getSqlCatalog(): Promise<SqlCatalog> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_TTL) return _cache.catalog;
  if (_building && _cache) return _cache.catalog;
  if (_cache) {
    _building = true;
    buildCatalog()
      .then((cat) => { _cache = { catalog: cat, ts: Date.now() }; })
      .catch(() => {})
      .finally(() => { _building = false; });
    return _cache.catalog;
  }
  _building = true;
  try {
    const catalog = await buildCatalog();
    _cache = { catalog, ts: Date.now() };
    return catalog;
  } finally {
    _building = false;
  }
}

// ── Per-DB tables + row counts ───────────────────────────────────────
export interface SqlTablesResult {
  id: string;
  label: string;
  size: string;
  updated: string | null;
  tables: Array<{ name: string; rows: number }>;
}

export async function getSqlTables(id: string): Promise<SqlTablesResult | { error: string }> {
  const e = getEntry(id);
  if (!e) return { error: 'unknown sql db' };
  try {
    // COUNT(*) changes as rows are written; in WAL mode the committed write lands
    // in -wal and the main file's mtime/size don't move until checkpoint, so
    // fingerprint BOTH (60s TTL is the backstop between checkpoints).
    const sig = `${statSig(e.path)}|${statSig(e.path + '-wal')}`;
    return await warmAsync(`sqltables:${id}`, sig, 60_000, async () => {
      const { size } = await duSize(e.path);
      const { iso } = lastWrite(e.path);
      let dbh: Database.Database | null = null;
      try {
        dbh = new Database(e.path, { readonly: true });
        dbh.pragma('busy_timeout = 4000');
        const names = listUserTables(dbh).slice(0, 80);
        const tables = names.map((name) => {
          let rows = -1;
          try {
            const r = dbh!.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number };
            rows = r.n;
          } catch {
            rows = -1;
          }
          return { name, rows };
        });
        return { id: e.id, label: e.label, size, updated: iso, tables };
      } finally {
        if (dbh) try { dbh.close(); } catch { /* ignore */ }
      }
    });
  } catch (err) {
    return { error: String((err as Error).message || err) };
  }
}

// ── SELECT-only query ────────────────────────────────────────────────
export interface SqlSelectResult {
  columns: string[];
  rows: unknown[][];
  elapsed_ms: number;
  capped: boolean;
}

const SQL_ROW_CAP = 500;

// SELECT-only guard: reject multi-statement, write/DDL keywords, and anything
// that doesn't begin with SELECT/WITH. (Same posture as databases.ts.)
function rejectSql(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return 'Only a single SELECT/WITH query is allowed';
  if (/;\s*\S/.test(trimmed)) return 'Only a single SELECT/WITH query is allowed';
  if (!/^\s*(with|select)\b/i.test(trimmed)) return 'Only a single SELECT/WITH query is allowed';
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex)\b/i.test(trimmed)) {
    return 'Only a single SELECT/WITH query is allowed';
  }
  return null;
}

export function runSqlSelect(id: string, sql: string): SqlSelectResult | { error: string } {
  const e = getEntry(id);
  if (!e) return { error: 'unknown sql db' };
  const violation = rejectSql(sql);
  if (violation) return { error: violation };

  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(e.path, { readonly: true });
    dbh.pragma('busy_timeout = 4000');
    const stmt = dbh.prepare(sql.trim());
    stmt.raw(true);
    const t0 = Date.now();
    const rows: unknown[][] = [];
    let capped = false;
    for (const row of stmt.iterate() as IterableIterator<unknown[]>) {
      if (rows.length >= SQL_ROW_CAP) { capped = true; break; }
      rows.push(row);
    }
    const elapsed_ms = Date.now() - t0;
    const columns = stmt.columns().map((c) => c.name);
    return { columns, rows, elapsed_ms, capped };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

// Prime the catalog on boot so the operator's first load is already warm.
export async function warmupSqlMonitor(): Promise<void> {
  try { await getSqlCatalog(); } catch { /* ignore */ }
}
