// Hermes Agent data layer — reads ~/.hermes/ state files directly.
// No subprocess calls at read time; restart/send use execSync at POST time.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const HOME = os.homedir();
const HERMES_HOME = path.join(HOME, '.hermes');
const HERMES_BIN = path.join(HOME, '.venv/bin/hermes');

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

export interface HermesData {
  gateway: HermesGatewayStatus;
  sessions: HermesSession[];
  skills: HermesSkill[];
  crons: HermesCron[];
  recent_logs: string[];
  model: string;
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

// ── Gateway status ───────────────────────────────────────────────────────────

export function getHermesGatewayStatus(): HermesGatewayStatus {
  const stateFile = path.join(HERMES_HOME, 'gateway_state.json');
  const raw = readJson<any>(stateFile, null);
  if (!raw || raw.gateway_state !== 'running') {
    return { running: false, pid: null, gateway_state: 'stopped', platforms: {}, active_agents: 0, start_time: null, uptime_secs: null };
  }
  // Verify PID still alive
  let alive = false;
  try { process.kill(raw.pid, 0); alive = true; } catch { /* not alive */ }
  // start_time is in jiffies (clock ticks at 100 Hz on Linux)
  const uptimeSecs = raw.start_time ? Math.max(0, Math.floor(os.uptime() - raw.start_time / 100)) : null;
  return {
    running: alive,
    pid: raw.pid,
    gateway_state: alive ? 'running' : 'stopped',
    platforms: raw.platforms || {},
    active_agents: raw.active_agents || 0,
    start_time: raw.start_time || null,
    uptime_secs: uptimeSecs,
  };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function getHermesSessions(): HermesSession[] {
  const sessFile = path.join(HERMES_HOME, 'sessions', 'sessions.json');
  const raw = readJson<Record<string, any>>(sessFile, {});
  return Object.values(raw).map((s: any) => ({
    session_key: s.session_key || '',
    session_id: s.session_id || '',
    display_name: s.display_name || s.origin?.chat_name || 'Unknown',
    platform: s.platform || 'unknown',
    chat_type: s.chat_type || 'dm',
    updated_at: s.updated_at || '',
    estimated_cost_usd: s.estimated_cost_usd || 0,
    suspended: !!s.suspended,
  }));
}

// ── Skills ───────────────────────────────────────────────────────────────────

export function getHermesSkills(): HermesSkill[] {
  const skillsDir = path.join(HERMES_HOME, 'skills');
  const skills: HermesSkill[] = [];

  const walkDir = (dir: string, source: string, category = '') => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const skillMd = path.join(full, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
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
          // recurse one level for category dirs
          walkDir(full, source, e.name);
        }
      }
    }
  };

  walkDir(skillsDir, 'local');
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Crons ────────────────────────────────────────────────────────────────────

export function getHermesCrons(): HermesCron[] {
  const cronDir = path.join(HERMES_HOME, 'cron');
  const crons: HermesCron[] = [];
  try {
    for (const f of fs.readdirSync(cronDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(cronDir, f), 'utf8'));
        crons.push({
          name: raw.name || f.replace('.json', ''),
          schedule: raw.schedule || '',
          prompt: raw.prompt || '',
          enabled: raw.enabled !== false,
        });
      } catch { /* skip */ }
    }
  } catch { /* empty */ }
  return crons;
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export function getHermesLogs(n = 40): string[] {
  return readLastLines(path.join(HERMES_HOME, 'logs', 'gateway.log'), n);
}

// ── Config model ─────────────────────────────────────────────────────────────

export function getHermesModel(): string {
  try {
    const raw = fs.readFileSync(path.join(HERMES_HOME, 'config.yaml'), 'utf8');
    const m = raw.match(/^\s*default:\s*(.+)$/m);
    return m ? m[1].trim() : 'unknown';
  } catch { return 'unknown'; }
}

// ── Combined payload ─────────────────────────────────────────────────────────

export function getHermesData(): HermesData {
  return {
    gateway: getHermesGatewayStatus(),
    sessions: getHermesSessions(),
    skills: getHermesSkills(),
    crons: getHermesCrons(),
    recent_logs: getHermesLogs(40),
    model: getHermesModel(),
    config_ok: fs.existsSync(path.join(HERMES_HOME, 'config.yaml')),
  };
}

// ── Actions (called from POST endpoints) ─────────────────────────────────────

export function hermesRestartGateway(): { ok: boolean; message: string } {
  try {
    execSync('pm2 restart hermes-gateway', { timeout: 10_000 });
    return { ok: true, message: 'Gateway restart queued via PM2' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export function hermesSend(chatId: string, message: string): { ok: boolean; message: string } {
  try {
    const safeMsg = message.replace(/'/g, "'\\''");
    execSync(`${HERMES_BIN} send --to telegram:${chatId} '${safeMsg}'`, {
      timeout: 15_000,
      env: { ...process.env, PATH: `/home/${os.userInfo().username}/.venv/bin:${process.env.PATH}` },
    });
    return { ok: true, message: 'sent' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
