// Accounts — read-only cross-product user inventory for the LOCAL-ONLY
// claudeclaw dashboard (:3141). Lists users per product (ARIES / MissionCtrl /
// Massage) by querying each product's OWN database.
//
// SECURITY MODEL: NO secrets ever leave here. The page/API expose only email,
// auth provider, join date, aggregate counts, and login status/method — never
// password hashes, tokens, or access/refresh credentials. ARIES is read with
// SELECT-only psql; the Massage SQLite is opened readonly. There is no
// client-supplied path or SQL — every query is a fixed literal below.
//
// Data sources:
//   ARIES        Postgres (localhost:5432/aries), connection string read from
//                aries/.env. Holds the canonical NextAuth User/Account tables.
//   MissionCtrl  has NO own user table — it federates to ARIES via the shared
//                mc_access cookie, so its accounts ARE the ARIES accounts.
//   Massage      own SQLite (server/data/massage.sqlite), fully isolated.
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import type { Hono } from 'hono';

const execFileAsync = promisify(execFile);

const ARIES_ENVS = ['/home/itsju/web/aries/.env', '/home/itsju/web/aries/.env.local'];
const MASSAGE_DB = '/home/itsju/web/massage/server/data/massage.sqlite';

type AccountRow = { email: string; provider: string; joined: string };
type LoginRow = { app: string; method: string; status: string; when: string };
type ProductAccounts = {
  product: string;
  ok: boolean;
  note?: string;
  error?: string;
  userCount: number;
  accountCount?: number;
  byProvider: { provider: string; count: number }[];
  recent: AccountRow[];
  recentLogins?: LoginRow[];
};
export type AccountsData = { generatedAt: string; products: ProductAccounts[] };

/** Pull ARIES' Postgres connection string from its .env (libpq can't parse
 *  Prisma's `?schema=public`, so strip it). Returns null if not configured. */
function ariesDbUrl(): string | null {
  for (const f of ARIES_ENVS) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/^DATABASE_URL=(.*)$/m);
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, '').replace(/\?schema=public/, '');
    }
  }
  return null;
}

/** Run a SELECT against ARIES via psql. -delimited so emails/values with
 *  commas or pipes never split a column. Fixed SQL only — no client input. */
async function psql(url: string, sql: string): Promise<string[][]> {
  const { stdout } = await execFileAsync(
    'psql', [url, '-tA', '-F', '', '-c', sql],
    { env: { ...process.env, PGCONNECT_TIMEOUT: '5' }, timeout: 8000 },
  );
  return stdout.trim().split('\n').filter(Boolean).map((l) => l.split(''));
}

async function getAriesAccounts(): Promise<ProductAccounts> {
  const base: ProductAccounts = { product: 'ARIES', ok: false, userCount: 0, accountCount: 0, byProvider: [], recent: [] };
  const url = ariesDbUrl();
  if (!url) return { ...base, error: 'aries DATABASE_URL not found' };
  try {
    const [[uc]] = await psql(url, 'select count(*) from "User"');
    const [[ac]] = await psql(url, 'select count(*) from "Account"');
    const prov = await psql(url, 'select provider, count(*) from "Account" group by provider order by 2 desc');
    const recent = await psql(
      url,
      `select u.email, coalesce(a.provider,'—'), to_char(u."createdAt",'YYYY-MM-DD') ` +
        `from "User" u left join "Account" a on a."userId"=u.id order by u."createdAt" desc limit 12`,
    );
    const logins = await psql(
      url,
      `select "appName", "authMethod", status, to_char("createdAt",'MM-DD HH24:MI') ` +
        `from "LoginEvent" order by "createdAt" desc limit 8`,
    );
    return {
      product: 'ARIES',
      ok: true,
      userCount: Number(uc?.[0] ?? 0),
      accountCount: Number(ac?.[0] ?? 0),
      byProvider: prov.map(([provider, count]) => ({ provider, count: Number(count) })),
      recent: recent.map(([email, provider, joined]) => ({ email, provider, joined })),
      recentLogins: logins.map(([app, method, status, when]) => ({ app, method, status, when })),
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

function getMassageAccounts(): ProductAccounts {
  const base: ProductAccounts = { product: 'Massage By Mike', ok: false, userCount: 0, byProvider: [], recent: [] };
  if (!existsSync(MASSAGE_DB)) return { ...base, error: 'massage.sqlite not found' };
  let db: Database.Database | null = null;
  try {
    db = new Database(MASSAGE_DB, { readonly: true });
    const uc = (db.prepare('select count(*) c from users').get() as { c: number }).c;
    const prov = db
      .prepare('select provider, count(*) c from oauth_accounts group by provider order by c desc')
      .all() as { provider: string; c: number }[];
    const recent = db
      .prepare('select email, date(created_at) joined from users order by created_at desc limit 12')
      .all() as { email: string; joined: string }[];
    return {
      product: 'Massage By Mike',
      ok: true,
      userCount: uc,
      byProvider: prov.map((p) => ({ provider: p.provider, count: p.c })),
      recent: recent.map((r) => ({ email: r.email, provider: '—', joined: r.joined })),
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  } finally {
    db?.close();
  }
}

/** Cross-product accounts snapshot. MissionCtrl rows mirror ARIES (federated). */
export async function getAccountsData(): Promise<AccountsData> {
  const aries = await getAriesAccounts();
  const massage = getMassageAccounts();
  const missionctrl: ProductAccounts = {
    product: 'MissionCtrl',
    ok: aries.ok,
    note: 'Federated — no own user table; shares ARIES accounts via the mc_access cookie.',
    error: aries.ok ? undefined : aries.error,
    userCount: aries.userCount,
    accountCount: aries.accountCount,
    byProvider: aries.byProvider,
    recent: [],
  };
  return { generatedAt: new Date().toISOString(), products: [aries, missionctrl, massage] };
}

// ── Presentation ──────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function chips(byProvider: { provider: string; count: number }[]): string {
  if (!byProvider.length) return '<span class="muted">no linked accounts yet</span>';
  return byProvider
    .map((p) => `<span class="chip">${esc(p.provider)} <b>${p.count}</b></span>`)
    .join(' ');
}

function userTable(rows: AccountRow[]): string {
  if (!rows.length) return '';
  const body = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.email)}</td><td class="prov">${esc(r.provider)}</td><td class="when">${esc(r.joined)}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Email</th><th>Provider</th><th>Joined</th></tr></thead><tbody>${body}</tbody></table>`;
}

function loginTable(rows: LoginRow[]): string {
  if (!rows.length) return '';
  const body = rows
    .map(
      (r) =>
        `<tr><td class="when">${esc(r.when)}</td><td>${esc(r.app)}</td><td>${esc(r.method)}</td>` +
        `<td class="${r.status === 'success' ? 'ok' : 'bad'}">${esc(r.status)}</td></tr>`,
    )
    .join('');
  return `<div class="logins"><div class="lbl">Recent logins</div><table><thead><tr><th>When</th><th>App</th><th>Method</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function productCard(p: ProductAccounts): string {
  const counts = p.accountCount !== undefined
    ? `<b>${p.userCount}</b> users · <b>${p.accountCount}</b> linked accounts`
    : `<b>${p.userCount}</b> users`;
  const errBanner = p.error ? `<div class="err">⚠ ${esc(p.error)}</div>` : '';
  const note = p.note ? `<div class="note">${esc(p.note)}</div>` : '';
  return `<section class="card ${p.ok ? '' : 'down'}">
    <div class="head"><div class="name">${esc(p.product)}</div><div class="dot ${p.ok ? 'up' : 'off'}"></div></div>
    ${errBanner}
    <div class="counts">${counts}</div>
    <div class="chips">${chips(p.byProvider)}</div>
    ${note}
    ${userTable(p.recent)}
    ${p.recentLogins ? loginTable(p.recentLogins) : ''}
  </section>`;
}

export function accountsPageHtml(data: AccountsData): string {
  const cards = data.products.map(productCard).join('');
  const ts = new Date(data.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="mobile-web-app-capable" content="yes">
<title>Accounts — Mission Control</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080d12;color:#c9d1da;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:18px;max-width:900px;margin:0 auto}
  a.back{display:inline-block;color:#3d8fad;text-decoration:none;font-size:13px;margin-bottom:14px}
  a.back:active{color:#7fd1ff}
  h1{font-size:19px;font-weight:700;color:#7fd1ff;letter-spacing:.5px;margin-bottom:2px}
  .sub{font-size:11px;color:#3d5a6e;margin-bottom:18px;font-family:monospace}
  .card{background:#0e1824;border:1px solid #1a2b38;border-radius:12px;padding:16px;margin-bottom:12px}
  .card.down{border-color:#5a2030}
  .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .name{font-size:16px;font-weight:700;color:#e2e8f0}
  .dot{width:8px;height:8px;border-radius:50%}
  .dot.up{background:#22c55e}.dot.off{background:#ef4444}
  .counts{font-size:13px;color:#9fb3c2;margin-bottom:8px}
  .counts b{color:#e2e8f0}
  .chips{margin-bottom:8px;line-height:1.9}
  .chip{display:inline-block;background:#10263a;border:1px solid #1a3b52;color:#7fd1ff;border-radius:999px;padding:2px 10px;font-size:11px;font-family:monospace}
  .chip b{color:#bfe9ff}
  .muted{font-size:11px;color:#3d5a6e;font-style:italic}
  .note{font-size:11px;color:#6b8a9e;font-style:italic;margin:6px 0 4px;line-height:1.4}
  .err{font-size:12px;color:#f3a0a0;background:#2a1015;border:1px solid #5a2030;border-radius:8px;padding:6px 10px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
  th{text-align:left;color:#3d5a6e;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:4px 8px;border-bottom:1px solid #1a2b38}
  td{padding:5px 8px;border-bottom:1px solid #11202c;color:#aebfcc}
  td.prov,td.when{color:#5d7689;font-family:monospace;font-size:11px}
  td.ok{color:#22c55e}td.bad{color:#ef4444}
  .logins{margin-top:12px}.logins .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#3d5a6e;font-weight:600}
  footer{margin-top:18px;font-size:10px;color:#1e3040;text-align:center;font-family:monospace;line-height:1.6}
</style></head><body>
<a class="back" href="/">&#8592; ClaudeClaw</a>
<h1>&#128101; Accounts</h1>
<div class="sub">read-only · users per product · ${esc(ts)} ET</div>
${cards}
<footer>No secrets shown — email · provider · join date · login status only.<br>ARIES = Postgres · MissionCtrl federates ARIES · Massage = isolated SQLite.</footer>
</body></html>`;
}

/** Wire the Accounts page + JSON API onto the dashboard Hono app.
 *  Call once inside buildDashboardApp(). Inherits the app's global auth gate. */
export function registerAccounts(app: Hono): void {
  app.get('/accounts', async (c) => c.html(accountsPageHtml(await getAccountsData())));
  app.get('/api/accounts', async (c) => {
    try {
      return c.json(await getAccountsData());
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
