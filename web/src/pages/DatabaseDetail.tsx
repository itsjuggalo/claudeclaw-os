// DatabaseDetail — deep page for a single database. Behaviour depends on the
// item's type (resolved from the /api/databases catalog by id):
//   kb      → Ask | Search tabs (RAG question-answering + semantic search)
//   sql     → table browser + SELECT-only query runner
//   secrets → grouped masked secrets with reveal + copy
// All data comes from /api/databases/* (see src/databases.ts). Read-only:
// the SQL runner is SELECT-only on the backend; secrets never auto-reveal.
import type { ComponentChildren } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { useRoute, useLocation } from 'wouter-preact';
import { KeyRound, Eye, EyeOff, Copy, ArrowLeft } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost } from '@/lib/api';
import { useDebouncedValue } from '@/lib/useDebounce';
import { fmtUpdated } from '@/pages/Databases';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

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
      {item.type === 'kb' && <KbDetail item={item} back={backLink} />}
      {item.type === 'sql' && <SqlDetail item={item} back={backLink} />}
      {item.type === 'secrets' && <SecretsDetail item={item} back={backLink} />}
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

  const noData = answer && (answer.abstained || !answer.answer.trim());

  return (
    <>
      <PageHeader
        title={item.label}
        breadcrumb="Databases"
        actions={back}
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
                  {asking ? 'Asking…' : 'Ask'}
                </button>
                {asking && <span class="text-[12px] text-[var(--color-text-muted)]">Querying knowledge base…</span>}
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
                        <div style={{
                          whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: 1.6,
                          color: 'var(--color-text)',
                        }}>{answer.answer}</div>
                      </div>
                      {answer.sources && answer.sources.length > 0 && (
                        <div style={{ marginTop: '14px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '8px', textTransform: 'uppercase' }}>
                            Sources
                          </div>
                          <ul style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {answer.sources.map((s, i) => (
                              <li key={i} style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontFamily: MONO }}>{s}</li>
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
            <div style={{
              background: 'var(--color-card)', border: '1px solid var(--color-border)',
              borderRadius: '10px', padding: '16px',
            }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '6px' }}>
                {item.stat}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                {item.size} · updated {fmtUpdated(item.updated)}. Ask or Search this knowledge base above.
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────── SQL ────────

interface SqlMeta { size: string; tables: { name: string; rows: number }[]; }
interface SqlQueryResponse { columns: string[]; rows: unknown[][]; elapsed_ms: number; }

function SqlDetail({ item, back }: { item: DbItem; back: ComponentChildren }) {
  const [meta, setMeta] = useState<SqlMeta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [sql, setSql] = useState('');
  const [running, setRunning] = useState(false);
  const [queryErr, setQueryErr] = useState<string | null>(null);
  const [result, setResult] = useState<SqlQueryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMetaLoading(true);
      setMetaErr(null);
      try {
        const r = await apiGet<SqlMeta>('/api/databases/sql/' + item.id + '/meta');
        if (!cancelled) setMeta(r);
      } catch (e) {
        if (!cancelled) setMetaErr(String((e as Error).message || e));
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
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
      <PageHeader title={item.label} breadcrumb="Databases" actions={back} />
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
            <div style={{ marginTop: '16px', overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px', fontFamily: MONO }}>
                <thead>
                  <tr>
                    {result.columns.map((c, i) => (
                      <th key={i} style={{
                        textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'var(--color-elevated)', color: 'var(--color-text)',
                        position: 'sticky', top: 0,
                      }}>{c}</th>
                    ))}
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await apiGet<SecretsResponse>('/api/databases/secrets');
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [item.id]);

  return (
    <>
      <PageHeader title={item.label} breadcrumb="Databases" actions={back} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '16px' }}>
            <KeyRound size={14} /> Values stay masked until you reveal them.
          </div>

          {loading && <PageState loading />}
          {error && <PageState error={error} />}

          {data && data.groups.map(group => (
            <section key={group.category} style={{ marginBottom: '20px' }}>
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
        </div>
      </div>
    </>
  );
}
