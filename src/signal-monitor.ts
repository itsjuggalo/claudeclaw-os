// Signal Monitor — data layer for the /signal-monitor page.
// Proves the headless signal listeners are ALIVE and actually pushing to Discord,
// and shows the option/flow apps' notifications side-by-side.
//
// Reads the LIVE capture dir ~/firebase-signals/ (NOT ~/LapClaw/firebase-signals,
// which trade-desk.ts uses and is a stale May-28 copy). Daemons writing here:
//   fcm-rtdb  (rtdb_stream.py)   → latest.json + live_signals.jsonl + rtdb_heartbeat
//   fcm-discord (discord_poster.py) → ~24 Discord webhooks + discord_heartbeat + state
//   fcm-push-listener (fcm_push_listener.py, audit) → fcm_push_audit.ndjson + fcm_push_heartbeat
// All reads are bounded (tail) + wrapped — this route is polled every 8s by the page.
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = process.env.HOME || '/home/itsju';
const FS_DIR        = join(HOME, 'firebase-signals');
const LATEST        = join(FS_DIR, 'latest.json');
const LIVE_LOG      = join(FS_DIR, 'live_signals.jsonl');
const PUSH_AUDIT    = join(FS_DIR, 'fcm_push_audit.ndjson');
const POSTER_STATE  = join(FS_DIR, 'discord_poster_state.json');
const POSTER_LOG    = join(FS_DIR, 'discord_poster.log');
const WATCHDOG_STATE = join(FS_DIR, 'signal_watchdog_state.json');
const HB: Record<string, string> = {
  'fcm-rtdb':          join(FS_DIR, 'rtdb_heartbeat'),
  'fcm-discord':       join(FS_DIR, 'discord_heartbeat'),
  'fcm-push-listener': join(FS_DIR, 'fcm_push_heartbeat'),
};

// App grouping by feed prefix. rtdb_stream.py streams: flow*/fg_*=Flow Greeks,
// v2_*=Vivid2 (primary option signals), ts_*=Trade Signals, ss_*=Stock Signals,
// vivid_*=legacy. Match by prefix so any new sub-feed is captured automatically.
const APPS: Array<{ id: string; label: string; sub: string; match: (f: string) => boolean }> = [
  { id: 'flow',  label: 'Flow Greeks',    sub: 'live options flow',  match: (f) => f.startsWith('fg_') || f.startsWith('flow') },
  { id: 'v2',    label: 'Option Signals', sub: 'Vivid2',             match: (f) => f.startsWith('v2_') },
  { id: 'ts',    label: 'Trade Signals',  sub: 'options + stocks',   match: (f) => f.startsWith('ts_') },
  { id: 'ss',    label: 'Stock Signals',  sub: 'name screens',       match: (f) => f.startsWith('ss_') },
  { id: 'vivid', label: 'Vivid (legacy)', sub: 'legacy stream',      match: (f) => f.startsWith('vivid_') },
];

interface Note {
  symbol: string; dir: 'bull' | 'bear' | 'neutral'; kind: string;
  value: number; text: string; extra: string; feed: string; received_at: string | null;
}

// ── tiny helpers ───────────────────────────────────────────────────────────
function tailBytes(path: string, maxBytes: number): string {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return '';
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.allocUnsafe(len);
      readSync(fd, buf, 0, len, start);
      return buf.toString('utf-8');
    } finally { closeSync(fd); }
  } catch { return ''; }
}

const etDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

// Count ndjson lines whose received_at is "today" (ET). partialFirst drops the
// first (likely truncated) line when the text came from a byte-tail.
function countToday(text: string, partialFirst: boolean): { count: number; lastAt: string | null; approx: boolean; total: number } {
  const today = etDate(new Date());
  const lines = text.split('\n').filter(Boolean);
  if (partialFirst && lines.length) lines.shift();
  let count = 0; let lastAt: string | null = null;
  for (const ln of lines) {
    let rec: string | undefined;
    try { rec = JSON.parse(ln).received_at; } catch { continue; }
    if (rec && etDate(new Date(rec)) === today) { count++; lastAt = rec; }
  }
  // approx: oldest line in window is also today → we may have truncated earlier ones
  let approx = false;
  if (partialFirst && lines.length) {
    try { const r = JSON.parse(lines[0]).received_at; if (r && etDate(new Date(r)) === today) approx = true; } catch { /* ignore */ }
  }
  return { count, lastAt, approx, total: lines.length };
}

function fmtMoney(v: number): string {
  if (!isFinite(v) || v <= 0) return '';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
function fmtVol(v: any): string { const n = Number(v) || 0; return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function shortExp(v: any): string {
  const n = Number(v);
  if (isFinite(n) && n > 1e9) { const dt = new Date(n * 1000); return `${dt.getMonth() + 1}/${dt.getDate()}`; }
  return v ? String(v) : '';
}
function guessDir(s: string): 'bull' | 'bear' | 'neutral' {
  const t = s.toLowerCase();
  if (/\b(call|bull|long|profit|gain|green|up)\b/.test(t)) return 'bull';
  if (/\b(put|bear|short|loss|stop|red|down)\b/.test(t)) return 'bear';
  return 'neutral';
}

// Turn a raw feed entry into a uniform display note (handles flow blocks,
// structured signals, target lists, plain alerts, and promo/upsell messages).
function normalize(feed: string, entry: any): Note {
  const d = (entry && entry.data) || {};
  const received_at = entry?.received_at || null;

  // 1) structured options flow (Flow Greeks)
  if ((d.Symbol || d.symbol) && d.OptionType) {
    const sym = String(d.Symbol || d.symbol);
    const dir = d.OptionType === 'CALL' ? 'bull' : d.OptionType === 'PUT' ? 'bear' : 'neutral';
    const val = Number(d.Value) || 0;
    const parts = [d.BlockType, d.OptionType, d.Strike ? `$${d.Strike}` : '', d.ExpiryStr ? shortExp(d.ExpiryStr) : shortExp(d.Expiry)].filter(Boolean);
    const extra = [fmtMoney(val), d.Volume ? `${fmtVol(d.Volume)}x` : ''].filter(Boolean).join(' · ');
    return { symbol: sym, dir, kind: String(d.BlockType || 'flow').toLowerCase(), value: val, text: parts.join(' '), extra, feed, received_at };
  }

  // 2) structured signal with a symbol (option/stock/short/closed/long-term)
  if (d.symbol || d.Symbol) {
    const sym = String(d.symbol || d.Symbol);
    const base = d.title || d.message || d.shortName || '';
    const tgt: string[] = [];
    if (d.strike) tgt.push(`$${d.strike}${d.expiry ? ' ' + shortExp(d.expiry) : ''}`);
    if (d.buyTarget) tgt.push(`buy ${d.buyTarget}`);
    if (d.sellTarget) tgt.push(`tgt ${d.sellTarget}`);
    if (d.stopLoss) tgt.push(`stop ${d.stopLoss}`);
    if (d.status) tgt.push(String(d.status));
    const text = String(base || tgt.join(' · ') || d.category || 'signal').replace(/\s+/g, ' ').trim();
    return {
      symbol: sym, dir: guessDir(`${d.category || ''} ${base}`),
      kind: String(d.status || d.category || 'signal').toLowerCase(), value: 0,
      text, extra: tgt.join(' · '), feed, received_at,
    };
  }

  // 3) plain text alert
  if (d.alert) return { symbol: '', dir: 'neutral', kind: 'alert', value: 0, text: String(d.alert).replace(/\s+/g, ' ').trim(), extra: '', feed, received_at };

  // 4) promo / general upsell ("get our signals 33% off")
  if (d.message) return { symbol: '', dir: 'neutral', kind: 'promo', value: 0, text: String(d.message).replace(/\s+/g, ' ').trim(), extra: String(d.type || d.topic || ''), feed, received_at };

  return { symbol: '', dir: 'neutral', kind: 'other', value: 0, text: JSON.stringify(d).slice(0, 160), extra: '', feed, received_at };
}

// pm2 jlist is ~200-500ms; cache it briefly so multiple pollers / fast refreshes
// don't hammer it.
let _pm2Cache: { at: number; map: Record<string, { status: string; restarts: number }> } | null = null;
function pm2Map(): Record<string, { status: string; restarts: number }> {
  const now = Date.now();
  if (_pm2Cache && now - _pm2Cache.at < 5000) return _pm2Cache.map;
  const map: Record<string, { status: string; restarts: number }> = {};
  try {
    const out = spawnSync('pm2', ['jlist'], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
    const arr = JSON.parse(out.stdout || '[]');
    for (const p of arr) map[p.name] = { status: p.pm2_env?.status || 'unknown', restarts: p.pm2_env?.restart_time ?? 0 };
  } catch { /* pm2 missing — daemons show 'missing' */ }
  _pm2Cache = { at: now, map };
  return map;
}

function hbAge(path: string): number | null {
  try { const v = parseFloat(readFileSync(path, 'utf-8').trim()); return isFinite(v) ? Math.floor(Date.now() / 1000 - v) : null; } catch { return null; }
}

// ── main ───────────────────────────────────────────────────────────────────
export function getSignalMonitor(perApp = 30): any {
  // Feeds (side-by-side columns) from the live latest.json (last ~50 per feed).
  let feeds: Record<string, any[]> = {};
  try { feeds = JSON.parse(readFileSync(LATEST, 'utf-8')); } catch { feeds = {}; }

  const known = (f: string) => APPS.some((a) => a.match(f));
  const collect = (pick: (f: string) => boolean): Note[] => {
    const items: Note[] = [];
    for (const [feed, entries] of Object.entries(feeds)) {
      if (!pick(feed) || !Array.isArray(entries)) continue;
      for (const e of entries) items.push(normalize(feed, e));
    }
    items.sort((x, y) => String(y.received_at || '').localeCompare(String(x.received_at || '')));
    return items;
  };

  const apps = APPS.map((a) => {
    const items = collect(a.match);
    return { id: a.id, label: a.label, sub: a.sub, count: items.length, items: items.slice(0, perApp) };
  });
  const otherItems = collect((f) => !known(f));
  if (otherItems.length) {
    apps.push({
      id: 'other', label: 'Other Feeds',
      sub: Object.keys(feeds).filter((f) => !known(f)).join(', ').slice(0, 60),
      count: otherItems.length, items: otherItems.slice(0, perApp),
    });
  }

  // Health.
  const now = Math.floor(Date.now() / 1000);
  const pm2 = pm2Map();
  const liveToday = countToday(tailBytes(LIVE_LOG, 1_500_000), true);
  let pushAuditText = ''; try { pushAuditText = readFileSync(PUSH_AUDIT, 'utf-8'); } catch { /* none yet */ }
  const pushToday = countToday(pushAuditText, false);

  // Discord poster catch-up: offset (bytes consumed) vs current live_signals size.
  let behindBytes = 0, caughtUp = true, lastPostAge: number | null = null, lastPostLine = '';
  try {
    const size = existsSync(LIVE_LOG) ? statSync(LIVE_LOG).size : 0;
    const offset = JSON.parse(readFileSync(POSTER_STATE, 'utf-8')).offset || 0;
    behindBytes = Math.max(0, size - offset);
    caughtUp = behindBytes < 8192;
  } catch { /* state missing */ }
  try { lastPostAge = now - Math.floor(statSync(POSTER_LOG).mtimeMs / 1000); } catch { /* log missing */ }
  try { const t = tailBytes(POSTER_LOG, 4000).split('\n').filter(Boolean); lastPostLine = (t[t.length - 1] || '').slice(-200); } catch { /* */ }

  let forwarderState = 'unknown';
  try { const w = JSON.parse(readFileSync(WATCHDOG_STATE, 'utf-8')); forwarderState = w.health || w.forwarder_state || 'unknown'; } catch { /* */ }

  const ageOf = (iso: string | null) => (iso ? now - Math.floor(Date.parse(iso) / 1000) : null);
  const baseDaemon = (name: string, label: string, role: string) => {
    const p = pm2[name] || { status: 'missing', restarts: 0 };
    const hb = hbAge(HB[name]);
    return { name, label, role, pm2: p.status, restarts: p.restarts, hbAge: hb, alive: p.status === 'online' && hb != null && hb < 90 };
  };

  const daemons = [
    { ...baseDaemon('fcm-rtdb', 'RTDB Stream', 'capture'),
      capturedToday: liveToday.count, capturedApprox: liveToday.approx, lastCaptureAge: ageOf(liveToday.lastAt) },
    { ...baseDaemon('fcm-discord', 'Discord Poster', 'forward'),
      caughtUp, behindBytes, lastPostAge, lastPostLine },
    { ...baseDaemon('fcm-push-listener', 'FCM Push (audit)', 'push'),
      pushesToday: pushToday.count, pushesTotal: pushToday.total, lastPushAge: ageOf(pushToday.lastAt) },
  ];

  return {
    generatedAt: now,
    apps,
    health: { daemons, forwarderState, capturedToday: liveToday.count, capturedApprox: liveToday.approx },
  };
}
