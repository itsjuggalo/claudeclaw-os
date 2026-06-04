// genguard.ts — shared safety gate for every heavy GPU generation route.
//
// Any generation (ComfyUI, local SDXL-turbo, LTX video) — whether triggered
// from the dashboard, a phone over Tailscale, or a raw API call — must pass
// preflightGate() BEFORE it submits, so a remote trigger can never crash or
// overfill the laptop. This reuses the existing safety stack rather than
// rebuilding it:
//   • system-guardian preflight = the single source of truth for "is it safe
//     to start a heavy GPU job" (checks C: >= 20G, RAM >= 4G, VRAM <= 5G, and
//     the /tmp/heavy-gpu-job.lock one-job concurrency lock).
//   • ping_mike.py (Telegram) + the Discord pipeline-alerts webhook = the
//     existing alert channels Mike already watches.
import { execSync, spawn } from 'child_process';
import fs from 'fs';

const HOME = process.env.HOME || '/home/itsju';
const COMFY = 'http://127.0.0.1:8188';

export interface GateResult { ok: boolean; reason?: string; }

// Run `system-guardian preflight`. exit 0 => safe (reason carries the OK line);
// non-zero => blocked (reason carries why). Absolute path: PM2's env may not
// have ~/bin on PATH.
export function preflightGate(): GateResult {
  try {
    const out = execSync(`${HOME}/bin/system-guardian preflight 2>&1`, {
      stdio: 'pipe', timeout: 15_000,
    }).toString().trim();
    return { ok: true, reason: out.slice(0, 300) };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const out = (err.stdout?.toString() || err.stderr?.toString() || err.message || 'preflight failed').trim();
    // Keep the last few lines — that's where the BLOCKED/FAIL reason lives.
    return { ok: false, reason: out.split('\n').slice(-3).join(' ').replace(/\s+/g, ' ').slice(0, 300) };
  }
}

// Current ComfyUI queue depth (running + pending). Returns 0 if unreachable
// (a cold ComfyUI has nothing queued, so 0 is the safe default).
export async function comfyQueueDepth(): Promise<number> {
  try {
    const r = await fetch(`${COMFY}/queue`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return 0;
    const q = await r.json() as { queue_running?: unknown[]; queue_pending?: unknown[] };
    return (q.queue_running?.length || 0) + (q.queue_pending?.length || 0);
  } catch { return 0; }
}

// Flush ComfyUI VRAM after a generation (memory Hard Rule 2 — never leave the
// 8GB card pinned between gens). Best-effort; call from a finally.
export async function comfyFree(): Promise<void> {
  try {
    await fetch(`${COMFY}/free`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* best-effort flush */ }
}

// Notify Mike on BOTH channels (Telegram via ping_mike.py + Discord webhook).
// Non-blocking (detached spawn) so a generation route never stalls on a ping.
export function notify(msg: string): void {
  try {
    spawn('python3', [`${HOME}/scripts/ping_mike.py`, msg], { stdio: 'ignore', detached: true }).unref();
  } catch { /* ping_mike exits 1 if undelivered — non-fatal */ }
  try {
    const wf = `${HOME}/.openclaw/secrets/discord_pipeline_alerts_webhook`;
    if (fs.existsSync(wf)) {
      const webhook = fs.readFileSync(wf, 'utf8').trim();
      const body = JSON.stringify({ content: msg, username: 'GenGuard' });
      spawn('curl', ['-s', '-X', 'POST', webhook, '-H', 'Content-Type: application/json', '-d', body],
        { stdio: 'ignore', detached: true }).unref();
    }
  } catch { /* best-effort */ }
}
