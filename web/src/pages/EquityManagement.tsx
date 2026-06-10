// Equity Management — per-agent (Boba/Jazzy) Alpaca risk console. Data from
// GET /api/equity (src/equity.ts): equity curves, risk metrics, doctrine
// checks, guardrail flags. Visual language matches Wallets (MONO + dark navy).
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const GREEN = '#66bb6a';
const RED = '#ef5350';
const AMBER = '#ffb74d';
const MUTED = '#607d8b';

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFull = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const sign = (n: number) => (n >= 0 ? '+' : '');
// Dollar amounts pair with Math.abs(), so the sign must be explicit —
// sign() alone drops the minus on negatives.
const fmtSigned = (n: number) => (n < 0 ? '-$' : '+$') + fmt(Math.abs(n));
const plColor = (n: number) => (n >= 0 ? GREEN : RED);

interface Flag { level: 'red' | 'amber'; code: string; msg: string }
interface Doctrine { rule: string; pass: boolean; detail: string }
interface Pos {
  symbol: string; display: string; asset_class: string; qty: number;
  market_value: number; cost_basis: number; unrealized_pl: number;
  unrealized_plpc: number; pct_of_equity: number; dte: number | null;
}
interface Account {
  name: string; ok: boolean; error?: string;
  equity: number; cash: number; buying_power: number;
  day_pl: number; day_pl_pct: number;
  curve: { t: number; eq: number }[];
  metrics: {
    sharpe: number | null; max_dd_pct: number; off_peak_pct: number;
    win_rate_days: number; down_streak: number; exposure_pct: number;
    top_pos_pct: number; month_pl_pct: number;
  };
  positions: Pos[]; doctrine: Doctrine[]; flags: Flag[];
}
interface Overview {
  accounts: Account[];
  combined: { equity: number; day_pl: number; day_pl_pct: number; red_flags: number; amber_flags: number };
  as_of: string;
}

export function EquityManagement() {
  const { data, loading, error, refresh } = useFetch<Overview>('/api/equity', 120_000);

  if (error) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Equity Management" />
        <PageState error={error} />
        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <button onClick={refresh} style={retryBtn}>Retry</button>
        </div>
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Equity Management" />
        <PageState loading />
      </div>
    );
  }
  const accounts = data?.accounts || [];
  const combined = data?.combined;

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Equity Management" actions={
        <button onClick={refresh} style={retryBtn}>Refresh</button>
      } />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>

          {/* COMMAND BAR — combined agent equity + flag census */}
          {combined && (
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 items-center" style={{
              marginBottom: '20px', padding: '22px 26px',
              background: 'linear-gradient(180deg, #0d1420 0%, #0a1115 100%)',
              border: '1px solid #1a2332', borderRadius: '10px',
            }}>
              <div>
                <div style={label}>AGENT EQUITY (BOBA + JAZZY)</div>
                <div style={{ fontSize: '44px', fontWeight: 800, color: '#e0e0e0', lineHeight: 1, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                  ${fmtFull(combined.equity)}
                </div>
                <div style={{ fontSize: '13px', color: plColor(combined.day_pl), marginTop: '8px', fontWeight: 600, fontFamily: MONO }}>
                  {fmtSigned(combined.day_pl)} today ({sign(combined.day_pl_pct)}{combined.day_pl_pct.toFixed(2)}%)
                </div>
              </div>
              <div class="flex flex-wrap gap-x-8 gap-y-3 lg:justify-center lg:px-6 lg:border-x lg:border-[#1a2332]">
                <Kpi label="RED FLAGS" value={String(combined.red_flags)} color={combined.red_flags > 0 ? RED : GREEN} glow={combined.red_flags > 0} />
                <Kpi label="AMBER" value={String(combined.amber_flags)} color={combined.amber_flags > 0 ? AMBER : GREEN} />
              </div>
              <div style={{ fontSize: '11px', color: MUTED, fontFamily: MONO, lineHeight: 1.7 }}>
                Doctrine: ≤20%/pick · -25% hard stop · ≤1 DTE gate · ≥3 underlyings · ≥10% cash.
                Violations surface as flags on each account below.
              </div>
            </div>
          )}

          {/* PER-ACCOUNT PANELS */}
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {accounts.map(a => <AccountPanel key={a.name} a={a} />)}
            {accounts.length === 0 && (
              <div style={{ padding: '24px', color: MUTED, fontFamily: MONO, fontSize: '12px', border: '1px dashed #1a2332', borderRadius: '8px' }}>
                No Alpaca agent credentials found in ~/.openclaw/secrets
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

const label = { fontSize: '11px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO } as const;
const retryBtn = {
  fontSize: '11px', color: '#4fc3f7', padding: '5px 14px', background: 'transparent',
  border: '1px solid #1a3a4a', borderRadius: '4px', cursor: 'pointer', fontFamily: MONO,
} as const;

function Kpi({ label: l, value, color, glow, sub }: { label: string; value: string; color: string; glow?: boolean; sub?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '1.5px', marginBottom: '6px', fontFamily: MONO }}>{l}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color, lineHeight: 1, fontFamily: MONO, textShadow: glow ? `0 0 8px ${color}66` : undefined, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px', fontFamily: MONO }}>{sub}</div>}
    </div>
  );
}

function AccountPanel({ a }: { a: Account }) {
  const m = a.metrics;
  const accent = a.name === 'boba' ? '#4fc3f7' : '#ce93d8';
  if (!a.ok) {
    return (
      <div style={{ ...panel, borderLeft: `3px solid ${RED}` }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO, textTransform: 'uppercase' }}>{a.name}</div>
        <div style={{ fontSize: '11px', color: RED, fontFamily: MONO, marginTop: '8px' }}>{a.error || 'fetch failed'}</div>
      </div>
    );
  }
  return (
    <div style={{ ...panel, borderLeft: `3px solid ${accent}` }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '15px', fontWeight: 800, color: accent, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase' }}>{a.name}</div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '24px', fontWeight: 800, color: '#e0e0e0', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>${fmt(a.equity)}</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: plColor(a.day_pl), fontFamily: MONO, marginLeft: '10px' }}>
            {fmtSigned(a.day_pl)} ({sign(a.day_pl_pct)}{a.day_pl_pct.toFixed(2)}%) today
          </span>
        </div>
      </div>

      {/* flags */}
      {a.flags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
          {a.flags.map((f, i) => (
            <span key={i} style={{
              fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '3px', fontFamily: MONO,
              background: (f.level === 'red' ? RED : AMBER) + '1d',
              color: f.level === 'red' ? RED : AMBER,
              border: `1px solid ${(f.level === 'red' ? RED : AMBER)}55`,
            }}>{f.code}: {f.msg}</span>
          ))}
        </div>
      )}

      {/* 1M equity curve */}
      <Curve curve={a.curve} id={a.name} />

      {/* KPI row */}
      <div class="grid grid-cols-3 md:grid-cols-6 gap-3" style={{ marginTop: '14px', padding: '12px', background: '#0d1117', borderRadius: '6px' }}>
        <Kpi label="1M P&L" value={`${sign(m.month_pl_pct)}${m.month_pl_pct.toFixed(1)}%`} color={plColor(m.month_pl_pct)} />
        <Kpi label="SHARPE" value={m.sharpe == null ? '—' : m.sharpe.toFixed(2)} color={m.sharpe != null && m.sharpe > 0 ? GREEN : '#90a4ae'} />
        <Kpi label="MAX DD" value={`${m.max_dd_pct.toFixed(1)}%`} color={m.max_dd_pct <= -15 ? RED : '#90a4ae'} />
        <Kpi label="WIN DAYS" value={`${m.win_rate_days.toFixed(0)}%`} color={m.win_rate_days >= 50 ? GREEN : AMBER} />
        <Kpi label="EXPOSURE" value={`${m.exposure_pct.toFixed(0)}%`} color={m.exposure_pct > 80 ? RED : '#4fc3f7'} />
        <Kpi label="CASH" value={`$${fmtFull(a.cash)}`} color={a.cash > 0 ? '#e0e0e0' : RED} />
      </div>

      {/* doctrine checklist */}
      <div style={{ marginTop: '14px' }}>
        <div style={{ fontSize: '9px', color: MUTED, letterSpacing: '1.5px', marginBottom: '6px', fontFamily: MONO }}>DISCIPLINE DOCTRINE</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {a.doctrine.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#0d1117', borderRadius: '4px', border: `1px solid ${d.pass ? '#1a2332' : RED + '44'}` }}>
              <span style={{
                fontSize: '9px', fontWeight: 800, padding: '2px 7px', borderRadius: '3px', fontFamily: MONO, letterSpacing: '1px',
                background: (d.pass ? GREEN : RED) + '1d', color: d.pass ? GREEN : RED, flexShrink: 0,
              }}>{d.pass ? 'PASS' : 'FAIL'}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO, flexShrink: 0 }}>{d.rule}</span>
              <span style={{ fontSize: '10px', color: MUTED, fontFamily: MONO, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* positions */}
      {a.positions.length > 0 && (
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '9px', color: MUTED, letterSpacing: '1.5px', marginBottom: '6px', fontFamily: MONO }}>POSITIONS ({a.positions.length})</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: '11px' }}>
              <thead>
                <tr style={{ color: MUTED, fontSize: '9px', letterSpacing: '1px', textAlign: 'right' }}>
                  <th style={{ ...th, textAlign: 'left' }}>POSITION</th>
                  <th style={th}>QTY</th>
                  <th style={th}>VALUE</th>
                  <th style={th}>% EQ</th>
                  <th style={th}>uP&L</th>
                  <th style={th}>DTE</th>
                </tr>
              </thead>
              <tbody>
                {a.positions.map((p, i) => {
                  const pc = plColor(p.unrealized_pl);
                  const dteRisk = p.dte !== null && p.dte <= 1;
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #1a2332', textAlign: 'right' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: '#e0e0e0' }}>{p.display}</td>
                      <td style={td}>{p.qty}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>${fmt(p.market_value)}</td>
                      <td style={{ ...td, color: p.pct_of_equity > 25 ? RED : '#90a4ae' }}>{p.pct_of_equity.toFixed(0)}%</td>
                      <td style={{ ...td, color: pc, fontWeight: 700 }}>{fmtSigned(p.unrealized_pl)} ({sign(p.unrealized_plpc * 100)}{(p.unrealized_plpc * 100).toFixed(1)}%)</td>
                      <td style={{ ...td, color: dteRisk ? RED : MUTED, fontWeight: dteRisk ? 800 : 400 }}>{p.dte == null ? '—' : p.dte}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {a.positions.length === 0 && (
        <div style={{ marginTop: '14px', padding: '12px', textAlign: 'center', color: MUTED, fontSize: '11px', fontFamily: MONO, border: '1px dashed #1a2332', borderRadius: '5px' }}>
          Flat — no open positions
        </div>
      )}
    </div>
  );
}

const panel = {
  background: 'linear-gradient(180deg, #0a1929 0%, #0d1420 100%)',
  border: '1px solid #1a3a4a', borderRadius: '8px', padding: '16px 18px',
} as const;
const th = { padding: '4px 8px', fontWeight: 600 } as const;
const td = { padding: '7px 8px' } as const;

function Curve({ curve, id }: { curve: { t: number; eq: number }[]; id: string }) {
  if (curve.length < 2) {
    return <div style={{ marginTop: '14px', padding: '16px', textAlign: 'center', color: MUTED, fontSize: '10px', fontFamily: MONO, background: '#0d1117', borderRadius: '6px' }}>No equity history yet</div>;
  }
  const W = 600, H = 120, PAD = 4;
  const eqs = curve.map(p => p.eq);
  const min = Math.min(...eqs), max = Math.max(...eqs);
  const range = max - min || 1;
  const pts = curve.map((p, i) => {
    const x = PAD + (i / (curve.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.eq - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = eqs[eqs.length - 1] >= eqs[0];
  const color = up ? GREEN : RED;
  const first = curve[0], last = curve[curve.length - 1];
  const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  return (
    <div style={{ marginTop: '14px', padding: '12px', background: '#0d1117', borderRadius: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '9px', color: MUTED, fontFamily: MONO, letterSpacing: '1px' }}>
        <span>1M EQUITY · {fmtDate(first.t)} → {fmtDate(last.t)}</span>
        <span>HI ${fmtFull(max)} · LO ${fmtFull(min)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '110px', display: 'block' }}>
        <defs>
          <linearGradient id={`eq-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={color} stop-opacity="0.25" />
            <stop offset="100%" stop-color={color} stop-opacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${PAD},${H - PAD} ${pts.join(' ')} ${W - PAD},${H - PAD}`} fill={`url(#eq-fill-${id})`} />
        <polyline points={pts.join(' ')} fill="none" stroke={color} stroke-width="1.8" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
