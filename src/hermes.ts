// Hermes Agent data layer — reads the live WSL Hermes workspace (~/.hermes) directly.
// Source of truth is the running v0.16.0 gateway (grok-4/xai-oauth, Telegram + trading crons).
// Reads are file/SQLite only; send/restart/oneshot shell out at POST time (allowlisted actions).
//
// Home + binary are env-configurable so the page can be pointed at a different Hermes
// workspace without a code change (default = the live install):
//   CLAUDECLAW_HERMES_HOME / HERMES_HOME  → workspace dir (default ~/.hermes)
//   HERMES_BIN                            → hermes CLI (default ~/.venv-hermes/bin/hermes)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import Database from 'better-sqlite3';

const HOME = os.homedir();
const HERMES_HOME =
  process.env.CLAUDECLAW_HERMES_HOME || process.env.HERMES_HOME || path.join(HOME, '.hermes');
// The RUNNING gateway uses ~/.venv-hermes (v0.16.0); ~/.venv/bin/hermes is a dead v0.15.1 build.
const HERMES_BIN = process.env.HERMES_BIN || path.join(HOME, '.venv-hermes/bin/hermes');
const HERMES_BIN_DIR = path.dirname(HERMES_BIN);

// ── Types ────────────────────────────────────────────────────────────────────

export interface HermesGatewayStatus {
  running: boolean;
  pid: number | null;
  gateway_state: string;
  platforms: Record<string, { state: string; error_message: string | null }>;
  active_agents: number;
  start_time: number | null;
  uptime_secs: number | null;
}

export interface HermesSession {
  session_key: string;
  session_id: string;
  display_name: string;
  platform: string;
  chat_type: string;
  updated_at: string;
  estimated_cost_usd: number;
  suspended: boolean;
  model: string;
  message_count: number;
  tool_call_count: number;
}

export interface HermesSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  path: string;
}

export interface HermesCron {
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
}

export interface HermesToolset {
  name: string;
  enabled: boolean;
  scope: string; // 'default' | platform name
}

export interface HermesConfigRedacted {
  model: string;
  provider: string;
  fallback: string[];
  toolsets: string[];
  web_search: string;
  cwd: string;
  version: string;
  home: string;
}

export interface HermesData {
  gateway: HermesGatewayStatus;
  sessions: HermesSession[];
  skills: HermesSkill[];
  skills_raw_count: number;
  crons: HermesCron[];
  toolsets: HermesToolset[];
  recent_logs: string[];
  model: string;
  provider: string;
  version: string;
  config: HermesConfigRedacted;
  config_ok: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; }
  catch { return fallback; }
}

function readLastLines(p: string, n: number): string[] {
  try {
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch { return []; }
}

function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (key && val) out[key] = val;
  }
  return out;
}

// Category/skill dirs the curated view hides: archives, downloads, backups, junk.
function isHiddenSkillDir(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.') || /^__MN_BACKUP/i.test(name) ||
    name === 'node_modules';
}

let _cfgCache: { at: number; cfg: Record<string, any> | null } = { at: 0, cfg: null };
function readConfig(): Record<string, any> | null {
  const now = Date.now();
  if (_cfgCache.cfg && now - _cfgCache.at < 15_000) return _cfgCache.cfg;
  try {
    const raw = fs.readFileSync(path.join(HERMES_HOME, 'config.yaml'), 'utf8');
    const cfg = yaml.load(raw) as Record<string, any>;
    _cfgCache = { at: now, cfg };
    return cfg;
  } catch { return null; }
}

function hermesEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${HERMES_BIN_DIR}:${process.env.PATH || ''}` };
}

// ── Gateway status ───────────────────────────────────────────────────────────

// Real process uptime from /proc/<pid>/stat field 22 (starttime, in clock ticks
// since boot). The start_time in gateway_state.json is NOT usable for this.
function procUptimeSecs(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 2 (comm) may contain spaces/parens — split on the last ')'.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    // After comm, index 0 = state (field 3); starttime is field 22 → index 19.
    const starttimeTicks = Number(rest[19]);
    if (!Number.isFinite(starttimeTicks)) return null;
    const clkTck = 100; // Linux USER_HZ (getconf CLK_TCK) is 100 on this kernel
    return Math.max(0, Math.floor(os.uptime() - starttimeTicks / clkTck));
  } catch { return null; }
}

export function getHermesGatewayStatus(): HermesGatewayStatus {
  const stateFile = path.join(HERMES_HOME, 'gateway_state.json');
  const raw = readJson<any>(stateFile, null);
  if (!raw || raw.gateway_state !== 'running') {
    return { running: false, pid: null, gateway_state: 'stopped', platforms: {}, active_agents: 0, start_time: null, uptime_secs: null };
  }
  let alive = false;
  try { process.kill(raw.pid, 0); alive = true; } catch { /* not alive */ }
  return {
    running: alive,
    pid: raw.pid,
    gateway_state: alive ? 'running' : 'stopped',
    platforms: raw.platforms || {},
    active_agents: raw.active_agents || 0,
    start_time: raw.start_time || null,
    uptime_secs: alive ? procUptimeSecs(raw.pid) : null,
  };
}

// ── Sessions (canonical store = state.db) ────────────────────────────────────

export function getHermesSessions(limit = 25): HermesSession[] {
  const dbPath = path.join(HERMES_HOME, 'state.db');
  if (fs.existsSync(dbPath)) {
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const rows = db.prepare(
        `SELECT id, source, user_id, model, title, message_count, tool_call_count,
                estimated_cost_usd, started_at, ended_at
           FROM sessions
          WHERE COALESCE(archived, 0) = 0
          ORDER BY started_at DESC
          LIMIT ?`
      ).all(limit) as any[];
      return rows.map((r) => ({
        session_key: r.id || '',
        session_id: r.id || '',
        display_name: r.title || r.id || 'session',
        platform: r.source || 'unknown',
        chat_type: r.user_id ? 'dm' : (r.source || ''),
        updated_at: r.ended_at || r.started_at
          ? new Date((r.ended_at || r.started_at) * 1000).toISOString()
          : '',
        estimated_cost_usd: Number(r.estimated_cost_usd) || 0,
        suspended: !r.ended_at,
        model: r.model || '',
        message_count: r.message_count || 0,
        tool_call_count: r.tool_call_count || 0,
      }));
    } catch {
      /* fall through to sessions.json (state.db may be WAL-locked) */
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }
  }
  // Fallback: gateway routing snapshot.
  const sessFile = path.join(HERMES_HOME, 'sessions', 'sessions.json');
  const raw = readJson<Record<string, any>>(sessFile, {});
  return Object.values(raw).slice(0, limit).map((s: any) => ({
    session_key: s.session_key || '',
    session_id: s.session_id || '',
    display_name: s.display_name || s.origin?.chat_name || 'Unknown',
    platform: s.platform || 'unknown',
    chat_type: s.chat_type || 'dm',
    updated_at: s.updated_at || '',
    estimated_cost_usd: s.estimated_cost_usd || 0,
    suspended: !!s.suspended,
    model: s.model || '',
    message_count: 0,
    tool_call_count: 0,
  }));
}

// ── Skills (curated: base skills only, deduped) ──────────────────────────────

export function getHermesSkills(): { skills: HermesSkill[]; rawCount: number } {
  const skillsDir = path.join(HERMES_HOME, 'skills');
  const skills: HermesSkill[] = [];
  let rawCount = 0;

  const walkDir = (dir: string, source: string, category = '', hidden = false) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const skillMd = path.join(full, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        rawCount++;
        if (hidden) continue; // counts toward raw, excluded from curated view
        try {
          const content = fs.readFileSync(skillMd, 'utf8');
          const fm = parseFrontmatter(content);
          skills.push({
            name: fm.name || e.name,
            description: fm.description || '',
            category: fm.category || category || source,
            source,
            path: full,
          });
        } catch { /* skip */ }
      } else {
        // Category dir — recurse one level, marking archive/backup/junk as hidden.
        walkDir(full, source, e.name, hidden || isHiddenSkillDir(e.name));
      }
    }
  };

  walkDir(skillsDir, 'local');

  // Dedupe by name (keep first seen after sort for stability).
  const seen = new Set<string>();
  const deduped = skills
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));

  return { skills: deduped, rawCount };
}

// ── Crons (READ-ONLY — live trading jobs, no UI controls) ────────────────────

export function getHermesCrons(): HermesCron[] {
  const cronDir = path.join(HERMES_HOME, 'cron');
  const crons: HermesCron[] = [];
  try {
    for (const f of fs.readdirSync(cronDir)) {
      if (!f.endsWith('.json')) continue;
      let parsed: any;
      try { parsed = JSON.parse(fs.readFileSync(path.join(cronDir, f), 'utf8')); }
      catch { continue; }
      // jobs.json wraps the jobs in a `.jobs` array; a file may also be a bare
      // array or a single job object.
      const jobs = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.jobs)
          ? parsed.jobs
          : parsed && typeof parsed === 'object' && (parsed.schedule || parsed.name)
            ? [parsed]
            : [];
      for (const raw of jobs as any[]) {
        if (!raw || typeof raw !== 'object') continue;
        // schedule is an object {kind, expr, display} on newer Hermes, or a string.
        const sched = raw.schedule && typeof raw.schedule === 'object'
          ? (raw.schedule.display || raw.schedule.expr || '')
          : (raw.schedule || raw.cron || '');
        crons.push({
          name: raw.name || raw.id || f.replace('.json', ''),
          schedule: String(sched),
          prompt: raw.prompt || raw.message || '',
          enabled: raw.enabled !== false && raw.state !== 'paused' && !raw.paused_at,
        });
      }
    }
  } catch { /* empty */ }
  return crons;
}

// ── Toolsets ─────────────────────────────────────────────────────────────────

export function getHermesToolsets(): HermesToolset[] {
  const cfg = readConfig();
  const out: HermesToolset[] = [];
  if (!cfg) return out;
  const seen = new Set<string>();
  const base = Array.isArray(cfg.toolsets) ? cfg.toolsets : [];
  for (const t of base) {
    const name = String(t);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, enabled: true, scope: 'default' });
  }
  const pt = cfg.platform_toolsets && typeof cfg.platform_toolsets === 'object' ? cfg.platform_toolsets : {};
  for (const [platform, list] of Object.entries(pt)) {
    for (const t of (Array.isArray(list) ? list : [])) {
      const name = String(t);
      if (seen.has(name)) continue; // already covered by default/another platform
      seen.add(name);
      out.push({ name, enabled: true, scope: platform });
    }
  }
  return out;
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export function getHermesLogs(n = 40): string[] {
  return readLastLines(path.join(HERMES_HOME, 'logs', 'gateway.log'), n);
}

// ── Model / provider / version ───────────────────────────────────────────────

export function getHermesModel(): { model: string; provider: string } {
  const cfg = readConfig();
  const model = cfg?.model?.default ? String(cfg.model.default) : 'unknown';
  const provider = cfg?.model?.provider ? String(cfg.model.provider) : 'unknown';
  return { model, provider };
}

let _verCache: { at: number; ver: string } = { at: 0, ver: '' };
export function getHermesVersion(): string {
  const now = Date.now();
  if (_verCache.ver && now - _verCache.at < 300_000) return _verCache.ver;
  try {
    const out = execFileSync(HERMES_BIN, ['version'], { timeout: 5_000, env: hermesEnv() }).toString();
    const m = out.match(/v(\d+\.\d+\.\d+)/);
    _verCache = { at: now, ver: m ? m[1] : '' };
    return _verCache.ver;
  } catch { return _verCache.ver || ''; }
}

// ── Redacted config (allowlist only — NEVER emit secrets) ────────────────────

export function getHermesConfigRedacted(): HermesConfigRedacted {
  const cfg = readConfig() || {};
  const fallbackRaw = cfg.fallback_providers;
  const fallback: string[] = Array.isArray(fallbackRaw)
    ? fallbackRaw.map((f: any) =>
        typeof f === 'string' ? f : [f?.provider, f?.model].filter(Boolean).join('/'))
        .filter(Boolean)
    : [];
  const web = cfg.web && typeof cfg.web === 'object' ? cfg.web : {};
  return {
    model: cfg.model?.default ? String(cfg.model.default) : 'unknown',
    provider: cfg.model?.provider ? String(cfg.model.provider) : 'unknown',
    fallback,
    toolsets: Array.isArray(cfg.toolsets) ? cfg.toolsets.map(String) : [],
    web_search: String(web.search_backend || web.backend || web.provider || 'n/a'),
    cwd: cfg.terminal?.cwd ? String(cfg.terminal.cwd) : '',
    version: getHermesVersion(),
    home: HERMES_HOME,
  };
}

// ── Status (thin) ────────────────────────────────────────────────────────────

export function getHermesStatus() {
  const gw = getHermesGatewayStatus();
  const { model, provider } = getHermesModel();
  return {
    gateway: gw,
    model,
    provider,
    version: getHermesVersion(),
    home: HERMES_HOME,
    bin: HERMES_BIN,
  };
}

// ── Combined payload ─────────────────────────────────────────────────────────

export function getHermesData(): HermesData {
  const { skills, rawCount } = getHermesSkills();
  const { model, provider } = getHermesModel();
  return {
    gateway: getHermesGatewayStatus(),
    sessions: getHermesSessions(),
    skills,
    skills_raw_count: rawCount,
    crons: getHermesCrons(),
    toolsets: getHermesToolsets(),
    recent_logs: getHermesLogs(40),
    model,
    provider,
    version: getHermesVersion(),
    config: getHermesConfigRedacted(),
    config_ok: fs.existsSync(path.join(HERMES_HOME, 'config.yaml')),
  };
}

// ── Actions (called from POST endpoints — allowlisted) ───────────────────────

export function hermesRestartGateway(): { ok: boolean; message: string } {
  try {
    // hermes-gateway is a PM2-managed process (PM2 God Daemon owns PID).
    execFileSync('pm2', ['restart', 'hermes-gateway'], { timeout: 10_000, env: hermesEnv() });
    return { ok: true, message: 'Gateway restart queued via PM2' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export function hermesSend(chatId: string, message: string): { ok: boolean; message: string } {
  // Telegram chat ids are numeric (may be negative for groups). Reject anything else
  // so the target arg can never smuggle extra flags/values.
  if (!/^-?\d+$/.test(chatId)) return { ok: false, message: 'invalid chat id' };
  if (!message.trim()) return { ok: false, message: 'empty message' };
  try {
    // execFileSync with an argument array → no shell, no injection surface.
    execFileSync(HERMES_BIN, ['send', '--to', `telegram:${chatId}`, message], {
      timeout: 15_000,
      env: hermesEnv(),
    });
    return { ok: true, message: 'sent' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export function hermesOneshot(prompt: string): { ok: boolean; output: string; message: string } {
  if (!prompt.trim()) return { ok: false, output: '', message: 'empty prompt' };
  try {
    const out = execFileSync(HERMES_BIN, ['-z', prompt], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: hermesEnv(),
    }).toString();
    return { ok: true, output: out.trim(), message: 'ok' };
  } catch (e: any) {
    // execFileSync throws on non-zero/timeout; surface any partial stdout.
    const partial = (e?.stdout ? e.stdout.toString() : '').trim();
    return { ok: false, output: partial, message: e?.killed ? 'timed out (60s)' : String(e?.message || e) };
  }
}
