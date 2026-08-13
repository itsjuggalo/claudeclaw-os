// Local FREE generation — spawns the diffusers CLI scripts in
// ~/01_ACTIVE/local-gen (no API key, no credits; runs on the local GPU). Images
// save to the gallery "Generated" section, videos to the "Free Video Maker"
// section, so both appear in /gallery automatically. The GPU is a single shared
// resource, so all local generations are serialized.
//
// SAFETY: every local gen passes preflightGate() (C:/RAM/VRAM/one-job-lock)
// before running. The python scripts then acquire /tmp/heavy-gpu-job.lock via
// gpu_safety.guard() (writes their own pid, checks for OTHER live jobs, releases
// on exit/SIGTERM) — so they, not this wrapper, own the lock. The wrapper must
// NOT pre-write the lock: doing so makes system-guardian see the python child's
// own pid as a foreign "heavy GPU job" and the gen blocks itself. LTX video
// additionally runs through run-video-safe.sh (gen-mode + cgroup ceiling)
// because it is the box-freeze vector on the 8GB GPU.
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { preflightGate } from './genguard.js';
import { applyGenRules } from './genrules.js';

const HOME = process.env.HOME || '/home/itsju';
const LG = `${HOME}/01_ACTIVE/local-gen`;
const PY = `${LG}/.venv/bin/python`;

export interface LocalResult { ok: boolean; file?: string; url?: string; error?: string; seed?: number; }

let _busy = false;

async function run(cmd: string, cmdArgs: string[], saveRe: RegExp, urlFor: (file: string) => string, timeoutMs: number, readyMarker: string, label: string): Promise<LocalResult> {
  if (!fs.existsSync(PY)) return { ok: false, error: 'Local generator is not installed yet.' };
  if (!fs.existsSync(`${LG}/INSTALL_DONE`)) return { ok: false, error: 'Local generator is still installing dependencies — try again shortly.' };
  if (!fs.existsSync(readyMarker)) return { ok: false, error: `${label} model is still downloading (one-time, several GB) — try again in a few minutes.` };
  if (_busy) return { ok: false, error: 'A local generation is already running (GPU busy) — wait for it to finish.' };
  // ── Safety gate — refuse if C:/RAM/VRAM unsafe or another heavy GPU job
  //    holds the lock. Same gate ComfyUI uses, so phone triggers can't crash.
  const gate = await preflightGate();
  if (!gate.ok) return { ok: false, error: `blocked: ${gate.reason}` };
  _busy = true;
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      cmdArgs,
      { cwd: LG, env: { ...process.env, HOME, HF_HUB_DISABLE_TELEMETRY: '1' }, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        _busy = false;
        // NOTE: the lock is owned + released by the python gpu_safety.guard().
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
    void child;  // lock acquisition happens inside the python gpu_safety.guard()
  });
}

export function generateLocalImage(opts: { prompt: string; model?: string; steps?: number; seed?: number }): Promise<LocalResult> {
  const raw = (opts.prompt || '').trim();
  if (!raw) return Promise.resolve({ ok: false, error: 'Prompt is required.' });
  const prompt = applyGenRules({ prompt: raw, kind: 'image', hasLora: false }).prompt;
  const model = opts.model === 'sd-turbo' ? 'sd-turbo' : 'sdxl-turbo';
  const steps = opts.steps && opts.steps > 0 ? Math.min(8, opts.steps) : 3;
  const args = ['--model', model, '--steps', String(steps)];
  if (Number.isFinite(opts.seed as number)) args.push('--seed', String(opts.seed));
  args.push('--', prompt);
  // SDXL-turbo is light (sub-15s) — run python directly, but still preflight-gated + locked.
  return run(PY, [`${LG}/generate_image_local.py`, ...args], /Image saved to (.+)/, (f) => `/api/gallery/file?root=generated&sub=&name=${encodeURIComponent(f)}`, 600_000, `${LG}/SDXL_READY`, 'SDXL-Turbo image');
}

export function generateLocalVideo(opts: { prompt: string; frames?: number; steps?: number; seed?: number }): Promise<LocalResult> {
  const raw = (opts.prompt || '').trim();
  if (!raw) return Promise.resolve({ ok: false, error: 'Prompt is required.' });
  // Rule 3: strip camera/tripod tokens from motion prompts (they render the object).
  const prompt = applyGenRules({ prompt: raw, kind: 'video', hasLora: false }).prompt;
  const frames = opts.frames && opts.frames > 0 ? Math.min(161, opts.frames) : 97;
  const steps = opts.steps && opts.steps > 0 ? Math.min(60, opts.steps) : 40;
  const args = ['--frames', String(frames), '--steps', String(steps)];
  if (Number.isFinite(opts.seed as number)) args.push('--seed', String(opts.seed));
  args.push('--', prompt);
  // LTX video → run-video-safe.sh: gen-mode (frees ~2G VRAM) + cgroup 14G ceiling
  // so it can't saturate the 8GB GPU and hard-freeze the laptop. generate_video.py
  // encodes the prompt with T5 on CPU then frees it (~9.5G) before loading the
  // transformer, so peak RAM fits the cgroup (the 2026-06-14 LTX OOM fix).
  return run(`${LG}/run-video-safe.sh`, args, /Video saved to (.+)/, (f) => `/api/gallery/file?root=video&sub=&name=${encodeURIComponent(f)}`, 1_200_000, `${LG}/LTX_READY`, 'LTX-Video');
}

// Keyframe drift-free video (DaForge no-drift method): pin the clip to a locked
// keyframe and let LTX add ONLY motion on top — so a trained character stays
// on-model for the whole clip instead of melting. One keyframe = subtle i2v; a
// second (end) keyframe = first-last-frame interpolation (front+side → fill).
// Reuses the SAME LTX weights as t2v (no new download) and the SAME 14G cgroup
// guard (run-keyframe-safe.sh), so it's exactly as crash-safe as the t2v path.
export function generateKeyframeVideo(opts: {
  initImage: string; endImage?: string; prompt?: string;
  frames?: number; steps?: number; seed?: number;
}): Promise<LocalResult> {
  if (!opts.initImage || !fs.existsSync(opts.initImage)) {
    return Promise.resolve({ ok: false, error: 'Keyframe image not found.' });
  }
  if (opts.endImage && !fs.existsSync(opts.endImage)) {
    return Promise.resolve({ ok: false, error: 'End keyframe not found.' });
  }
  // The keyframe sets the scene; the prompt describes only motion. Strip camera/
  // tripod tokens (Rule 3) so the model doesn't render the object into the clip.
  const raw = (opts.prompt || 'subtle natural motion: a slow breath, a blink, a small head turn').trim();
  const prompt = applyGenRules({ prompt: raw, kind: 'video', hasLora: false }).prompt;
  const frames = opts.frames && opts.frames > 0 ? Math.min(161, opts.frames) : 97;
  const steps = opts.steps && opts.steps > 0 ? Math.min(60, opts.steps) : 40;
  const args = ['--init-image', opts.initImage];
  if (opts.endImage) args.push('--end-image', opts.endImage);
  args.push('--frames', String(frames), '--steps', String(steps));
  if (Number.isFinite(opts.seed as number)) args.push('--seed', String(opts.seed));
  args.push('--', prompt);
  return run(`${LG}/run-keyframe-safe.sh`, args, /Video saved to (.+)/, (f) => `/api/gallery/file?root=video&sub=&name=${encodeURIComponent(f)}`, 1_200_000, `${LG}/LTX_READY`, 'Keyframe video');
}
