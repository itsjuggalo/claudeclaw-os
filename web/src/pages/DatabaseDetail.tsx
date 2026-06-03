// DatabaseDetail — deep page for a single database. Behaviour depends on the
// item's type (resolved from the /api/databases catalog by id):
//   kb      → Ask | Search tabs (RAG question-answering + semantic search)
//   sql     → table browser + SELECT-only query runner
//   secrets → grouped masked secrets with reveal + copy
// All data comes from /api/databases/* (see src/databases.ts). Read-only:
// the SQL runner is SELECT-only on the backend; secrets never auto-reveal.
import type { ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useRoute, useLocation } from 'wouter-preact';
import { KeyRound, Eye, EyeOff, Copy, ArrowLeft, Search, Download, RefreshCw } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost } from '@/lib/api';
import { useDebouncedValue } from '@/lib/useDebounce';
import { fmtUpdated } from '@/pages/Databases';
import { renderMarkdown } from '@/lib/markdown';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

// Small refresh control placed in a deep page's header (deep pages fetch once;
// this re-pulls on demand since the catalog's 60s SWR doesn't cover them).
function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Refresh"
      class="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      <RefreshCw size={13} class={busy ? 'animate-spin' : undefined} /> Refresh
    </button>
  );
}

type DbType = 'kb' | 'sql' | 'secrets';

interface DbItem {
  id: string;
  type: DbType;
  label: string;
  subtitle?: string;
  stat: string;
  size: string;
  updated: string;
  accent: string;
  askable?: boolean;
}
interface CatalogResponse { groups: { id: string; label: string; items: DbItem[] }[]; }

export function DatabaseDetail() {
  const [, params] = useRoute<{ id: string }>('/databases/:id');
  const [, setLocation] = useLocation();
  const id = params?.id ?? '';

  const [item, setItem] = useState<DbItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await apiGet<CatalogResponse>('/api/databases');
        const found = r.groups.flatMap(g => g.items).find(i => i.id === id) ?? null;
        if (!cancelled) {
          setItem(found);
          if (!found) setError('Database "' + id + '" not found in the catalog.');
        }
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  const backLink = (
    <button
      type="button"
      onClick={() => setLocation('/databases')}
      class="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    >
      <ArrowLeft size={13} /> Databases
    </button>
  );

  if (loading) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Database" breadcrumb="Databases" actions={backLink} />
        <PageState loading />
      </div>
    );
  }
  if (error || !item) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Database" breadcrumb="Databases" actions={backLink} />
        <PageState error={error || 'Not found'} />
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      {/* key by id so internal state (tab, answer, sources, query, result)
          fully resets when navigating between two DBs of the same type. */}
      {item.type === 'kb' && <KbDetail key={item.id} item={item} back={backLink} />}
      {item.type === 'sql' && <SqlDetail key={item.id} item={item} back={backLink} />}
      {item.type === 'secrets' && <SecretsDetail key={item.id} item={item} back={backLink} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── KB ────────

interface KbHit {
  source: string;
  heading: string;
  course?: string;
  preview: string;
  distance: number;
  layer: string;
}
interface KbSearchResponse { hits: KbHit[]; abstained: boolean; }
interface KbAskResponse { answer: string; sources: string[]; abstained?: boolean; used_portfolio?: boolean; }
interface KbSourceGroup { name: string; chunks: number; sources: number; }
interface KbSourcesResponse {
  groupBy: string | null; totalChunks: number; totalSources: number;
  groups: KbSourceGroup[]; error?: string;
}

// "Heading (course)" → "Heading" — the bit worth re-searching.
function citationHeading(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

const LAYER_COLOR: Record<string, string> = {
  identity: '#a78bfa', critical: '#f59e0b', working: '#10b981', episodic: '#5eb6ff',
};

function KbDetail({ item, back }: { item: DbItem; back: ComponentChildren }) {
  type KbTab = 'ask' | 'search' | 'sources';
  const [tab, setTab] = useState<KbTab>(item.askable ? 'ask' : 'search');

  // Ask state
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<KbAskResponse | null>(null);

  // Search state
  const [query, setQuery] = useState('');
  const dq = useDebouncedValue(query, 250);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [search, setSearch] = useState<KbSearchResponse | null>(null);

  // Sources (breakdown) state — lazily loaded the first time the tab opens.
  const [sources, setSources] = useState<KbSourcesResponse | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesErr, setSourcesErr] = useState<string | null>(null);

  // Jump from a citation to the Search tab, pre-filled with the lesson heading.
  function jumpToSearch(heading: string) {
    setQuery(heading);
    setTab('search');
  }

  async function runAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setAskErr(null);
    setAnswer(null);
    try {
      const r = await apiPost<KbAskResponse>('/api/databases/kb/' + item.id + '/ask', { question });
      setAnswer(r);
    } catch (e) {
      setAskErr(String((e as Error).message || e));
    } finally {
      setAsking(false);
    }
  }

  useEffect(() => {
    if (tab !== 'search') return;
    if (!dq.trim()) { setSearch(null); setSearchErr(null); return; }
    let cancelled = false;
    async function run() {
      setSearching(true);
      setSearchErr(null);
      try {
        const p = new URLSearchParams({ q: dq, top: '10' });
        const r = await apiGet<KbSearchResponse>('/api/databases/kb/' + item.id + '/search?' + p);
        if (!cancelled) setSearch(r);
      } catch (e) {
        if (!cancelled) setSearchErr(String((e as Error).message || e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [dq, tab, item.id]);

  useEffect(() => {
    if (tab !== 'sources' || sources || sourcesLoading) return;
    let cancelled = false;
    async function run() {
      setSourcesLoading(true);
      setSourcesErr(null);
      try {
        const r = await apiGet<KbSourcesResponse>('/api/databases/kb/' + item.id + '/sources');
        if (!cancelled) setSources(r);
      } catch (e) {
        if (!cancelled) setSourcesErr(String((e as Error).message || e));
      } finally {
        if (!cancelled) setSourcesLoading(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [tab, item.id, sources, sourcesLoading]);

  const noData = answer && (answer.abstained || !answer.answer.trim());

  return (
    <>
      <PageHeader
        title={item.label}
        breadcrumb="Databases"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {tab === 'sources' && <RefreshButton onClick={() => setSources(null)} busy={sourcesLoading} />}
            {back}
          </div>
        }
        tabs={
          <>
            {item.askable && <Tab label="Ask" active={tab === 'ask'} onClick={() => setTab('ask')} />}
            <Tab label="Search" active={tab === 'search'} onClick={() => setTab('search')} />
            <Tab label="Sources" active={tab === 'sources'} onClick={() => setTab('sources')} />
          </>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '900px', margin: '0 auto' }}>

          {tab === 'ask' && (
            <>
              <textarea
                value={question}
                onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void runAsk();
                  }
                }}
                placeholder={'Ask ' + item.label + ' anything…'}
                rows={3}
                class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => void runAsk()}
                  disabled={asking || !question.trim()}
                  class="px-4 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-50"
                >
                  {asking ? 'Thinking…' : 'Ask'}
                </button>
                {asking && (
                  <span class="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
                    <span class="animate-spin" style={{
                      width: '12px', height: '12px', borderRadius: '50%',
                      border: '2px solid var(--color-border)', borderTopColor: 'var(--color-accent)',
                      display: 'inline-block',
                    }} />
                    Thinking…
                  </span>
                )}
                {!asking && (
                  <span class="text-[11px] text-[var(--color-text-faint)]">⌘/Ctrl+Enter to ask</span>
                )}
              </div>

              {askErr && (
                <div style={{ marginTop: '16px' }}>
                  <PageState error={askErr} />
                </div>
              )}

              {answer && !asking && (
                <div style={{ marginTop: '18px' }}>
                  {noData ? (
                    <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]">
                      This KB doesn't cover that.
                    </div>
                  ) : (
                    <>
                      <div style={{
                        background: 'var(--color-card)', border: '1px solid var(--color-border)',
                        borderRadius: '10px', padding: '16px',
                      }}>
                        {answer.used_portfolio && (
                          <span style={{
                            display: 'inline-block', fontSize: '10px', fontWeight: 700,
                            color: '#10b981', background: '#10b98122', padding: '2px 8px',
                            borderRadius: '999px', marginBottom: '10px',
                          }}>portfolio context</span>
                        )}
                        <div
                          class="chat-md"
                          style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text)' }}
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.answer) }}
                        />
                      </div>
                      {answer.sources && answer.sources.length > 0 && (
                        <div style={{ marginTop: '14px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '8px', textTransform: 'uppercase' }}>
                            Sources — click to search
                          </div>
                          <ul style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {answer.sources.map((s, i) => (
                              <li key={i}>
                                <button
                                  type="button"
                                  onClick={() => jumpToSearch(citationHeading(s))}
                                  title={'Search this KB for "' + citationHeading(s) + '"'}
                                  style={{
                                    fontSize: '12px', color: 'var(--color-text-muted)', fontFamily: MONO,
                                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                  class="hover:text-[var(--color-accent)] hover:underline"
                                >{s}</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'search' && (
            <>
              <input
                type="text"
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                placeholder={'Search ' + item.label + '…'}
                class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              {searchErr && <div style={{ marginTop: '16px' }}><PageState error={searchErr} /></div>}
              {searching && <div class="text-[12px] text-[var(--color-text-muted)]" style={{ marginTop: '14px' }}>Searching…</div>}
              {search && !searching && (search.abstained || search.hits.length === 0) && (
                <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]" style={{ marginTop: '14px' }}>
                  No relevant content in this knowledge base.
                </div>
              )}
              {search && !searching && !search.abstained && search.hits.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                  {search.hits.map((h, i) => {
                    const lc = LAYER_COLOR[h.layer] || '#6b7280';
                    return (
                      <div key={i} class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
                        <div class="flex items-center gap-2 mb-1 text-xs">
                          {h.layer && (
                            <span style={{ background: lc + '33', color: lc, padding: '2px 6px', borderRadius: 4 }}>{h.layer}</span>
                          )}
                          <span class="text-[var(--color-text-muted)]">{h.source}</span>
                          {h.course && <span class="text-[var(--color-text-faint)]">· {h.course}</span>}
                          <span class="ml-auto text-[var(--color-text-faint)]">dist {h.distance?.toFixed(3)}</span>
                        </div>
                        {h.heading && h.heading !== '---' && (
                          <div class="font-medium text-sm mb-1 text-[var(--color-text)]">{h.heading}</div>
                        )}
                        <pre class="text-xs whitespace-pre-wrap text-[var(--color-text-muted)]" style={{ fontFamily: 'inherit' }}>{h.preview}</pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'sources' && (
            <>
              <div style={{
                background: 'var(--color-card)', border: '1px solid var(--color-border)',
                borderRadius: '10px', padding: '16px', marginBottom: '16px',
              }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '6px' }}>
                  {sources && !sources.error
                    ? sources.totalChunks.toLocaleString() + ' chunks · ' + sources.totalSources.toLocaleString() + ' sources'
                    : item.stat}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  {item.size} · updated {fmtUpdated(item.updated)}
                  {sources?.groupBy && <> · grouped by <code style={{ fontFamily: MONO }}>{sources.groupBy}</code></>}
                </div>
              </div>

              {sourcesLoading && <PageState loading />}
              {sourcesErr && <PageState error={sourcesErr} />}
              {sources?.error && (
                <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]">
                  Breakdown unavailable: {sources.error}
                </div>
              )}

              {sources && !sources.error && sources.groups.length > 0 && (
                <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                  {sources.groups.map((g, i) => {
                    const pct = sources.totalChunks > 0 ? (g.chunks / sources.totalChunks) * 100 : 0;
                    return (
                      <div key={i} style={{
                        position: 'relative', padding: '11px 14px',
                        borderBottom: i < sources.groups.length - 1 ? '1px solid var(--color-border)' : 'none',
                      }}>
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: pct + '%', background: 'color-mix(in srgb, var(--color-accent) 9%, transparent)',
                          pointerEvents: 'none',
                        }} />
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ minWidth: 0, flex: 1, fontSize: '13px', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.name}>{g.name}</span>
                          <span style={{ flexShrink: 0, fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO }}>
                            {g.sources > 0 && <>{g.sources.toLocaleString()} src · </>}{g.chunks.toLocaleString()} chunks
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {sources && !sources.error && sources.groups.length === 0 && (
                <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]">
                  No per-source breakdown available for this knowledge base.
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────── SQL ────────

interface SqlMeta { size: string; tables: { name: string; rows: number }[]; }
interface SqlQueryResponse {
  columns: string[];
  columnTypes?: (string | null)[];
  rows: unknown[][];
  elapsed_ms: number;
  capped?: boolean;
}

// Serialize a result set to CSV (RFC-4180-ish quoting) or row-objects JSON.
function toCsv(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}
function toJson(columns: string[], rows: unknown[][]): string {
  return JSON.stringify(rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), null, 2);
}

function SqlDetail({ item, back }: { item: DbItem; back: ComponentChildren }) {
  const [meta, setMeta] = useState<SqlMeta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [sql, setSql] = useState('');
  const [running, setRunning] = useState(false);
  const [queryErr, setQueryErr] = useState<string | null>(null);
  const [result, setResult] = useState<SqlQueryResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyResult(fmt: 'csv' | 'json') {
    if (!result) return;
    const text = fmt === 'csv'
      ? toCsv(result.columns, result.rows)
      : toJson(result.columns, result.rows);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(fmt);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  async function loadMeta() {
    setMetaLoading(true);
    setMetaErr(null);
    try {
      const r = await apiGet<SqlMeta>('/api/databases/sql/' + item.id + '/meta');
      setMeta(r);
    } catch (e) {
      setMetaErr(String((e as Error).message || e));
    } finally {
      setMetaLoading(false);
    }
  }

  useEffect(() => {
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function runQuery(sqlText: string) {
    if (!sqlText.trim()) return;
    setRunning(true);
    setQueryErr(null);
    setResult(null);
    try {
      const r = await apiPost<SqlQueryResponse>('/api/databases/sql/' + item.id + '/query', { sql: sqlText });
      setResult(r);
    } catch (e) {
      // apiPost throws ApiError; the 400 body carries { error }.
      const err = e as { body?: { error?: string }; message?: string };
      setQueryErr(err?.body?.error || String(err?.message || e));
    } finally {
      setRunning(false);
    }
  }

  function previewTable(name: string) {
    const q = 'SELECT * FROM "' + name + '" LIMIT 50';
    setSql(q);
    void runQuery(q);
  }

  return (
    <>
      <PageHeader
        title={item.label}
        breadcrumb="Databases"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <RefreshButton onClick={() => void loadMeta()} busy={metaLoading} />
            {back}
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '1100px', margin: '0 auto' }}>

          {metaLoading && <PageState loading />}
          {metaErr && <PageState error={metaErr} />}

          {meta && (
            <>
              <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '12px' }}>
                {meta.size} · {meta.tables.length} tables
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '8px', marginBottom: '20px',
              }}>
                {meta.tables.map(t => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => previewTable(t.name)}
                    style={{
                      textAlign: 'left', background: 'var(--color-card)',
                      border: '1px solid var(--color-border)', borderRadius: '8px',
                      padding: '10px 12px', cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '3px' }}>{t.rows.toLocaleString()} rows</div>
                  </button>
                ))}
              </div>
            </>
          )}

          <textarea
            value={sql}
            onInput={(e) => setSql((e.target as HTMLTextAreaElement).value)}
            placeholder={'SELECT * FROM …'}
            rows={4}
            spellcheck={false}
            style={{ fontFamily: MONO, fontSize: '13px' }}
            class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={() => void runQuery(sql)}
              disabled={running || !sql.trim()}
              class="px-4 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              {running ? 'Running…' : 'Run'}
            </button>
            <span class="text-[11px] text-[var(--color-text-faint)]">SELECT only — writes are blocked.</span>
            {result && !running && (
              <span class="text-[11px] text-[var(--color-text-faint)] ml-auto">{result.rows.length} rows · {result.elapsed_ms}ms</span>
            )}
          </div>

          {queryErr && (
            <div class="p-3 rounded-md border border-[var(--color-status-failed)] mt-3" style={{ background: 'color-mix(in srgb, var(--color-status-failed) 8%, transparent)' }}>
              <div class="text-[var(--color-status-failed)] text-[12px] font-mono">{queryErr}</div>
            </div>
          )}

          {result && !running && result.columns.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
                {result.rows.length.toLocaleString()} rows · {result.columns.length} cols · {result.elapsed_ms}ms
              </span>
              {result.capped && (
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b' }}>
                  showing first {result.rows.length.toLocaleString()} — result truncated
                </span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => void copyResult('csv')}
                  class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                >
                  <Download size={12} /> {copied === 'csv' ? 'copied' : 'CSV'}
                </button>
                <button
                  type="button"
                  onClick={() => void copyResult('json')}
                  class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                >
                  <Download size={12} /> {copied === 'json' ? 'copied' : 'JSON'}
                </button>
              </span>
            </div>
          )}

          {result && !running && result.columns.length > 0 && (
            <div style={{ marginTop: '8px', overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px', fontFamily: MONO }}>
                <thead>
                  <tr>
                    {result.columns.map((c, i) => {
                      const ty = result.columnTypes?.[i];
                      return (
                        <th key={i} title={ty ? c + ' : ' + ty : c} style={{
                          textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap',
                          borderBottom: '1px solid var(--color-border)',
                          background: 'var(--color-elevated)', color: 'var(--color-text)',
                          position: 'sticky', top: 0,
                        }}>
                          {c}
                          {ty && <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 400, color: 'var(--color-text-faint)', textTransform: 'lowercase' }}>{ty}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{
                          padding: '6px 10px', whiteSpace: 'nowrap', maxWidth: '380px',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          borderBottom: '1px solid var(--color-border)',
                          color: 'var(--color-text-muted)',
                        }} title={cell === null ? 'NULL' : String(cell)}>
                          {cell === null ? <span style={{ opacity: 0.4 }}>NULL</span> : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result && !running && result.columns.length === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)]" style={{ marginTop: '14px' }}>Query returned no columns.</div>
          )}

        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────── SECRETS ───────

interface SecretItem { name: string; source: string; masked: string; }
interface SecretsResponse { groups: { category: string; items: SecretItem[] }[]; }
interface RevealResponse { value: string; }

function SecretRow({ source, name, masked }: SecretItem) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reveal(): Promise<string | null> {
    if (revealed !== null) return revealed;
    setBusy(true);
    setErr(null);
    try {
      const p = new URLSearchParams({ source, name });
      const r = await apiGet<RevealResponse>('/api/databases/secrets/reveal?' + p);
      setRevealed(r.value);
      return r.value;
    } catch (e) {
      const e2 = e as { body?: { error?: string }; message?: string };
      setErr(e2?.body?.error || String(e2?.message || e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (revealed !== null) { setRevealed(null); return; }
    await reveal();
  }

  async function copy() {
    const val = revealed !== null ? revealed : await reveal();
    if (val == null) return;
    try {
      await navigator.clipboard.writeText(val);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr('clipboard blocked');
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '9px 12px', borderBottom: '1px solid var(--color-border)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', fontFamily: MONO }}>{name}</div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source}</div>
      </div>
      <div style={{
        fontSize: '12px', fontFamily: MONO, color: err ? 'var(--color-status-failed)' : 'var(--color-text-muted)',
        maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {err ? err : (busy ? '…' : (revealed !== null ? revealed : masked))}
      </div>
      <button
        type="button"
        onClick={() => void toggle()}
        title={revealed !== null ? 'Hide' : 'Reveal'}
        class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
      >
        {revealed !== null ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy"
        class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
      >
        {copied ? <span style={{ fontSize: '10px', color: '#10b981' }}>copied</span> : <Copy size={15} />}
      </button>
    </div>
  );
}

function SecretsDetail({ item, back }: { item: DbItem; back: ComponentChildren }) {
  const [data, setData] = useState<SecretsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  async function loadSecrets() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiGet<SecretsResponse>('/api/databases/secrets');
      setData(r);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSecrets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const totalCount = data ? data.groups.reduce((n, g) => n + g.items.length, 0) : 0;

  // Client-side filter on name / source / category (case-insensitive).
  const q = filter.trim().toLowerCase();
  const filteredGroups = (data?.groups ?? [])
    .map(g => ({
      category: g.category,
      items: q
        ? g.items.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.source.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q))
        : g.items,
    }))
    .filter(g => g.items.length > 0);

  return (
    <>
      <PageHeader
        title={item.label}
        breadcrumb="Databases"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <RefreshButton onClick={() => void loadSecrets()} busy={loading} />
            {back}
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '16px' }}>
            <KeyRound size={14} /> Values stay masked until you reveal them.
            {data && totalCount > 0 && <span style={{ marginLeft: 'auto' }}>{totalCount} secrets</span>}
          </div>

          {data && totalCount > 0 && (
            <div style={{ position: 'relative', marginBottom: '16px', maxWidth: '360px' }}>
              <span style={{
                position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
                color: 'var(--color-text-faint)', display: 'inline-flex', pointerEvents: 'none',
              }}>
                <Search size={14} />
              </span>
              <input
                type="text"
                value={filter}
                onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
                placeholder="Filter secrets…"
                class="w-full pl-8 pr-3 py-1.5 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          )}

          {/* Category jump-nav — 200+ rows are long even filtered. */}
          {filteredGroups.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
              {filteredGroups.map(group => (
                <button
                  key={group.category}
                  type="button"
                  onClick={() => sectionRefs.current[group.category]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  class="px-2.5 py-1 rounded-full text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] bg-[var(--color-card)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]"
                >
                  {group.category} <span style={{ opacity: 0.55 }}>{group.items.length}</span>
                </button>
              ))}
            </div>
          )}

          {loading && <PageState loading />}
          {error && <PageState error={error} />}

          {filteredGroups.map(group => (
            <section
              key={group.category}
              ref={(el) => { sectionRefs.current[group.category] = el as HTMLElement | null; }}
              style={{ marginBottom: '20px', scrollMarginTop: '12px' }}
            >
              <div style={{
                fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px',
                textTransform: 'uppercase', color: 'var(--color-text-faint)', marginBottom: '8px',
              }}>{group.category}</div>
              <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                {group.items.map((s, i) => <SecretRow key={s.source + ':' + s.name + ':' + i} {...s} />)}
              </div>
            </section>
          ))}

          {data && data.groups.length === 0 && (
            <PageState empty emptyTitle="No secrets" emptyDescription="No secret sources were found." />
          )}

          {data && totalCount > 0 && q && filteredGroups.length === 0 && (
            <PageState empty emptyTitle="No matches" emptyDescription={'No secrets match "' + filter.trim() + '".'} />
          )}
        </div>
      </div>
    </>
  );
}
