// Wallet aggregation — ported from MissionCtrlV2's /api/wallets route so the
// (sensitive) brokerage/exchange balances live on the LOCAL-ONLY claudeclaw
// dashboard (:3141) instead of the publicly-mirrored MissionCtrl (:3000).
//
// Pulls Alpaca paper, Coinbase (CSV script), Robinhood (script), Hyperliquid
// (go-trader state + personal account), and CoinGecko spot prices. Reads
// secrets from ~/.openclaw/secrets and runs the same ~/scripts/*.py helpers.
// Same machine as MissionCtrl, so every path resolves identically.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const HOME = process.env.HOME || '/home/itsju';
const SECRETS = join(HOME, '.openclaw/secrets');
const HL_STATE = join(HOME, 'go-trader/platforms/hyperliquid/state.json');

export interface Wallet {
  name: string;
  type: string;
  badge?: string;
  accent?: string;
  balance: number;
  cash: number;
  buying_power: number;
  status: string;
  notes?: string;
  positions?: unknown[];
  as_of?: unknown;
}

async function buildWallets(): Promise<Wallet[]> {
  const wallets: Wallet[] = [];

  // Run the two slow Python scripts in parallel alongside the fast API calls
  const UVR = 'PATH=/home/itsju/.local/bin:/usr/local/bin:/usr/bin:/bin /home/itsju/.local/bin/uv run';
  const [cbResult, rhResult, alpacaResult, hlPersonalResult, cgResult] = await Promise.allSettled([
    execAsync(`${UVR} /home/itsju/scripts/coinbase-from-csv.py`, { timeout: 30000 }),
    execAsync(`${UVR} /home/itsju/scripts/robinhood-full-portfolio.py`, { timeout: 30000 }),
    (async () => {
      const key = readFileSync(join(SECRETS, 'alpaca-key-id'), 'utf-8').trim();
      const secret = readFileSync(join(SECRETS, 'alpaca-secret'), 'utf-8').trim();
      const res = await fetch('https://paper-api.alpaca.markets/v2/account', {
        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok ? res.json() : null;
    })(),
    (async () => {
      const hlAddrPath = join(SECRETS, 'hyperliquid-address.txt');
      if (!existsSync(hlAddrPath)) return null;
      const hlAddress = readFileSync(hlAddrPath, 'utf-8').trim();
      const hlRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: hlAddress }),
        signal: AbortSignal.timeout(8000),
      });
      return hlRes.ok ? hlRes.json() : null;
    })(),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd', {
      headers: { 'User-Agent': 'MissionControl/1.0' },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  // === 1. ALPACA PAPER ===
  if (alpacaResult.status === 'fulfilled' && alpacaResult.value) {
    const acct = alpacaResult.value as any;
    wallets.push({
      name: 'Alpaca Paper Trading',
      type: 'Brokerage (Paper)',
      badge: 'PAPER',
      balance: parseFloat(acct.equity || '0'),
      cash: parseFloat(acct.cash || '0'),
      buying_power: parseFloat(acct.buying_power || '0'),
      status: 'live',
      notes: 'Phase 1: $100K → $110K goal',
    });
  } else {
    wallets.push({ name: 'Alpaca Paper', type: 'Brokerage (Paper)', badge: 'PAPER', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: String((alpacaResult as PromiseRejectedResult).reason || 'fetch failed').slice(0, 80) });
  }

  // === 2. COINBASE (from saved CSV holdings) ===
  if (cbResult.status === 'fulfilled') {
    try {
      const cb = JSON.parse(cbResult.value.stdout.trim());
      if (cb.error) {
        wallets.push({ name: 'Coinbase', type: 'Exchange (CSV)', badge: 'CSV', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: cb.error.slice(0, 100) });
      } else {
        const holdings = cb.holdings || [];
        const topNotes = holdings.filter((h: any) => h.value_usd > 1).slice(0, 6).map((h: any) => `${h.currency}: $${h.value_usd.toFixed(0)}`);
        const fundedCount = holdings.filter((h: any) => h.value_usd > 0.01).length;
        wallets.push({
          name: 'Coinbase',
          type: 'Exchange (CSV)',
          badge: 'CSV',
          balance: cb.total_usd || 0,
          cash: 0,
          buying_power: 0,
          status: 'live',
          positions: holdings.map((h: any) => ({ symbol: h.currency, quantity: h.balance, price: h.price_usd, equity: h.value_usd, type: 'crypto' })),
          notes: `${fundedCount} assets · ${topNotes.join(' | ') || 'no holdings'}`,
          as_of: cb.as_of,
        });
      }
    } catch (e) {
      wallets.push({ name: 'Coinbase', type: 'Exchange (CSV)', badge: 'CSV', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: String(e).slice(0, 100) });
    }
  } else {
    wallets.push({ name: 'Coinbase', type: 'Exchange (CSV)', badge: 'CSV', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: String((cbResult as PromiseRejectedResult).reason || 'script failed').slice(0, 100) });
  }

  // === 3. ROBINHOOD ===
  if (rhResult.status === 'fulfilled') {
    try {
      const rhData = JSON.parse(rhResult.value.stdout.trim());
      if (rhData.error) {
        wallets.push({ name: 'Robinhood', type: 'Brokerage (Live)', badge: 'LIVE', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: rhData.error.slice(0, 80) });
      } else {
        wallets.push({
          name: 'Robinhood — Stocks',
          type: 'Brokerage (Live)',
          badge: 'LIVE',
          accent: 'cyan',
          balance: rhData.stock_total || 0,
          cash: rhData.cash || 0,
          buying_power: rhData.cash || 0,
          status: 'live',
          positions: (rhData.stocks || []).map((s: any) => ({ symbol: s.symbol, quantity: s.quantity, avg_cost: s.avg_cost, price: s.price, equity: s.equity, pct_change: s.pct_change, type: 'stock' })),
          notes: `${(rhData.stocks || []).length} positions`,
        });
        wallets.push({
          name: 'Robinhood — Crypto',
          type: 'Brokerage (Live)',
          badge: 'LIVE',
          accent: 'purple',
          balance: rhData.crypto_total || 0,
          cash: 0,
          buying_power: 0,
          status: 'live',
          positions: (rhData.crypto || []).map((c: any) => ({ symbol: c.symbol, quantity: c.quantity, price: c.price, equity: c.equity, type: 'crypto' })),
          notes: `${(rhData.crypto || []).filter((c: any) => c.equity > 0.5).length} assets`,
        });
      }
    } catch (e) {
      wallets.push({ name: 'Robinhood', type: 'Brokerage (Live)', badge: 'LIVE', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: String(e).slice(0, 80) });
    }
  } else {
    wallets.push({ name: 'Robinhood', type: 'Brokerage (Live)', badge: 'LIVE', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: String((rhResult as PromiseRejectedResult).reason || 'script failed').slice(0, 80) });
  }

  // === 4. HYPERLIQUID go-trader ===
  try {
    if (existsSync(HL_STATE)) {
      const state = JSON.parse(readFileSync(HL_STATE, 'utf-8'));
      const strategies: Record<string, Record<string, unknown>> = state.strategies || {};
      const prices = (cgResult.status === 'fulfilled' ? cgResult.value : null) as any;
      const priceMap: Record<string, number> = {
        BTC: prices?.bitcoin?.usd || 0,
        ETH: prices?.ethereum?.usd || 0,
        SOL: prices?.solana?.usd || 0,
      };
      let totalValue = 0, totalCash = 0, totalInitial = 0, activeStrategies = 0, openPositions = 0;
      for (const [, strat] of Object.entries(strategies)) {
        const cash = (strat['cash'] as number) || 0;
        totalCash += cash;
        totalInitial += (strat['initial_capital'] as number) || 500;
        const positions = (strat['positions'] as Record<string, Record<string, unknown>>) || {};
        let posValue = 0;
        for (const [sym, pos] of Object.entries(positions)) {
          const qty = (pos['quantity'] as number) || 0;
          posValue += qty * (priceMap[sym] || 0);
          if (qty > 0) openPositions++;
        }
        totalValue += cash + posValue;
        if (Object.keys(positions).length > 0) activeStrategies++;
      }
      const stratCount = Object.keys(strategies).length;
      const pnlPct = totalInitial > 0 ? ((totalValue - totalInitial) / totalInitial * 100) : 0;
      wallets.push({
        name: 'Hyperliquid (go-trader)',
        type: 'DEX Perps (Live)',
        badge: 'LIVE',
        balance: totalValue,
        cash: totalCash,
        buying_power: totalCash,
        status: 'live',
        notes: `${stratCount} strategies | ${activeStrategies} active | ${openPositions} positions | ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% P/L`,
      });
    }
  } catch (e) {
    wallets.push({ name: 'Hyperliquid', type: 'DEX Perps (Live)', badge: 'LIVE', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: String(e).slice(0, 80) });
  }

  // === 5. HYPERLIQUID PERSONAL WALLET ===
  if (hlPersonalResult.status === 'fulfilled' && hlPersonalResult.value) {
    const hlData = hlPersonalResult.value as any;
    const marginSummary = hlData.marginSummary || {};
    const accountValue = parseFloat(marginSummary.accountValue || '0');
    const totalMargin = parseFloat(marginSummary.totalMarginUsed || '0');
    const positions = hlData.assetPositions || [];
    const posNotes = positions.map((p: any) => {
      const pos = p.position || {};
      return `${pos.coin || '?'}: ${pos.szi || '0'} (uPnL: $${parseFloat(pos.unrealizedPnl || '0').toFixed(2)})`;
    }).slice(0, 5).join(' | ');
    wallets.push({
      name: 'Hyperliquid (Personal)',
      type: 'DEX Perps (Live)',
      badge: 'LIVE',
      balance: accountValue,
      cash: accountValue - totalMargin,
      buying_power: accountValue - totalMargin,
      status: 'live',
      notes: positions.length > 0 ? posNotes : 'No open positions',
    });
  } else {
    wallets.push({ name: 'Hyperliquid (Personal)', type: 'DEX Perps (Live)', badge: 'LIVE', balance: 0, cash: 0, buying_power: 0, status: 'error', notes: 'fetch failed' });
  }

  return wallets;
}

// Stale-while-revalidate cache (5 min), mirroring the original route so the
// expensive Python scripts don't run on every dashboard poll.
let _cache: { wallets: Wallet[]; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;
let _building = false;

export async function getWallets(): Promise<Wallet[]> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_TTL) return _cache.wallets;

  if (_building && _cache) return _cache.wallets; // refresh in flight → serve stale

  if (_cache) {
    // Stale cache exists → refresh in background, return stale immediately.
    _building = true;
    buildWallets()
      .then(w => { _cache = { wallets: w, ts: Date.now() }; })
      .catch(() => {})
      .finally(() => { _building = false; });
    return _cache.wallets;
  }

  // Cold start — wait for the first build.
  _building = true;
  try {
    const wallets = await buildWallets();
    _cache = { wallets, ts: Date.now() };
    return wallets;
  } finally {
    _building = false;
  }
}
