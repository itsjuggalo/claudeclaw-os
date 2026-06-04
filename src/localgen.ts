// Local FREE generation — spawns the diffusers CLI scripts in
// ~/01_ACTIVE/local-gen (no API key, no credits; runs on the local GPU). Images
// save to the gallery "Generated" section, videos to the "Free Video Maker"
// section, so both appear in /gallery automatically. The GPU is a single shared
// resource, so all local generations are serialized.
//
// SAFETY: every local gen passes preflightGate() (C:/RAM/VRAM/one-job-lock)
// before running, and holds /tmp/heavy-gpu-job.lock for its duration so a
// concurrent ComfyUI submit (or system-guardian) sees one job at a time. LTX
// video additionally runs through run-video-safe.sh (gen-mode + cgroup ceiling)
// because it is the box-freeze vector on the 8GB GPU.
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { preflightGate } from './genguard.js';

const HOME = process.env.HOME || '/home/itsju';
const LG = `${HOME}/01_ACTIVE/local-gen`;
const PY = `${LG}/.venv/bin/python`;
const LOCK = '/tmp/heavy-gpu-job.lock';

export interface LocalResult { ok: boolean; file?: string; url?: string; error?: string; seed?: number; }

let _busy = false;

function run(cmd: string, cmdArgs: string[], saveRe: RegExp, urlFor: (file: string) => string, timeoutMs: number, readyMarker: string, label: string): Promise<LocalResult> {
  return new Promise((resolve) => {
    if (!fs.existsSync(PY)) return resolve({ ok: false, error: 'Local generator is not installed yet.' });
    if (!fs.existsSync(`${LG}/INSTALL_DONE`)) return resolve({ ok: false, error: 'Local generator is still installing dependencies — try again shortly.' });
    if (!fs.existsSync(readyMarker)) return resolve({ ok: false, error: `${label} model is still downloading (one-time, several GB) — try again in a few minutes.` });
    if (_busy) return resolve({ ok: false, error: 'A local generation is already running (GPU busy) — wait for it to finish.' });
    // ── Safety gate — refuse if C:/RAM/VRAM unsafe or another heavy GPU job
    //    holds the lock. Same gate ComfyUI uses, so phone triggers can't crash.
    const gate = preflightGate();
    if (!gate.ok) return resolve({ ok: false, error: `blocked: ${gate.reason}` });
    _busy = true;
    const child = execFile(
      cmd,
      cmdArgs,
      { cwd: LG, env: { ...process.env, HOME, HF_HUB_DISABLE_TELEMETRY: '1' }, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        _busy = false;
        try { fs.unlinkSync(LOCK); } catch { /* wrapper may have already removed it */ }
        const out = `${stdout || ''}\n${stderr || ''}`;
        const m = out.match(saveRe);
        if (m) {
          const file = path.basename(m[1].trim());
          const seedM = out.match(/Seed:\s*(\d+)/);
          const seed = seedM ? Number(seedM[1]) : undefined;
          return resolve({ ok: true, file, url: urlFor(file), seed });
        }
        let error = 'Local generation failed.';
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          error = 'Local generation timed out (first run also downloads the model — try again once it has).';
        } else if (/CUDA out of memory|OutOfMemoryError/i.test(out)) {
          error = 'GPU out of memory — free VRAM (e.g. close BlueStacks/WSA) and retry.';
        } else if (/CUDA not available/.test(out)) {
          error = 'GPU/CUDA not available for local generation.';
        } else {
          const e = out.match(/Error:\s*(.+)/) || out.match(/([A-Za-z]*Error:.*)/);
          if (e) error = e[1].trim().slice(0, 300);
          else if (err) error = String(err.message).slice(0, 300);
        }
        resolve({ ok: false, error });
      },
    );
    // One-job concurrency lock (PID of the child). system-guardian preflight and
    // a concurrent ComfyUI submit both honor this — so it's truly one job at a time.
    try { if (child.pid) fs.writeFileSync(LOCK, String(child.pid)); } catch { /* best-effort */ }
  });
}

export function generateLocalImage(opts: { prompt: string; model?: string; steps?: number; seed?: number }): Promise<LocalResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) return Promise.resolve({ ok: false, error: 'Prompt is required.' });
  const model = opts.model === 'sd-turbo' ? 'sd-turbo' : 'sdxl-turbo';
  const steps = opts.steps && opts.steps > 0 ? Math.min(8, opts.steps) : 3;
  const args = ['--model', model, '--steps', String(steps)];
  if (Number.isFinite(opts.seed as number)) args.push('--seed', String(opts.seed));
  args.push('--', prompt);
  // SDXL-turbo is light (sub-15s) — run python directly, but still preflight-gated + locked.
  return run(PY, [`${LG}/generate_image_local.py`, ...args], /Image saved to (.+)/, (f) => `/api/gallery/file?root=generated&sub=&name=${encodeURIComponent(f)}`, 600_000, `${LG}/SDXL_READY`, 'SDXL-Turbo image');
}

export function generateLocalVideo(opts: { prompt: string; frames?: number; steps?: number; seed?: number }): Promise<LocalResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) return Promise.resolve({ ok: false, error: 'Prompt is required.' });
  const frames = opts.frames && opts.frames > 0 ? Math.min(161, opts.frames) : 97;
  const steps = opts.steps && opts.steps > 0 ? Math.min(60, opts.steps) : 40;
  const args = ['--frames', String(frames), '--steps', String(steps)];
  if (Number.isFinite(opts.seed as number)) args.push('--seed', String(opts.seed));
  args.push('--', prompt);
  // LTX video → run-video-safe.sh: gen-mode (frees ~2G VRAM) + cgroup 9G ceiling
  // so it can't saturate the 8GB GPU and hard-freeze the laptop.
  return run(`${LG}/run-video-safe.sh`, args, /Video saved to (.+)/, (f) => `/api/gallery/file?root=video&sub=&name=${encodeURIComponent(f)}`, 1_200_000, `${LG}/LTX_READY`, 'LTX-Video');
}
