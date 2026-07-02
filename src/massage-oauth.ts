// Massage Admin — two-admin Google sign-in.
//
// Gives the Massage Admin console a real per-person identity so remote (Tailscale)
// access can be restricted to the two owner emails, and every audit row carries the
// acting admin's email instead of an anonymous shared-password session.
//
// Reuses the massage site's already-registered Google OAuth *client* (client id +
// secret read from the massage server's own .env — one source of truth, same box),
// runs a self-contained code exchange, and — only for an allow-listed, Google-verified
// email — mints an mc_access `userToken` carrying { email }. Non-allowlisted emails are
// rejected. Loopback still bypasses this (local dev on the laptop).
//
// One external, one-time step is required for REMOTE use: the claudeclaw redirect URI
// (`<origin>/massage-admin/oauth/callback`) must be added to the Google OAuth client's
// authorized redirect URIs in the Google Cloud console. Loopback works without it.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Context } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { MC_COOKIE, MASTER_TTL_SEC, userToken } from './mc-access.js';
import { MC_ACCESS_SECRET } from './config.js';

const MASSAGE_ENV = process.env.MASSAGE_ENV_PATH || '/AIWorkWSL/web/massage/server/.env';
const STATE_COOKIE = 'mbm_admin_oauth';

// Comma/space-separated allowlist; defaults to the two owner accounts (main + testing).
export function adminAllowlist(): Set<string> {
  const raw = process.env.MASSAGE_ADMIN_EMAILS || 'mlenglund92@gmail.com,itsjuggalo@gmail.com';
  return new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
}
export function isAllowlistedAdmin(email: string | undefined | null): boolean {
  return !!email && adminAllowlist().has(String(email).toLowerCase());
}

function massageEnv(key: string): string {
  try {
    const m = readFileSync(MASSAGE_ENV, 'utf-8').match(new RegExp(`^${key}=(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
function googleCreds(): { id: string; secret: string } {
  return {
    id: process.env.GOOGLE_CLIENT_ID || massageEnv('GOOGLE_CLIENT_ID'),
    secret: process.env.GOOGLE_CLIENT_SECRET || massageEnv('GOOGLE_CLIENT_SECRET'),
  };
}
// Redirect URI derived from the incoming request origin so it works for both
// http://127.0.0.1:3141 and the ts.net HTTPS proxy — whichever the admin used.
function redirectUri(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || url.host;
  return `${proto}://${host}/massage-admin/oauth/callback`;
}

// --- signed state (CSRF) — HMAC over {nonce,next,exp} with MC_ACCESS_SECRET ---
function signState(next: string): string {
  const payload = Buffer.from(JSON.stringify({ n: crypto.randomBytes(8).toString('hex'), next, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const sig = crypto.createHmac('sha256', MC_ACCESS_SECRET || 'unset').update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyState(state: string): { next: string } | null {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', MC_ACCESS_SECRET || 'unset').update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    const next = typeof p.next === 'string' && p.next.startsWith('/') && !p.next.startsWith('//') ? p.next : '/massage-admin';
    return { next };
  } catch { return null; }
}

// GET /massage-admin/login → bounce to Google's consent screen.
export async function massageAdminLoginStart(c: Context): Promise<Response> {
  const { id, secret } = googleCreds();
  if (!id || !secret) return c.html(errPage('Google sign-in is not configured (GOOGLE_CLIENT_ID/SECRET missing in the massage .env).'), 500);
  if (!MC_ACCESS_SECRET) return c.html(errPage('MC_ACCESS_SECRET is not set; cannot mint an identified session.'), 500);
  const next = c.req.query('next') || '/massage-admin';
  const state = signState(next);
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, sameSite: 'Lax', path: '/massage-admin', maxAge: 600 });
  const p = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(c),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`, 302);
}

// GET /massage-admin/oauth/callback → exchange code, verify email, mint mc_access.
export async function massageAdminOauthCallback(c: Context): Promise<Response> {
  const code = c.req.query('code');
  const state = c.req.query('state') || '';
  const cookieState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/massage-admin' });
  if (!code) return c.html(errPage('Sign-in was cancelled or failed.'), 400);
  if (!state || state !== cookieState) return c.html(errPage('Invalid or expired sign-in state — please try again.'), 400);
  const ok = verifyState(state);
  if (!ok) return c.html(errPage('Invalid or expired sign-in state — please try again.'), 400);

  const { id, secret } = googleCreds();
  let tok: { id_token?: string; error?: string };
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri(c), grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(10000),
    });
    tok = await r.json() as { id_token?: string; error?: string };
    if (!r.ok || !tok.id_token) return c.html(errPage(`Google token exchange failed${tok.error ? `: ${tok.error}` : ''}.`), 502);
  } catch (e) {
    return c.html(errPage(`Google token exchange error: ${String((e as Error).message)}`), 502);
  }

  // id_token came straight from Google's token endpoint over TLS via our authenticated
  // client — trust its claims. Decode the payload for email + verification.
  let claims: { email?: string; email_verified?: boolean | string; name?: string; sub?: string };
  try {
    claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf-8'));
  } catch { return c.html(errPage('Could not read Google identity.'), 502); }

  const email = String(claims.email || '').toLowerCase();
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!email || !verified) return c.html(errPage('Your Google email is not verified.'), 403);
  if (!isAllowlistedAdmin(email)) {
    return c.html(errPage(`${email} is not authorized for the Massage Admin console. Ask Mike to add it to MASSAGE_ADMIN_EMAILS.`), 403);
  }

  const token = await userToken(MC_ACCESS_SECRET, { email, name: claims.name, sub: claims.sub }, MASTER_TTL_SEC);
  setCookie(c, MC_COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: MASTER_TTL_SEC });
  return c.redirect(ok.next, 302);
}

function errPage(msg: string): string {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>Massage Admin sign-in</title>
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1D2023">
    <h1 style="font-size:20px;color:#9b440d">Massage Admin sign-in</h1>
    <p style="font-size:15px;line-height:1.5;color:#50555C">${msg.replace(/[<>&]/g, (x) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[x] as string))}</p>
    <p><a href="/massage-admin/login" style="color:#9b440d;font-weight:600">Try again</a> · <a href="/massage-admin" style="color:#50555C">Back to Massage Admin</a></p>
  </div>`;
}
