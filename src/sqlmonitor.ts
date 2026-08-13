// SQL Monitor — inventory + browse + (scoped) MODERATION surface for the
// operational SQLite DBs on the laptop, served to the LOCAL-ONLY claudeclaw
// dashboard (:3141).
//
// DELIBERATELY SELF-CONTAINED: this module shares NO code with databases.ts. It
// duplicates a handful of small read-only helpers on purpose so the existing
// /databases catalog page can never be affected by changes here (Mike's ask:
// "a new page so we're not messing anything up in the database page").
//
// SECURITY MODEL (identical posture to databases.ts): only ids registered in
// SQL_REGISTRY below ever resolve to a path — the client passes an id, never a
// path, so there is no traversal surface. Reads open the DB readonly and SQL is
// SELECT-only (guarded).
//
// MODERATION (added 2026-06-25, Mike's ask "moderate the DBs"): a CURATED subset
// of DBs is flagged `writable`. Only those accept single-row UPDATE/DELETE/INSERT
// — addressed by rowid, never free-form SQL. EVERY write is guarded three ways:
//   1) CONFIRM — the client shows the row + a typed confirm before calling.
//   2) AUTO-BACKUP — the whole DB file is snapshotted before the write, and the
//      exact before-image row is captured (one-click undo).
//   3) AUDIT — every mutation lands in a SEPARATE moderation_audit.sqlite (kept
//      out of the target DBs so they stay pristine — Mike: "keep DBs separate").
// Non-writable DBs stay strictly read-only, exactly as before.
import { existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);
const HOME = '/home/itsju';

// ── Registry ─────────────────────────────────────────────────────────
export type SqlGroup = 'pipeline' | 'apps' | 'state' | 'tooling' | 'internals';

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
  /** Curated allowlist: this DB accepts single-row moderation writes (edit/delete/insert).
   *  Default OFF — only safe app/site DBs are flipped on. Everything else is read-only. */
  writable?: boolean;
}

const RAW_REGISTRY: SqlEntry[] = [
  // Trade & Pipeline
  { id: 'desk-pipeline', label: 'Desk Pipeline', subtitle: 'trade events + flow alerts', group: 'pipeline', path: `${HOME}/LapClaw/pipeline/desk_pipeline.sqlite`, live: true },
  { id: 'flow', label: 'Flow Data (live)', subtitle: 'options flow stream', group: 'pipeline', path: `${HOME}/02_DATA/flow-data/flow.db`, live: true },
  { id: 'flow-archive', label: 'Flow Data (archive)', subtitle: 'rolled-off flow', group: 'pipeline', path: `${HOME}/02_DATA/flow-data/flow_archive.db` },
  { id: 'mc-options-flow', label: 'MissionCtrl — Options Flow', subtitle: 'mc pipeline flow alerts', group: 'pipeline', path: `${HOME}/web/missionctrl/pipeline/options_flow.sqlite`, live: true },
  { id: 'mc-trade-ledger', label: 'MissionCtrl — Trade Ledger', subtitle: 'mc executed-trade ledger', group: 'pipeline', path: `${HOME}/web/missionctrl/pipeline/trade_ledger.sqlite` },
  { id: 'mc-live-trades', label: 'MissionCtrl — Live Trades', subtitle: 'mc live trade feed', group: 'pipeline', path: `${HOME}/web/missionctrl/data/live_trades.sqlite`, live: true },
  { id: 'mc-verdict-history', label: 'MissionCtrl — Verdict History', subtitle: 'mc decision verdicts', group: 'pipeline', path: `${HOME}/web/missionctrl/data/verdict_history.sqlite` },
  { id: 'nightshift', label: 'Nightshift', subtitle: 'overnight improve cycles', group: 'pipeline', path: `${HOME}/cron/nightshift/nightshift.sqlite` },

  // Sites & Apps (customer-facing data — moderation enabled)
  { id: 'massage', label: 'Massage By Mike', subtitle: 'clients · bookings · sessions', group: 'apps', path: `${HOME}/web/massage/server/data/massage.sqlite`, writable: true },
  { id: 'mc-articles', label: 'MissionCtrl — Articles', subtitle: 'news / research cache', group: 'apps', path: `${HOME}/web/missionctrl/data/articles.sqlite` },
  { id: 'mc-tv-webhook-log', label: 'MissionCtrl — TV Webhook Log', subtitle: 'tradingview webhook hits', group: 'apps', path: `${HOME}/web/missionctrl/data/tv_webhook_log.sqlite` },
  { id: 'mc-dashboard-history', label: 'MissionCtrl — Dashboard History', subtitle: 'mc dashboard snapshots', group: 'apps', path: `${HOME}/web/missionctrl/data/dashboard_history.sqlite` },

  // App & Agent State
  { id: 'claudeclaw', label: 'ClaudeClaw App DB', subtitle: 'gens / sessions / store', group: 'state', path: `${HOME}/agents/claudeclaw/store/claudeclaw.db`, writable: true },
  { id: 'hermes', label: 'Hermes State', subtitle: 'gateway harness state', group: 'state', path: `${HOME}/.hermes/state.db` },
  { id: 'openclaw', label: 'OpenClaw State', subtitle: 'agent harness state', group: 'state', path: `${HOME}/.openclaw/state/openclaw.sqlite` },

  // Tooling & Logs
  { id: 'metrics', label: 'Metrics', subtitle: 'system metrics', group: 'tooling', path: `${HOME}/metrics/metrics.db`, live: true },
  { id: 'n8n', label: 'n8n', subtitle: 'workflow automation', group: 'tooling', path: `${HOME}/.n8n/database.sqlite` },
  { id: 'robinhood', label: 'Robinhood CLI', subtitle: 'printing-press RH cache', group: 'tooling', path: `${HOME}/.local/share/robinhood-pp-cli/data.db` },
  { id: 'codex-logs', label: 'Codex Logs', subtitle: 'codex CLI history', group: 'tooling', path: `${HOME}/.codex/logs_2.sqlite` },
  { id: 'mc-kb-access', label: 'mc-kb Access Log', subtitle: 'RAG query log', group: 'tooling', path: `${HOME}/02_DATA/mc-kb/access-log.sqlite` },

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
  { id: 'apps', label: 'Sites & Apps' },
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
  writable: boolean;    // moderation (single-row edit/delete/insert) enabled
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
    writable: !!e.writable,
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

// ═════════════════════════════════════════════════════════════════════
//  MODERATION — scoped single-row writes (edit / delete / insert)
//  Only DBs flagged `writable` in the registry accept these. Every write is
//  CONFIRM-gated (client), AUTO-BACKED-UP (file snapshot + before-image row),
//  and AUDITED to a SEPARATE moderation_audit.sqlite.
// ═════════════════════════════════════════════════════════════════════

const AUDIT_PATH = `${HOME}/agents/claudeclaw/store/moderation_audit.sqlite`;
const BACKUP_DIR = `${HOME}/backups/db-moderation`;
const BACKUP_THROTTLE_MS = 60 * 1000;   // at most one file snapshot per DB per minute
const MOD_ROW_CAP = 200;                // rows per moderation page

function quoteIdent(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// ── Audit DB (lazy singleton; its own file, never touches target DBs) ──
let _auditDb: Database.Database | null = null;
function auditDb(): Database.Database {
  if (_auditDb) return _auditDb;
  const d = new Database(AUDIT_PATH);
  d.pragma('journal_mode = WAL');
  d.pragma('busy_timeout = 5000');
  d.exec(`CREATE TABLE IF NOT EXISTS mutations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    db_id       TEXT NOT NULL,
    db_label    TEXT,
    db_path     TEXT NOT NULL,
    tbl         TEXT NOT NULL,
    action      TEXT NOT NULL,          -- update | delete | insert
    row_key     TEXT,                   -- JSON {rowid} or {pk:{...}}
    before_json TEXT,                   -- full before-image row (null for insert)
    after_json  TEXT,                   -- full after-image row (null for delete)
    ip          TEXT,
    backup_path TEXT,
    undone_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mut_ts ON mutations(ts);`);
  _auditDb = d;
  return d;
}

// ── File snapshot before a write (throttled; consistent under WAL) ──
const _lastBackup = new Map<string, { ms: number; path: string }>();
async function backupBeforeWrite(e: SqlEntry, src: Database.Database): Promise<string> {
  const prev = _lastBackup.get(e.id);
  if (prev && Date.now() - prev.ms < BACKUP_THROTTLE_MS && existsSync(prev.path)) return prev.path;
  const dir = `${BACKUP_DIR}/${e.id}`;
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${dir}/${stamp}.sqlite`;
  try {
    await src.backup(dest);          // online backup — safe while the DB is in use
  } catch {
    // Fallback: plain file copy (source may momentarily lock); best-effort.
    try { copyFileSync(e.path, dest); } catch { /* ignore */ }
  }
  _lastBackup.set(e.id, { ms: Date.now(), path: dest });
  return dest;
}

// ── Table introspection (writable target only) ──
interface TableShape {
  cols: Array<{ name: string; type: string; notnull: number; dflt: unknown; pk: number }>;
  hasRowid: boolean;       // false for WITHOUT ROWID tables
  pkCols: string[];        // declared primary-key columns
}
function tableShape(dbh: Database.Database, table: string): TableShape | null {
  if (!listUserTables(dbh).includes(table)) return null;   // real user table only (no views / FTS shadows)
  const cols = dbh.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as TableShape['cols'];
  if (!cols.length) return null;
  // WITHOUT ROWID tables report nothing for `SELECT rowid`; detect via the create SQL.
  const ddl = (dbh.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string } | undefined)?.sql || '';
  const hasRowid = !/WITHOUT\s+ROWID/i.test(ddl);
  const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  return { cols, hasRowid, pkCols };
}

// Resolve the WHERE clause + params for a single addressed row.
function keyClause(shape: TableShape, key: { rowid?: number | string; pk?: Record<string, unknown> }):
  { where: string; params: unknown[] } | { error: string } {
  if (shape.hasRowid && key.rowid != null) return { where: 'rowid = ?', params: [key.rowid] };
  if (shape.pkCols.length && key.pk) {
    const params: unknown[] = [];
    for (const c of shape.pkCols) {
      if (!(c in key.pk)) return { error: `missing primary-key value for "${c}"` };
      params.push(key.pk[c]);
    }
    return { where: shape.pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND '), params };
  }
  return { error: 'row is not addressable (no rowid and no primary key)' };
}

// ── Read a writable table as addressable rows (rowid + columns) ──
export interface ModRowsResult {
  id: string; label: string; table: string; writable: boolean;
  columns: string[];          // real columns (excludes the synthetic __rowid)
  hasRowid: boolean; pkCols: string[];
  rows: Array<{ __key: { rowid?: number | string; pk?: Record<string, unknown> }; cells: unknown[] }>;
  total: number; offset: number; capped: boolean;
}
export function getModerationRows(id: string, table: string, limit = MOD_ROW_CAP, offset = 0): ModRowsResult | { error: string } {
  const e = getEntry(id);
  if (!e) return { error: 'unknown sql db' };
  if (!e.writable) return { error: 'this database is read-only (moderation not enabled)' };
  const lim = Math.max(1, Math.min(MOD_ROW_CAP, Math.floor(limit) || MOD_ROW_CAP));
  const off = Math.max(0, Math.floor(offset) || 0);
  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(e.path, { readonly: true });
    dbh.pragma('busy_timeout = 5000');
    const shape = tableShape(dbh, table);
    if (!shape) return { error: 'unknown or non-editable table' };
    const columns = shape.cols.map((c) => c.name);
    const total = (dbh.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get() as { n: number }).n;
    const sel = shape.hasRowid ? `SELECT rowid AS __rowid, * FROM ${quoteIdent(table)}` : `SELECT * FROM ${quoteIdent(table)}`;
    const stmt = dbh.prepare(`${sel} LIMIT ? OFFSET ?`);
    const raw = stmt.all(lim, off) as Array<Record<string, unknown>>;
    const rows = raw.map((r) => {
      const cells = columns.map((c) => r[c]);
      const __key: { rowid?: number | string; pk?: Record<string, unknown> } = {};
      if (shape.hasRowid) __key.rowid = r.__rowid as number;
      else if (shape.pkCols.length) { __key.pk = {}; for (const c of shape.pkCols) __key.pk[c] = r[c]; }
      return { __key, cells };
    });
    return {
      id: e.id, label: e.label, table, writable: true,
      columns, hasRowid: shape.hasRowid, pkCols: shape.pkCols,
      rows, total, offset: off, capped: total > off + rows.length,
    };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

// Fetch a single addressed row's current values (the before-image), keyed object form.
function fetchRow(dbh: Database.Database, table: string, shape: TableShape,
                  key: { rowid?: number | string; pk?: Record<string, unknown> }): Record<string, unknown> | null {
  const kc = keyClause(shape, key);
  if ('error' in kc) return null;
  const sel = shape.hasRowid
    ? `SELECT rowid AS __rowid, * FROM ${quoteIdent(table)} WHERE ${kc.where}`
    : `SELECT * FROM ${quoteIdent(table)} WHERE ${kc.where}`;
  return (dbh.prepare(sel).get(...kc.params) as Record<string, unknown>) || null;
}

export interface MutationResult { ok: true; auditId: number; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; backup: string; }

function logMutation(e: SqlEntry, table: string, action: string,
                     key: unknown, before: unknown, after: unknown, ip: string, backup: string): number {
  const info = auditDb().prepare(`INSERT INTO mutations
    (ts, db_id, db_label, db_path, tbl, action, row_key, before_json, after_json, ip, backup_path)
    VALUES (@ts,@db_id,@db_label,@db_path,@tbl,@action,@row_key,@before_json,@after_json,@ip,@backup_path)`).run({
      ts: new Date().toISOString(), db_id: e.id, db_label: e.label, db_path: e.path, tbl: table, action,
      row_key: key == null ? null : JSON.stringify(key),
      before_json: before == null ? null : JSON.stringify(before),
      after_json: after == null ? null : JSON.stringify(after),
      ip: ip || '', backup_path: backup || '',
    });
  return Number(info.lastInsertRowid);
}

// ── UPDATE one row ──
export async function updateRow(id: string, table: string,
  key: { rowid?: number | string; pk?: Record<string, unknown> },
  changes: Record<string, unknown>, ip = ''): Promise<MutationResult | { error: string }> {
  const e = getEntry(id);
  if (!e) return { error: 'unknown sql db' };
  if (!e.writable) return { error: 'this database is read-only (moderation not enabled)' };
  if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) return { error: 'no changes supplied' };
  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(e.path);
    dbh.pragma('busy_timeout = 5000');
    const shape = tableShape(dbh, table);
    if (!shape) return { error: 'unknown or non-editable table' };
    const valid = new Set(shape.cols.map((c) => c.name));
    const setCols = Object.keys(changes).filter((c) => c !== '__rowid');
    for (const c of setCols) if (!valid.has(c)) return { error: `unknown column "${c}"` };
    if (!setCols.length) return { error: 'no valid columns to update' };
    const kc = keyClause(shape, key);
    if ('error' in kc) return { error: kc.error };
    const before = fetchRow(dbh, table, shape, key);
    if (!before) return { error: 'row not found' };
    const backup = await backupBeforeWrite(e, dbh);
    const setSql = setCols.map((c) => `${quoteIdent(c)} = ?`).join(', ');
    const res = dbh.prepare(`UPDATE ${quoteIdent(table)} SET ${setSql} WHERE ${kc.where}`)
      .run(...setCols.map((c) => changes[c] as unknown), ...kc.params);
    if (res.changes !== 1) return { error: `expected to update 1 row, updated ${res.changes}` };
    const after = fetchRow(dbh, table, shape, key);
    const auditId = logMutation(e, table, 'update', key, before, after, ip, backup);
    return { ok: true, auditId, before, after, backup };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

// ── DELETE one row ──
export async function deleteRow(id: string, table: string,
  key: { rowid?: number | string; pk?: Record<string, unknown> }, ip = ''): Promise<MutationResult | { error: string }> {
  const e = getEntry(id);
  if (!e) return { error: 'unknown sql db' };
  if (!e.writable) return { error: 'this database is read-only (moderation not enabled)' };
  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(e.path);
    dbh.pragma('busy_timeout = 5000');
    const shape = tableShape(dbh, table);
    if (!shape) return { error: 'unknown or non-editable table' };
    const kc = keyClause(shape, key);
    if ('error' in kc) return { error: kc.error };
    const before = fetchRow(dbh, table, shape, key);
    if (!before) return { error: 'row not found' };
    const backup = await backupBeforeWrite(e, dbh);
    const res = dbh.prepare(`DELETE FROM ${quoteIdent(table)} WHERE ${kc.where}`).run(...kc.params);
    if (res.changes !== 1) return { error: `expected to delete 1 row, deleted ${res.changes}` };
    const auditId = logMutation(e, table, 'delete', key, before, null, ip, backup);
    return { ok: true, auditId, before, after: null, backup };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

// ── INSERT one row ──
export async function insertRow(id: string, table: string,
  values: Record<string, unknown>, ip = ''): Promise<MutationResult | { error: string }> {
  const e = getEntry(id);
  if (!e) return { error: 'unknown sql db' };
  if (!e.writable) return { error: 'this database is read-only (moderation not enabled)' };
  if (!values || typeof values !== 'object' || !Object.keys(values).length) return { error: 'no values supplied' };
  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(e.path);
    dbh.pragma('busy_timeout = 5000');
    const shape = tableShape(dbh, table);
    if (!shape) return { error: 'unknown or non-editable table' };
    const valid = new Set(shape.cols.map((c) => c.name));
    const cols = Object.keys(values).filter((c) => c !== '__rowid');
    for (const c of cols) if (!valid.has(c)) return { error: `unknown column "${c}"` };
    if (!cols.length) return { error: 'no valid columns to insert' };
    const backup = await backupBeforeWrite(e, dbh);
    const res = dbh.prepare(`INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => values[c] as unknown));
    const key = shape.hasRowid ? { rowid: Number(res.lastInsertRowid) } : { pk: Object.fromEntries(shape.pkCols.map((c) => [c, values[c]])) };
    const after = fetchRow(dbh, table, shape, key);
    const auditId = logMutation(e, table, 'insert', key, null, after, ip, backup);
    return { ok: true, auditId, before: null, after, backup };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

// ── Audit log (recent mutations) ──
export interface AuditEntry {
  id: number; ts: string; db_id: string; db_label: string | null; tbl: string;
  action: string; row_key: string | null; before_json: string | null; after_json: string | null;
  ip: string | null; backup_path: string | null; undone_at: string | null;
}
export function getAuditLog(limit = 100, dbId?: string): { entries: AuditEntry[] } {
  try {
    const d = auditDb();
    const rows = dbId
      ? d.prepare('SELECT * FROM mutations WHERE db_id=? ORDER BY id DESC LIMIT ?').all(dbId, Math.min(500, limit))
      : d.prepare('SELECT * FROM mutations ORDER BY id DESC LIMIT ?').all(Math.min(500, limit));
    return { entries: rows as AuditEntry[] };
  } catch {
    return { entries: [] };
  }
}

// ── Undo a mutation (restore the before-image / remove an inserted row) ──
export async function undoMutation(auditId: number, ip = ''): Promise<{ ok: true; action: string } | { error: string }> {
  const d = auditDb();
  const m = d.prepare('SELECT * FROM mutations WHERE id=?').get(auditId) as AuditEntry | undefined;
  if (!m) return { error: 'audit entry not found' };
  if (m.undone_at) return { error: 'already undone' };
  const e = getEntry(m.db_id);
  if (!e || !e.writable) return { error: 'source DB is not writable' };
  const key = m.row_key ? JSON.parse(m.row_key) as { rowid?: number | string; pk?: Record<string, unknown> } : null;
  const before = m.before_json ? JSON.parse(m.before_json) as Record<string, unknown> : null;
  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(e.path);
    dbh.pragma('busy_timeout = 5000');
    const shape = tableShape(dbh, m.tbl);
    if (!shape) return { error: 'table no longer exists' };
    await backupBeforeWrite(e, dbh);
    if (m.action === 'delete') {
      // Re-insert the deleted row (drop the synthetic __rowid; re-pin rowid if integer PK absent).
      if (!before) return { error: 'no before-image to restore' };
      const cols = Object.keys(before).filter((c) => c !== '__rowid');
      dbh.prepare(`INSERT INTO ${quoteIdent(m.tbl)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => before[c] as unknown));
    } else if (m.action === 'update') {
      if (!before || !key) return { error: 'no before-image to restore' };
      const kc = keyClause(shape, key);
      if ('error' in kc) return { error: kc.error };
      const cols = Object.keys(before).filter((c) => c !== '__rowid');
      const setSql = cols.map((c) => `${quoteIdent(c)} = ?`).join(', ');
      dbh.prepare(`UPDATE ${quoteIdent(m.tbl)} SET ${setSql} WHERE ${kc.where}`)
        .run(...cols.map((c) => before[c] as unknown), ...kc.params);
    } else if (m.action === 'insert') {
      if (!key) return { error: 'no key to remove' };
      const kc = keyClause(shape, key);
      if ('error' in kc) return { error: kc.error };
      dbh.prepare(`DELETE FROM ${quoteIdent(m.tbl)} WHERE ${kc.where}`).run(...kc.params);
    } else {
      return { error: `cannot undo action "${m.action}"` };
    }
    d.prepare('UPDATE mutations SET undone_at=? WHERE id=?').run(new Date().toISOString(), auditId);
    logMutation(e, m.tbl, `undo-${m.action}`, key, m.after_json ? JSON.parse(m.after_json) : null, before, ip, '');
    return { ok: true, action: m.action };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}
