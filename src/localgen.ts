// Local FREE generation — spawns the diffusers CLI scripts in
// ~/01_ACTIVE/local-gen (no API key, no credits; runs on the local GPU). Images
// save to the gallery "Generated" section, videos to the "Free Video Maker"
// section, so both appear in /gallery automatically. The GPU is a single shared
// resource, so all local generations are serialized.
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME || '/home/itsju';
const LG = `${HOME}/01_ACTIVE/local-gen`;
const PY = `${LG}/.venv/bin/python`;

export interface LocalResult { ok: boolean; file?: string; url?: string; error?: string; }

let _busy = false;

function run(script: string, args: string[], saveRe: RegExp, urlFor: (file: string) => string, timeoutMs: number, readyMarker: string, label: string): Promise<LocalResult> {
  return new Promise((resolve) => {
    if (!fs.existsSync(PY)) return resolve({ ok: false, error: 'Local generator is not installed yet.' });
    if (!fs.existsSync(`${LG}/INSTALL_DONE`)) return resolve({ ok: false, error: 'Local generator is still installing dependencies — try again shortly.' });
    if (!fs.existsSync(readyMarker)) return resolve({ ok: false, error: `${label} model is still downloading (one-time, several GB) — try again in a few minutes.` });
    if (_busy) return resolve({ ok: false, error: 'A local generation is already running (GPU busy) — wait for it to finish.' });
    _busy = true;
    execFile(
      PY,
      [script, ...args],
      { cwd: LG, env: { ...process.env, HOME, HF_HUB_DISABLE_TELEMETRY: '1' }, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        _busy = false;
        const out = `${stdout || ''}\n${stderr || ''}`;
        const m = out.match(saveRe);
        if (m) {
          const file = path.basename(m[1].trim());
          return resolve({ ok: true, file, url: urlFor(file) });
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
  });
}

export function generateLocalImage(opts: { prompt: string; model?: string; steps?: number }): Promise<LocalResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) return Promise.resolve({ ok: false, error: 'Prompt is required.' });
  const model = opts.model === 'sd-turbo' ? 'sd-turbo' : 'sdxl-turbo';
  const steps = opts.steps && opts.steps > 0 ? Math.min(8, opts.steps) : 3;
  const args = ['--model', model, '--steps', String(steps), '--', prompt];
  return run(`${LG}/generate_image_local.py`, args, /Image saved to (.+)/, (f) => `/api/gallery/file?root=generated&sub=&name=${encodeURIComponent(f)}`, 600_000, `${LG}/SDXL_READY`, 'SDXL-Turbo image');
}

export function generateLocalVideo(opts: { prompt: string; frames?: number; steps?: number }): Promise<LocalResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) return Promise.resolve({ ok: false, error: 'Prompt is required.' });
  const frames = opts.frames && opts.frames > 0 ? Math.min(161, opts.frames) : 97;
  const steps = opts.steps && opts.steps > 0 ? Math.min(60, opts.steps) : 40;
  const args = ['--frames', String(frames), '--steps', String(steps), '--', prompt];
  return run(`${LG}/generate_video.py`, args, /Video saved to (.+)/, (f) => `/api/gallery/file?root=video&sub=&name=${encodeURIComponent(f)}`, 1_200_000, `${LG}/LTX_READY`, 'LTX-Video');
}
