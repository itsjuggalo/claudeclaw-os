// FlowWinnersPage — options contracts that achieved ≥200% peak return, with AI WHY explanations.
// Polls /api/trade-desk/flow-winners (5 min). Supports days selector + client-side symbol/type/sort filters.
import { useState, useMemo } from 'preact/hooks';
import { useFetch } from '@/lib/useFetch';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

const C = {
  bg: '#0d1420',
  card: '#0a1929',
  border: '#1a2332',
  borderB: '#1a3a4a',
  text: '#e0e0e0',
  muted: '#607d8b',
  green: '#66bb6a',
  red: '#ef5350',
  blue: '#4fc3f7',
  purple: '#ce93d8',
  amber: '#ff9800',
};

// ── types ────────────────────────────────────────────────────────────────────
interface Winner {
  contract: string;
  symbol: string;
  option_type: string;
  strike: number;
  expiry: string;
  first_price: number;
  max_price: number;
  peak_pct: number;
  why_summary: string;
  key_factors: string | null;
  pattern_tags: string | null;
  detected_at: string;
  flow_value: number;
  flow_count: number;
  alert_type: string;
}

interface ApiResponse {
  winners: Winner[];
}

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtFlow = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${v}`;
};

const fmtPct = (v: number) => `+${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}%`;

const fmtExpiry = (iso: string) => {
  // "2026-07-17" → "Jul-26"
  try {
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + '-' +
      String(d.getUTCFullYear()).slice(2);
  } catch { return iso; }
};

const fmtTs = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const peakColor = (pct: number) => {
  if (pct > 1000) return C.purple;
  if (pct > 500) return C.green;
  return C.blue;
};

const peakGlow = (pct: number) =>
  pct > 1000 ? `0 0 10px ${C.purple}66, 0 0 20px ${C.purple}33` : 'none';

const alertBadgeColor = (type: string) => {
  if (type === 'repeat_flow') return C.amber;
  if (type === 'weekly_flow') return C.blue;
  return C.muted;
};

const parseFactors = (raw: string | null): string[] | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch { /* fall through */ }
  return [raw];
};

// ── stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.borderB}`,
      borderRadius: '8px',
      padding: '14px 18px',
      flex: '1 1 160px',
    }}>
      <div style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, letterSpacing: '1.5px', marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 800, color: color ?? C.text, fontFamily: MONO, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

// ── winner card ──────────────────────────────────────────────────────────────
function WinnerCard({ w, expanded, onToggle }: {
  w: Winner;
  expanded: boolean;
  onToggle: () => void;
}) {
  const borderColor = w.peak_pct > 500 ? C.green : C.amber;
  const pColor = peakColor(w.peak_pct);
  const factors = parseFactors(w.key_factors);
  const callOrPut = w.option_type === 'CALL' ? C.green : C.red;

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.borderB}`,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '8px',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      onClick={onToggle}
    >
      {/* ── header row ── */}
      <div style={{
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px',
      }}>
        {/* Symbol */}
        <span style={{
          fontSize: '20px', fontWeight: 800, color: C.blue, fontFamily: MONO, letterSpacing: '0.5px', flexShrink: 0,
        }}>
          {w.symbol}
        </span>

        {/* Option type badge */}
        <span style={{
          fontSize: '9px', fontWeight: 700, padding: '3px 7px', borderRadius: '3px',
          fontFamily: MONO, letterSpacing: '1px',
          background: callOrPut + '22', color: callOrPut,
          border: `1px solid ${callOrPut}44`, flexShrink: 0,
        }}>
          {w.option_type}
        </span>

        {/* Strike + expiry */}
        <span style={{ fontSize: '11px', color: C.muted, fontFamily: MONO, flexShrink: 0 }}>
          ${w.strike} · {fmtExpiry(w.expiry)}
        </span>

        {/* Alert type badge */}
        <span style={{
          fontSize: '9px', fontWeight: 700, padding: '3px 7px', borderRadius: '3px',
          fontFamily: MONO, letterSpacing: '1px',
          background: alertBadgeColor(w.alert_type) + '22',
          color: alertBadgeColor(w.alert_type),
          border: `1px solid ${alertBadgeColor(w.alert_type)}44`,
          flexShrink: 0,
        }}>
          {w.alert_type}
        </span>

        {/* Divider */}
        <div style={{ flex: 1, minWidth: '16px' }} />

        {/* Peak % — right side */}
        <span style={{
          fontSize: '22px', fontWeight: 800, color: pColor, fontFamily: MONO,
          textShadow: peakGlow(w.peak_pct), flexShrink: 0,
        }}>
          {fmtPct(w.peak_pct)}
        </span>
        <span style={{ fontSize: '12px', color: C.green, flexShrink: 0 }}>▲</span>

        {/* Flow value */}
        <span style={{ fontSize: '11px', color: C.text, fontFamily: MONO, flexShrink: 0 }}>
          {fmtFlow(w.flow_value)} flow
        </span>
      </div>

      {/* Contract + prints sub-row */}
      <div style={{
        padding: '0 16px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '6px',
      }}>
        <span style={{ fontSize: '10px', color: C.muted, fontFamily: MONO }}>
          {w.contract}
        </span>
        <span style={{ fontSize: '10px', color: C.muted, fontFamily: MONO }}>
          {w.flow_count} print{w.flow_count !== 1 ? 's' : ''} · detected {fmtTs(w.detected_at)}
        </span>
      </div>

      {/* ── expanded body ── */}
      {expanded && (
        <div onClick={(e) => e.stopPropagation()}>
          {/* WHY IT WORKED */}
          <div style={{
            borderTop: `1px solid ${C.border}`,
            padding: '14px 16px',
            background: '#0d1117',
          }}>
            <div style={{
              fontSize: '9px', color: C.muted, fontFamily: MONO,
              letterSpacing: '2px', marginBottom: '10px', fontWeight: 700,
            }}>
              WHY IT WORKED
            </div>
            <p style={{
              margin: 0, fontSize: '12px', color: C.text, fontFamily: MONO,
              lineHeight: 1.6,
            }}>
              {w.why_summary}
            </p>
          </div>

          {/* KEY FACTORS */}
          {factors && (
            <div style={{
              borderTop: `1px solid ${C.border}`,
              padding: '14px 16px',
              background: '#0d1117',
            }}>
              <div style={{
                fontSize: '9px', color: C.muted, fontFamily: MONO,
                letterSpacing: '2px', marginBottom: '10px', fontWeight: 700,
              }}>
                KEY FACTORS
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {factors.map((f, i) => (
                  <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: C.amber, flexShrink: 0, fontSize: '10px', marginTop: '2px', fontFamily: MONO }}>•</span>
                    <span style={{ fontSize: '12px', color: C.text, fontFamily: MONO, lineHeight: 1.6 }}>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export function FlowWinnersPage() {
  const [days, setDays] = useState(7);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CALL' | 'PUT'>('ALL');
  const [sort, setSort] = useState<'peak' | 'date' | 'flow'>('peak');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);

  const path = `/api/trade-desk/flow-winners?days=${days}`;
  const { data, loading, error } = useFetch<ApiResponse>(path, 300_000);

  const allWinners: Winner[] = data?.winners ?? [];

  // client-side filter + sort
  const filtered = useMemo(() => {
    let list = allWinners;
    if (symbolFilter.trim()) {
      const q = symbolFilter.trim().toUpperCase();
      list = list.filter(w => w.symbol.includes(q));
    }
    if (typeFilter !== 'ALL') {
      list = list.filter(w => w.option_type === typeFilter);
    }
    if (sort === 'peak') list = [...list].sort((a, b) => b.peak_pct - a.peak_pct);
    else if (sort === 'date') list = [...list].sort((a, b) => b.detected_at.localeCompare(a.detected_at));
    else if (sort === 'flow') list = [...list].sort((a, b) => b.flow_value - a.flow_value);
    return list;
  }, [allWinners, symbolFilter, typeFilter, sort]);

  // stats
  const totalWinners = filtered.length;
  const avgPeak = totalWinners > 0
    ? Math.round(filtered.reduce((s, w) => s + w.peak_pct, 0) / totalWinners)
    : 0;
  const biggest = totalWinners > 0
    ? filtered.reduce((best, w) => w.peak_pct > best.peak_pct ? w : best, filtered[0])
    : null;
  const totalFlow = filtered.reduce((s, w) => s + (w.flow_value ?? 0), 0);

  // pattern summary (shown when >5 winners)
  const patternSummary = useMemo(() => {
    if (allWinners.length <= 5) return null;
    // most common alert_type
    const typeCounts: Record<string, number> = {};
    allWinners.forEach(w => { typeCounts[w.alert_type] = (typeCounts[w.alert_type] ?? 0) + 1; });
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    // top 3 symbols
    const symCounts: Record<string, number> = {};
    allWinners.forEach(w => { symCounts[w.symbol] = (symCounts[w.symbol] ?? 0) + 1; });
    const topSyms = Object.entries(symCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
    // avg flow_count
    const avgFC = allWinners.reduce((s, w) => s + (w.flow_count ?? 1), 0) / allWinners.length;
    return { topType, topSyms, avgFC };
  }, [allWinners]);

  // expand/collapse all
  const handleExpandAll = () => {
    if (allExpanded) {
      setExpandedIds(new Set());
      setAllExpanded(false);
    } else {
      setExpandedIds(new Set(filtered.map(w => w.contract)));
      setAllExpanded(true);
    }
  };

  const toggleCard = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── btn helpers ──────────────────────────────────────────────────────────
  const dayBtn = (d: number) => (
    <button
      key={d}
      onClick={() => setDays(d)}
      style={{
        padding: '5px 12px', borderRadius: '4px', fontFamily: MONO, fontSize: '11px', fontWeight: 700,
        letterSpacing: '0.5px', cursor: 'pointer',
        background: days === d ? C.blue + '33' : 'transparent',
        color: days === d ? C.blue : C.muted,
        border: `1px solid ${days === d ? C.blue + '66' : C.border}`,
        transition: 'all 0.15s',
      }}
    >
      {d}d
    </button>
  );

  const typeBtn = (t: 'ALL' | 'CALL' | 'PUT') => {
    const col = t === 'CALL' ? C.green : t === 'PUT' ? C.red : C.muted;
    const active = typeFilter === t;
    return (
      <button
        key={t}
        onClick={() => setTypeFilter(t)}
        style={{
          padding: '5px 12px', borderRadius: '4px', fontFamily: MONO, fontSize: '11px', fontWeight: 700,
          letterSpacing: '0.5px', cursor: 'pointer',
          background: active ? col + '33' : 'transparent',
          color: active ? col : C.muted,
          border: `1px solid ${active ? col + '66' : C.border}`,
          transition: 'all 0.15s',
        }}
      >
        {t}
      </button>
    );
  };

  const sortBtn = (key: 'peak' | 'date' | 'flow', label: string) => {
    const active = sort === key;
    return (
      <button
        key={key}
        onClick={() => setSort(key)}
        style={{
          padding: '5px 12px', borderRadius: '4px', fontFamily: MONO, fontSize: '11px', fontWeight: 700,
          letterSpacing: '0.5px', cursor: 'pointer',
          background: active ? C.amber + '22' : 'transparent',
          color: active ? C.amber : C.muted,
          border: `1px solid ${active ? C.amber + '55' : C.border}`,
          transition: 'all 0.15s',
        }}
      >
        {label}
      </button>
    );
  };

  // ── render ───────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Flow Winners" />
        <PageState error={error} />
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Flow Winners" />
        <PageState loading />
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Flow Winners" />
      <div style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
        <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>

          {/* Back link */}
          <a
            href="/trade-desk"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '11px', color: C.muted, fontFamily: MONO,
              textDecoration: 'none', marginBottom: '18px',
              letterSpacing: '0.5px',
            }}
          >
            ← Trade Desk
          </a>

          {/* Page title */}
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{
              margin: '0 0 8px', fontSize: '22px', fontWeight: 800,
              color: C.text, fontFamily: MONO, letterSpacing: '1px',
            }}>
              Flow Winners
            </h1>
            <span style={{
              display: 'inline-block',
              fontSize: '10px', fontFamily: MONO, letterSpacing: '1.5px',
              padding: '3px 10px', borderRadius: '4px',
              background: C.green + '22', color: C.green,
              border: `1px solid ${C.green}44`,
            }}>
              Contracts with ≥200% realized peak return
            </span>
          </div>

          {/* ── controls bar ── */}
          <div style={{
            background: C.card, border: `1px solid ${C.borderB}`,
            borderRadius: '8px', padding: '14px 16px', marginBottom: '20px',
            display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center',
          }}>
            {/* Days selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, letterSpacing: '1.5px', marginRight: '4px' }}>DAYS</span>
              {[1, 3, 7, 14, 30].map(dayBtn)}
            </div>

            {/* Symbol input */}
            <input
              type="text"
              placeholder="Filter by ticker..."
              value={symbolFilter}
              onInput={(e) => setSymbolFilter((e.target as HTMLInputElement).value)}
              style={{
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: '4px',
                color: C.text, fontFamily: MONO, fontSize: '11px',
                padding: '6px 10px', outline: 'none', width: '140px',
              }}
            />

            {/* Type filter */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['ALL', 'CALL', 'PUT'] as const).map(typeBtn)}
            </div>

            {/* Sort */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, letterSpacing: '1.5px' }}>SORT</span>
              {sortBtn('peak', 'Peak%')}
              {sortBtn('date', 'Date')}
              {sortBtn('flow', 'Flow $')}
            </div>

            {/* Count */}
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: C.muted, fontFamily: MONO }}>
              {totalWinners} winner{totalWinners !== 1 ? 's' : ''} found
            </span>
          </div>

          {/* ── stats row ── */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '20px',
          }}>
            <StatCard label="TOTAL WINNERS" value={String(totalWinners)} color={C.blue} />
            <StatCard
              label="AVG PEAK RETURN"
              value={totalWinners > 0 ? fmtPct(avgPeak) : '—'}
              color={C.green}
            />
            <StatCard
              label="BIGGEST WINNER"
              value={biggest ? `${biggest.symbol} ${fmtPct(biggest.peak_pct)}` : '—'}
              color={peakColor(biggest?.peak_pct ?? 0)}
            />
            <StatCard
              label="TOTAL FLOW PREMIUM"
              value={totalFlow > 0 ? fmtFlow(totalFlow) : '—'}
              color={C.amber}
            />
          </div>

          {/* ── expand/collapse all ── */}
          {filtered.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
              <button
                onClick={handleExpandAll}
                style={{
                  fontSize: '10px', fontFamily: MONO, letterSpacing: '1px',
                  color: C.blue, background: 'transparent',
                  border: `1px solid ${C.blue}44`, borderRadius: '4px',
                  padding: '5px 12px', cursor: 'pointer',
                }}
              >
                {allExpanded ? 'Collapse All' : 'Expand All'}
              </button>
            </div>
          )}

          {/* ── winners list ── */}
          {filtered.length === 0 ? (
            <div style={{
              background: C.card, border: `1px solid ${C.borderB}`,
              borderRadius: '8px', padding: '36px 24px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>◎</div>
              <div style={{ fontSize: '13px', color: C.text, fontFamily: MONO, marginBottom: '8px' }}>
                No winners detected in the past {days} day{days !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '11px', color: C.muted, fontFamily: MONO, lineHeight: 1.7 }}>
                Winners are flow contracts that achieved ≥200% peak return.<br />
                The scanner runs hourly during market hours.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filtered.map(w => (
                <WinnerCard
                  key={w.contract}
                  w={w}
                  expanded={expandedIds.has(w.contract)}
                  onToggle={() => toggleCard(w.contract)}
                />
              ))}
            </div>
          )}

          {/* ── pattern learning summary ── */}
          {patternSummary && (
            <div style={{
              marginTop: '28px',
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              padding: '16px 20px',
            }}>
              <div style={{
                fontSize: '9px', color: C.muted, fontFamily: MONO,
                letterSpacing: '2px', marginBottom: '12px', fontWeight: 700,
              }}>
                PATTERNS FROM THIS WINDOW
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[
                  [`Most common alert type`, patternSummary.topType],
                  [`Top symbols`, patternSummary.topSyms.join(', ') || '—'],
                  [`Avg flow print count`, patternSummary.avgFC.toFixed(1)],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '10px', color: C.muted, fontFamily: MONO, minWidth: '200px' }}>
                      {label}:
                    </span>
                    <span style={{ fontSize: '11px', color: C.text, fontFamily: MONO }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
