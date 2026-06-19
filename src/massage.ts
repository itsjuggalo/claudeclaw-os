// Massage By Mike — ops cockpit bridge. ClaudeClaw (local-only :3141) proxies the
// token-guarded admin API the massage server exposes on localhost:3003. The bearer token
// is read straight from the massage server's own .env so there is ONE source of truth and
// nothing extra to paste. Same machine as the massage app, so the path resolves directly.
import { readFileSync } from 'node:fs';

const MASSAGE_BASE = (process.env.MASSAGE_API_URL || 'http://127.0.0.1:3003').replace(/\/$/, '');
const MASSAGE_ENV = process.env.MASSAGE_ENV_PATH || '/AIWorkWSL/web/massage/server/.env';

export interface LifecycleRow {
  id: string;
  email: string;
  name: string | null;
  state: 'warn' | 'warned' | 'delete' | 'reactivated';
  idle_days: number;
  warned_at: string | null;
  delete_at: string | null;
  days_until_delete: number | null;
  appt_count: number;
  future_appt_count: number;
}
export interface MassageMonitor {
  ok?: boolean;
  now: number;
  accounts: {
    total: number; verified: number; unverified: number; oauth_only: number; active_sessions: number;
    active: number; warn: number; warned: number; delete: number; reactivated: number; exempt: number;
  };
  appointments: { requested: number; confirmed_upcoming: number; total: number };
  payments: { pending: number; claimed_sum: number; received_sum: number };
  membership_interest: number;
  reaper: {
    on: boolean; live: boolean; warn_days: number; grace_days: number;
    last_run: string | null; last_checked: number | null; last_warned: number | null; last_deleted: number | null;
  };
  lifecycle: LifecycleRow[];
}

function adminToken(): string {
  if (process.env.MASSAGE_ADMIN_TOKEN) return process.env.MASSAGE_ADMIN_TOKEN.trim();
  try {
    const m = readFileSync(MASSAGE_ENV, 'utf-8').match(/^ADMIN_API_TOKEN=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

async function call<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const tok = adminToken();
  if (!tok) throw new Error('massage admin token unavailable (ADMIN_API_TOKEN missing in massage .env)');
  const res = await fetch(`${MASSAGE_BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    let body = ''; try { body = await res.text(); } catch { /* ignore */ }
    throw new Error(`massage ${pathname} → HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// 30s stale-while-revalidate cache on the read (mirrors wallets.ts); actions bust it.
let _cache: { at: number; data: MassageMonitor } | null = null;
const TTL_MS = 30_000;

export async function getMassageMonitor(force = false): Promise<MassageMonitor> {
  const now = Date.now();
  if (!force && _cache && now - _cache.at < TTL_MS) return _cache.data;
  const data = await call<MassageMonitor>('/api/admin/monitor');
  _cache = { at: now, data };
  return data;
}

export async function keepAccount(id: string): Promise<unknown> {
  const r = await call(`/api/admin/account/${encodeURIComponent(id)}/keep`, { method: 'POST' });
  _cache = null; return r;
}
export async function deleteAccount(id: string): Promise<unknown> {
  const r = await call(`/api/admin/account/${encodeURIComponent(id)}/delete`, { method: 'POST' });
  _cache = null; return r;
}
export async function setReaper(cfg: { on?: boolean; live?: boolean; warn_days?: number; grace_days?: number }): Promise<unknown> {
  const r = await call('/api/admin/reaper', { method: 'POST', body: JSON.stringify(cfg || {}) });
  _cache = null; return r;
}
