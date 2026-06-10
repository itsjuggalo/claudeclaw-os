// PortfolioAIPage — Robinhood equity + Coinbase crypto + Alpaca paper positions
// with rule-based AI signals (verdict) per holding, cross-referenced against
// /api/trade-desk/flow-rank and /api/trade-desk/momentum.
import { useState, useCallback } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Position {
  symbol: string;
  quantity: number;
  price: number;
  equity: number;
  avg_cost: number;
  pct_change: number | null;
  type?: string;
}

interface Wallet {
  name: string;
  type?: string;
  badge?: string;
  balance: number;
  cash?: number;
  buying_power?: number;
  status?: string;
  notes?: string;
  positions?: Position[];
  as_of?: string;
}

interface FlowPick {
  ticker: string;
  final_band: string;
  final_confidence: number;
  curator_thesis?: string;
}

interface MomentumEntry {
  ticker: string;
  trend: string;
  streak: number;
  bull_streak: number;
  bear_streak: number;
  avg_confidence_7d: number;
}

type VerdictKey = 'STRONG BUY' | 'BUY' | 'HOLD' | 'REDUCE' | 'SELL' | 'WATCH';

const VERDICT_COLORS: Record<VerdictKey, string> = {
  'STRONG BUY': '#66bb6a',
  'BUY': '#4fc3f7',
  'HOLD': '#90a4ae',
  'REDUCE': '#ff9800',
  'SELL': '#ef5350',
  'WATCH': '#ce93d8',
};

const VERDICT_BOLD: Record<VerdictKey, boolean> = {
  'STRONG BUY': true,
  'BUY': false,
  'HOLD': false,
  'REDUCE': false,
  'SELL': false,
  'WATCH': false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtQtyCrypto = (n: number) => (n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(4) : n.toFixed(2));
const fmtQtyStock = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtPrice = (n: number) => n > 0 && n < 0.01 ? n.toFixed(6) : n > 0 && n < 1 ? n.toFixed(4) : fmt2(n);
const nowMin = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

function timeSince(iso: string | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function computePct(p: Position): number | null {
  if (p.pct_change != null) return p.pct_change;
  if (p.avg_cost > 0 && p.price > 0) return ((p.price - p.avg_cost) / p.avg_cost) * 100;
  return null;
}

function computeVerdict(
  p: Position,
  pct: number | null,
  flowMap: Map<string, FlowPick>,
  momMap: Map<string, MomentumEntry>,
): { verdict: VerdictKey; reasons: string[] } {
  const sym = p.symbol.toUpperCase();
  const flow = flowMap.get(sym);
  const mom = momMap.get(sym);
  const trend = mom?.trend?.toUpperCase() ?? null;
  const streak = mom?.streak ?? 0;

  // STRONG BUY
  if (flow && ['GOLD', 'PLATINUM'].includes((flow.final_band || '').toUpperCase()) && trend === 'UP') {
    return {
      verdict: 'STRONG BUY',
      reasons: [
        `Flow Rank: ${flow.final_band} band (${flow.final_confidence}% confidence)`,
        `Momentum: UP streak ${streak}d`,
      ],
    };
  }
  // SELL
  if (pct != null && pct < -50 && !flow && trend === 'DOWN') {
    return {
      verdict: 'SELL',
      reasons: [
        `Down ${pct.toFixed(1)}% from avg cost`,
        'No flow signal — trend DOWN',
      ],
    };
  }
  // REDUCE
  if (pct != null && pct < -30 && !flow) {
    return {
      verdict: 'REDUCE',
      reasons: [
        `Down ${pct.toFixed(1)}% from avg cost`,
        'No supporting flow signal',
      ],
    };
  }
  // WATCH (conflicting: in flow picks but down)
  if (flow && pct != null && pct < 0) {
    return {
      verdict: 'WATCH',
      reasons: [
        `Flow Rank pick (${flow.final_band}) but position is down ${pct.toFixed(1)}%`,
        'Conflicting signals — monitor closely',
      ],
    };
  }
  // BUY
  if (flow || (trend === 'UP' && streak >= 3)) {
    const reasons: string[] = [];
    if (flow) reasons.push(`Flow Rank: ${flow.final_band} (${flow.final_confidence}%)`);
    if (trend === 'UP') reasons.push(`Momentum: UP streak ${streak}d`);
    return { verdict: 'BUY', reasons };
  }
  // HOLD default
  return {
    verdict: 'HOLD',
    reasons: [
      pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% from avg cost` : 'No price history',
      'No strong directional signal',
    ],
  };
}

function findWallet(wallets: Wallet[], keyword: string): Wallet | null {
  return wallets.find(w => w.name?.toLowerCase().includes(keyword.toLowerCase())) ?? null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, total, asOf, color }: { label: string; total: number; asOf?: string; color: string }) {
  // Snapshot age. >24h = stale: a trader glancing at money figures must not
  // mistake a 3-week-old snapshot for live data.
  const ageH = asOf ? (Date.now() - new Date(asOf).getTime()) / 3_600_000 : null;
  const stale = ageH != null && ageH > 24;
  const staleLabel = stale ? (ageH! >= 48 ? `STALE ${Math.floor(ageH! / 24)}d` : 'STALE') : null;
  return (
    <div style={{
      background: '#0a1929',
      border: '1px solid #1a3a4a',
      borderTop: `3px solid ${color}`,
      borderRadius: '8px',
      padding: '16px 20px',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '10px', color: '#607d8b', letterSpacing: '2px', fontFamily: MONO }}>{label}</span>
        {staleLabel && (
          <span style={{
            fontSize: '9px', fontWeight: 800, fontFamily: MONO, letterSpacing: '1px',
            color: '#ffb74d', background: '#ffb74d1a', border: '1px solid #ffb74d55',
            borderRadius: '3px', padding: '2px 7px', whiteSpace: 'nowrap',
          }}>{staleLabel}</span>
        )}
      </div>
      <div style={{ fontSize: '32px', fontWeight: 800, color: stale ? '#90a4ae' : '#e0e0e0', fontFamily: MONO, lineHeight: 1 }}>${fmtInt(total)}</div>
      <div style={{ fontSize: '11px', color: stale ? '#ffb74d' : '#607d8b', marginTop: '8px', fontFamily: MONO }}>as of: {asOf ? timeSince(asOf) : '—'}</div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: VerdictKey }) {
  const color = VERDICT_COLORS[verdict];
  const bold = VERDICT_BOLD[verdict];
  return (
    <span style={{
      fontSize: '9px',
      fontWeight: bold ? 800 : 600,
      color,
      background: color + '22',
      border: `1px solid ${color}44`,
      borderRadius: '3px',
      padding: '2px 7px',
      letterSpacing: '1px',
      fontFamily: MONO,
      whiteSpace: 'nowrap',
    }}>{verdict}</span>
  );
}

function ActionPopup({ show, onClose, title, children }: {
  show: boolean;
  onClose: () => void;
  title: string;
  children: any;
}) {
  if (!show) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
    }} onClick={onClose}>
      <div style={{
        background: '#0a1929',
        border: '1px solid #1a3a4a',
        borderRadius: '10px',
        padding: '20px 24px',
        minWidth: '280px', maxWidth: '420px',
        boxShadow: '0 8px 32px #0008',
      }} onClick={(e: any) => e.stopPropagation()}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#4fc3f7', fontFamily: MONO, marginBottom: '12px', letterSpacing: '1px' }}>{title}</div>
        {children}
        <button onClick={onClose} style={{
          marginTop: '14px', width: '100%', padding: '7px',
          background: 'transparent', border: '1px solid #1a3a4a', borderRadius: '4px',
          color: '#607d8b', fontSize: '11px', cursor: 'pointer', fontFamily: MONO,
        }}>Close</button>
      </div>
    </div>
  );
}

function PositionCard({ p, isCrypto, flow, mom }: {
  p: Position;
  isCrypto: boolean;
  flow: FlowPick | undefined;
  mom: MomentumEntry | undefined;
}) {
  const [flowPopup, setFlowPopup] = useState(false);
  const [momPopup, setMomPopup] = useState(false);
  const pct = computePct(p);
  const { verdict, reasons } = computeVerdict(
    p,
    pct,
    flow ? new Map([[p.symbol.toUpperCase(), flow]]) : new Map(),
    mom ? new Map([[p.symbol.toUpperCase(), mom]]) : new Map(),
  );
  const pctColor = pct != null ? (pct >= 0 ? '#66bb6a' : '#ef5350') : '#607d8b';

  const bigLoss = pct != null && pct < -30;
  const bigGain = pct != null && pct > 50;
  const leftBorder = bigLoss ? '#ef5350' : bigGain ? '#66bb6a' : '#1a3a4a';
  const glowStyle = bigGain ? { boxShadow: '0 0 12px #66bb6a33' } : {};

  const qty = Number(p.quantity || 0);
  const equity = Number(p.equity || 0);
  const avgCost = Number(p.avg_cost || 0);
  const price = Number(p.price || 0);
  const dollarPL = avgCost > 0 && qty > 0 ? (price - avgCost) * qty : null;

  return (
    <>
      <div style={{
        background: '#0a1929',
        border: '1px solid #1a3a4a',
        borderLeft: `3px solid ${leftBorder}`,
        borderRadius: '7px',
        padding: '13px 15px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        ...glowStyle,
      }}>
        {/* Row 1: symbol + verdict */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '15px', fontWeight: 800, color: isCrypto ? '#ce93d8' : '#4fc3f7', fontFamily: MONO }}>{p.symbol}</span>
          <VerdictBadge verdict={verdict} />
        </div>

        {/* Row 2: equity + pct */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '20px', fontWeight: 800, color: '#e0e0e0', fontFamily: MONO }}>${fmt2(equity)}</span>
          {pct != null && (
            <span style={{ fontSize: '12px', fontWeight: 700, color: pctColor, background: pctColor + '22', padding: '2px 8px', borderRadius: '3px', fontFamily: MONO }}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
            </span>
          )}
        </div>

        {/* Row 3: qty / avg / now */}
        <div style={{ fontSize: '10px', color: '#90a4ae', fontFamily: MONO, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>Qty: {isCrypto ? fmtQtyCrypto(qty) : fmtQtyStock(qty)} {isCrypto ? '' : 'shares'}</span>
          {avgCost > 0 && <span>Avg: ${fmtPrice(avgCost)} → Now: ${fmtPrice(price)}</span>}
          {dollarPL != null && (
            <span style={{ color: dollarPL >= 0 ? '#66bb6a' : '#ef5350', fontWeight: 600 }}>
              {dollarPL >= 0 ? '+' : '-'}${fmt2(Math.abs(dollarPL))}
            </span>
          )}
        </div>

        {/* Reasons */}
        <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc', color: '#607d8b', fontSize: '10px', fontFamily: MONO }}>
          {reasons.map((r, i) => <li key={i} style={{ marginBottom: '2px' }}>{r}</li>)}
        </ul>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
          <button onClick={() => setFlowPopup(true)} style={{
            flex: 1, fontSize: '10px', color: '#4fc3f7', padding: '5px',
            background: '#4fc3f711', border: '1px solid #4fc3f733', borderRadius: '4px',
            cursor: 'pointer', fontFamily: MONO,
          }}>Ask Flow Rank</button>
          <button onClick={() => setMomPopup(true)} style={{
            flex: 1, fontSize: '10px', color: '#ce93d8', padding: '5px',
            background: '#ce93d811', border: '1px solid #ce93d833', borderRadius: '4px',
            cursor: 'pointer', fontFamily: MONO,
          }}>Momentum</button>
        </div>
      </div>

      {/* Flow Rank popup */}
      <ActionPopup show={flowPopup} onClose={() => setFlowPopup(false)} title={`FLOW RANK — ${p.symbol}`}>
        {flow ? (
          <div style={{ fontSize: '12px', color: '#e0e0e0', fontFamily: MONO, lineHeight: 1.6 }}>
            <div><span style={{ color: '#607d8b' }}>Band: </span><span style={{ color: '#ff9800', fontWeight: 700 }}>{flow.final_band}</span></div>
            <div><span style={{ color: '#607d8b' }}>Confidence: </span>{flow.final_confidence}%</div>
            {flow.curator_thesis && <div style={{ marginTop: '8px', color: '#90a4ae', fontSize: '11px', lineHeight: 1.5 }}>{flow.curator_thesis}</div>}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO }}>{p.symbol} is not currently in the Flow Rank picks.</div>
        )}
      </ActionPopup>

      {/* Momentum popup */}
      <ActionPopup show={momPopup} onClose={() => setMomPopup(false)} title={`MOMENTUM — ${p.symbol}`}>
        {mom ? (
          <div style={{ fontSize: '12px', color: '#e0e0e0', fontFamily: MONO, lineHeight: 1.8 }}>
            <div><span style={{ color: '#607d8b' }}>Trend: </span><span style={{ color: mom.trend?.toUpperCase() === 'UP' ? '#66bb6a' : '#ef5350', fontWeight: 700 }}>{mom.trend?.toUpperCase()}</span></div>
            <div><span style={{ color: '#607d8b' }}>Current streak: </span>{mom.streak}d</div>
            <div><span style={{ color: '#607d8b' }}>Bull streak: </span>{mom.bull_streak}d</div>
            <div><span style={{ color: '#607d8b' }}>Bear streak: </span>{mom.bear_streak}d</div>
            <div><span style={{ color: '#607d8b' }}>Avg confidence (7d): </span>{mom.avg_confidence_7d?.toFixed(1)}%</div>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO }}>No momentum data found for {p.symbol}.</div>
        )}
      </ActionPopup>
    </>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PortfolioAIPage() {
  const [activeTab, setActiveTab] = useState<'robinhood' | 'coinbase' | 'alpaca'>('robinhood');
  const [sort, setSort] = useState<'loss' | 'gain' | 'value'>('loss');
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell' | 'watch'>('all');
  const [lastRefreshLabel, setLastRefreshLabel] = useState(nowMin());

  const { data: walletsRaw, loading: wLoading, error: wError, refresh: refreshWallets } = useFetch<Wallet[]>('/api/wallets', 120_000);
  const { data: flowRaw, loading: fLoading, refresh: refreshFlow } = useFetch<{ picks: FlowPick[]; cycle_time: string }>('/api/trade-desk/flow-rank', 300_000);
  const { data: momRaw, loading: mLoading, refresh: refreshMom } = useFetch<{ momentum: MomentumEntry[] }>('/api/trade-desk/momentum', 300_000);

  const wallets: Wallet[] = Array.isArray(walletsRaw) ? walletsRaw : [];
  const flowPicks: FlowPick[] = flowRaw?.picks ?? [];
  const momentum: MomentumEntry[] = momRaw?.momentum ?? [];

  const flowMap = new Map<string, FlowPick>(flowPicks.filter(p => p.ticker).map(p => [p.ticker.toUpperCase(), p]));
  const momMap = new Map<string, MomentumEntry>(momentum.filter(m => m.ticker).map(m => [m.ticker.toUpperCase(), m]));

  const handleRefresh = useCallback(() => {
    refreshWallets();
    refreshFlow();
    refreshMom();
    setLastRefreshLabel(nowMin());
  }, [refreshWallets, refreshFlow, refreshMom]);

  // Wallet helpers
  const rhWallet = findWallet(wallets, 'robinhood');
  const cbWallet = findWallet(wallets, 'coinbase');
  const apWallet = wallets.find(w => {
    const n = w.name?.toLowerCase() ?? '';
    return n.includes('alpaca') || n.includes('paper') || (w.badge ?? '').toUpperCase() === 'PAPER';
  }) ?? null;

  const rhPositions = (rhWallet?.positions ?? []).filter(p => (p.type ?? 'stock') !== 'crypto');
  const cbPositions = cbWallet?.positions ?? [];
  const apPositions = apWallet?.positions ?? [];

  // Summary totals
  const rhTotal = rhWallet?.balance ?? rhPositions.reduce((s, p) => s + (p.equity || 0), 0);
  const cbTotal = cbWallet?.balance ?? cbPositions.reduce((s, p) => s + (p.equity || 0), 0);
  const apTotal = apWallet?.balance ?? apPositions.reduce((s, p) => s + (p.equity || 0), 0);
  const latestAsOf = wallets.map(w => w.as_of).filter(Boolean)[0];

  // Sort + filter logic
  function sortPositions(positions: Position[]): Position[] {
    const sorted = [...positions];
    if (sort === 'loss') sorted.sort((a, b) => (computePct(a) ?? 0) - (computePct(b) ?? 0));
    else if (sort === 'gain') sorted.sort((a, b) => (computePct(b) ?? 0) - (computePct(a) ?? 0));
    else sorted.sort((a, b) => (b.equity || 0) - (a.equity || 0));
    return sorted;
  }

  function filterPositions(positions: Position[]): Position[] {
    if (filter === 'all') return positions;
    return positions.filter(p => {
      const pct = computePct(p);
      const { verdict } = computeVerdict(p, pct, flowMap, momMap);
      if (filter === 'buy') return verdict === 'BUY' || verdict === 'STRONG BUY';
      if (filter === 'sell') return verdict === 'SELL' || verdict === 'REDUCE';
      if (filter === 'watch') return verdict === 'WATCH';
      return true;
    });
  }

  const processedRH = filterPositions(sortPositions(rhPositions));
  const processedCB = filterPositions(sortPositions(cbPositions));
  const processedAP = filterPositions(sortPositions(apPositions));

  // Health stats
  const allPositions = [...rhPositions, ...cbPositions, ...apPositions];
  const atLoss = allPositions.filter(p => (computePct(p) ?? 0) < 0);
  const atGain = allPositions.filter(p => (computePct(p) ?? 0) > 0);
  const totalLoss = atLoss.reduce((s, p) => s + (p.equity || 0) - (p.avg_cost * p.quantity || 0), 0);
  const biggestLoser = allPositions.reduce<Position | null>((min, p) => {
    const pct = computePct(p) ?? 0;
    return !min || pct < (computePct(min) ?? 0) ? p : min;
  }, null);
  const biggestWinner = allPositions.reduce<Position | null>((max, p) => {
    const pct = computePct(p) ?? 0;
    return !max || pct > (computePct(max) ?? 0) ? p : max;
  }, null);
  const overlappingTickers = allPositions.map(p => p.symbol.toUpperCase()).filter(sym => flowMap.has(sym));
  const uniqueOverlap = [...new Set(overlappingTickers)];
  const buySignalCount = allPositions.filter(p => {
    const { verdict } = computeVerdict(p, computePct(p), flowMap, momMap);
    return verdict === 'BUY' || verdict === 'STRONG BUY';
  }).length;

  const tabPositions: Record<string, Position[]> = {
    robinhood: processedRH,
    coinbase: processedCB,
    alpaca: processedAP,
  };
  const currentPositions = tabPositions[activeTab];
  const isCryptoTab = activeTab === 'coinbase';

  const isLoading = wLoading && wallets.length === 0;

  if (wError) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader title="Portfolio AI" breadcrumb="← Trade Desk" />
      <PageState error={wError} />
    </div>
  );

  if (isLoading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader title="Portfolio AI" breadcrumb="← Trade Desk" />
      <PageState loading />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1420' }}>
      {/* HEADER */}
      <PageHeader
        title="Portfolio AI"
        breadcrumb="← Trade Desk"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontSize: '10px', color: '#607d8b', background: '#0a1929',
              border: '1px solid #1a2332', borderRadius: '4px', padding: '3px 9px',
              fontFamily: MONO,
            }}>
              Last updated: {lastRefreshLabel} ET
            </span>
            <a href="/trade-desk" style={{
              fontSize: '11px', color: '#4fc3f7', textDecoration: 'none', fontFamily: MONO,
            }}>← Trade Desk</a>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '1400px', margin: '0 auto' }}>

          {/* SUMMARY BAR — stacks on phones so the dollar figures never clip */}
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5" style={{ marginBottom: '20px' }}>
            <SummaryCard label="ROBINHOOD EQUITY" total={rhTotal} asOf={rhWallet?.as_of ?? latestAsOf} color="#4fc3f7" />
            <SummaryCard label="COINBASE CRYPTO" total={cbTotal} asOf={cbWallet?.as_of ?? latestAsOf} color="#ce93d8" />
            <SummaryCard label="PAPER TRADING" total={apTotal} asOf={apWallet?.as_of ?? latestAsOf} color="#ff9800" />
          </div>

          {/* TAB BAR */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #1a2332', paddingBottom: '8px', flexWrap: 'wrap' }}>
            {(['robinhood', 'coinbase', 'alpaca'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: '6px 16px', borderRadius: '5px', border: 'none', cursor: 'pointer',
                fontFamily: MONO, fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                background: activeTab === tab ? '#1a3a4a' : 'transparent',
                color: activeTab === tab ? '#e0e0e0' : '#607d8b',
              }}>
                {tab === 'robinhood' ? 'ROBINHOOD' : tab === 'coinbase' ? 'COINBASE' : 'ALPACA PAPER'}
                <span style={{ marginLeft: '6px', fontSize: '10px', color: '#607d8b' }}>
                  ({tabPositions[tab].length})
                </span>
              </button>
            ))}
          </div>

          {/* SORT / FILTER / REFRESH BAR */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO }}>SORT:</span>
            {(['loss', 'gain', 'value'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)} style={{
                fontSize: '10px', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer',
                fontFamily: MONO, border: '1px solid #1a3a4a',
                background: sort === s ? '#1a3a4a' : 'transparent',
                color: sort === s ? '#e0e0e0' : '#607d8b',
              }}>
                {s === 'loss' ? 'By Loss%' : s === 'gain' ? 'By Gain%' : 'By Value'}
              </button>
            ))}
            <span style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO, marginLeft: '8px' }}>FILTER:</span>
            {(['all', 'buy', 'sell', 'watch'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontSize: '10px', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer',
                fontFamily: MONO, border: '1px solid #1a3a4a',
                background: filter === f ? '#1a3a4a' : 'transparent',
                color: filter === f ? '#e0e0e0' : '#607d8b',
              }}>
                {f === 'all' ? 'All' : f === 'buy' ? 'Buy Signals' : f === 'sell' ? 'Sell/Reduce' : 'Watch List'}
              </button>
            ))}
            <button onClick={handleRefresh} style={{
              marginLeft: 'auto', fontSize: '10px', padding: '5px 14px', borderRadius: '4px',
              cursor: 'pointer', fontFamily: MONO, fontWeight: 700,
              background: '#4fc3f711', border: '1px solid #4fc3f733', color: '#4fc3f7',
            }}>
              {(wLoading || fLoading || mLoading) ? 'Refreshing…' : 'Refresh Data'}
            </button>
          </div>

          {/* ALPACA PAPER BADGE */}
          {activeTab === 'alpaca' && (
            <div style={{
              marginBottom: '14px', padding: '8px 14px',
              background: '#ff980011', border: '1px solid #ff980033', borderRadius: '5px',
              fontSize: '11px', color: '#ff9800', fontFamily: MONO,
            }}>
              PAPER TRADING — not real money. These are simulated positions from the Alpaca paper account.
            </div>
          )}

          {/* POSITIONS GRID */}
          {currentPositions.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#607d8b', fontFamily: MONO, fontSize: '12px', border: '1px dashed #1a2332', borderRadius: '8px' }}>
              No positions match the current filter.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: '12px', marginBottom: '24px' }}>
              {currentPositions.map((p, i) => (
                <PositionCard
                  key={p.symbol + i}
                  p={p}
                  isCrypto={isCryptoTab || p.type === 'crypto'}
                  flow={flowMap.get(p.symbol.toUpperCase())}
                  mom={momMap.get(p.symbol.toUpperCase())}
                />
              ))}
            </div>
          )}

          {/* PORTFOLIO HEALTH SUMMARY */}
          <div style={{
            background: '#0a1929',
            border: '1px solid #1a2332',
            borderRadius: '8px',
            padding: '16px 20px',
            marginTop: '8px',
          }}>
            <div style={{ fontSize: '10px', color: '#607d8b', letterSpacing: '2px', fontFamily: MONO, marginBottom: '14px' }}>PORTFOLIO HEALTH</div>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>

              <div>
                <div style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO, marginBottom: '4px' }}>AT LOSS</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#ef5350', fontFamily: MONO }}>{atLoss.length}</div>
                <div style={{ fontSize: '10px', color: '#ef5350', fontFamily: MONO }}>${fmt2(Math.abs(totalLoss))} total</div>
              </div>

              <div>
                <div style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO, marginBottom: '4px' }}>AT GAIN</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#66bb6a', fontFamily: MONO }}>{atGain.length}</div>
              </div>

              {biggestLoser && (
                <div>
                  <div style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO, marginBottom: '4px' }}>BIGGEST LOSER</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#ef5350', fontFamily: MONO }}>{biggestLoser.symbol}</div>
                  <div style={{ fontSize: '10px', color: '#ef5350', fontFamily: MONO }}>
                    {((computePct(biggestLoser) ?? 0)).toFixed(1)}%
                  </div>
                </div>
              )}

              {biggestWinner && (
                <div>
                  <div style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO, marginBottom: '4px' }}>BIGGEST WINNER</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#66bb6a', fontFamily: MONO }}>{biggestWinner.symbol}</div>
                  <div style={{ fontSize: '10px', color: '#66bb6a', fontFamily: MONO }}>
                    +{((computePct(biggestWinner) ?? 0)).toFixed(1)}%
                  </div>
                </div>
              )}

              <div style={{ flex: 1, minWidth: '160px' }}>
                <div style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO, marginBottom: '6px' }}>
                  IN FLOW RANK ({uniqueOverlap.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {uniqueOverlap.length === 0 ? (
                    <span style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO }}>None of your holdings appear in current picks</span>
                  ) : uniqueOverlap.map(sym => {
                    const pick = flowMap.get(sym);
                    return (
                      <span key={sym} style={{
                        fontSize: '10px', fontWeight: 700, fontFamily: MONO,
                        padding: '2px 8px', borderRadius: '3px',
                        background: '#ff980022', border: '1px solid #ff980044', color: '#ff9800',
                      }}>{sym} {pick ? `(${pick.final_band})` : ''}</span>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO, marginBottom: '4px' }}>BUY SIGNALS</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#4fc3f7', fontFamily: MONO }}>{buySignalCount}</div>
                <div style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO }}>holdings</div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
