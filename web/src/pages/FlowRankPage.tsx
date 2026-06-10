// FlowRankPage — ranked options flow picks + AIME query panel.
// Two-column layout: picks on left (60%), AIME on right (40%).
import { useState, useEffect } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:       '#0d1420',
  card:     '#0a1929',
  border:   '#1a2332',
  borderB:  '#1a3a4a',
  text:     '#e0e0e0',
  muted:    '#607d8b',
  green:    '#66bb6a',
  red:      '#ef5350',
  blue:     '#4fc3f7',
  purple:   '#ce93d8',
  amber:    '#ff9800',
  platinum: '#b39ddb',
  gold:     '#ff9800',
  silver:   '#90a4ae',
};

// ── types ─────────────────────────────────────────────────────────────────────
interface Pick {
  rank: number;
  ticker: string;
  final_band: 'PLATINUM' | 'GOLD' | 'SILVER';
  final_confidence: number;
  curator_thesis: string;
  asset_class: string;
  target_account: string;
  generated_at: string;
}

interface FlowRankData {
  picks: Pick[];
  cycle_time: string;
}

interface AimeResponse {
  response?: string;
  status: string;
  message?: string;
}

interface HistoryEntry {
  prompt: string;
  response: string;
  status: string;
  message?: string;
  ts: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function bandColor(band: string): string {
  if (band === 'PLATINUM') return C.platinum;
  if (band === 'GOLD')     return C.gold;
  return C.silver;
}

function bandBg(band: string): string {
  if (band === 'PLATINUM') return 'rgba(179,157,219,0.18)';
  if (band === 'GOLD')     return 'rgba(255,152,0,0.18)';
  return 'rgba(144,164,174,0.12)';
}

function bandBorder(band: string): string {
  if (band === 'PLATINUM') return C.platinum;
  if (band === 'GOLD')     return C.gold;
  return C.silver;
}

function confidenceColor(pct: number): string {
  if (pct >= 80) return C.green;
  if (pct >= 60) return C.amber;
  return C.red;
}

function formatCycleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true, timeZoneName: 'short',
    });
  } catch { return iso; }
}

const QUICK_PROMPTS = [
  'Analyze top flow rank pick',
  'Should I buy AMD calls right now?',
  "What's the market saying about NVDA?",
  'Best options play for this macro regime?',
];

// ── component ─────────────────────────────────────────────────────────────────
export function FlowRankPage() {
  const { data, loading, error } = useFetch<FlowRankData>('/api/trade-desk/flow-rank', 300_000);
  const picks: Pick[] = data?.picks ?? [];

  // responsive
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 900);
  useEffect(() => {
    const handler = () => setNarrow(window.innerWidth < 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // expand/collapse thesis rows
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (rank: number) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(rank) ? next.delete(rank) : next.add(rank);
    return next;
  });

  // scoring explainer toggle
  const [scoringOpen, setScoringOpen] = useState(false);

  // AIME panel state
  const [prompt, setPrompt] = useState('');
  const [aimeLoading, setAimeLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  async function submitAime() {
    const q = prompt.trim();
    if (!q || aimeLoading) return;
    setAimeLoading(true);
    try {
      const res = await apiPost<AimeResponse>('/api/trade-desk/aime', { prompt: q });
      setHistory(prev => [
        { prompt: q, response: res.response ?? '', status: res.status, message: res.message, ts: Date.now() },
        ...prev.slice(0, 2),
      ]);
      setPrompt('');
    } catch (e) {
      setHistory(prev => [
        { prompt: q, response: '', status: 'error', message: String(e), ts: Date.now() },
        ...prev.slice(0, 2),
      ]);
    } finally {
      setAimeLoading(false);
    }
  }

  // ── PageHeader breadcrumb ──────────────────────────────────────────────────
  const backLink = (
    <a
      href="/trade-desk"
      style={{ fontSize: 12, color: C.muted, textDecoration: 'none', marginRight: 8 }}
    >
      ← Trade Desk
    </a>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>
      <PageHeader
        title="Flow Rank"
        breadcrumb="Trade Desk"
        actions={backLink}
      />

      {loading && picks.length === 0 && <PageState loading />}
      {error && <PageState error={error} />}

      {(!loading || picks.length > 0) && !error && (
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 20px 48px',
        }}>
          <div style={{
            display: 'flex',
            flexDirection: narrow ? 'column' : 'row',
            gap: 16,
            maxWidth: 1400,
            margin: '0 auto',
          }}>

            {/* ══════════════════════ LEFT: PICKS ══════════════════════════ */}
            <div style={{ flex: narrow ? '1 1 auto' : '0 0 60%', minWidth: 0 }}>

              {/* Panel header */}
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: '10px 10px 0 0', padding: '12px 16px',
                display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
              }}>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: C.blue, letterSpacing: 1 }}>
                  FLOW RANK v2.1
                </span>
                {data?.cycle_time && (
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
                    Cycle: {formatCycleTime(data.cycle_time)}
                  </span>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {(['PLATINUM', 'GOLD', 'SILVER'] as const).map(b => (
                    <span key={b} style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: bandBg(b), color: bandColor(b),
                      border: `1px solid ${bandBorder(b)}33`, fontFamily: MONO,
                    }}>{b}</span>
                  ))}
                </div>
              </div>

              {/* Table */}
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderTop: 'none', borderRadius: picks.length === 0 ? '0 0 10px 10px' : '0',
                overflowX: 'auto',
              }}>
                {picks.length === 0 ? (
                  <div style={{ padding: '24px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                    Pipeline cycle pending — runs every 15 min during market hours
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        {['RANK', 'TICKER', 'BAND', 'CONFIDENCE', 'ACCOUNT', 'THESIS'].map(h => (
                          <th key={h} class={h === 'ACCOUNT' ? 'hidden sm:table-cell' : h === 'THESIS' ? 'hidden md:table-cell' : undefined} style={{
                            padding: '8px 12px', textAlign: 'left',
                            fontSize: 10, fontFamily: MONO, fontWeight: 700,
                            color: C.muted, letterSpacing: 1,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {picks.map(pick => {
                        const isExpanded = expanded.has(pick.rank);
                        const thesis = pick.curator_thesis ?? '';
                        const truncated = thesis.length > 100 ? thesis.slice(0, 100) + '…' : thesis;
                        const needsExpand = thesis.length > 100;

                        return [
                          <tr
                            key={`row-${pick.rank}`}
                            style={{
                              borderBottom: `1px solid ${C.border}`,
                              borderLeft: `3px solid ${bandBorder(pick.final_band)}`,
                              background: isExpanded ? `${bandBg(pick.final_band)}` : undefined,
                              transition: 'background 0.1s',
                            }}
                          >
                            {/* RANK */}
                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: 28, height: 28, borderRadius: '50%',
                                background: 'rgba(255,255,255,0.04)',
                                border: `1px solid ${C.border}`,
                                fontSize: 11, fontFamily: MONO, color: C.muted,
                              }}>#{pick.rank}</span>
                            </td>
                            {/* TICKER */}
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ fontSize: 16, fontWeight: 800, color: C.blue, fontFamily: MONO }}>
                                {pick.ticker}
                              </span>
                            </td>
                            {/* BAND */}
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                padding: '3px 9px', borderRadius: 999, fontSize: 10,
                                fontFamily: MONO, fontWeight: 700,
                                background: bandBg(pick.final_band),
                                color: bandColor(pick.final_band),
                                border: `1px solid ${bandBorder(pick.final_band)}55`,
                              }}>{pick.final_band}</span>
                            </td>
                            {/* CONFIDENCE */}
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                fontSize: 13, fontWeight: 700, fontFamily: MONO,
                                color: confidenceColor(pick.final_confidence),
                              }}>{pick.final_confidence}%</span>
                            </td>
                            {/* ACCOUNT */}
                            <td class="hidden sm:table-cell" style={{ padding: '10px 12px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: 4, fontSize: 10,
                                fontFamily: MONO, background: 'rgba(79,195,247,0.1)',
                                color: C.blue, border: `1px solid ${C.borderB}`,
                              }}>{pick.target_account}</span>
                            </td>
                            {/* THESIS */}
                            <td class="hidden md:table-cell" style={{ padding: '10px 12px', maxWidth: 280 }}>
                              <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
                                {isExpanded ? thesis : truncated}
                              </span>
                              {needsExpand && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(pick.rank)}
                                  style={{
                                    marginLeft: 6, fontSize: 10, color: C.blue,
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    padding: 0, fontFamily: MONO,
                                  }}
                                >{isExpanded ? '▲ less' : '▼ more'}</button>
                              )}
                            </td>
                          </tr>,
                          // mobile-only thesis row (THESIS column is hidden < md)
                          thesis ? (
                            <tr key={`mob-${pick.rank}`} class="md:hidden" style={{
                              borderBottom: `1px solid ${C.border}`,
                              borderLeft: `3px solid ${bandBorder(pick.final_band)}`,
                            }}>
                              <td colSpan={4} style={{ padding: '0 12px 10px' }}>
                                <span style={{ fontSize: 11.5, color: C.text, lineHeight: 1.5 }}>
                                  {isExpanded ? thesis : truncated}
                                </span>
                                {needsExpand && (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(pick.rank)}
                                    style={{
                                      marginLeft: 6, fontSize: 10, color: C.blue,
                                      background: 'none', border: 'none', cursor: 'pointer',
                                      padding: 0, fontFamily: MONO,
                                    }}
                                  >{isExpanded ? '▲ less' : '▼ more'}</button>
                                )}
                              </td>
                            </tr>
                          ) : null,
                          // expanded sub-row
                          isExpanded && (
                            <tr key={`expand-${pick.rank}`} style={{
                              background: `${bandBg(pick.final_band)}`,
                              borderBottom: `1px solid ${C.border}`,
                              borderLeft: `3px solid ${bandBorder(pick.final_band)}`,
                            }}>
                              <td colSpan={6} style={{ padding: '10px 16px 14px' }}>
                                <div style={{
                                  fontSize: 12, color: C.text, lineHeight: 1.7,
                                  background: 'rgba(0,0,0,0.2)', borderRadius: 8,
                                  padding: '10px 14px',
                                  borderLeft: `2px solid ${bandColor(pick.final_band)}`,
                                }}>
                                  {thesis}
                                </div>
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Scoring explainer */}
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderTop: 'none', borderRadius: '0 0 10px 10px',
              }}>
                <button
                  type="button"
                  onClick={() => setScoringOpen(o => !o)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 16px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: C.muted, fontFamily: MONO,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span>How scoring works</span>
                  <span style={{ transition: 'transform 0.15s', display: 'inline-block', transform: scoringOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </button>
                {scoringOpen && (
                  <div style={{
                    padding: '0 16px 14px', fontSize: 11, color: C.muted,
                    lineHeight: 1.8, fontFamily: MONO,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    <div style={{ paddingTop: 10 }}>
                      <span style={{ color: C.blue }}>Repeat Accumulation</span> (0–35 pts) ·{' '}
                      <span style={{ color: C.amber }}>Premium Urgency</span> (0–30 pts) ·{' '}
                      <span style={{ color: C.green }}>Aggressor Pattern</span> (0–20 pts) ·{' '}
                      <span style={{ color: C.purple }}>Moneyness Bonus</span> (0–10 pts) ·{' '}
                      <span style={{ color: C.platinum }}>Winner Symbol Bonus</span> (+5 pts for TSLA, NVDA, AAPL…)
                    </div>
                    <div style={{ marginTop: 6, color: '#3d5060' }}>
                      PLATINUM ≥ 90 · GOLD ≥ 75 · SILVER ≥ 60
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ══════════════════════ RIGHT: AIME ══════════════════════════ */}
            <div style={{ flex: narrow ? '1 1 auto' : '0 0 40%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Panel header */}
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: '10px 10px 0 0', padding: '12px 16px',
              }}>
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: C.purple, letterSpacing: 1 }}>
                  AIME INTELLIGENCE
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  Powered by AInvest AI copilot
                </div>
              </div>

              {/* Quick prompts + query box */}
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderTop: 'none', borderRadius: '0 0 10px 10px',
                padding: '14px 16px',
              }}>
                {/* Quick prompts */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {QUICK_PROMPTS.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPrompt(q)}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 999,
                        border: `1px solid ${C.borderB}`, cursor: 'pointer',
                        background: 'rgba(79,195,247,0.06)', color: C.blue,
                        fontFamily: MONO, transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(79,195,247,0.14)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(79,195,247,0.06)'; }}
                    >{q}</button>
                  ))}
                </div>

                {/* Input */}
                <textarea
                  rows={3}
                  value={prompt}
                  onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitAime();
                  }}
                  placeholder="Ask AIME anything about the market..."
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: '#060e18', border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '10px 12px', resize: 'vertical',
                    color: C.text, fontSize: 13, fontFamily: MONO,
                    outline: 'none', lineHeight: 1.6,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button
                    type="button"
                    disabled={aimeLoading || !prompt.trim()}
                    onClick={submitAime}
                    style={{
                      padding: '7px 18px', borderRadius: 8, cursor: aimeLoading ? 'wait' : 'pointer',
                      background: aimeLoading ? 'rgba(206,147,216,0.1)' : 'rgba(206,147,216,0.18)',
                      border: `1px solid ${C.purple}66`, color: C.purple,
                      fontSize: 12, fontFamily: MONO, fontWeight: 700,
                      opacity: (!prompt.trim() && !aimeLoading) ? 0.4 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {aimeLoading ? '⟳ Thinking…' : 'Ask AIME →'}
                  </button>
                </div>
              </div>

              {/* Response history */}
              {history.map((entry, idx) => {
                const opacity = idx === 0 ? 1 : idx === 1 ? 0.6 : 0.35;
                const isNoCookie = entry.status === 'no_cookie';
                const isExpired  = entry.status === 'cookie_expired';
                const isError    = entry.status === 'error';

                return (
                  <div
                    key={entry.ts}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: '14px 16px',
                      opacity, transition: 'opacity 0.3s',
                    }}
                  >
                    {/* Prompt echo */}
                    <div style={{
                      fontSize: 11, color: C.muted, fontFamily: MONO,
                      marginBottom: 8, paddingBottom: 8,
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      Q: {entry.prompt}
                    </div>

                    {/* No-cookie warning */}
                    {isNoCookie && (
                      <div style={{
                        background: 'rgba(255,152,0,0.08)', border: `1px solid ${C.amber}55`,
                        borderRadius: 8, padding: '12px 14px',
                      }}>
                        <div style={{ color: C.amber, fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
                          AIME not configured
                        </div>
                        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.8 }}>
                          Set <code style={{ color: C.blue, fontFamily: MONO }}>AIME_SESSION_COOKIE</code> in{' '}
                          <code style={{ color: C.blue, fontFamily: MONO }}>~/.claudeclaw/.env</code> then restart ClaudeClaw.
                        </div>
                        <ol style={{ fontSize: 11, color: C.muted, lineHeight: 2, marginTop: 10, paddingLeft: 18 }}>
                          <li>Open Chrome → go to ainvest.com while logged in</li>
                          <li>F12 → Application → Cookies → copy the cookie string</li>
                          <li>Add to <code style={{ fontFamily: MONO, color: C.blue }}>~/.claudeclaw/.env</code>:
                            <div style={{ marginTop: 4, background: '#06101a', padding: '6px 10px', borderRadius: 6, fontFamily: MONO, fontSize: 10, color: C.green }}>
                              AIME_SESSION_COOKIE=&lt;paste here&gt;
                            </div>
                          </li>
                          <li><code style={{ fontFamily: MONO, color: C.blue }}>systemctl --user restart claudeclaw.service</code></li>
                        </ol>
                      </div>
                    )}

                    {/* Expired cookie */}
                    {isExpired && (
                      <div style={{
                        background: 'rgba(239,83,80,0.08)', border: `1px solid ${C.red}55`,
                        borderRadius: 8, padding: '10px 14px',
                        fontSize: 12, color: C.red,
                      }}>
                        Session expired — refresh cookie in <code style={{ fontFamily: MONO }}>~/.claudeclaw/.env</code>
                      </div>
                    )}

                    {/* Generic error */}
                    {isError && (
                      <div style={{
                        background: 'rgba(239,83,80,0.08)', border: `1px solid ${C.red}55`,
                        borderRadius: 8, padding: '10px 14px',
                        fontSize: 12, color: C.red, fontFamily: MONO,
                      }}>
                        {entry.message || 'Request failed'}
                      </div>
                    )}

                    {/* Normal response */}
                    {!isNoCookie && !isExpired && !isError && entry.response && (
                      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {entry.response}
                      </div>
                    )}
                  </div>
                );
              })}

              {history.length === 0 && (
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: '24px 16px',
                  textAlign: 'center', color: C.muted, fontSize: 12, fontFamily: MONO,
                }}>
                  Ask a question above to get AIME intelligence
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowRankPage;
