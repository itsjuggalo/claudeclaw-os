// Token + chatId come from the URL query string (set by the Telegram deep
// link or by a saved bookmark). We persist both to sessionStorage on first
// load so subsequent navigations keep working without rewriting the URL.
// We never use localStorage: dashboardToken is sensitive, and storing it
// across browser sessions would enlarge its blast radius.
//
// PRIMARY persistence is now the server-set HttpOnly `claudeclaw_token`
// cookie (10y, set whenever a valid ?token= is presented). The browser
// auto-attaches it to every same-origin fetch + EventSource, so a reboot /
// browser-close keeps working with no token in the URL. sessionStorage is
// just a same-tab convenience. If BOTH are gone (new device, cookie wiped),
// the first /api/* call 401s and showReauthOverlay() gives a one-field way
// back in — never a wall of 401s. See showReauthOverlay() below.

const url = new URL(window.location.href);

let cachedToken = url.searchParams.get('token') || '';
if (cachedToken) {
  try { sessionStorage.setItem('claudeclaw.token', cachedToken); } catch {}
} else {
  try { cachedToken = sessionStorage.getItem('claudeclaw.token') || ''; } catch {}
}

let cachedChatId = url.searchParams.get('chatId') || '';
if (cachedChatId) {
  try { sessionStorage.setItem('claudeclaw.chatId', cachedChatId); } catch {}
} else {
  try { cachedChatId = sessionStorage.getItem('claudeclaw.chatId') || ''; } catch {}
}

export const dashboardToken = cachedToken;
export const chatId = cachedChatId;

function withToken(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(dashboardToken)}`;
}

// ── Zero-lockout re-auth ──────────────────────────────────────────────────
// Any 401 (cookie expired/cleared, fresh device, token drift) renders a
// single full-screen prompt instead of letting every panel fail silently.
// Submitting navigates to /?token=<value>, which makes the server re-set the
// HttpOnly cookie and reload authenticated — no manual URL editing, ever.
// DOM-injected (not React) so it works even if app render fails on the 401s.
let reauthShown = false;
function showReauthOverlay(): void {
  if (reauthShown || typeof document === 'undefined') return;
  reauthShown = true;

  const ov = document.createElement('div');
  ov.id = 'cc-reauth-overlay';
  ov.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(10,12,16,0.92);' +
    'font:14px system-ui,-apple-system,Segoe UI,sans-serif;color:#e8eaed;';
  ov.innerHTML =
    '<div style="background:#16191f;border:1px solid #2a2f3a;border-radius:12px;' +
    'padding:24px;width:min(92vw,380px);box-shadow:0 12px 40px rgba(0,0,0,.5)">' +
    '<div style="font-size:16px;font-weight:600;margin-bottom:6px">🔒 Session expired</div>' +
    '<div style="opacity:.7;margin-bottom:16px;line-height:1.4">' +
    'Paste your dashboard token to reconnect. It is stored as a secure ' +
    'cookie that re-extends on every visit, so you stay signed in across ' +
    'reboots.</div>' +
    '<input id="cc-reauth-input" type="password" autocomplete="off" ' +
    'placeholder="DASHBOARD_TOKEN" style="width:100%;box-sizing:border-box;' +
    'padding:10px 12px;border-radius:8px;border:1px solid #2a2f3a;background:#0e1116;' +
    'color:#e8eaed;font-size:14px;outline:none;margin-bottom:12px" />' +
    '<button id="cc-reauth-btn" style="width:100%;padding:10px;border:0;border-radius:8px;' +
    'background:#3b82f6;color:#fff;font-size:14px;font-weight:600;cursor:pointer">' +
    'Unlock dashboard</button></div>';
  document.body.appendChild(ov);

  const input = ov.querySelector('#cc-reauth-input') as HTMLInputElement;
  const btn = ov.querySelector('#cc-reauth-btn') as HTMLButtonElement;
  const submit = () => {
    const v = (input.value || '').trim();
    if (!v) { input.focus(); return; }
    // Land on / (not the current deep route) so the server sees the query,
    // sets the cookie, then serves the SPA shell authenticated.
    window.location.assign('/?token=' + encodeURIComponent(v));
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input.focus(), 50);
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

// Centralised failure handling: a 401 means "not authenticated" — surface the
// re-auth prompt before throwing so callers still get their rejected promise.
function handleFailure(status: number): void {
  if (status === 401) showReauthOverlay();
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(withToken(path), { method: 'GET' });
  if (!res.ok) {
    handleFailure(res.status);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    handleFailure(res.status);
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    handleFailure(res.status);
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `PATCH ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    handleFailure(res.status);
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `PUT ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await fetch(withToken(path), { method: 'DELETE' });
  if (!res.ok) {
    handleFailure(res.status);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function tokenizedSseUrl(path: string): string {
  return withToken(path);
}

// Vite dev runs on :5173 and proxies /api/* and /warroom/text to the
// backend on :3141. The legacy voice room at /warroom?mode=voice can't
// be proxied (it shares a path prefix with the v2 SPA route), so links
// that go to legacy pages must point at the backend origin in dev.
const BACKEND_ORIGIN = (import.meta as any).env?.DEV ? 'http://localhost:3141' : '';

export function legacyUrl(path: string): string {
  return BACKEND_ORIGIN + path;
}
