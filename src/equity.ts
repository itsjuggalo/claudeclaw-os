// Equity management — per-agent Alpaca paper analytics for the /equity page.
// Reads BOTH agent accounts (boba + jazzy) from ~/.openclaw/secrets, pulls
// account + positions + 1M portfolio history in parallel, and computes risk
// metrics + trading-discipline guardrail flags server-side (no new deps).
// Doctrine checks mirror the open improvement plan: ≤20% buying power per
// pick, hard -25% stop, ≤1-DTE time-decay gate, diversification floor.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.HOME || '/home/itsju';
const SECRETS = join(HOME, '.openclaw/secrets');
const BASE = 'https://paper-api.alpaca.markets';

interface Creds { name: string; key: string; secret: string }

export interface EquityFlag {
  level: 'red' | 'amber';
  code: string;
  msg: string;
}

export interface EquityPosition {
  symbol: string;
  display: string;            // human label, e.g. "TSLA 430C 06/12"
  asset_class: string;
  qty: number;
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  unrealized_plpc: number;    // fraction, -0.25 = -25%
  current_price: number;
  avg_entry_price: number;
  pct_of_equity: number;      // market_value / equity
  dte: number | null;         // options only
  underlying: string;         // OCC root for options, symbol otherwise
}

export interface DoctrineCheck {
  rule: string;
  pass: boolean;
  detail: string;
}

export interface AccountEquity {
  name: string;
  ok: boolean;
  error?: string;
  equity: number;
  last_equity: number;
  cash: number;
  buying_power: number;
  day_pl: number;
  day_pl_pct: number;
  curve: { t: number; eq: number }[];   // 1M daily closes, epoch seconds
  metrics: {
    sharpe: number | null;    // 1M daily returns, annualized √252
    max_dd_pct: number;       // worst peak→trough over 1M, negative
    off_peak_pct: number;     // current vs 1M peak, negative when under water
    win_rate_days: number;    // % of up days over 1M
    down_streak: number;      // consecutive down days ending today
    exposure_pct: number;     // gross position value / equity
    top_pos_pct: number;      // biggest position / equity
    month_pl_pct: number;     // first→last of curve
  };
  positions: EquityPosition[];
  doctrine: DoctrineCheck[];
  flags: EquityFlag[];
}

function loadCreds(): Creds[] {
  const out: Creds[] = [];
  for (const name of ['boba', 'jazzy']) {
    const kp = join(SECRETS, `alpaca-${name}-key-id`);
    const sp = join(SECRETS, `alpaca-${name}-secret`);
    if (existsSync(kp) && existsSync(sp)) {
      out.push({
        name,
        key: readFileSync(kp, 'utf-8').trim(),
        secret: readFileSync(sp, 'utf-8').trim(),
      });
    }
  }
  return out;
}

async function alp(c: Creds, path: string): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'APCA-API-KEY-ID': c.key, 'APCA-API-SECRET-KEY': c.secret },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

// OCC option symbol: ROOT + YYMMDD + C/P + strike*1000 zero-padded to 8.
const OCC = /^([A-Z.]{1,6})(\d{6})([CP])(\d{8})$/;

function parseOcc(sym: string) {
  const m = OCC.exec(sym);
  if (!m) return null;
  const [, root, ymd, right, strike8] = m;
  // Expiry at ~16:00 ET ≈ 20:00 UTC; DTE 0 = expires today.
  const exp = Date.UTC(2000 + +ymd.slice(0, 2), +ymd.slice(2, 4) - 1, +ymd.slice(4, 6), 20, 0, 0);
  const dte = Math.max(0, Math.floor((exp - Date.now()) / 86_400_000));
  const strike = +strike8 / 1000;
  return {
    underlying: root,
    dte,
    display: `${root} ${strike}${right} ${ymd.slice(2, 4)}/${ymd.slice(4, 6)}`,
  };
}

function buildMetrics(curve: { t: number; eq: number }[], equity: number, positions: EquityPosition[]) {
  const eqs = curve.map(p => p.eq);
  const rets: number[] = [];
  for (let i = 1; i < eqs.length; i++) {
    if (eqs[i - 1] > 0) rets.push(eqs[i] / eqs[i - 1] - 1);
  }
  let sharpe: number | null = null;
  if (rets.length >= 5) {
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
    const sd = Math.sqrt(variance);
    sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : null;
  }
  let peak = -Infinity, maxDd = 0;
  for (const e of eqs) {
    if (e > peak) peak = e;
    if (peak > 0) maxDd = Math.min(maxDd, e / peak - 1);
  }
  const allPeak = Math.max(...eqs, equity, 1);
  const offPeak = equity / allPeak - 1;
  const upDays = rets.filter(r => r > 0).length;
  let downStreak = 0;
  for (let i = rets.length - 1; i >= 0 && rets[i] < 0; i--) downStreak++;
  const gross = positions.reduce((s, p) => s + Math.abs(p.market_value), 0);
  const top = positions.reduce((s, p) => Math.max(s, Math.abs(p.market_value)), 0);
  return {
    sharpe,
    max_dd_pct: maxDd * 100,
    off_peak_pct: offPeak * 100,
    win_rate_days: rets.length ? (upDays / rets.length) * 100 : 0,
    down_streak: downStreak,
    exposure_pct: equity > 0 ? (gross / equity) * 100 : 0,
    top_pos_pct: equity > 0 ? (top / equity) * 100 : 0,
    month_pl_pct: eqs.length >= 2 && eqs[0] > 0 ? (eqs[eqs.length - 1] / eqs[0] - 1) * 100 : 0,
  };
}

function buildDoctrine(equity: number, cash: number, positions: EquityPosition[]): DoctrineCheck[] {
  const checks: DoctrineCheck[] = [];

  // ≤20% buying power per pick (open improvement plan; currently 100% in TEST MODE).
  const worstSize = positions.reduce((s, p) => Math.max(s, equity > 0 ? p.cost_basis / equity : 0), 0);
  const offenders = positions.filter(p => equity > 0 && p.cost_basis / equity > 0.20);
  checks.push({
    rule: '≤20% per pick',
    pass: offenders.length === 0,
    detail: offenders.length
      ? `${offenders.length} position(s) over — worst ${(worstSize * 100).toFixed(0)}% (${offenders[0].display})`
      : positions.length ? `largest entry ${(worstSize * 100).toFixed(0)}% of equity` : 'no open positions',
  });

  // Hard -25% stop: nothing should still be open past -25%.
  const pastStop = positions.filter(p => p.unrealized_plpc <= -0.25);
  checks.push({
    rule: 'hard -25% stop',
    pass: pastStop.length === 0,
    detail: pastStop.length
      ? pastStop.map(p => `${p.display} ${(p.unrealized_plpc * 100).toFixed(0)}%`).join(', ')
      : 'no position past -25%',
  });

  // Time-decay gate: no options held into ≤1 DTE.
  const expiring = positions.filter(p => p.dte !== null && p.dte <= 1);
  checks.push({
    rule: '≤1 DTE gate',
    pass: expiring.length === 0,
    detail: expiring.length
      ? expiring.map(p => `${p.display} (${p.dte} DTE)`).join(', ')
      : 'no options expiring within 1 day',
  });

  // Diversification floor: when deployed, hold ≥3 distinct underlyings.
  const underlyings = new Set(positions.map(p => p.underlying));
  const deployed = equity > 0 && positions.reduce((s, p) => s + Math.abs(p.market_value), 0) / equity > 0.3;
  checks.push({
    rule: 'diversification ≥3',
    pass: !deployed || underlyings.size >= 3,
    detail: positions.length ? `${underlyings.size} underlying(s): ${[...underlyings].slice(0, 5).join(', ')}` : 'flat',
  });

  // Cash buffer: keep ≥10% dry powder.
  const cashPct = equity > 0 ? (cash / equity) * 100 : 100;
  checks.push({
    rule: 'cash buffer ≥10%',
    pass: cashPct >= 10,
    detail: `${cashPct.toFixed(0)}% cash`,
  });

  return checks;
}

function buildFlags(a: AccountEquity): EquityFlag[] {
  const flags: EquityFlag[] = [];
  const m = a.metrics;
  if (m.off_peak_pct <= -25) flags.push({ level: 'red', code: 'DRAWDOWN', msg: `${m.off_peak_pct.toFixed(0)}% off 1M peak` });
  else if (m.off_peak_pct <= -10) flags.push({ level: 'amber', code: 'DRAWDOWN', msg: `${m.off_peak_pct.toFixed(0)}% off 1M peak` });
  if (m.down_streak >= 5) flags.push({ level: 'red', code: 'BLEEDING', msg: `${m.down_streak} straight down days` });
  else if (m.down_streak >= 3) flags.push({ level: 'amber', code: 'BLEEDING', msg: `${m.down_streak} straight down days` });
  if (m.exposure_pct > 95) flags.push({ level: 'red', code: 'ALL-IN', msg: `${m.exposure_pct.toFixed(0)}% exposure, no reserve` });
  else if (m.exposure_pct > 80) flags.push({ level: 'amber', code: 'EXPOSED', msg: `${m.exposure_pct.toFixed(0)}% gross exposure` });
  if (m.top_pos_pct > 40) flags.push({ level: 'red', code: 'CONCENTRATED', msg: `top position = ${m.top_pos_pct.toFixed(0)}% of equity` });
  for (const d of a.doctrine) {
    if (!d.pass) flags.push({ level: d.rule.includes('stop') || d.rule.includes('DTE') ? 'red' : 'amber', code: 'DOCTRINE', msg: `${d.rule}: ${d.detail}` });
  }
  return flags;
}

async function buildAccount(c: Creds): Promise<AccountEquity> {
  const empty: AccountEquity = {
    name: c.name, ok: false, equity: 0, last_equity: 0, cash: 0, buying_power: 0,
    day_pl: 0, day_pl_pct: 0, curve: [],
    metrics: { sharpe: null, max_dd_pct: 0, off_peak_pct: 0, win_rate_days: 0, down_streak: 0, exposure_pct: 0, top_pos_pct: 0, month_pl_pct: 0 },
    positions: [], doctrine: [], flags: [],
  };
  const [acct, rawPos, hist] = await Promise.all([
    alp(c, '/v2/account'),
    alp(c, '/v2/positions'),
    alp(c, '/v2/account/portfolio/history?period=1M&timeframe=1D'),
  ]);
  if (!acct) return { ...empty, error: 'account fetch failed (check keys)' };

  const equity = parseFloat(acct.equity || '0');
  const lastEq = parseFloat(acct.last_equity || '0');

  const positions: EquityPosition[] = (Array.isArray(rawPos) ? rawPos : []).map((p: any) => {
    const occ = p.asset_class === 'us_option' ? parseOcc(String(p.symbol)) : null;
    return {
      symbol: String(p.symbol),
      display: occ?.display || String(p.symbol),
      asset_class: String(p.asset_class || 'us_equity'),
      qty: parseFloat(p.qty || '0'),
      market_value: parseFloat(p.market_value || '0'),
      cost_basis: parseFloat(p.cost_basis || '0'),
      unrealized_pl: parseFloat(p.unrealized_pl || '0'),
      unrealized_plpc: parseFloat(p.unrealized_plpc || '0'),
      current_price: parseFloat(p.current_price || '0'),
      avg_entry_price: parseFloat(p.avg_entry_price || '0'),
      pct_of_equity: equity > 0 ? (parseFloat(p.market_value || '0') / equity) * 100 : 0,
      dte: occ ? occ.dte : null,
      underlying: occ?.underlying || String(p.symbol),
    };
  }).sort((a, b) => Math.abs(b.market_value) - Math.abs(a.market_value));

  const curve: { t: number; eq: number }[] = [];
  if (hist && Array.isArray(hist.timestamp) && Array.isArray(hist.equity)) {
    for (let i = 0; i < hist.timestamp.length; i++) {
      const eq = Number(hist.equity[i]);
      if (eq > 0) curve.push({ t: Number(hist.timestamp[i]), eq });
    }
  }

  const out: AccountEquity = {
    ...empty,
    ok: true,
    equity,
    last_equity: lastEq,
    cash: parseFloat(acct.cash || '0'),
    buying_power: parseFloat(acct.buying_power || '0'),
    day_pl: equity - lastEq,
    day_pl_pct: lastEq > 0 ? ((equity - lastEq) / lastEq) * 100 : 0,
    curve,
    positions,
  };
  out.metrics = buildMetrics(curve, equity, positions);
  out.doctrine = buildDoctrine(equity, out.cash, positions);
  out.flags = buildFlags(out);
  return out;
}

export interface EquityOverview {
  accounts: AccountEquity[];
  combined: { equity: number; day_pl: number; day_pl_pct: number; red_flags: number; amber_flags: number };
  as_of: string;
}

async function buildOverview(): Promise<EquityOverview> {
  const creds = loadCreds();
  const accounts = await Promise.all(creds.map(buildAccount));
  const equity = accounts.reduce((s, a) => s + a.equity, 0);
  const lastEq = accounts.reduce((s, a) => s + a.last_equity, 0);
  const flags = accounts.flatMap(a => a.flags);
  return {
    accounts,
    combined: {
      equity,
      day_pl: equity - lastEq,
      day_pl_pct: lastEq > 0 ? ((equity - lastEq) / lastEq) * 100 : 0,
      red_flags: flags.filter(f => f.level === 'red').length,
      amber_flags: flags.filter(f => f.level === 'amber').length,
    },
    as_of: new Date().toISOString(),
  };
}

// Stale-while-revalidate cache (2 min) — same pattern as wallets.ts so
// dashboard polling never hammers Alpaca.
let _cache: { data: EquityOverview; ts: number } | null = null;
const TTL = 2 * 60 * 1000;
let _building = false;

export async function getEquity(): Promise<EquityOverview> {
  const now = Date.now();
  if (_cache && now - _cache.ts < TTL) return _cache.data;
  if (_building && _cache) return _cache.data;
  if (_cache) {
    _building = true;
    buildOverview()
      .then(d => { _cache = { data: d, ts: Date.now() }; })
      .catch(() => {})
      .finally(() => { _building = false; });
    return _cache.data;
  }
  _building = true;
  try {
    const data = await buildOverview();
    _cache = { data, ts: Date.now() };
    return data;
  } finally {
    _building = false;
  }
}
