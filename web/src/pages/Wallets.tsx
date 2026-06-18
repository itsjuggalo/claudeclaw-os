// Wallets & Growth Plan — stacked REAL (top) / PAPER (bottom) view. Each section
// carries the same chart set: an allocation donut, a top-holdings bar list, and a
// computed "Next Moves" panel (rebalance drift + tax-loss harvesting for real;
// risk/doctrine guardrails for paper). REAL data = GET /api/wallets (RH + Coinbase,
// LOCAL-ONLY). PAPER data = GET /api/equity (boba + jazzy Alpaca, with curves +
// doctrine flags). Next-moves logic mirrors ~/05_AUTOMATION/{tlh,rebalance}_live.py
// (the /tlh + /rebalance CLIs); this is the read-only visualization layer.
import { useState, useEffect } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const GREEN = '#66bb6a', RED = '#ef5350', BLUE = '#4fc3f7', PURPLE = '#ce93d8';
const GREY = '#90a4ae', MUTED = '#607d8b', AMBER = '#ffb74d', TEXT = '#e0e0e0';

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const sgn = (n: number) => (n >= 0 ? '+' : '');
const plColor = (n: number) => (n >= 0 ? GREEN : RED);

const ACTION_BTN = {
  fontSize: '11px', color: BLUE, padding: '5px 14px', background: 'transparent',
  border: '1px solid #1a3a4a', borderRadius: '4px', cursor: 'pointer', fontFamily: MONO,
  textDecoration: 'none', display: 'inline-block',
} as const;

// Default class targets (matches rebalance_live.py); editable + persisted locally.
const DEFAULT_TARGET = { stock: 55, crypto: 30, cash: 15 };
const CONC_CAP = 15; // % of book in one name → flag
const DUST_USD = 5;

// Wash-sale-safe maintain-exposure proxies (mirrors tlh_live.py).
const REPLACEMENT: Record<string, string> = {
  SOUN: 'BOTZ/ROBO or ARKQ', MSTR: 'IBIT or FBTC', MSTY: 'YBTC / spot-BTC ETF',
  IBIT: 'FBTC or BITB', COIN: 'FINX (fintech basket)', NIO: 'LIT or DRIV',
  LIDR: 'ROBO or IDRV', NFLX: 'XLC or FDN', ORCL: 'XLK/VGT 31d, then rebuy',
  KLAR: 'FINX/IPAY', QBTS: 'QTUM',
};
const DEAD = new Set(['AMC', 'XXRP', 'XRPT', 'SNDL', 'TNXP', 'BBIG', 'KITT']);
const STABLE = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'USD', 'PYUSD', 'TUSD']);

// ─────────────────────────── wallet shaping (from original) ─────────────────
const isPaper = (w: any): boolean => {
  const name = (w.name || '').toLowerCase(), notes = (w.notes || '').toLowerCase();
  if (name.includes('go-trader') || name.includes('gotrader') || name.includes('paper') || name.includes('alpaca')) return true;
  if (notes.includes('strategies') && notes.includes('active')) return true;
  const badge = (w.badge || '').toUpperCase();
  return badge === 'PAPER';
};
const parseNotesHoldings = (w: any): any[] => {
  if ((w.positions || []).length > 0) return w.positions;
  const notes = String(w.notes || '');
  if (!notes || notes.includes('Phase') || notes.includes('strategies')) return [];
  const out: any[] = [];
  for (const part of notes.split('|').map((s: string) => s.trim()).filter(Boolean)) {
    let m = part.match(/^([A-Z0-9]+):\s*(-?[0-9.]+)\s*\(uPnL:\s*\$?(-?[0-9.]+)/i);
    if (m) { out.push({ symbol: m[1], quantity: parseFloat(m[2]), equity: Math.abs(parseFloat(m[3])) || 0, type: 'crypto', avg_cost: 0, price: 0, _upnl: parseFloat(m[3]) }); continue; }
    m = part.match(/^([A-Z0-9]+):\s*\$?([0-9.]+)/i);
    if (m) out.push({ symbol: m[1], quantity: 0, equity: parseFloat(m[2]), type: 'crypto', avg_cost: 0, price: 0 });
  }
  return out;
};
const mergeRobinhood = (wallets: any[]): any[] => {
  const stocks = wallets.find(w => (w.name || '').toLowerCase().includes('robinhood') && (w.name || '').toLowerCase().includes('stock'));
  const crypto = wallets.find(w => (w.name || '').toLowerCase().includes('robinhood') && (w.name || '').toLowerCase().includes('crypto'));
  if (!stocks && !crypto) return wallets;
  const merged: any = {
    name: 'Robinhood', badge: 'LIVE', type: 'Brokerage (Live)',
    balance: (stocks?.balance || 0) + (crypto?.balance || 0),
    cash: (stocks?.cash || 0) + (crypto?.cash || 0),
    buying_power: (stocks?.buying_power || 0) + (crypto?.buying_power || 0),
    status: (stocks?.status === 'error' || crypto?.status === 'error') ? 'error' : 'ok',
    notes: [stocks?.notes, crypto?.notes].filter(Boolean).join(' | '),
    positions: [...(stocks?.positions || []).map((p: any) => ({ ...p, type: p.type || 'stock' })),
                ...(crypto?.positions || []).map((p: any) => ({ ...p, type: p.type || 'crypto' }))],
    _merged: true,
  };
  return wallets.filter(w => w !== stocks && w !== crypto).concat(merged);
};

// ─────────────────────────────── charts ─────────────────────────────────────
function Donut({ segs, size = 150, thickness = 20, center, sub }: {
  segs: { label: string; value: number; color: string }[]; size?: number; thickness?: number; center?: string; sub?: string;
}) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#16202c" strokeWidth={thickness} />
        {segs.filter(s => s.value > 0).map((s, i) => {
          const len = (s.value / total) * C, off = acc; acc += len;
          return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
            strokeWidth={thickness} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />;
        })}
      </g>
      {center && <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle"
        style={{ fill: TEXT, fontSize: '17px', fontWeight: 800, fontFamily: MONO }}>{center}</text>}
      {sub && <text x="50%" y="61%" textAnchor="middle" dominantBaseline="middle"
        style={{ fill: MUTED, fontSize: '9px', letterSpacing: '1.5px', fontFamily: MONO }}>{sub}</text>}
    </svg>
  );
}

function Legend({ segs, total }: { segs: { label: string; value: number; color: string }[]; total: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', minWidth: '120px' }}>
      {segs.filter(s => s.value > 0).map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontFamily: MONO }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: s.color, flexShrink: 0 }} />
          <span style={{ color: GREY, flex: 1 }}>{s.label}</span>
          <span style={{ color: TEXT, fontWeight: 700 }}>{total > 0 ? ((s.value / total) * 100).toFixed(0) : 0}%</span>
          <span style={{ color: MUTED, minWidth: '54px', textAlign: 'right' }}>${fmt0(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

function BarRow({ items, max }: { items: { label: string; value: number; color: string; sub?: string }[]; max: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontFamily: MONO }}>
          <span style={{ width: '52px', color: TEXT, fontWeight: 700 }}>{it.label}</span>
          <div style={{ flex: 1, height: '14px', background: '#0d1117', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: Math.max(2, (it.value / (max || 1)) * 100) + '%', height: '100%', background: it.color, borderRadius: '3px' }} />
          </div>
          <span style={{ width: '64px', textAlign: 'right', color: GREY }}>${fmt0(it.value)}</span>
          {it.sub && <span style={{ width: '52px', textAlign: 'right', color: it.sub.startsWith('-') ? RED : GREEN }}>{it.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function Sparkline({ pts, color, w = 200, h = 40 }: { pts: number[]; color: string; w?: number; h?: number }) {
  if (pts.length < 2) return <div style={{ height: h, color: MUTED, fontSize: '10px', fontFamily: MONO }}>no curve</div>;
  const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p - min) / rng) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }} preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function Card({ title, accent, children, right }: { title: string; accent: string; children: any; right?: any }) {
  return (
    <div style={{ background: 'linear-gradient(180deg, #0a1929 0%, #0d1420 100%)', border: '1px solid #1a3a4a', borderRadius: '8px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: accent, fontWeight: 700, fontFamily: MONO }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────── real-money analytics ───────────────────────────
function buildRealBook(liveWallets: any[]) {
  const positions: any[] = [];
  let cash = 0;
  for (const w of liveWallets) {
    cash += w.cash || 0;
    for (const p of (w.positions || [])) {
      const equity = Number(p.equity || 0);
      if (equity <= 0) continue;
      const avg = Number(p.avg_cost || 0), price = Number(p.price || 0), qty = Number(p.quantity || 0);
      // Stablecoins are effectively cash — count them as such so allocation +
      // rebalance don't read $0 cash while real dry powder sits in USDC.
      const cls = STABLE.has(p.symbol) ? 'cash' : (p.type === 'crypto' ? 'crypto' : 'stock');
      if (cls === 'cash') { cash += equity; continue; }
      const upl = avg > 0 && qty ? (price - avg) * qty : null;
      const uplpct = p.pct_change != null ? p.pct_change : (avg > 0 ? ((price - avg) / avg) * 100 : null);
      positions.push({ symbol: p.symbol, cls, equity, avg, price, qty, upl, uplpct, broker: w.name });
    }
  }
  positions.sort((a, b) => b.equity - a.equity);
  const byClass = { stock: 0, crypto: 0, cash };
  for (const p of positions) byClass[p.cls as 'stock' | 'crypto'] += p.equity;
  const invested = byClass.stock + byClass.crypto;
  return { positions, byClass, cash, invested, total: invested + cash };
}

function nextMoves(book: any, target: Record<string, number>) {
  const total = book.total || 1;
  const drift = (['stock', 'crypto', 'cash'] as const).map(cls => {
    const cur = (book.byClass[cls] / total) * 100, tgt = target[cls] ?? 0;
    return { cls, cur, tgt, deltaPct: cur - tgt, deltaUsd: ((cur - tgt) / 100) * total };
  });
  const losers = book.positions.filter((p: any) => p.cls === 'stock' && p.upl != null && p.upl <= -1).sort((a: any, b: any) => a.upl - b.upl);
  const tlhTotal = losers.reduce((s: number, p: any) => s + p.upl, 0);
  const cryptoNoBasis = book.positions.filter((p: any) => p.cls === 'crypto' && p.avg <= 0 && p.equity >= DUST_USD);
  const dust = book.positions.filter((p: any) => p.equity > 0 && p.equity < DUST_USD);
  const conc = book.positions.filter((p: any) => (p.equity / total) * 100 >= CONC_CAP);
  return { drift, losers, tlhTotal, cryptoNoBasis, dust, conc };
}

// ──────────────────────────────── page ──────────────────────────────────────
export function Wallets() {
  const real = useFetch<any[]>('/api/wallets', 60_000);
  const paper = useFetch<any>('/api/equity', 120_000);
  const [target, setTarget] = useState<Record<string, number>>(() => {
    try { const r = localStorage.getItem('ccw:target-alloc'); if (r) return JSON.parse(r); } catch { /* */ }
    return { ...DEFAULT_TARGET };
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const wallets: any[] = Array.isArray(real.data) ? real.data : [];

  if (real.error && wallets.length === 0) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Wallets & Growth Plan" />
        <PageState error={real.error} />
        <div style={{ textAlign: 'center', marginTop: '12px' }}><button onClick={real.refresh} style={ACTION_BTN}>Retry</button></div>
      </div>
    );
  }
  if (real.loading && wallets.length === 0) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Wallets & Growth Plan" />
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <div class="animate-pulse" style={{ height: '180px', background: '#0d1420', border: '1px solid #1a2332', borderRadius: '10px', marginBottom: '16px' }} />
          <div class="animate-pulse" style={{ height: '180px', background: '#0a1929', border: '1px solid #1a3a4a', borderRadius: '10px' }} />
        </div>
      </div>
    );
  }

  const hydrated = wallets.map(w => (w.positions || []).length === 0 ? { ...w, positions: parseNotesHoldings(w) } : w);
  const merged = mergeRobinhood(hydrated);
  const liveWallets = merged.filter(w => !isPaper(w));
  const book = buildRealBook(liveWallets);
  const moves = nextMoves(book, target);

  const paperData = paper.data && !paper.data.error ? paper.data : null;
  const paperTotal = paperData?.combined?.equity || 0;

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Wallets & Growth Plan" actions={
        <>
          <Link href="/equity" style={ACTION_BTN}>Equity Mgmt →</Link>
          <button onClick={() => { real.refresh(); paper.refresh(); }} style={ACTION_BTN}>Refresh</button>
        </>
      } />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px' }}>

          <RealSection book={book} moves={moves} target={target} setTarget={setTarget}
            liveWallets={liveWallets} collapsed={collapsed} setCollapsed={setCollapsed} expanded={expanded} setExpanded={setExpanded} />

          <PaperSection data={paperData} loading={paper.loading} total={paperTotal} />

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── REAL ───────────────────────────────────────
function SectionBanner({ label, total, sub, accent, glow }: { label: string; total: number; sub: string; accent: string; glow: boolean }) {
  return (
    <div style={{
      padding: '14px 20px', background: 'linear-gradient(90deg, #0d1420 0%, #0a1115 100%)',
      border: '1px solid #1a2332', borderLeft: '4px solid ' + accent, borderRadius: '8px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
    }}>
      <div>
        <div style={{ fontSize: '12px', letterSpacing: '3px', color: accent, fontWeight: 800, fontFamily: MONO, textShadow: glow ? '0 0 8px ' + accent + '55' : undefined }}>{label}</div>
        <div style={{ fontSize: '11px', color: MUTED, fontFamily: MONO, marginTop: '4px' }}>{sub}</div>
      </div>
      <div style={{ fontSize: '34px', fontWeight: 800, color: TEXT, fontFamily: MONO, letterSpacing: '-0.5px' }}>${fmt0(total)}</div>
    </div>
  );
}

function RealSection({ book, moves, target, setTarget, liveWallets, collapsed, setCollapsed, expanded, setExpanded }: any) {
  const allocSegs = [
    { label: 'Stocks', value: book.byClass.stock, color: BLUE },
    { label: 'Crypto', value: book.byClass.crypto, color: PURPLE },
    { label: 'Cash', value: book.byClass.cash, color: GREY },
  ];
  const topHoldings = book.positions.slice(0, 7).map((p: any) => ({
    label: p.symbol, value: p.equity, color: p.cls === 'crypto' ? PURPLE : BLUE,
    sub: p.uplpct != null ? `${sgn(p.uplpct)}${p.uplpct.toFixed(0)}%` : undefined,
  }));
  const maxHold = Math.max(...book.positions.map((p: any) => p.equity), 1);
  const totalUpl = book.positions.reduce((s: number, p: any) => s + (p.upl || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <SectionBanner label="● REAL MONEY" accent={GREEN} glow
        total={book.total} sub={`Robinhood + Coinbase · ${book.positions.length} positions · invested $${fmt0(book.invested)} · cash $${fmt0(book.cash)}`} />

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title="ALLOCATION" accent={GREEN}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <Donut segs={allocSegs} center={`$${fmt0(book.total)}`} sub="TOTAL" />
            <Legend segs={allocSegs} total={book.total} />
          </div>
        </Card>

        <Card title="TOP HOLDINGS" accent={GREEN} right={<span style={{ fontSize: '10px', color: plColor(totalUpl), fontFamily: MONO }}>uP/L {sgn(totalUpl)}${fmt0(Math.abs(totalUpl))}</span>}>
          <BarRow items={topHoldings} max={maxHold} />
        </Card>

        <NextMovesCard book={book} moves={moves} target={target} setTarget={setTarget} />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {liveWallets.map((w: any, i: number) => (
          <WalletCard key={i} w={w} live={true} collapsed={collapsed} toggleCollapse={(n: string) => setCollapsed((p: any) => ({ ...p, [n]: !p[n] }))}
            expanded={expanded} toggleExpanded={(k: string) => setExpanded((p: any) => ({ ...p, [k]: !p[k] }))} />
        ))}
      </div>
    </div>
  );
}

function NextMovesCard({ book, moves, target, setTarget }: any) {
  const [editing, setEditing] = useState(false);
  const off = moves.drift.filter((d: any) => Math.abs(d.deltaPct) > 5);
  const saveTarget = (cls: string, v: number) => {
    const t = { ...target, [cls]: v };
    setTarget(t);
    try { localStorage.setItem('ccw:target-alloc', JSON.stringify(t)); } catch { /* */ }
  };
  return (
    <Card title="NEXT MOVES — GROW THE BOOK" accent={AMBER}
      right={<button onClick={() => setEditing(e => !e)} style={{ ...ACTION_BTN, fontSize: '9px', padding: '3px 8px', color: MUTED }}>{editing ? 'done' : '✎ target'}</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontFamily: MONO }}>

        {/* Rebalance drift */}
        <div>
          <div style={{ fontSize: '9px', color: MUTED, letterSpacing: '1.5px', marginBottom: '5px' }}>REBALANCE vs TARGET</div>
          {moves.drift.map((d: any) => (
            <div key={d.cls} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginBottom: '3px' }}>
              <span style={{ width: '46px', color: TEXT, textTransform: 'capitalize' }}>{d.cls}</span>
              {editing ? (
                <input type="number" value={target[d.cls]} onInput={(e: any) => saveTarget(d.cls, Number(e.target.value))}
                  style={{ width: '46px', background: '#0d1117', border: '1px solid #1a3a4a', color: TEXT, fontFamily: MONO, fontSize: '11px', padding: '1px 4px', borderRadius: '3px' }} />
              ) : <span style={{ width: '46px', color: MUTED }}>{d.cur.toFixed(0)}→{d.tgt}%</span>}
              <span style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: Math.abs(d.deltaPct) > 5 ? (d.deltaPct > 0 ? AMBER : BLUE) : MUTED }}>
                {Math.abs(d.deltaPct) <= 5 ? 'on target' : d.deltaPct > 0 ? `trim $${fmt0(Math.abs(d.deltaUsd))}` : `add $${fmt0(Math.abs(d.deltaUsd))}`}
              </span>
            </div>
          ))}
          {off.length === 0 && <div style={{ fontSize: '10px', color: GREEN }}>balanced — no class off &gt;5%</div>}
        </div>

        {/* TLH */}
        <div style={{ borderTop: '1px solid #1a2332', paddingTop: '9px' }}>
          <div style={{ fontSize: '9px', color: MUTED, letterSpacing: '1.5px', marginBottom: '5px' }}>HARVEST LOSSES (TLH)</div>
          <div style={{ fontSize: '12px', color: TEXT, marginBottom: '5px' }}>
            <span style={{ color: RED, fontWeight: 800 }}>${fmt0(Math.abs(moves.tlhTotal))}</span> harvestable
            <span style={{ color: MUTED }}> · ≈ ${fmt0(Math.abs(moves.tlhTotal) * 0.24)} shield @24%</span>
          </div>
          {moves.losers.slice(0, 4).map((p: any) => (
            <div key={p.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
              <span style={{ color: TEXT, width: '54px' }}>{p.symbol}</span>
              <span style={{ color: RED, width: '60px', textAlign: 'right' }}>${fmt0(p.upl)}</span>
              <span style={{ color: MUTED, flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                {DEAD.has(p.symbol) ? 'close — dead' : '→ ' + (REPLACEMENT[p.symbol] || 'sector ETF 31d')}
              </span>
            </div>
          ))}
          {moves.cryptoNoBasis.length > 0 && (
            <div style={{ fontSize: '9px', color: MUTED, marginTop: '4px' }}>
              {moves.cryptoNoBasis.length} crypto need basis (Coinbase CSV) · no wash-sale on crypto
            </div>
          )}
        </div>

        {/* Concentration + dust */}
        {(moves.conc.length > 0 || moves.dust.length > 0) && (
          <div style={{ borderTop: '1px solid #1a2332', paddingTop: '9px', fontSize: '10px', color: MUTED }}>
            {moves.conc.map((p: any) => (
              <div key={p.symbol} style={{ color: AMBER }}>⚠ {p.symbol} {((p.equity / book.total) * 100).toFixed(0)}% — over {CONC_CAP}% cap</div>
            ))}
            {moves.dust.length > 0 && <div style={{ marginTop: '3px' }}>🧹 {moves.dust.length} dust lines (&lt;${DUST_USD}) — close to declutter</div>}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────── PAPER ──────────────────────────────────────
function PaperSection({ data, loading, total }: { data: any; loading: boolean; total: number }) {
  if (loading && !data) {
    return <div class="animate-pulse" style={{ height: '160px', background: '#0d1420', border: '1px solid #1a2332', borderRadius: '8px' }} />;
  }
  if (!data || !(data.accounts || []).length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <SectionBanner label="◆ PAPER" accent={GREY} glow={false} total={total} sub="Alpaca paper — boba + jazzy" />
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED, fontSize: '12px', fontFamily: MONO, border: '1px dashed #1a2332', borderRadius: '8px' }}>No paper data</div>
      </div>
    );
  }
  const c = data.combined || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <SectionBanner label="◆ PAPER" accent={GREY} glow={false} total={total}
        sub={`Alpaca paper · ${data.accounts.length} agents · day ${sgn(c.day_pl || 0)}$${fmt0(Math.abs(c.day_pl || 0))} (${sgn(c.day_pl_pct || 0)}${(c.day_pl_pct || 0).toFixed(1)}%) · ${c.red_flags || 0} red / ${c.amber_flags || 0} amber flags`} />
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.accounts.map((a: any) => <PaperAccount key={a.name} a={a} />)}
      </div>
    </div>
  );
}

function PaperAccount({ a }: { a: any }) {
  if (a.error) {
    return (
      <Card title={a.name.toUpperCase()} accent={RED}>
        <div style={{ fontSize: '11px', color: RED, fontFamily: MONO }}>{a.error}</div>
      </Card>
    );
  }
  const byClass: Record<string, number> = {};
  for (const p of (a.positions || [])) byClass[p.asset_class] = (byClass[p.asset_class] || 0) + p.market_value;
  const cashV = Math.max(0, a.cash || 0);
  const segs = [
    { label: 'Stock', value: byClass['us_equity'] || 0, color: BLUE },
    { label: 'Options', value: byClass['us_option'] || 0, color: AMBER },
    { label: 'Crypto', value: byClass['crypto'] || 0, color: PURPLE },
    { label: 'Cash', value: cashV, color: GREY },
  ].filter(s => s.value > 0);
  const curve = (a.curve || []).map((x: any) => x.eq);
  const top = [...(a.positions || [])].sort((x, y) => y.market_value - x.market_value).slice(0, 5)
    .map((p: any) => ({ label: p.symbol, value: p.market_value, color: p.unrealized_pl >= 0 ? GREEN : RED, sub: `${sgn(p.unrealized_plpc * 100)}${(p.unrealized_plpc * 100).toFixed(0)}%` }));
  const maxV = Math.max(...(a.positions || []).map((p: any) => p.market_value), 1);
  const m = a.metrics || {};

  return (
    <Card title={a.name.toUpperCase()} accent={GREY}
      right={<span style={{ fontSize: '12px', fontWeight: 800, color: TEXT, fontFamily: MONO }}>${fmt0(a.equity)} <span style={{ color: plColor(a.day_pl), fontSize: '10px' }}>{sgn(a.day_pl)}{(a.day_pl_pct || 0).toFixed(1)}%</span></span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <Donut segs={segs} size={120} thickness={16} center={`$${fmt0(a.equity)}`} sub="EQUITY" />
          <div style={{ flex: 1, minWidth: '140px' }}>
            <Legend segs={segs} total={segs.reduce((s, x) => s + x.value, 0)} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: '9px', color: MUTED, letterSpacing: '1.5px', marginBottom: '5px', fontFamily: MONO }}>1M EQUITY CURVE</div>
          <Sparkline pts={curve} color={(m.month_pl_pct || 0) >= 0 ? GREEN : RED} />
        </div>

        {top.length > 0 && <BarRow items={top} max={maxV} />}

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '10px', fontFamily: MONO, color: MUTED, borderTop: '1px solid #1a2332', paddingTop: '8px' }}>
          <span>Sharpe <b style={{ color: TEXT }}>{m.sharpe != null ? m.sharpe.toFixed(2) : '—'}</b></span>
          <span>MaxDD <b style={{ color: RED }}>{(m.max_dd_pct || 0).toFixed(0)}%</b></span>
          <span>Exposure <b style={{ color: TEXT }}>{(m.exposure_pct || 0).toFixed(0)}%</b></span>
          <span>TopPos <b style={{ color: (m.top_pos_pct || 0) > 20 ? AMBER : TEXT }}>{(m.top_pos_pct || 0).toFixed(0)}%</b></span>
        </div>

        {/* Next moves = doctrine guardrails */}
        {(a.flags || []).length > 0 && (
          <div style={{ borderTop: '1px solid #1a2332', paddingTop: '8px' }}>
            <div style={{ fontSize: '9px', color: MUTED, letterSpacing: '1.5px', marginBottom: '5px', fontFamily: MONO }}>NEXT MOVES — RISK GUARDRAILS</div>
            {a.flags.map((f: any, i: number) => (
              <div key={i} style={{ fontSize: '10px', fontFamily: MONO, color: f.level === 'red' ? RED : AMBER, marginBottom: '2px' }}>
                {f.level === 'red' ? '●' : '▲'} {f.msg}
              </div>
            ))}
          </div>
        )}
        {(a.flags || []).length === 0 && (
          <div style={{ borderTop: '1px solid #1a2332', paddingTop: '8px', fontSize: '10px', color: GREEN, fontFamily: MONO }}>✓ all doctrine checks pass</div>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────── wallet detail cards (from original) ─────────────────
function WalletCard({ w, live, collapsed, toggleCollapse, expanded, toggleExpanded }: any) {
  const balance = w.balance || 0, cash = w.cash || 0, bp = w.buying_power || 0;
  const isError = w.status === 'error';
  const positions = w.positions || [];
  const isStrategy = (w.notes || '').includes('strategies');
  const hasPositions = positions.length > 0;
  const isCollapsed = !!collapsed[w.name];
  const stocks = positions.filter((p: any) => p.type !== 'crypto').sort((a: any, b: any) => (b.equity || 0) - (a.equity || 0));
  const crypto = positions.filter((p: any) => p.type === 'crypto').sort((a: any, b: any) => (b.equity || 0) - (a.equity || 0));
  const hasBoth = stocks.length > 0 && crypto.length > 0;
  const borderColor = isError ? RED : (live ? GREEN : GREY);

  return (
    <div style={{ background: 'linear-gradient(180deg, #0a1929 0%, #0d1420 100%)', border: '1px solid #1a3a4a', borderLeft: '3px solid ' + borderColor, borderRadius: '8px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: 1, minWidth: 0 }}>
          {(hasPositions || isStrategy) && (
            <span onClick={() => toggleCollapse(w.name)} style={{ cursor: 'pointer', fontSize: '14px', color: MUTED, userSelect: 'none', marginTop: '2px', fontFamily: MONO }}>{isCollapsed ? '▸' : '▾'}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: TEXT, fontFamily: MONO }}>{w.name}</span>
              {w.badge && <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '3px', fontFamily: MONO, letterSpacing: '1px', background: w.badge === 'LIVE' ? '#66bb6a22' : '#ff980022', color: w.badge === 'LIVE' ? GREEN : '#ff9800', border: '1px solid ' + (w.badge === 'LIVE' ? '#66bb6a44' : '#ff980044') }}>{w.badge}</span>}
              {isError && <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '3px', fontFamily: MONO, background: '#ef535022', color: RED, border: '1px solid #ef535044' }}>ERROR</span>}
              {(() => {
                const ageH = w.as_of ? (Date.now() - new Date(w.as_of as string).getTime()) / 3_600_000 : null;
                if (ageH == null || !(ageH > 24)) return null;
                return <span style={{ fontSize: '9px', fontWeight: 800, padding: '2px 7px', borderRadius: '3px', fontFamily: MONO, letterSpacing: '1px', background: '#ffb74d1a', color: AMBER, border: '1px solid #ffb74d55' }}>{ageH >= 48 ? `STALE ${Math.floor(ageH / 24)}d` : 'STALE'}</span>;
              })()}
            </div>
            <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>{w.type}{hasPositions ? ' · ' + positions.length + ' positions' : ''}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', marginLeft: '8px' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: balance > 0 ? GREEN : RED, fontFamily: MONO }}>${fmt(balance)}</div>
        </div>
      </div>
      {!isCollapsed && (
        <>
          {(cash !== 0 || bp !== 0) && (
            <div style={{ display: 'flex', gap: '16px', marginTop: '10px', padding: '8px 12px', background: '#0d1117', borderRadius: '5px' }}>
              {cash !== 0 && <div><div style={{ fontSize: '9px', color: MUTED, fontFamily: MONO, marginBottom: '2px', letterSpacing: '1px' }}>CASH</div><div style={{ fontSize: '13px', fontWeight: 600, color: cash >= 0 ? TEXT : RED, fontFamily: MONO }}>${fmt(cash)}</div></div>}
              {bp !== 0 && bp !== cash && <div><div style={{ fontSize: '9px', color: MUTED, fontFamily: MONO, marginBottom: '2px', letterSpacing: '1px' }}>BUYING POWER</div><div style={{ fontSize: '13px', fontWeight: 600, color: BLUE, fontFamily: MONO }}>${fmt(bp)}</div></div>}
            </div>
          )}
          {!isError && hasPositions && (
            <div style={{ marginTop: '10px' }}>
              {stocks.length > 0 && <PositionSection title={hasBoth ? 'STOCKS' : 'HOLDINGS'} positions={stocks} expanded={!!expanded[w.name + ':stocks']} setExpanded={() => toggleExpanded(w.name + ':stocks')} symColor={BLUE} />}
              {crypto.length > 0 && <div style={{ marginTop: hasBoth ? '12px' : 0 }}><PositionSection title={hasBoth ? 'CRYPTO' : 'HOLDINGS'} positions={crypto} expanded={!!expanded[w.name + ':crypto']} setExpanded={() => toggleExpanded(w.name + ':crypto')} symColor={PURPLE} /></div>}
            </div>
          )}
          {isStrategy && <div style={{ marginTop: '10px', padding: '10px 12px', background: '#0d1117', borderRadius: '5px' }}><div style={{ fontSize: '9px', color: MUTED, fontFamily: MONO, marginBottom: '5px', letterSpacing: '1px' }}>STRATEGY OVERVIEW</div><div style={{ fontSize: '12px', color: TEXT, fontFamily: MONO, lineHeight: 1.5 }}>{w.notes}</div></div>}
          {!hasPositions && !isStrategy && w.notes && <div style={{ marginTop: '10px', padding: '10px 12px', background: '#0d1117', borderRadius: '5px', color: MUTED, fontSize: '11px', fontFamily: MONO }}>{w.notes}</div>}
        </>
      )}
    </div>
  );
}

function PositionSection({ title, positions, expanded, setExpanded, symColor }: any) {
  const shown = expanded ? positions : positions.slice(0, 8);
  return (
    <>
      <div style={{ fontSize: '9px', color: MUTED, letterSpacing: '1.5px', marginBottom: '6px', fontFamily: MONO }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: '6px' }}>
        {shown.map((p: any, i: number) => {
          const isStock = p.type !== 'crypto';
          const price = Number(p.price || 0), avgCost = Number(p.avg_cost || 0), equity = Number(p.equity || 0), qty = Number(p.quantity || 0);
          const pctRet = p.pct_change != null ? p.pct_change : (avgCost > 0 ? ((price - avgCost) / avgCost) * 100 : null);
          const dollarPL = avgCost > 0 && qty ? (price - avgCost) * qty : null;
          const pctColor = pctRet != null ? (pctRet >= 0 ? GREEN : RED) : MUTED;
          const bgTint = pctRet != null ? (pctRet >= 0 ? 'rgba(102,187,106,0.05)' : 'rgba(239,83,80,0.05)') : '#0d1117';
          const borderTint = pctRet != null ? (pctRet >= 0 ? 'rgba(102,187,106,0.28)' : 'rgba(239,83,80,0.25)') : '#1a3a4a';
          return (
            <div key={i} style={{ padding: '9px 11px', background: 'linear-gradient(180deg, #0d1117 0%, ' + bgTint + ' 100%)', borderRadius: '5px', border: '1px solid ' + borderTint, display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: symColor, letterSpacing: '0.5px', fontFamily: MONO }}>{p.symbol}</span>
                <span style={{ fontSize: '8px', fontWeight: 700, color: MUTED, letterSpacing: '1.2px', fontFamily: MONO }}>{isStock ? 'STOCK' : 'CRYPTO'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '16px', fontWeight: 800, color: TEXT, fontFamily: MONO }}>${fmt(equity)}</span>
                {pctRet != null && <span style={{ fontSize: '10px', fontWeight: 700, color: pctColor, background: pctColor + '22', padding: '2px 6px', borderRadius: '3px', fontFamily: MONO }}>{pctRet >= 0 ? '+' : ''}{pctRet.toFixed(1)}%</span>}
              </div>
              {dollarPL != null && Math.abs(dollarPL) > 0.01 && (
                <div style={{ fontSize: '9px', color: pctColor, textAlign: 'right', fontWeight: 600, fontFamily: MONO }}>{dollarPL >= 0 ? '+' : '-'}${fmt(Math.abs(dollarPL))} {dollarPL >= 0 ? 'gain' : 'loss'}</div>
              )}
            </div>
          );
        })}
      </div>
      {positions.length > 8 && (
        <button onClick={setExpanded} style={{ marginTop: '8px', width: '100%', fontSize: '10px', color: BLUE, padding: '6px', background: 'transparent', border: '1px dashed #1a3a4a', borderRadius: '3px', cursor: 'pointer', fontFamily: MONO, letterSpacing: '0.5px' }}>
          {expanded ? 'Show Top 8' : 'Show All (' + positions.length + ')'}
        </button>
      )}
    </>
  );
}
