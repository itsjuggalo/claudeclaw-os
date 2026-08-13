// TradeDeskPage — 6-panel trading command center grid for ClaudeClaw dashboard.
// Polls /api/trade-desk/overview (5 min) and /api/trade-desk/brief (5 min).
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { NestedSquaresSpinner } from '@/components/NestedSquaresSpinner';
import { useFetch, invalidateFetchCache } from '@/lib/useFetch';
import { useSpin } from '@/lib/useSpin';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

// ── palette ─────────────────────────────────────────────────────────────────
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

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtTs = (iso: string | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const trunc = (s: string | undefined, n: number) => {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
};

const bandColor = (band: string) => {
  const b = (band || '').toUpperCase();
  if (b === 'PLATINUM') return C.purple;
  if (b === 'GOLD')     return C.amber;
  return C.muted;
};

const bandBg = (band: string) => {
  const b = (band || '').toUpperCase();
  if (b === 'PLATINUM') return C.purple + '22';
  if (b === 'GOLD')     return C.amber + '22';
  return '#1a2332';
};

// ── shared sub-components ────────────────────────────────────────────────────
function PanelCard({ title, children, linkHref }: {
  title: string;
  children: preact.ComponentChildren;
  linkHref?: string;
}) {
  const inner = (
    <div style={{
      background: C.card,
      border: `1px solid ${C.borderB}`,
      borderRadius: '8px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      height: '100%',
    }}>
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '10px', letterSpacing: '2px', color: C.muted, fontWeight: 700, fontFamily: MONO }}>
          {title}
        </span>
        {linkHref && (
          <span style={{ fontSize: '9px', color: C.blue, fontFamily: MONO, letterSpacing: '1px' }}>VIEW ›</span>
        )}
      </div>
      <div style={{ flex: 1, padding: '12px 14px', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );

  if (linkHref) {
    return (
      <a href={linkHref} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
        {inner}
      </a>
    );
  }
  return inner as any;
}

// ── Panel 1: Flow Rank Picks ─────────────────────────────────────────────────
function FlowRankPanel({ flowRank }: { flowRank: any }) {
  const picks: any[] = (flowRank?.picks || []).slice(0, 5);
  const cycleTime = flowRank?.cycle_time;

  return (
    <PanelCard title="FLOW RANK — TOP PICKS" linkHref="/trade-desk/flow-rank">
      <div style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, marginBottom: '10px' }}>
        cycle {fmtTs(cycleTime)}
      </div>
      {picks.length === 0 ? (
        <div style={{ color: C.muted, fontSize: '12px', fontFamily: MONO, padding: '12px 0', textAlign: 'center' }}>
          Pipeline cycle pending…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {picks.map((p: any, i: number) => (
            <div key={i} style={{
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              padding: '8px 11px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <span style={{ fontSize: '10px', color: C.muted, fontFamily: MONO, width: '14px', flexShrink: 0 }}>
                {p.rank ?? i + 1}
              </span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: C.blue, fontFamily: MONO, width: '54px', flexShrink: 0, letterSpacing: '0.5px' }}>
                {p.ticker}
              </span>
              <span style={{
                fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '3px',
                fontFamily: MONO, letterSpacing: '1px',
                background: bandBg(p.final_band), color: bandColor(p.final_band),
                border: `1px solid ${bandColor(p.final_band)}44`,
                flexShrink: 0,
              }}>
                {p.final_band}
              </span>
              <span style={{ fontSize: '11px', color: C.text, fontFamily: MONO, flexShrink: 0 }}>
                {(p.final_confidence ?? 0)}
              </span>
              <span style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, background: '#1a2332', padding: '2px 6px', borderRadius: '3px', flexShrink: 0 }}>
                {p.asset_class}
              </span>
              <span style={{ fontSize: '10px', color: '#90a4ae', fontFamily: MONO, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {trunc(p.curator_thesis, 80)}
              </span>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

// ── Panel 2: Momentum Strip ───────────────────────────────────────────────────
function MomentumPanel({ momentum }: { momentum: any[] }) {
  const items = (momentum || []).slice(0, 10);

  const arrowFor = (m: any) => {
    const trend = (m.trend || '').toUpperCase();
    if (trend === 'UP' || (m.bull_streak ?? 0) > 0) return '↑';
    if (trend === 'DOWN' || (m.bear_streak ?? 0) > 0) return '↓';
    return '→';
  };

  const colorFor = (m: any) => {
    const trend = (m.trend || '').toUpperCase();
    if (trend === 'UP' || (m.bull_streak ?? 0) > 0) return C.green;
    if (trend === 'DOWN' || (m.bear_streak ?? 0) > 0) return C.red;
    return C.muted;
  };

  return (
    <PanelCard title="MOMENTUM" linkHref="/trade-desk/flow-rank">
      {items.length === 0 ? (
        <div style={{ color: C.muted, fontSize: '12px', fontFamily: MONO, padding: '12px 0', textAlign: 'center' }}>
          No momentum data yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', overflowX: 'auto' }}>
          {items.map((m: any, i: number) => {
            const col = colorFor(m);
            const arrow = arrowFor(m);
            const streak = m.streak ?? m.bull_streak ?? 0;
            return (
              <div key={i} style={{
                background: col + '15',
                border: `1px solid ${col}44`,
                borderRadius: '6px',
                padding: '7px 11px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                minWidth: '60px',
              }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: col, fontFamily: MONO, letterSpacing: '0.5px' }}>
                  {m.ticker}
                </span>
                <span style={{ fontSize: '14px', color: col }}>
                  {arrow}
                </span>
                <span style={{ fontSize: '9px', color: C.muted, fontFamily: MONO }}>
                  ×{streak}
                </span>
                {m.avg_confidence_7d != null && (
                  <span style={{ fontSize: '9px', color: '#90a4ae', fontFamily: MONO }}>
                    {(m.avg_confidence_7d * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}

// ── Panel 3: Macro Regime ────────────────────────────────────────────────────
function MacroPanel({ macro }: { macro: any }) {
  if (!macro) {
    return (
      <PanelCard title="MACRO">
        <div style={{ color: C.muted, fontSize: '12px', fontFamily: MONO, textAlign: 'center', padding: '12px 0' }}>
          No macro data
        </div>
      </PanelCard>
    );
  }

  const regimeColor = macro.regime === 'RISK_ON' ? C.green : macro.regime === 'RISK_OFF' ? C.red : C.amber;
  const vix = Number(macro.vix ?? 0);
  const vixColor = vix < 18 ? C.green : vix <= 25 ? C.amber : C.red;

  let tailwinds: string[] = [];
  let headwinds: string[] = [];
  try {
    const parsed = JSON.parse(macro.sector_tailwinds_json || '{}');
    tailwinds = (parsed.tailwinds || []).slice(0, 3);
    headwinds = (parsed.headwinds || []).slice(0, 3);
  } catch { /* ignore */ }

  return (
    <PanelCard title="MACRO">
      {/* Regime badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <span style={{
          fontSize: '13px', fontWeight: 800, padding: '4px 12px', borderRadius: '5px',
          fontFamily: MONO, letterSpacing: '2px',
          background: regimeColor + '22', color: regimeColor,
          border: `1px solid ${regimeColor}55`,
          textShadow: `0 0 8px ${regimeColor}44`,
        }}>
          {macro.regime ?? '—'}
        </span>
      </div>

      {/* VIX row */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '10px' }}>
        <div>
          <div style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, letterSpacing: '1.5px', marginBottom: '3px' }}>VIX</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: vixColor, fontFamily: MONO }}>
            {vix.toFixed(1)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, letterSpacing: '1.5px', marginBottom: '3px' }}>VIX %ILE</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: C.text, fontFamily: MONO }}>
            {macro.vix_pct != null ? macro.vix_pct + '%' : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, letterSpacing: '1.5px', marginBottom: '3px' }}>FED</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: C.amber, fontFamily: MONO }}>
            {macro.fed_posture ?? '—'}
          </div>
        </div>
      </div>

      {/* Rates summary */}
      {macro.rates_summary && (
        <div style={{ fontSize: '11px', color: '#90a4ae', fontFamily: MONO, marginBottom: '10px', lineHeight: 1.5 }}>
          {trunc(macro.rates_summary, 120)}
        </div>
      )}

      {/* Sector chips */}
      {(tailwinds.length > 0 || headwinds.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
          {tailwinds.map((s: string, i: number) => (
            <span key={'t' + i} style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '3px', fontFamily: MONO, background: C.green + '22', color: C.green, border: `1px solid ${C.green}44` }}>
              ↑ {s}
            </span>
          ))}
          {headwinds.map((s: string, i: number) => (
            <span key={'h' + i} style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '3px', fontFamily: MONO, background: C.red + '22', color: C.red, border: `1px solid ${C.red}44` }}>
              ↓ {s}
            </span>
          ))}
        </div>
      )}

      <div style={{ fontSize: '9px', color: C.muted, fontFamily: MONO }}>
        ran {fmtTs(macro.ran_at)}
      </div>
    </PanelCard>
  );
}

// ── Panel 4: Recent Flow Winners ─────────────────────────────────────────────
function WinnersPanel({ winners }: { winners: any[] }) {
  const rows = (winners || []).slice(0, 5);

  return (
    <PanelCard title="FLOW WINNERS (7D)" linkHref="/trade-desk/flow-winners">
      {rows.length === 0 ? (
        <div style={{ color: C.muted, fontSize: '12px', fontFamily: MONO, textAlign: 'center', padding: '12px 0' }}>
          No winners yet
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
          <thead>
            <tr>
              {['SYM', 'TYPE', 'STRIKE', 'EXPIRY', 'PEAK%'].map(h => (
                <th key={h} style={{ fontSize: '9px', color: C.muted, letterSpacing: '1.2px', textAlign: 'left', padding: '0 6px 8px 0', fontWeight: 700 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w: any, i: number) => {
              const peak = Number(w.peak_pct ?? 0);
              const peakColor = peak >= 500 ? C.green : peak >= 200 ? C.amber : C.text;
              return (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '7px 6px 7px 0', fontSize: '12px', fontWeight: 800, color: C.blue }}>
                    {w.symbol}
                  </td>
                  <td style={{ padding: '7px 6px 7px 0', fontSize: '10px', color: w.option_type === 'CALL' ? C.green : C.red }}>
                    {w.option_type}
                  </td>
                  <td style={{ padding: '7px 6px 7px 0', fontSize: '10px', color: C.text }}>
                    ${w.strike}
                  </td>
                  <td style={{ padding: '7px 6px 7px 0', fontSize: '10px', color: C.muted }}>
                    {w.expiry ? String(w.expiry).slice(2) : '—'}
                  </td>
                  <td style={{ padding: '7px 0', fontSize: '11px', fontWeight: 700, color: peakColor }}>
                    +{peak.toLocaleString()}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </PanelCard>
  );
}

// ── Panel 5: Trade Ledger ─────────────────────────────────────────────────────
function LedgerPanel({ ledger }: { ledger: any[] }) {
  const rows = (ledger || []).slice(-8).reverse();

  return (
    <PanelCard title="RECENT EXECUTIONS" linkHref="/trade-desk/portfolio">
      {rows.length === 0 ? (
        <div style={{ color: C.muted, fontSize: '12px', fontFamily: MONO, textAlign: 'center', padding: '12px 0' }}>
          No executions in last 48h
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {rows.map((r: any, i: number) => {
            const ok = String(r.exec_ok).toLowerCase() === 'true';
            const conf = r.confidence != null ? (Number(r.confidence) * 100).toFixed(0) : null;
            return (
              <div key={i} style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: '5px',
                padding: '7px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}>
                <span style={{
                  fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                  fontFamily: MONO, letterSpacing: '1px',
                  background: r.account?.includes('Boba') ? C.blue + '22' : C.purple + '22',
                  color: r.account?.includes('Boba') ? C.blue : C.purple,
                  border: `1px solid ${r.account?.includes('Boba') ? C.blue : C.purple}44`,
                  flexShrink: 0,
                }}>
                  {r.account?.replace(' R2', '') ?? '?'}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: C.blue, fontFamily: MONO, flexShrink: 0 }}>
                  {r.ticker}
                </span>
                <span style={{ fontSize: '10px', color: r.option_type === 'CALL' ? C.green : C.red, fontFamily: MONO, flexShrink: 0 }}>
                  {r.option_type}
                </span>
                <span style={{ fontSize: '10px', color: C.muted, fontFamily: MONO, flexShrink: 0 }}>
                  ${r.strike} · {r.expiry ? String(r.expiry).slice(2) : '—'}
                </span>
                <span style={{ fontSize: '11px', color: C.text, fontFamily: MONO, flexShrink: 0 }}>
                  @${Number(r.fill_price ?? 0).toFixed(2)}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '14px', flexShrink: 0 }}>
                  {ok ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.red }}>✗</span>}
                </span>
                {conf != null && (
                  <span style={{ fontSize: '9px', color: C.muted, fontFamily: MONO, flexShrink: 0 }}>
                    {conf}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}

// ── Panel 6: AI Brief ─────────────────────────────────────────────────────────
function BriefPanel({ briefData }: { briefData: any }) {
  const { busy: refreshing, spin } = useSpin();
  const handleRefresh = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void spin(() => { invalidateFetchCache('/api/trade-desk/brief'); });
  };

  const notGenerated = !briefData || briefData.status === 'not_generated' || !briefData.brief;
  const lines: string[] = briefData?.brief
    ? String(briefData.brief).split('\n').filter(Boolean)
    : [];

  return (
    <PanelCard title="AI TRADING BRIEF">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        {briefData?.generated_at && (
          <span style={{ fontSize: '9px', color: C.muted, fontFamily: MONO }}>
            {fmtTs(briefData.generated_at)}
          </span>
        )}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            fontSize: '9px', color: C.blue, fontFamily: MONO,
            background: 'transparent', border: `1px solid ${C.blue}44`,
            borderRadius: '3px', padding: '3px 8px',
            cursor: 'pointer', letterSpacing: '1px',
          }}
        >
          {refreshing ? <NestedSquaresSpinner size={10} /> : null} REFRESH
        </button>
      </div>

      {notGenerated ? (
        <div style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: '6px',
          padding: '14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
        }}>
          <span style={{ fontSize: '16px', color: C.muted }}>ℹ</span>
          <span style={{ fontSize: '11px', color: C.muted, fontFamily: MONO, lineHeight: 1.6 }}>
            Brief generates every 5 min during market hours (9:30–4:00 ET)
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {lines.map((line: string, i: number) => {
            const isBullet = line.trimStart().startsWith('•') || line.trimStart().startsWith('-');
            return (
              <div key={i} style={{
                fontSize: '11px',
                color: isBullet ? C.text : '#90a4ae',
                fontFamily: MONO,
                lineHeight: 1.6,
                paddingLeft: isBullet ? '0' : '0',
                display: 'flex',
                gap: '6px',
                alignItems: 'flex-start',
              }}>
                {isBullet && (
                  <span style={{ color: C.blue, flexShrink: 0, fontSize: '10px', marginTop: '2px' }}>▸</span>
                )}
                <span style={{ flex: 1 }}>
                  {isBullet ? line.replace(/^[\s•\-]+/, '') : line}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function TradeDeskPage() {
  const { data, loading, error } = useFetch<any>('/api/trade-desk/overview', 300_000);
  const { data: briefData } = useFetch<any>('/api/trade-desk/brief', 300_000);

  if (error) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Trade Desk" />
        <PageState error={error} />
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Trade Desk" />
        <PageState loading />
      </div>
    );
  }

  const overview = data || {};

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Trade Desk" />
      <div style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
        <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>

          {/* 2-column grid — collapses naturally at narrow widths */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))',
            gap: '16px',
            alignItems: 'start',
          }}>
            <FlowRankPanel flowRank={overview.flow_rank} />
            <MomentumPanel momentum={overview.momentum} />
            <MacroPanel macro={overview.macro} />
            <WinnersPanel winners={overview.recent_winners} />
            <LedgerPanel ledger={overview.ledger} />
            <BriefPanel briefData={briefData} />
          </div>

        </div>
      </div>
    </div>
  );
}
