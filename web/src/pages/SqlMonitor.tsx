import { useState } from 'preact/hooks';
import { Database, RefreshCw, ChevronRight, ChevronDown, Play, AlertTriangle, Table2 } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';
import { formatRelativeTime, formatNumber } from '@/lib/format';

interface SqlDbInfo {
  id: string; label: string; subtitle?: string; group: string;
  size: string; bytes: number; tables: number; walSize: string;
  updated: string | null; live: boolean; stale: boolean; infra: boolean;
}
interface SqlCatalogGroup { id: string; label: string; items: SqlDbInfo[]; }
interface SqlCatalog { groups: SqlCatalogGroup[]; totalBytes: number; generatedAt: number; }

interface SqlTablesResult {
  id: string; label: string; size: string; updated: string | null;
  tables: Array<{ name: string; rows: number }>;
}
interface SqlSelectResult { columns: string[]; rows: unknown[][]; elapsed_ms: number; capped: boolean; }

const agoFromIso = (iso: string | null) => (iso ? formatRelativeTime(Math.floor(Date.parse(iso) / 1000)) : '—');

// ── One DB's expandable detail: table list + SELECT-only query runner ──
function DbDetail({ db }: { db: SqlDbInfo }) {
  const { data, loading, error } = useFetch<SqlTablesResult | { error: string }>(`/api/sql/${db.id}/meta`, 0);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<SqlSelectResult | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const meta = data && !('error' in data) ? data : null;
  const metaErr = data && 'error' in data ? data.error : error;

  async function run(query?: string) {
    const q = (query ?? sql).trim();
    if (!q) return;
    if (query) setSql(query);
    setRunning(true); setQErr(null); setResult(null);
    try {
      const r = await apiPost<SqlSelectResult | { error: string }>(`/api/sql/${db.id}/query`, { sql: q });
      if ('error' in r) setQErr(r.error);
      else setResult(r);
    } catch (e: any) {
      setQErr(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div class="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-3 space-y-3">
      {loading && !meta && <div class="text-[11px] text-[var(--color-text-faint)]">Loading tables…</div>}
      {metaErr && <div class="text-[11px] text-[var(--color-status-failed)] font-mono">{metaErr}</div>}

      {meta && (
        <>
          {/* Tables */}
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5">
              Tables ({meta.tables.length})
            </div>
            {meta.tables.length === 0 ? (
              <div class="text-[11px] text-[var(--color-text-faint)]">No user tables.</div>
            ) : (
              <div class="flex flex-wrap gap-1.5">
                {meta.tables.map((t) => (
                  <button key={t.name} type="button"
                    onClick={() => run(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 100`)}
                    title={`Browse ${t.name}`}
                    class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] transition-colors">
                    <Table2 size={11} class="opacity-60" />
                    <span class="font-mono">{t.name}</span>
                    <span class="tabular-nums text-[var(--color-text-faint)]">{t.rows < 0 ? '?' : formatNumber(t.rows)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* SELECT-only query box */}
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Query (SELECT-only)</div>
              <button type="button" onClick={() => run()} disabled={running || !sql.trim()}
                class="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                style="background:var(--color-accent)">
                <Play size={11} /> {running ? 'Running…' : 'Run'}
              </button>
            </div>
            <textarea
              value={sql}
              onInput={(e) => setSql((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }}
              placeholder={`SELECT * FROM ... LIMIT 100   (⌘/Ctrl+Enter to run)`}
              rows={2}
              spellcheck={false}
              class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-[12px] font-mono text-[var(--color-text)] resize-y" />
          </div>

          {qErr && (
            <div class="rounded-md border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--color-status-failed)]">
              {qErr}
            </div>
          )}

          {result && (
            <div>
              <div class="text-[10px] text-[var(--color-text-faint)] mb-1 tabular-nums">
                {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · {result.elapsed_ms}ms
                {result.capped && <span class="text-[var(--color-warn)]"> · capped at 500</span>}
              </div>
              <div class="overflow-x-auto rounded-md border border-[var(--color-border)] max-h-[360px] overflow-y-auto">
                <table class="w-full text-[11px]">
                  <thead class="bg-[var(--color-elevated)] border-b border-[var(--color-border)] text-left sticky top-0">
                    <tr>
                      {result.columns.map((c, i) => (
                        <th key={i} class="px-2.5 py-1.5 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri} class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-elevated)]">
                        {row.map((cell, ci) => (
                          <td key={ci} class="px-2.5 py-1.5 font-mono text-[var(--color-text-muted)] whitespace-nowrap max-w-[420px] truncate"
                            title={cell == null ? '' : String(cell)}>
                            {cell == null ? <span class="text-[var(--color-text-faint)] italic">null</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DbCard({ db }: { db: SqlDbInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        class="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-[var(--color-elevated)] transition-colors">
        {open ? <ChevronDown size={14} class="text-[var(--color-text-faint)] shrink-0" /> : <ChevronRight size={14} class="text-[var(--color-text-faint)] shrink-0" />}
        <Database size={15} class="text-[var(--color-accent)] shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-medium text-[var(--color-text)] truncate">{db.label}</span>
            {db.stale && (
              <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                style="color:var(--color-warn);background:color-mix(in srgb,var(--color-warn) 14%,transparent)">
                <AlertTriangle size={10} /> stale
              </span>
            )}
            {db.live && !db.stale && (
              <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                style="color:var(--color-status-done);background:color-mix(in srgb,var(--color-status-done) 14%,transparent)">live</span>
            )}
          </div>
          {db.subtitle && <div class="text-[10px] text-[var(--color-text-faint)] truncate">{db.subtitle}</div>}
        </div>
        <div class="flex items-center gap-4 text-[11px] text-[var(--color-text-muted)] tabular-nums shrink-0">
          <span title="size on disk">{db.size}{db.walSize && <span class="text-[var(--color-text-faint)]"> +{db.walSize} wal</span>}</span>
          <span class="hidden sm:inline" title="tables">{db.tables < 0 ? '—' : db.tables} {db.tables === 1 ? 'table' : 'tables'}</span>
          <span class="hidden md:inline text-[var(--color-text-faint)]" title={db.updated || ''}>{agoFromIso(db.updated)}</span>
        </div>
      </button>
      {open && <DbDetail db={db} />}
    </div>
  );
}

export function SqlMonitor() {
  const { data, loading, error, refresh } = useFetch<SqlCatalog>('/api/sql', 30000);
  const [showInternals, setShowInternals] = useState(false);

  const groups = data?.groups ?? [];
  const mainGroups = groups.filter((g) => g.id !== 'internals');
  const internals = groups.find((g) => g.id === 'internals');

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="SQL Monitor"
        actions={
          <button type="button" onClick={() => refresh()} title="Refresh"
            class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <RefreshCw size={12} /> refresh
          </button>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}

      {data && (
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <p class="text-[11px] text-[var(--color-text-faint)] leading-snug">
            Read-only view of every operational SQLite DB on the box — click a DB to browse its tables and run SELECT-only
            queries. Separate from the <span class="font-mono">/databases</span> page; these are system DBs, so there are no
            write or delete actions.
          </p>

          {mainGroups.map((g) => (
            <section key={g.id}>
              <h2 class="text-[12px] font-semibold text-[var(--color-text-muted)] mb-2">
                {g.label} <span class="text-[var(--color-text-faint)]">({g.items.length})</span>
              </h2>
              <div class="space-y-2">
                {g.items.map((db) => <DbCard key={db.id} db={db} />)}
              </div>
            </section>
          ))}

          {internals && internals.items.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowInternals((s) => !s)}
                class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-2">
                {showInternals ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Internals <span class="text-[var(--color-text-faint)] font-normal">({internals.items.length}) — agent memory, watchdog, tools with their own UI</span>
              </button>
              {showInternals && (
                <div class="space-y-2">
                  {internals.items.map((db) => <DbCard key={db.id} db={db} />)}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
