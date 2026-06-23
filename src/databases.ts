// Databases catalog — read-only inventory + query surface for the LOCAL-ONLY
// claudeclaw dashboard (:3141). Exposes the laptop's knowledge bases (RAG),
// trade/pipeline/state SQLite DBs, RAG/FTS indexes, and a masked secrets view.
//
// SECURITY MODEL: only ids registered in REGISTRY below ever resolve to a path.
// There is no path passed in from the client — callers reference a db by its
// registered `id`, so there is no path-traversal surface. SQL is SELECT-only
// (guarded), DBs are opened readonly, and secret values are never returned by
// the catalog/list endpoints (only by the explicit, allow-listed reveal call).
import { readFileSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { sep as pathSep } from 'node:path';

// Stale / non-secret files to hide from the listing + block from reveal:
// dotfiles (.git, .gitignore) and superseded copies (.bak / .deleted / .old).
const STALE_SECRET = /^\.|[.-](bak|dead|deleted|old)([-.]|$)|deleted/i;
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

const HOME = '/home/itsju';
const VENV = '/home/itsju/02_DATA/mc-kb/.venv/bin/python';

/** Resolve the Python interpreter for a KB's pyDir.
 *  Use the KB's own .venv if present (future-proof); otherwise fall back to
 *  the shared mc-kb venv which already has lancedb + sentence-transformers. */
function kbPython(pyDir: string): string {
  const own = join(pyDir, '.venv', 'bin', 'python');
  return existsSync(own) ? own : VENV;
}

// ── Registry ─────────────────────────────────────────────────────────
export type DbType = 'kb' | 'sql' | 'secrets';
export type DbGroup = 'kb' | 'sql' | 'state' | 'index' | 'secrets' | 'internals';

export interface RegistryEntry {
  id: string;
  type: DbType;
  group: DbGroup;
  label: string;
  subtitle?: string;
  accent?: string;
  path: string;      // dir (kb) or file (sql); '' for secrets
  pyDir?: string;    // kb root dir for query.py/ask.py
  askable?: boolean;
  searchUrl?: string; // warm RAG server (semantic /query) — fast-path for kbSearch
  /** Plumbing the operator rarely needs (FTS indexes, empty agent memories,
   *  watchdog state). Collected into a collapsed "Internals" group instead of
   *  the main catalog sections. Deep links still resolve normally. */
  infra?: boolean;
}

const RAW_REGISTRY: RegistryEntry[] = [
  // Knowledge Bases (RAG)
  // claytrader/erikdalton/vibecoding point at the shared warm server on :8095
  // (kb-warm-server PM2 app, ~/kb-warm-server/server.py). It keeps the embedding
  // model + LanceDB tables resident so a query is ~0.4-1.6s instead of the ~40-54s
  // cold load of spawning query.py. kbSearch falls back to query.py automatically
  // if the server is down (kbSearchViaServer returns null), so search never breaks.
  // mc-kb keeps its own :8091 warm-server path. Each ?kb= routes to that KB.
  { id: 'claytrader', type: 'kb', group: 'kb', label: 'ClayTrader University', subtitle: "Clay's trading method", accent: 'amber', path: `${HOME}/claytrader-kb`, pyDir: `${HOME}/claytrader-kb`, askable: true, searchUrl: 'http://127.0.0.1:8095/query?kb=claytrader' },
  { id: 'erikdalton', type: 'kb', group: 'kb', label: 'Erik Dalton', subtitle: 'Bodywork / MAT self-care', accent: 'emerald', path: `${HOME}/erikdalton-kb`, pyDir: `${HOME}/erikdalton-kb`, askable: true, searchUrl: 'http://127.0.0.1:8095/query?kb=erikdalton' },
  { id: 'vibecoding', type: 'kb', group: 'kb', label: 'Vibe Coding Academy', subtitle: 'AI coding workflows', accent: 'violet', path: `${HOME}/vibecoding-kb`, pyDir: `${HOME}/vibecoding-kb`, askable: existsSync(`${HOME}/vibecoding-kb/ask.py`), searchUrl: 'http://127.0.0.1:8095/query?kb=vibecoding' },
  { id: 'mckb', type: 'kb', group: 'kb', label: 'mc-kb (Mission Control RAG)', subtitle: 'Bible + memory + notes', accent: 'sky', path: `${HOME}/02_DATA/mc-kb`, pyDir: `${HOME}/02_DATA/mc-kb`, askable: existsSync(`${HOME}/02_DATA/mc-kb/ask.py`), searchUrl: 'http://127.0.0.1:8091/query' },

  // Trade & Pipeline SQL
  { id: 'desk-pipeline', type: 'sql', group: 'sql', label: 'Desk Pipeline', accent: 'sky', path: `${HOME}/LapClaw/pipeline/desk_pipeline.sqlite` },
  { id: 'flow', type: 'sql', group: 'sql', label: 'Flow Data (live)', accent: 'sky', path: `${HOME}/02_DATA/flow-data/flow.db` },
  { id: 'flow-archive', type: 'sql', group: 'sql', label: 'Flow Data (archive)', accent: 'sky', path: `${HOME}/02_DATA/flow-data/flow_archive.db` },
  { id: 'background-tasks', type: 'sql', group: 'sql', label: 'Background Tasks (watchdog)', accent: 'sky', path: `${HOME}/background_tasks.sqlite`, infra: true },

  // App & Agent State
  { id: 'claudeclaw', type: 'sql', group: 'state', label: 'ClaudeClaw App DB', accent: 'cyan', path: `${HOME}/claudeclaw-os/store/claudeclaw.db` },
  { id: 'mem-boba', type: 'sql', group: 'state', label: 'Boba — agent memory', accent: 'cyan', path: `${HOME}/.openclaw/memory/boba.sqlite`, infra: true },
  { id: 'mem-jazzy', type: 'sql', group: 'state', label: 'JazzyHazzy — agent memory', accent: 'cyan', path: `${HOME}/.openclaw/memory/jazzyhazzy.sqlite`, infra: true },
  { id: 'mem-main', type: 'sql', group: 'state', label: 'Main — agent memory', accent: 'cyan', path: `${HOME}/.openclaw/memory/main.sqlite`, infra: true },

  // RAG / FTS Indexes
  { id: 'claytrader-fts', type: 'sql', group: 'index', label: 'ClayTrader FTS', accent: 'amber', path: `${HOME}/claytrader-kb/fts.db`, infra: true },
  { id: 'erikdalton-fts', type: 'sql', group: 'index', label: 'Erik Dalton FTS', accent: 'emerald', path: `${HOME}/erikdalton-kb/fts.db`, infra: true },
  { id: 'mckb-fts', type: 'sql', group: 'index', label: 'mc-kb FTS', accent: 'sky', path: `${HOME}/02_DATA/mc-kb/fts.db`, infra: true },
  { id: 'bible-rag', type: 'sql', group: 'index', label: 'Bible RAG index', accent: 'sky', path: `${HOME}/.bible-rag/index.sqlite`, infra: true },

  // Secrets
  { id: 'secrets', type: 'secrets', group: 'secrets', label: 'Secrets & Keys', accent: 'rose', path: '' },
];

// Skip any path that doesn't exist so a missing file never crashes the catalog.
// (secrets has no single path; its presence is handled in listSecrets.)
export const REGISTRY: RegistryEntry[] = RAW_REGISTRY.filter(
  (e) => e.type === 'secrets' || existsSync(e.path),
);

export function getEntry(id: string): RegistryEntry | null {
  return REGISTRY.find((e) => e.id === id) ?? null;
}

/** kb root dir for an id, or null if not a registered kb. */
export function getKbDir(id: string): string | null {
  const e = getEntry(id);
  if (!e || e.type !== 'kb' || !e.pyDir) return null;
  return e.pyDir;
}

// ── Catalog (SWR-cached, 60s) ────────────────────────────────────────
export interface CatalogItem {
  id: string;
  type: DbType;
  label: string;
  subtitle?: string;
  stat: string;
  size: string;
  bytes: number;
  updated: string | null;
  accent?: string;
  askable?: boolean;
}
export interface CatalogGroup {
  id: DbGroup;
  label: string;
  items: CatalogItem[];
}
export interface Catalog {
  groups: CatalogGroup[];
  totalBytes: number;
}

const GROUP_ORDER: Array<{ id: DbGroup; label: string }> = [
  { id: 'kb', label: 'Knowledge Bases' },
  { id: 'sql', label: 'Trade & Pipeline SQL' },
  { id: 'state', label: 'App & Agent State' },
  { id: 'index', label: 'RAG / FTS Indexes' },
  { id: 'secrets', label: 'Secrets & Keys' },
];

async function duSize(target: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('du', ['-sh', target], { timeout: 5000 });
    return stdout.split('\t')[0]?.trim() || '—';
  } catch {
    return '—';
  }
}

// Apparent byte size (du -sb) so the catalog can sum per-group + total sizes
// across mixed units. Returns 0 on failure (treated as "unknown" by the UI).
async function duBytes(target: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', target], { timeout: 5000 });
    const n = parseInt(stdout.split(/\s+/)[0] || '', 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
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

function mtimeISO(target: string): string | null {
  try {
    return statSync(target).mtime.toISOString();
  } catch {
    return null;
  }
}

/** List user-meaningful tables: skips sqlite_* plus FTS5 shadow tables
 *  (<vt>_data/_idx/_docsize/_config/_content) — the virtual table itself
 *  stays listed. Shadow tables remain queryable via the SQL editor; they
 *  are only hidden from listings so counts and grids reflect real schema. */
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

function sqlTableCount(path: string): string {
  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(path, { readonly: true });
    dbh.pragma('busy_timeout = 4000');
    const n = listUserTables(dbh).length;
    return `${n} ${n === 1 ? 'table' : 'tables'}`;
  } catch {
    return '—';
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

function kbChunkStat(dir: string): string {
  try {
    const raw = readFileSync(join(dir, 'sync_status.json'), 'utf-8');
    const json = JSON.parse(raw) as { reindex?: { chunks?: number }; chunks?: number };
    const chunks = json.reindex?.chunks ?? json.chunks;
    if (typeof chunks === 'number') return `${chunks} chunks`;
  } catch { /* fall through to fts.db */ }
  // Fallback: every KB's fts.db carries a meta table with chunk_count
  // (mc-kb's sync_status.json has no chunk field at all).
  let dbh: Database.Database | null = null;
  try {
    const fts = join(dir, 'fts.db');
    if (!existsSync(fts)) return '—';
    dbh = new Database(fts, { readonly: true });
    const r = dbh.prepare("SELECT value FROM meta WHERE key='chunk_count'").get() as { value?: string } | undefined;
    const n = Number(r?.value);
    if (Number.isFinite(n) && n > 0) return `${n} chunks`;
    return '—';
  } catch {
    return '—';
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

function secretsFileCount(): string {
  try {
    // Count exactly what the deep-page listing surfaces: non-stale files across
    // every allow-listed secret dir + each existing .env file.
    let n = 0;
    for (const dir of SECRET_DIRS) {
      if (!existsSync(dir)) continue;
      n += readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && !STALE_SECRET.test(d.name)).length;
    }
    n += ENV_FILES.filter((f) => existsSync(f)).length;
    return `${n} files`;
  } catch {
    return '—';
  }
}

async function buildItem(e: RegistryEntry): Promise<CatalogItem> {
  let stat = '—';
  let bytes = 0;
  let updated: string | null = null;

  try {
    if (e.type === 'kb') {
      bytes = await duBytes(e.path);
      updated = mtimeISO(e.path);
      stat = kbChunkStat(e.path);
    } else if (e.type === 'sql') {
      bytes = await duBytes(e.path);
      updated = mtimeISO(e.path);
      stat = sqlTableCount(e.path);
    } else {
      // secrets
      stat = secretsFileCount();
      const dir = join(HOME, '.openclaw/secrets');
      bytes = await duBytes(dir);
      updated = mtimeISO(dir);
    }
  } catch {
    // resilient: any per-item failure leaves defaults
  }

  return {
    id: e.id,
    type: e.type,
    label: e.label,
    subtitle: e.subtitle,
    stat,
    size: formatSize(bytes),
    bytes,
    updated,
    accent: e.accent,
    askable: e.type === 'kb' ? e.askable : undefined,
  };
}

async function buildCatalog(): Promise<Catalog> {
  const items = await Promise.all(REGISTRY.map(buildItem));
  const byId = new Map<string, CatalogItem>(items.map((it) => [it.id, it]));
  const groups: CatalogGroup[] = GROUP_ORDER.map((g) => ({
    id: g.id,
    label: g.label,
    items: REGISTRY.filter((e) => e.group === g.id && !e.infra)
      .map((e) => byId.get(e.id))
      .filter((it): it is CatalogItem => Boolean(it)),
  })).filter((g) => g.items.length > 0);

  // Infra entries (FTS indexes, empty agent memories, watchdog state) live in
  // one trailing group the client renders behind a "Show internals" toggle.
  const internals = REGISTRY.filter((e) => e.infra)
    .map((e) => byId.get(e.id))
    .filter((it): it is CatalogItem => Boolean(it));
  if (internals.length > 0) {
    groups.push({ id: 'internals', label: 'Internals', items: internals });
  }

  // Grand total de-dups nested paths: a KB dir's `du` already includes its
  // fts.db, which is ALSO registered separately under RAG/FTS Indexes — so
  // summing every item naively would count those bytes twice. Per-group
  // subtotals stay un-deduped on purpose (each is its own lens).
  const withPath = items.map((it) => ({ bytes: it.bytes, path: getEntry(it.id)?.path || '' }));
  const totalBytes = withPath.reduce((sum, a) => {
    if (!a.path) return sum + a.bytes; // secrets / pathless
    const nested = withPath.some((b) => b !== a && b.path && a.path.startsWith(b.path + pathSep));
    return nested ? sum : sum + a.bytes;
  }, 0);

  return { groups, totalBytes };
}

let _cache: { catalog: Catalog; ts: number } | null = null;
const CACHE_TTL = 60 * 1000;
let _building = false;

export async function getCatalog(): Promise<Catalog> {
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

// ── Warm caches (stale-while-revalidate) ─────────────────────────────
// Serve precomputed values so repeat loads hit memory (single-digit ms) instead
// of re-spawning a Python/LanceDB subprocess or re-opening a SQLite DB per call.
// A stale entry is returned instantly while a fresh value recomputes in the
// background. `sig` is a cheap mtime:size fingerprint — when the underlying data
// changes (rows written, KB reindexed) the next call refreshes. Errors throw out
// of `compute`, so they are never cached.
interface WarmEntry { value: unknown; ts: number; sig: string; building: boolean; }
const _warm = new Map<string, WarmEntry>();

function statSig(path: string): string {
  try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; } catch { return 'na'; }
}

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
    return e.value as T; // SWR: serve last good immediately
  }
  const value = await compute(); // first ever: pay full cost (uncached on throw)
  _warm.set(key, { value, ts: Date.now(), sig, building: false });
  return value;
}

function warmSync<T>(key: string, sig: string, ttl: number, compute: () => T): T {
  const e = _warm.get(key);
  if (e && Date.now() - e.ts < ttl && e.sig === sig) return e.value as T;
  const value = compute();
  _warm.set(key, { value, ts: Date.now(), sig, building: false });
  return value;
}

// Prime every cache on boot so the operator's first load is already warm.
export async function warmupDatabases(): Promise<void> {
  try { await getCatalog(); } catch { /* ignore */ }
  await Promise.all(REGISTRY.map(async (e) => {
    try {
      if (e.type === 'sql') await sqlMeta(e.id);
      else if (e.type === 'kb' && existsSync(join(e.path, 'kb.vectors'))) await kbSources(e.id);
    } catch { /* ignore */ }
  }));
  try { listSecrets(); } catch { /* ignore */ }
}

// ── KB search / ask ──────────────────────────────────────────────────
export interface KbHit {
  source: string;
  heading: string;
  course: string;
  preview: string;
  distance: number;
  layer: string;
}
export interface KbSearchResult {
  hits: KbHit[];
  abstained: boolean;
}

interface RawKbHit {
  source?: string;
  heading?: string;
  course?: string;
  text?: string;
  _distance?: number;
  _source_layer?: string;
}

// Fast-path: pull hits from a warm RAG HTTP server (model stays resident, so a
// query is ~2s vs the ~40s cold load of spawning query.py). Semantic-only +
// previews; callers fall back to query.py when this returns null.
async function kbSearchViaServer(url: string, q: string, top: number): Promise<KbHit[] | null> {
  try {
    // URL API so a searchUrl that already carries params (e.g. ?kb=claytrader
    // for the shared :8095 server) merges cleanly with q/top.
    const u = new URL(url);
    u.searchParams.set('q', q);
    u.searchParams.set('top', String(top));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let body: { hits?: RawKbHit[] };
    try {
      const resp = await fetch(u, { signal: ctrl.signal });
      if (!resp.ok) return null;
      body = (await resp.json()) as { hits?: RawKbHit[] };
    } finally {
      clearTimeout(timer);
    }
    const raw = Array.isArray(body.hits) ? body.hits : [];
    return raw.map((h) => ({
      source: h.source ?? '',
      heading: h.heading ?? '',
      course: h.course ?? '',
      // server hits carry `preview` (already truncated); local hits carry `text`.
      preview: ((h as { preview?: string }).preview ?? h.text ?? '').slice(0, 400),
      distance: typeof h._distance === 'number' ? h._distance : 0,
      // mc-kb colours its badge by memory tier; the server omits _source_layer.
      layer: h._source_layer ?? (h as { tier?: string }).tier ?? '',
    }));
  } catch {
    return null;
  }
}

export async function kbSearch(id: string, q: string, top = 8): Promise<KbSearchResult> {
  const entry = getEntry(id);
  const dir = getKbDir(id);
  if (!dir) return { hits: [], abstained: true };
  const topN = String(Math.max(1, Math.min(50, Math.floor(top) || 8)));

  // Warm-server fast-path. The server applies the same relevance gate as
  // query.py, so an empty response is a real abstain — trust it. Only a null
  // (server unreachable/error) falls through to the query.py spawn below, so
  // search never silently breaks if the server is down.
  if (entry?.searchUrl) {
    const fast = await kbSearchViaServer(entry.searchUrl, q, Number(topN));
    if (fast !== null) return { hits: fast, abstained: fast.length === 0 };
  }
  try {
    // execFile with an args array — q is never shell-interpolated.
    // Use the KB's own .venv if present; fall back to the shared mc-kb venv.
    // Timeout 90s: cold embedding-model load takes ~40-54s; 90s gives real headroom.
    const { stdout } = await execFileAsync(
      kbPython(dir),
      [join(dir, 'query.py'), '--json', '--top', topN, q],
      { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as RawKbHit[];
    const hits: KbHit[] = (Array.isArray(parsed) ? parsed : []).map((h) => ({
      source: h.source ?? '',
      heading: h.heading ?? '',
      course: h.course ?? '',
      preview: (h.text ?? '').slice(0, 400),
      distance: typeof h._distance === 'number' ? h._distance : 0,
      layer: h._source_layer ?? '',
    }));
    return { hits, abstained: hits.length === 0 };
  } catch {
    return { hits: [], abstained: true };
  }
}

// ── KB sources breakdown ─────────────────────────────────────────────
// Per-course (or per-tier) chunk + distinct-source counts, read straight from
// the LanceDB kb_chunks table. Powers the Sources tab on the KB deep page.
export interface KbSourceGroup {
  name: string;
  chunks: number;
  sources: number;
}
export interface KbSourcesResult {
  groupBy: string | null;
  totalChunks: number;
  totalSources: number;
  groups: KbSourceGroup[];
  error?: string;
}

// Grouping is schema-tolerant: trading/dalton/vibe KBs carry `course`, mc-kb
// only has `tier`. We pick the first present column and never load `vector`.
const PY_KB_SOURCES = `
import sys, json, warnings
warnings.filterwarnings("ignore")
import lancedb
from collections import Counter
vdir = sys.argv[1]
try:
    db = lancedb.connect(vdir)
    if 'kb_chunks' not in list(db.table_names()):
        print(json.dumps({"error": "no kb_chunks table"})); sys.exit(0)
    t = db.open_table('kb_chunks')
    cols = [f.name for f in t.schema]
    has_source = 'source' in cols
    group_col = next((c for c in ('course', 'source_tag', 'tier') if c in cols), None)
    want = [c for c in ('source', group_col) if c]
    rows = t.to_arrow().select(want).to_pylist() if want else []
    total_chunks = t.count_rows()
    sources_all = set()
    chunk_counter = Counter()
    source_sets = {}
    for r in rows:
        if has_source:
            sources_all.add(r.get('source'))
        if group_col is not None:
            raw = r.get(group_col)
            label = ('' if raw is None else str(raw).strip()) or '(uncategorized)'
            chunk_counter[label] += 1
            if has_source:
                source_sets.setdefault(label, set()).add(r.get('source'))
    groups = [{"name": k, "chunks": v, "sources": len(source_sets.get(k, ()))}
              for k, v in chunk_counter.items()]
    groups.sort(key=lambda g: -g['chunks'])
    print(json.dumps({"groupBy": group_col, "totalChunks": total_chunks,
                      "totalSources": len(sources_all), "groups": groups}))
except Exception as e:
    print(json.dumps({"error": str(e)[:200]}))
`;

export async function kbSources(id: string): Promise<KbSourcesResult> {
  const dir = getKbDir(id);
  const empty: KbSourcesResult = { groupBy: null, totalChunks: 0, totalSources: 0, groups: [] };
  if (!dir) return { ...empty, error: 'unknown kb' };
  const vectors = join(dir, 'kb.vectors');
  if (!existsSync(vectors)) return { ...empty, error: 'no vector store' };
  try {
    // Static unless the KB reindexes; warm-cache 5min (turns a ~3.5s subprocess
    // spawn into a ~2ms read). A reindex rewrites sync_status.json, which is a
    // far more reliable change-signal than the kb.vectors dir mtime (LanceDB
    // writes new files in subdirs without touching the top dir); the 5min TTL is
    // the backstop. The Python helper prints {"error":...} on failure — detect
    // and throw so a transient error is NEVER pinned in cache for 5min.
    const statusFile = join(dir, 'sync_status.json');
    const sigPath = existsSync(statusFile) ? statusFile : vectors;
    return await warmAsync(`kbsources:${id}`, statSig(sigPath), 5 * 60_000, async () => {
      const { stdout } = await execFileAsync(
        kbPython(dir),
        ['-c', PY_KB_SOURCES, vectors],
        { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout) as KbSourcesResult & { error?: string };
      if (parsed.error) throw new Error(parsed.error);
      return { ...empty, ...parsed };
    });
  } catch (e) {
    return { ...empty, error: String((e as Error).message || e) };
  }
}

export interface KbAskResult {
  answer?: string;
  sources?: unknown;
  abstained?: boolean;
  used_portfolio?: boolean;
  error?: string;
}

export async function kbAsk(id: string, question: string): Promise<KbAskResult> {
  const entry = getEntry(id);
  const dir = getKbDir(id);
  if (!entry || !dir) return { error: 'unknown kb' };
  if (!entry.askable || !existsSync(join(dir, 'ask.py'))) {
    return { error: 'not askable' };
  }
  try {
    // claytrader keeps its default portfolio context (don't pass --no-portfolio).
    // Use the KB's own .venv if present; fall back to the shared mc-kb venv.
    // Generous ceiling: cold embed load (~40s) + retrieval + Gemini retries 3×/60s.
    const { stdout } = await execFileAsync(
      kbPython(dir),
      [join(dir, 'ask.py'), '--json', question],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as KbAskResult;
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

// ── Anatomy image layer (KBs that ship an anatomy/index.json) ──────────
// e.g. erikdalton: cached BodyParts3D / Wikimedia muscle renders + an alias
// table so the client can map a topic/answer to its muscle image(s).
export interface AnatomyMuscle {
  name: string;
  slug: string;
  fma?: string[];
  parts?: string[];
  aliases?: string[];
  images?: Record<string, string>; // view -> relative path (img/<slug>-front.png)
  viewer_url?: string | null;
  source?: string | null;
  attribution?: string | null;
}
export interface AnatomyIndex { muscles: Record<string, AnatomyMuscle>; }

export function kbAnatomy(id: string): AnatomyIndex {
  const dir = getKbDir(id);
  if (!dir) return { muscles: {} };
  const idxFile = join(dir, 'anatomy', 'index.json');
  if (!existsSync(idxFile)) return { muscles: {} };
  try {
    return { muscles: JSON.parse(readFileSync(idxFile, 'utf8')) as Record<string, AnatomyMuscle> };
  } catch {
    return { muscles: {} };
  }
}

// Serve a cached anatomy image. Hard-locked to anatomy/img/<sanitized>.png —
// the filename is regex-gated AND realpath-confirmed to stay inside the dir, so
// there is no traversal surface even though the client supplies the name.
export function kbAnatomyImage(id: string, file: string): { data: Buffer; mime: string } | { error: string } {
  const dir = getKbDir(id);
  if (!dir) return { error: 'unknown kb' };
  if (!/^[a-z0-9-]+\.png$/.test(file)) return { error: 'bad filename' };
  const imgDir = join(dir, 'anatomy', 'img');
  const full = join(imgDir, file);
  try {
    if (!existsSync(full)) return { error: 'not found' };
    if (!realpathSync(full).startsWith(realpathSync(imgDir) + pathSep)) return { error: 'denied' };
    return { data: readFileSync(full), mime: 'image/png' };
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

// Serve a frame JPG from anatomy/frames/<videoId>/<file>.
// videoId and file are both regex-gated + realpath-confirmed — no traversal.
export function kbAnatomyFrame(
  id: string, videoId: string, file: string,
): { data: Buffer; mime: string } | { error: string } {
  const dir = getKbDir(id);
  if (!dir) return { error: 'unknown kb' };
  // videoId: alphanumeric + underscores (matches actual directory names)
  if (!/^[A-Za-z0-9_.-]+$/.test(videoId)) return { error: 'bad video id' };
  // file: seg-NNN-NNNs.jpg pattern
  if (!/^[a-z0-9._-]+\.jpe?g$/.test(file)) return { error: 'bad filename' };
  const framesDir = join(dir, 'anatomy', 'frames');
  const full = join(framesDir, videoId, file);
  try {
    if (!existsSync(full)) return { error: 'not found' };
    if (!realpathSync(full).startsWith(realpathSync(framesDir) + pathSep)) return { error: 'denied' };
    return { data: readFileSync(full), mime: 'image/jpeg' };
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

// Serve a per-segment audio clip (Erik's REAL teaching voice) from
// anatomy/audio/<videoId>/<file>. videoId + file are regex-gated + realpath-
// confirmed (no traversal) — same hardening as kbAnatomyFrame, but audio-only.
export function kbAnatomyAudio(
  id: string, videoId: string, file: string,
): { data: Buffer; mime: string } | { error: string } {
  const dir = getKbDir(id);
  if (!dir) return { error: 'unknown kb' };
  if (!/^[A-Za-z0-9_.-]+$/.test(videoId)) return { error: 'bad video id' };
  // file: seg-NNN.mp3 pattern
  if (!/^[a-z0-9._-]+\.mp3$/.test(file)) return { error: 'bad filename' };
  const audioDir = join(dir, 'anatomy', 'audio');
  const full = join(audioDir, videoId, file);
  try {
    if (!existsSync(full)) return { error: 'not found' };
    if (!realpathSync(full).startsWith(realpathSync(audioDir) + pathSep)) return { error: 'denied' };
    return { data: readFileSync(full), mime: 'audio/mpeg' };
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

// Return the frames index for a given KB's anatomy/frames/_index.json.
export function kbFramesIndex(id: string): Record<string, unknown> {
  const dir = getKbDir(id);
  if (!dir) return {};
  const idxFile = join(dir, 'anatomy', 'frames', '_index.json');
  if (!existsSync(idxFile)) return {};
  try { return JSON.parse(readFileSync(idxFile, 'utf8')) as Record<string, unknown>; }
  catch { return {}; }
}

// Return a single video's frames.json.
export function kbVideoFrames(
  id: string, videoId: string,
): { frames: unknown[] } | { error: string } {
  const dir = getKbDir(id);
  if (!dir) return { error: 'unknown kb' };
  if (!/^[A-Za-z0-9_.-]+$/.test(videoId)) return { error: 'bad video id' };
  const framesDir = join(dir, 'anatomy', 'frames');
  const full = join(framesDir, videoId, 'frames.json');
  try {
    if (!existsSync(full)) return { error: 'not found' };
    if (!realpathSync(full).startsWith(realpathSync(framesDir) + pathSep)) return { error: 'denied' };
    const parsed = JSON.parse(readFileSync(full, 'utf8')) as { frames?: unknown[] };
    return { frames: parsed.frames || [] };
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

// Serve a curated quiz MINI-CLIP (5s motion + Erik's real voice) from
// anatomy/quiz_clips/<file>.mp4. Same hardening as the frame/audio routes —
// filename regex-gated + realpath-confirmed (no traversal), video-only.
export function kbAnatomyClip(
  id: string, file: string,
): { data: Buffer; mime: string } | { error: string } {
  const dir = getKbDir(id);
  if (!dir) return { error: 'unknown kb' };
  // file: "<videoId>-segNNN.mp4"
  if (!/^[A-Za-z0-9._-]+\.mp4$/.test(file)) return { error: 'bad filename' };
  const clipsDir = join(dir, 'anatomy', 'quiz_clips');
  const full = join(clipsDir, file);
  try {
    if (!existsSync(full)) return { error: 'not found' };
    if (!realpathSync(full).startsWith(realpathSync(clipsDir) + pathSep)) return { error: 'denied' };
    return { data: readFileSync(full), mime: 'video/mp4' };
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

// Curated quiz bank (vision-filtered hands-on technique moments). Each entry pairs
// a motion clip with its CENTER still (clip and still now show the same instant).
// Media paths are rewritten to the served API routes so the client stays dumb.
export interface QuizBankItem {
  clipUrl: string; stillUrl: string; videoId: string;
  technique: string; region: string; caption: string;
  difficulty: string; lesson: string; course: string;
  regionConfidence?: number; // 0-1, from the vision re-audit; low-conf cards are deprioritised in the quiz
}
export function kbQuizBank(id: string): { items: QuizBankItem[] } {
  const dir = getKbDir(id);
  if (!dir) return { items: [] };
  const bankFile = join(dir, 'anatomy', 'quiz_bank.json');
  if (!existsSync(bankFile)) return { items: [] };
  try {
    const raw = JSON.parse(readFileSync(bankFile, 'utf8')) as Array<Record<string, unknown>>;
    const items: QuizBankItem[] = [];
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    for (const e of raw) {
      const clipFile = str(e.clip).split('/').pop() || '';
      const stillFile = str(e.still).split('/').pop() || '';
      const videoId = str(e.still).split('/').slice(-2, -1)[0] || '';
      if (!clipFile || !stillFile || !videoId) continue;
      items.push({
        clipUrl: `/api/databases/kb/${id}/anatomy/clip/${clipFile}`,
        stillUrl: `/api/databases/kb/${id}/anatomy/frames/${videoId}/${stillFile}`,
        videoId,
        technique: str(e.technique), region: str(e.region),
        caption: str(e.caption), difficulty: str(e.difficulty) || 'medium',
        lesson: str(e.lesson), course: str(e.course),
        regionConfidence: typeof e.regionConfidence === 'number' ? e.regionConfidence : undefined,
      });
    }
    return { items };
  } catch {
    return { items: [] };
  }
}

// ── SQL meta / select ────────────────────────────────────────────────
export interface SqlMeta {
  size: string;
  tables: Array<{ name: string; rows: number }>;
}

export async function sqlMeta(id: string): Promise<SqlMeta | { error: string }> {
  const e = getEntry(id);
  if (!e || e.type !== 'sql') return { error: 'unknown sql db' };
  try {
    // Counts change as rows are written. These DBs run in WAL mode, so committed
    // writes land in the `-wal` sibling and the MAIN file's mtime/size don't move
    // until a checkpoint — fingerprint BOTH so a write actually invalidates the
    // entry (60s TTL is the backstop between checkpoints).
    const sig = `${statSig(e.path)}|${statSig(e.path + '-wal')}`;
    return await warmAsync(`sqlmeta:${id}`, sig, 60_000, async () => {
      const size = await duSize(e.path);
      let dbh: Database.Database | null = null;
      try {
        dbh = new Database(e.path, { readonly: true });
        dbh.pragma('busy_timeout = 4000');
        const names = listUserTables(dbh).slice(0, 60);
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
        return { size, tables };
      } finally {
        if (dbh) try { dbh.close(); } catch { /* ignore */ }
      }
    });
  } catch (err) {
    return { error: String((err as Error).message || err) };
  }
}

export interface SqlSelectResult {
  columns: string[];
  columnTypes: (string | null)[];
  rows: unknown[][];
  elapsed_ms: number;
  capped: boolean;
}

// Max rows handed back to the client; anything beyond is silently dropped by
// SQLite's full result so we flag `capped` to surface it in the UI.
const SQL_ROW_CAP = 500;

// SELECT-only guard. Rejects multi-statement, write/DDL keywords, and anything
// that doesn't start with SELECT/WITH.
function rejectSql(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return 'Only a single SELECT/WITH query is allowed';
  // Multi-statement: a ';' followed by any non-whitespace.
  if (/;\s*\S/.test(trimmed)) return 'Only a single SELECT/WITH query is allowed';
  if (!/^\s*(with|select)\b/i.test(trimmed)) return 'Only a single SELECT/WITH query is allowed';
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex)\b/i.test(trimmed)) {
    return 'Only a single SELECT/WITH query is allowed';
  }
  return null;
}

export function sqlSelect(id: string, sql: string): SqlSelectResult | { error: string } {
  const e = getEntry(id);
  if (!e || e.type !== 'sql') return { error: 'unknown sql db' };
  const violation = rejectSql(sql);
  if (violation) return { error: violation };

  let dbh: Database.Database | null = null;
  try {
    dbh = new Database(e.path, { readonly: true });
    dbh.pragma('busy_timeout = 4000');
    const stmt = dbh.prepare(sql.trim());
    stmt.raw(true);
    const t0 = Date.now();
    // Iterate (don't .all()) so a huge result never fully materializes in the
    // daemon: pull one past the cap to detect truncation, then stop.
    const rows: unknown[][] = [];
    let capped = false;
    for (const row of stmt.iterate() as IterableIterator<unknown[]>) {
      if (rows.length >= SQL_ROW_CAP) { capped = true; break; }
      rows.push(row);
    }
    const elapsed_ms = Date.now() - t0;
    const colDefs = stmt.columns();
    const columns = colDefs.map((c) => c.name);
    const columnTypes = colDefs.map((c) => c.type ?? null);
    return { columns, columnTypes, rows, elapsed_ms, capped };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  } finally {
    if (dbh) try { dbh.close(); } catch { /* ignore */ }
  }
}

// ── Secrets ──────────────────────────────────────────────────────────
// Allow-listed secret source dirs (used by both listSecrets and revealSecret).
const SECRET_DIRS = [
  join(HOME, '.openclaw/secrets'),
  join(HOME, 'scripts/keys'),
];
const ENV_FILES = [
  `${HOME}/.vibe-trading/.env`,
  `${HOME}/.hermes/.env`,
  `${HOME}/03_AGENTS/claudeclaw-os/.env`,
  `${HOME}/05_AUTOMATION/changelog-master/.env`,
  `${HOME}/claude-office/backend/.env`,
  `${HOME}/01_ACTIVE/free-video-maker/.env`,
  `${HOME}/04_RESEARCH/banana-squad/.env`,
];

export interface SecretItem {
  name: string;
  source: string;
  masked: string;
  modified: string | null;
}
export interface SecretGroup {
  category: string;
  items: SecretItem[];
}
export interface SecretsResult {
  groups: SecretGroup[];
}

function maskValue(value: string): string {
  const v = value.trim();
  if (v.length < 8) return '••••••••';
  return `${v.slice(0, 5)}••••${v.slice(-2)}`;
}

function categorize(name: string): string {
  const n = name.toLowerCase();
  if (/webhook/.test(n)) return 'Discord Webhooks';
  if (/telegram/.test(n)) return 'Telegram';
  if (/(alpaca|robinhood|coinbase|okx|tradier|hyperliquid)/.test(n)) return 'Trading Creds';
  if (/token/.test(n)) return 'Tokens';
  if (/(key|secret|api)/.test(n)) return 'API Keys';
  return 'Other';
}

export function listSecrets(): SecretsResult {
  // Filesystem scan of every secret dir + .env; cheap-ish but sync-blocking.
  // Warm-cache 30s (a TTL — no single mtime spans all dirs); reveal is uncached.
  return warmSync('secrets', '', 30_000, _listSecrets);
}

function _listSecrets(): SecretsResult {
  const byCat = new Map<string, SecretItem[]>();
  const push = (category: string, item: SecretItem) => {
    const arr = byCat.get(category) ?? [];
    arr.push(item);
    byCat.set(category, arr);
  };

  for (const dir of SECRET_DIRS) {
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && !STALE_SECRET.test(d.name))
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const full = join(dir, name);
        const value = readFileSync(full, 'utf-8');
        push(categorize(name), { name, source: dir, masked: maskValue(value), modified: mtimeISO(full) });
      } catch {
        // unreadable file → skip
      }
    }
  }

  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    try {
      // whole .env file = one entry; do not parse/mask its values here.
      const name = file.replace(`${HOME}/`, '');
      push('Env Files', { name, source: file, masked: '(env file)', modified: mtimeISO(file) });
    } catch {
      // skip
    }
  }

  const groups: SecretGroup[] = [...byCat.entries()].map(([category, items]) => ({ category, items }));
  return { groups };
}

export interface RevealResult {
  value?: string;
  error?: string;
}

export function revealSecret(source: string, name: string): RevealResult {
  if (!SECRET_DIRS.includes(source)) return { error: 'forbidden' };
  if (!name || name.includes('/') || name.includes('..')) return { error: 'forbidden' };
  if (STALE_SECRET.test(name)) return { error: 'forbidden' };
  try {
    const full = join(source, name);
    if (!existsSync(full)) return { error: 'not found' };
    // Resolve symlinks and confirm the target stays inside the allow-listed
    // dir — a planted symlink (foo -> /etc/passwd) must not leak external files.
    const real = realpathSync(full);
    if (real !== full && !real.startsWith(source + pathSep)) return { error: 'forbidden' };
    const value = readFileSync(real, 'utf-8');
    return { value };
  } catch {
    return { error: 'forbidden' };
  }
}
