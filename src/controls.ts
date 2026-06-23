/**
 * Master Control Panel registry — the single source of truth for every operator
 * toggle/action Mike can flip from his phone via the claudeclaw dashboard
 * (page: /control, API: /api/control/*). Declarative on purpose: adding a new
 * control = ONE entry in CONTROLS below (a status probe + an apply fn). The page
 * renders whatever is here, grouped by `group`, with danger-confirm where set.
 *
 * Safety: trading levers (killswitches) are real — they write/remove the exact
 * files the decision daemons check (KILLSWITCH.exists()). Resuming trading
 * (turning a killswitch OFF) is danger-gated so a stray tap can't un-halt the desk.
 */
import fs from 'fs';
import { spawn, execSync } from 'child_process';

const HOME = process.env.HOME || '/home/itsju';
const STATE = `${HOME}/.openclaw/workspace/state`;
const KEEP_AWAKE = `${STATE}/comfyui_keep_awake`;
const BOBA_KS = `${STATE}/boba_killswitch`;
const JAZZY_KS = `${STATE}/jazzy_killswitch`;

export type ControlKind = 'media' | 'trading' | 'service' | 'system';
/** Which direction of a control is destructive and must be confirmed. */
export type DangerWhen = 'on' | 'off' | 'always';

export interface ControlState {
  id: string;
  on: boolean;
  detail?: string;
}

export interface ControlMeta {
  id: string;
  label: string;
  group: string;
  kind: ControlKind;
  type: 'toggle' | 'action';
  description: string;
  dangerWhen?: DangerWhen;
  /** Button/confirm verb for the dangerous direction (e.g. "Resume Boba"). */
  dangerVerb?: string;
}

interface ControlDef extends ControlMeta {
  status: () => Promise<ControlState> | ControlState;
  /** toggle: `on` = desired state. action: called once with on=true. */
  apply: (on: boolean) => Promise<void> | void;
}

// ── helpers ────────────────────────────────────────────────────────────────
function fileExists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}
function touch(p: string): void {
  fs.writeFileSync(p, new Date().toISOString() + '\n');
}
function rm(p: string): void {
  try { fs.unlinkSync(p); } catch { /* already gone */ }
}

/** Read the ComfyUI pidfile as a validated integer (or null). Keeps untrusted
 *  file content out of any shell — we only ever pass it to process.kill(int). */
function comfyPid(): number | null {
  try {
    const n = parseInt(fs.readFileSync('/tmp/comfyui.pid', 'utf-8').trim(), 10);
    return Number.isInteger(n) && n > 1 ? n : null;
  } catch { return null; }
}
/** ComfyUI is "on" if its API answers on :8188 (falls back to a live pidfile). */
async function comfyUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch('http://127.0.0.1:8188/system_stats', { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) return true;
  } catch { /* not answering — try pidfile */ }
  const pid = comfyPid();
  if (pid) { try { process.kill(pid, 0); return true; } catch { /* dead */ } }
  return false;
}
function comfyStart(): void {
  // bash-launch so a missing execute bit can't EACCES; detached so it outlives us.
  const child = spawn('bash', [`${HOME}/bin/comfyui-start`], { detached: true, stdio: 'ignore' });
  child.unref();
}
function comfyStop(): void {
  const pid = comfyPid();
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  // Static patterns only — no interpolation reaches the shell.
  try { execSync("pkill -f '[Cc]omfy[Uu][Ii]/venv/bin/python.*main.py' 2>/dev/null || true"); } catch { /* ignore */ }
  try { execSync('rm -f /tmp/heavy-gpu-job.lock 2>/dev/null || true'); } catch { /* ignore */ }
}

// ── the registry ─────────────────────────────────────────────────────────────
// To add a control: append one entry. `status` probes live state; `apply`
// effects the change. Set dangerWhen+dangerVerb for anything that needs a
// confirm tap. Keep trading-affecting controls grouped under "Trading Safety".
const CONTROLS: ControlDef[] = [
  {
    id: 'comfyui',
    label: 'ComfyUI — image/video gens',
    group: 'Media & GPU',
    kind: 'media',
    type: 'toggle',
    description: 'Local ComfyUI server on :8188. Off frees ~4–8 GB of GPU/RAM.',
    status: async () => {
      const on = await comfyUp();
      return { id: 'comfyui', on, detail: on ? 'running :8188' : 'stopped' };
    },
    apply: (on) => { if (on) comfyStart(); else comfyStop(); },
  },
  {
    id: 'comfyui-keep-awake',
    label: 'Keep ComfyUI awake',
    group: 'Media & GPU',
    kind: 'media',
    type: 'toggle',
    description: 'Disable the 30-min idle auto-stop so gens stay ready while you work remotely.',
    status: () => {
      const on = fileExists(KEEP_AWAKE);
      return { id: 'comfyui-keep-awake', on, detail: on ? 'auto-stop OFF' : 'auto-stops after 30m idle' };
    },
    apply: (on) => { if (on) touch(KEEP_AWAKE); else rm(KEEP_AWAKE); },
  },
  {
    id: 'boba-killswitch',
    label: 'Boba — trading',
    group: 'Trading Safety',
    kind: 'trading',
    type: 'toggle',
    description: 'ON = freeze every Boba decision cycle & order. OFF = resume live (paper) trading.',
    // Toggle ON = "trading enabled" = removing the killswitch = the DANGEROUS
    // direction (un-halting the desk), so confirm-gate dir 'on'. Halting (toggle
    // OFF) is protective and needs no confirm.
    dangerWhen: 'on',
    dangerVerb: 'Resume Boba trading',
    status: () => {
      const halted = fileExists(BOBA_KS);
      // UI semantics: toggle ON = "trading enabled". Halted = killswitch present.
      return { id: 'boba-killswitch', on: !halted, detail: halted ? '🔴 HALTED' : 'trading enabled' };
    },
    // on=true → resume (remove killswitch, DANGER). on=false → halt (write killswitch).
    apply: (on) => { if (on) rm(BOBA_KS); else touch(BOBA_KS); },
  },
  {
    id: 'jazzy-killswitch',
    label: 'Jazzy — trading',
    group: 'Trading Safety',
    kind: 'trading',
    type: 'toggle',
    description: 'ON = freeze every Jazzy decision cycle & order. OFF = resume live (paper) trading.',
    dangerWhen: 'on',
    dangerVerb: 'Resume Jazzy trading',
    status: () => {
      const halted = fileExists(JAZZY_KS);
      return { id: 'jazzy-killswitch', on: !halted, detail: halted ? '🔴 HALTED' : 'trading enabled' };
    },
    apply: (on) => { if (on) rm(JAZZY_KS); else touch(JAZZY_KS); },
  },
  {
    id: 'halt-all',
    label: 'HALT ALL TRADING',
    group: 'Trading Safety',
    kind: 'trading',
    type: 'action',
    description: 'Panic button — sets both Boba & Jazzy killswitches at once.',
    dangerWhen: 'always',
    dangerVerb: 'Halt everything now',
    status: () => {
      const on = fileExists(BOBA_KS) && fileExists(JAZZY_KS);
      return { id: 'halt-all', on, detail: on ? 'all desks halted' : '' };
    },
    apply: () => { touch(BOBA_KS); touch(JAZZY_KS); },
  },
];

// ── public surface (imported by dashboard.ts) ────────────────────────────────

/** Meta + live state, merged — one round-trip for the page to render everything. */
export async function readControlPanel(): Promise<(ControlMeta & ControlState)[]> {
  return Promise.all(
    CONTROLS.map(async ({ status, apply: _apply, ...meta }) => {
      try {
        const st = await status();
        return { ...meta, ...st };
      } catch {
        return { ...meta, id: meta.id, on: false, detail: 'status error' };
      }
    }),
  );
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  /** When confirm is required, the verb to show on the confirm button. */
  confirmVerb?: string;
  state?: ControlMeta & ControlState;
}

export async function applyControl(id: string, on: boolean, confirm: boolean): Promise<ApplyResult> {
  const c = CONTROLS.find((x) => x.id === id);
  if (!c) return { ok: false, error: 'unknown control' };

  const dir: 'on' | 'off' = c.type === 'action' ? 'on' : (on ? 'on' : 'off');
  const needsConfirm = c.dangerWhen === 'always' || c.dangerWhen === dir;
  if (needsConfirm && !confirm) {
    return { ok: false, error: 'confirm required', confirmVerb: c.dangerVerb || 'Confirm' };
  }

  await c.apply(on);
  const { status, apply: _a, ...meta } = c;
  const st = await status();
  return { ok: true, state: { ...meta, ...st } };
}
