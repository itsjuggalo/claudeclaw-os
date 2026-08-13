// EXAMPLE: how to wire the Health OS dashboard + WHOOP OAuth into a Hono server.
//
// This is an illustrative excerpt, not a drop-in file. It shows the four routes
// the dashboard needs:
//   GET /healthdb        -> the page (token-gated, token stashed in a cookie)
//   GET /api/healthdb    -> the JSON the page polls (token-gated)
//   GET /whoop/connect   -> kicks off WHOOP OAuth (token-gated)
//   GET /whoop/callback  -> WHOOP redirects here; we save the refresh token
//
// Auth model: a single DASHBOARD_TOKEN (a long random string in ~/.env) gates
// everything. /healthdb takes it as ?token=, stashes it in an HttpOnly cookie,
// and redirects to a clean URL so the token never lingers in the address bar.

import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getHealthDashboardHtml } from './health-dashboard.js';
import { getHealthDashboard } from './health-data.js';

const app = new Hono();
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';

// ── the page ────────────────────────────────────────────────────────────────
app.get('/healthdb', (c) => {
  const qToken = c.req.query('token');
  if (qToken !== undefined) {
    if (!DASHBOARD_TOKEN || qToken !== DASHBOARD_TOKEN) return c.json({ error: 'Unauthorized' }, 401);
    setCookie(c, 'hdbt', qToken, { path: '/healthdb', httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
    return c.redirect('/healthdb');
  }
  if (!DASHBOARD_TOKEN || getCookie(c, 'hdbt') !== DASHBOARD_TOKEN) {
    return c.html('<body style="background:#07080a;color:#9aa1ad;font-family:system-ui">Open from your bot.</body>', 401);
  }
  const pref = parseInt(getCookie(c, 'hdbrange') || '', 10);
  const range = [7, 30, 90].includes(pref) ? pref : 7;
  c.header('Cache-Control', 'no-store');
  return c.html(getHealthDashboardHtml(DASHBOARD_TOKEN, range));
});

// ── the data (the page polls this every minute) ──────────────────────────────
app.get('/api/healthdb', async (c) => {
  if (c.req.query('token') !== DASHBOARD_TOKEN) return c.json({ error: 'Unauthorized' }, 401);
  c.header('Cache-Control', 'no-store');
  const range = parseInt(c.req.query('range') || '30', 10);
  return c.json(await getHealthDashboard(range)); // reads Supabase, aggregates 7/30/90-day
});

// ── WHOOP OAuth (the connection blueprint) ───────────────────────────────────
const HOME_ENV = path.join(process.env.HOME || '', '.env');
const readHomeEnv = (): Record<string, string> => {
  const out: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(HOME_ENV, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const i = s.indexOf('=');
      out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* no ~/.env */ }
  return out;
};
const setHomeEnv = (key: string, value: string): boolean => {
  let txt: string;
  try { txt = fs.readFileSync(HOME_ENV, 'utf8'); } catch { return false; } // never CREATE, avoid clobber
  const lines = txt.split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith(key + '=')) { lines[i] = key + '=' + value; found = true; break; }
  if (!found) lines.push(key + '=' + value);
  fs.writeFileSync(HOME_ENV, lines.join('\n').replace(/\n+$/, '') + '\n', { mode: 0o600 });
  return true;
};

const WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_REDIRECT = `https://<your-host>/whoop/callback`; // must match the WHOOP app exactly
const WHOOP_SCOPES = 'read:recovery read:sleep read:cycles offline';

app.get('/whoop/connect', (c) => {
  if (c.req.query('token') !== DASHBOARD_TOKEN) return c.json({ error: 'Unauthorized' }, 401);
  const cid = readHomeEnv().WHOOP_CLIENT_ID;
  if (!cid) return c.text('WHOOP_CLIENT_ID missing in ~/.env', 500);
  const state = crypto.randomUUID();
  setCookie(c, 'whoopstate', state, { path: '/whoop', httpOnly: true, sameSite: 'Lax', maxAge: 600 });
  const q = [
    'response_type=code',
    'client_id=' + encodeURIComponent(cid),
    'redirect_uri=' + encodeURIComponent(WHOOP_REDIRECT),
    'scope=' + encodeURIComponent(WHOOP_SCOPES), // encodeURIComponent so spaces are %20, not +
    'state=' + encodeURIComponent(state),
  ].join('&');
  return c.redirect(WHOOP_AUTH + '?' + q);
});

app.get('/whoop/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state || state !== getCookie(c, 'whoopstate')) return c.html('Auth could not be verified.', 400);
  const env = readHomeEnv();
  const r = await fetch(WHOOP_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code,
      client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET, redirect_uri: WHOOP_REDIRECT,
    }),
  });
  const tok: any = await r.json().catch(() => ({}));
  if (!r.ok || !tok.refresh_token) return c.html('Token exchange failed.', 502);
  setHomeEnv('WHOOP_REFRESH_TOKEN', tok.refresh_token); // whoop-sync.py rotates it from here
  return c.html('WHOOP connected. You can close this tab.');
});

export default app;
