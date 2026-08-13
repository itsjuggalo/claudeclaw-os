// Trade Desk — data layer for the /trade-desk section of the ClaudeClaw dashboard.
// Reads from the live trading pipeline: Firebase signals, Flow Rank, Flow Winners,
// Ticker Momentum, Macro Context, Trade Ledger, and AIME. All DB access is
// synchronous (better-sqlite3) and read-only. AIME uses cookie-based HTTP.
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.HOME || '/home/itsju';

const FLOW_DB     = join(HOME, '02_DATA/flow-data/flow.db');
const PIPELINE_DB = join(HOME, 'LapClaw/pipeline/desk_pipeline.sqlite');
const LEDGER_DB   = join(HOME, 'LapClaw/pipeline/trade_ledger.sqlite');
// LIVE capture dir — the fcm-rtdb daemon writes here. (Was 'LapClaw/firebase-signals',
// a stale May-28 copy that left the Signal Feed page showing month-old data.)
const SIGNALS_FILE = join(HOME, 'firebase-signals/latest.json');
const BRIEF_CACHE  = join(HOME, '02_DATA/trade-brief-cache.json');

// Priority feeds for the signal panel (flow data first, then alerts)
const SIGNAL_FEEDS = [
  'flow_live_today', 'flow2_live_today',
  'flow_alerts', 'flow2_alerts',
  'v2_option', 'v2_stock',
  'ts_option', 'ss_option',
  'ts_stock', 'ss_stock',
];

function openDb(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  try {
    return new Database(path, { readonly: true });
  } catch {
    return null;
  }
}

// ── Signals (latest.json — last 50 per feed) ───────────────────────────────
export function getSignals(limit = 100): { signals: any[]; flow_events: any[]; feeds_available: string[] } {
  let signals: any[] = [];
  let feeds_available: string[] = [];

  try {
    const raw = readFileSync(SIGNALS_FILE, 'utf-8');
    const feeds: Record<string, any[]> = JSON.parse(raw);
    feeds_available = Object.keys(feeds);

    for (const feed of SIGNAL_FEEDS) {
      const entries = feeds[feed];
      if (!entries || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        signals.push({ ...entry, feed });
      }
    }
    signals.sort((a, b) => (b.received_at || '').localeCompare(a.received_at || ''));
    signals = signals.slice(0, limit);
  } catch { /* file missing or malformed */ }

  // Also pull recent flow_events from SQLite for structured sweep/block data
  const flow_events = getFlowEvents(6, 50);

  return { signals, flow_events, feeds_available };
}

// ── Flow Events (SQLite, structured sweep/block) ───────────────────────────
export function getFlowEvents(hours = 6, limit = 100): any[] {
  const db = openDb(FLOW_DB);
  if (!db) return [];
  try {
    const since = (Date.now() - hours * 3600 * 1000); // event_time is unix ms
    return (db.prepare(`
      SELECT symbol, option_type, strike, expiry, premium, volume, block_type, event_time
      FROM flow_events
      WHERE event_time >= ?
      ORDER BY event_time DESC, premium DESC
      LIMIT ?
    `).all(since, limit) as any[]).map(r => ({
      ...r,
      event_time_iso: new Date(r.event_time).toISOString(),
    }));
  } finally {
    db.close();
  }
}

// ── Flow Rank (premium_shortlist joined with dossiers) ─────────────────────
export function getFlowRank(): { picks: any[]; cycle_time: string | null } {
  const db = openDb(PIPELINE_DB);
  if (!db) return { picks: [], cycle_time: null };
  try {
    const latest = db.prepare(
      `SELECT cycle_id, generated_at FROM premium_shortlist ORDER BY generated_at DESC LIMIT 1`
    ).get() as any;
    if (!latest) return { picks: [], cycle_time: null };

    const picks = db.prepare(`
      SELECT p.rank, p.confidence_band, p.confidence_score, p.target_account, p.asset_class,
             d.ticker, d.final_band, d.final_confidence, d.curator_thesis, d.asset_class as d_asset_class
      FROM premium_shortlist p
      JOIN dossiers d ON p.dossier_id = d.id
      WHERE p.cycle_id = ?
      ORDER BY p.rank ASC
      LIMIT 10
    `).all(latest.cycle_id) as any[];

    return { picks, cycle_time: latest.generated_at };
  } finally {
    db.close();
  }
}

// ── Flow Winners (≥200% realized peak returns) ────────────────────────────
export function getFlowWinners(days = 7, symbol?: string): any[] {
  const db = openDb(FLOW_DB);
  if (!db) return [];
  try {
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const params: any[] = [since];
    let sql = `
      SELECT contract, symbol, option_type, strike, expiry,
             first_price, max_price, peak_pct, why_summary, key_factors,
             pattern_tags, detected_at, flow_value, flow_count, alert_type
      FROM flow_winners
      WHERE detected_at >= ?
    `;
    if (symbol) { sql += ' AND symbol = ?'; params.push(symbol.toUpperCase()); }
    sql += ' ORDER BY detected_at DESC LIMIT 50';
    return db.prepare(sql).all(...params) as any[];
  } finally {
    db.close();
  }
}

// ── Ticker Momentum ───────────────────────────────────────────────────────
export function getMomentum(): any[] {
  const db = openDb(PIPELINE_DB);
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT ticker, cycle_count_7d, cycle_count_3d, streak,
             avg_confidence_7d, avg_confidence_3d, trend,
             bull_streak, bear_streak, last_seen
      FROM ticker_momentum
      ORDER BY cycle_count_7d DESC, streak DESC
      LIMIT 25
    `).all() as any[];
  } finally {
    db.close();
  }
}

// ── Macro Context ─────────────────────────────────────────────────────────
export function getMacro(): any | null {
  const db = openDb(PIPELINE_DB);
  if (!db) return null;
  try {
    return db.prepare(`SELECT * FROM macro_context ORDER BY rowid DESC LIMIT 1`).get() ?? null;
  } finally {
    db.close();
  }
}

// ── Trade Ledger (recent executed orders) ─────────────────────────────────
export function getTradeLedger(hours = 48): any[] {
  const db = openDb(LEDGER_DB);
  if (!db) return [];
  try {
    // cycle_time is TEXT in ISO format; compare as string prefix
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString().slice(0, 16);
    return db.prepare(`
      SELECT account, cycle_time, ticker, option_type, strike, expiry,
             contracts, fill_price, confidence, protocol, exec_ok
      FROM executed_ledger
      WHERE cycle_time >= ?
      ORDER BY cycle_time DESC
      LIMIT 50
    `).all(since) as any[];
  } finally {
    db.close();
  }
}

// ── AI Trading Brief (5-min cache written by trade-brief-generator.py) ────
export function getBrief(): { brief: string | null; generated_at: string | null; status: string; bullets?: string[] } {
  try {
    if (!existsSync(BRIEF_CACHE)) return { brief: null, generated_at: null, status: 'not_generated' };
    const parsed = JSON.parse(readFileSync(BRIEF_CACHE, 'utf-8'));
    return { status: 'ok', ...parsed };
  } catch {
    return { brief: null, generated_at: null, status: 'error' };
  }
}

// ── AIME Query (cookie-based SSE to tech.ainvest.com) ────────────────────
export async function queryAIME(prompt: string, cookie: string): Promise<{ response: string; status: string }> {
  if (!cookie) return { response: '', status: 'no_cookie' };

  const resp = await fetch('https://tech.ainvest.com/gateway/aime/stream-query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://ainvest.com/',
      'Origin': 'https://ainvest.com',
      'Accept': 'text/event-stream, application/json, */*',
    },
    body: JSON.stringify({ query: prompt, stream: false }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) return { response: '', status: 'cookie_expired' };
    throw new Error(`AIME HTTP ${resp.status}`);
  }

  const text = await resp.text();
  // Handle SSE or plain JSON response
  let response = text;
  try {
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    if (lines.length > 0) {
      const chunks = lines.map(l => {
        try { return JSON.parse(l.slice(6))?.content || JSON.parse(l.slice(6))?.text || ''; }
        catch { return ''; }
      });
      response = chunks.join('');
    } else {
      const json = JSON.parse(text);
      response = json.content || json.text || json.answer || json.response || text;
    }
  } catch { /* keep raw text */ }

  return { response, status: 'ok' };
}

// ── Combined overview (for the Trade Desk home panel) ─────────────────────
export function getTradeDeskOverview(): {
  flow_rank: ReturnType<typeof getFlowRank>;
  momentum: any[];
  macro: any;
  recent_winners: any[];
  ledger: any[];
} {
  return {
    flow_rank: getFlowRank(),
    momentum: getMomentum().slice(0, 10),
    macro: getMacro(),
    recent_winners: getFlowWinners(3, undefined).slice(0, 5),
    ledger: getTradeLedger(24),
  };
}
