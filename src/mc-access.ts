/**
 * Fleet-wide single-password access gate — shared, dependency-free, runtime-agnostic.
 *
 * The SAME file is vendored into missionctrl (src/lib/mc-access.ts), aries
 * (src/lib/mc-access.ts) and claudeclaw (src/mc-access.ts). Canonical copy lives
 * at ~/restructure/staging/mc-access/mc-access.ts — edit there, re-copy, rebuild
 * all three. Keep it EDGE-SAFE: no node imports (fs/buffer/node:crypto), only Web
 * Crypto + base64 globals, so it compiles + runs in Next edge middleware, Next
 * node route handlers, AND claudeclaw's Hono server (Node 22 has global crypto).
 *
 * Credential model: the cookie value is a signed token
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))
 * The raw password is NEVER stored in the cookie. A guest link carries the same
 * signed-token shape with a short exp. Verification is HMAC + expiry only —
 * stateless, so any app verifies a token any other app (or mc-grant) issued.
 * This is what makes one login unlock all three apps (cookies ignore port).
 */

export const MC_COOKIE = 'mc_access';

/** 400 days — the hard ceiling browsers clamp cookies to. Master sessions slide. */
export const MASTER_TTL_SEC = 400 * 24 * 3600;

export type McKind = 'master' | 'guest';
export interface McPayload {
  exp: number; // unix seconds; token invalid once passed
  kind: McKind;
  label?: string; // guest grants carry a human label for logs
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── base64url (works in edge + node 22 via global btoa/atob) ───────────────
function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  // Cast to ArrayBuffer: at runtime Web Crypto accepts any BufferSource (Uint8Array
  // included), but TS lib.dom's generic Uint8Array<ArrayBufferLike> doesn't satisfy
  // the BufferSource overload across all three apps' tsconfigs — the cast is sound.
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, utf8(msg) as unknown as ArrayBuffer);
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Sign a payload into a cookie/link token. */
export async function signToken(payload: McPayload, secret: string): Promise<string> {
  const body = b64urlEncode(utf8(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, body));
  return `${body}.${sig}`;
}

/** Verify a token: HMAC must match AND it must not be expired. Null otherwise. */
export async function verifyToken(
  value: string | null | undefined,
  secret: string,
): Promise<McPayload | null> {
  if (!value || !secret) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  let provided: Uint8Array;
  let expected: Uint8Array;
  try {
    provided = b64urlDecode(sig);
    expected = await hmac(secret, body);
  } catch {
    return null;
  }
  if (!timingSafeEqual(provided, expected)) return null;
  let payload: McPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as McPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp <= nowSec()) return null;
  return payload;
}

/** Mint a master-session token (long-lived; callers slide it on each request). */
export function masterToken(secret: string): Promise<string> {
  return signToken({ exp: nowSec() + MASTER_TTL_SEC, kind: 'master' }, secret);
}

/** Parse "24h" | "90m" | "7d" | "30s" | "3600" → seconds. Null if malformed. */
export function parseDuration(s: string): number | null {
  const m = /^\s*(\d+)\s*([smhd])?\s*$/i.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || 's').toLowerCase();
  return n * (u === 'd' ? 86400 : u === 'h' ? 3600 : u === 'm' ? 60 : 1);
}

// ── loopback detection (local = trusted, never prompted) ───────────────────
const LOOPBACK_HOSTS = new Set(['', 'localhost', '127.0.0.1', '[::1]', '::1']);

/** A single IP (optionally :port) that is unambiguously loopback. */
export function isLoopbackAddr(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return (
    v === '127.0.0.1' ||
    v === '::1' ||
    v === '[::1]' ||
    v === '::ffff:127.0.0.1' ||
    v.startsWith('127.') ||
    v.startsWith('[::1]:')
  );
}

/**
 * True only for a DIRECT loopback request, judged from header VALUES (not mere
 * presence) — Next `next start` self-stamps x-forwarded-* from the socket, so a
 * presence check would reject even real 127.0.0.1 calls. Ported from aries
 * src/lib/net.ts. `get` is a header accessor (Headers.get-compatible).
 *
 * NOTE: only safe where a trusted layer (Next) stamps x-forwarded-for from the
 * real socket. For a raw server with no such stamping (claudeclaw/Hono), use the
 * socket remoteAddress with isLoopbackAddr instead — headers there are spoofable.
 */
export function isLoopbackHeaders(get: (k: string) => string | null | undefined): boolean {
  const xff = get('x-forwarded-for');
  if (xff && !xff.split(',').every((p) => isLoopbackAddr(p))) return false;

  const realIp = get('x-real-ip');
  if (realIp && !isLoopbackAddr(realIp)) return false;

  const fwd = get('forwarded');
  if (fwd) {
    for (const part of fwd.split(',')) {
      const m = /for=("?)\[?([^\];"]+)\]?\1/i.exec(part);
      if (m && !isLoopbackAddr(m[2])) return false;
    }
  }

  const xfHostRaw = get('x-forwarded-host');
  const xfHost = (xfHostRaw || '').split(':')[0].toLowerCase();
  if (xfHostRaw && !LOOPBACK_HOSTS.has(xfHost)) return false;

  const host = (get('host') || '').split(':')[0].toLowerCase();
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Self-contained password page (inline CSS, no external assets, so it renders
 * while the rest of the site is gated). House dark palette + red accent. Shared
 * by all three apps. `nextUrl` is the post-login destination; `err` a message.
 */
export function mcLoginPage(nextUrl: string, err: string): string {
  const safeNext = String(nextUrl || '/').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const errHtml = err ? `<div class="err">${err.replace(/</g, '&lt;')}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="theme-color" content="#0e0e10"><title>Mission Control · Unlock</title>
<style>
:root{--bg:#0e0e10;--card:#16191f;--bd:#2a2f3a;--tx:#e8e8e6;--mut:#8a8f99;--red:#e02434;--blue:#2f6bff}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:radial-gradient(1200px 600px at 50% -10%,#1a1d24 0,var(--bg) 60%);color:var(--tx);
font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center}
.card{width:min(92vw,360px);background:var(--card);border:1px solid var(--bd);border-radius:16px;
padding:28px 24px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:.3px;margin-bottom:4px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--red);box-shadow:0 0 14px var(--red)}
.sub{color:var(--mut);font-size:12.5px;margin:2px 0 18px}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin-bottom:7px}
input{width:100%;background:#0e1014;border:1px solid var(--bd);border-radius:10px;color:var(--tx);
padding:12px 13px;font-size:16px;outline:none}input:focus{border-color:var(--blue)}
button{width:100%;margin-top:14px;background:var(--red);color:#fff;border:0;border-radius:10px;
padding:12px;font-size:15px;font-weight:600;cursor:pointer}button:active{transform:translateY(1px)}
.err{background:rgba(224,36,52,.12);border:1px solid rgba(224,36,52,.4);color:#ffb4bc;
border-radius:9px;padding:9px 11px;font-size:13px;margin-bottom:14px}
.foot{color:var(--mut);font-size:11px;text-align:center;margin-top:16px}
</style></head><body>
<form class="card" method="POST" action="/api/mc-login">
<div class="brand"><span class="dot"></span>Mission Control</div>
<div class="sub">Enter the access password to continue.</div>
${errHtml}
<input type="hidden" name="next" value="${safeNext}">
<label for="p">Password</label>
<input id="p" name="password" type="password" autocomplete="current-password" autofocus
inputmode="text" placeholder="••••••••">
<button type="submit">Unlock</button>
<div class="foot">This device will be remembered.</div>
</form></body></html>`;
}
