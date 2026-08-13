// Trade history + what-if — runs ~/05_AUTOMATION/trade_history.py (RH-crypto fills →
// buy/sell ledger, "never sold" counterfactual, forward compounding projection) and
// returns its JSON. Read-only; same local-only stance as /api/wallets + /api/equity.
// All numbers are computed from actual fills — no predictions baked in server-side.
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const SCRIPT = '/home/itsju/05_AUTOMATION/trade_history.py';

export interface TradeHistory {
  rows: any[];
  tot: Record<string, number>;
  recent: any[];
  n_orders: number;
  sell_delta_total: number;
  book_total: number;
  projection: { rate: number; y1: number; y3: number; y5: number; y10: number }[];
  error?: string;
}

let _cache: { data: TradeHistory; ts: number } | null = null;
const TTL = 10 * 60 * 1000; // 10 min — fills change slowly; the API call is heavy
let _building = false;

async function build(): Promise<TradeHistory> {
  const { stdout } = await execAsync(`/usr/bin/python3 ${SCRIPT} --json`, {
    timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function getTradeHistory(): Promise<TradeHistory> {
  const now = Date.now();
  if (_cache && now - _cache.ts < TTL) return _cache.data;
  if (_building && _cache) return _cache.data;
  if (_cache) {
    _building = true;
    build().then(d => { _cache = { data: d, ts: Date.now() }; })
      .catch(() => {}).finally(() => { _building = false; });
    return _cache.data;
  }
  _building = true;
  try {
    const data = await build();
    _cache = { data, ts: Date.now() };
    return data;
  } catch (e) {
    return { error: String(e) } as TradeHistory;
  } finally {
    _building = false;
  }
}
