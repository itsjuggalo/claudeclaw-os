// Image generation — runs the local "banana-maker" Nano Banana (Gemini) skill
// as a subprocess and saves into its output/ dir, which is the gallery's
// "Generated" section (see src/gallery.ts), so new images appear in the Gallery
// automatically. We forward ClaudeClaw's own GOOGLE_API_KEY to the child so it
// works under systemd (the skill's ~/.env.shared is not present here).
import { execFile } from 'child_process';
import path from 'path';
import { GOOGLE_API_KEY } from './config.js';

const HOME = process.env.HOME || '/home/itsju';
const BM = `${HOME}/.claude/skills/banana-maker`;
const PY = `${BM}/venv/bin/python`;
const SCRIPT = `${BM}/generate_image.py`;

const MODELS = new Set(['flash', 'pro', 'grounded']);
const ARS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '1:4', '4:1', '1:8', '8:1']);
const SIZES = new Set(['512', '1K', '2K', '4K']);

// Single in-flight guard: each call spawns a Python+SDK process and spends API
// credits, so we serialize — reject a new request while one is still running.
let _busy = false;

export interface GenInput { prompt: string; model?: string; aspectRatio?: string; size?: string; }
export interface GenResult { ok: boolean; file?: string; url?: string; notes?: string; error?: string; }

export function generateImage(opts: GenInput): Promise<GenResult> {
  return new Promise((resolve) => {
    const prompt = (opts.prompt || '').trim();
    if (!prompt) return resolve({ ok: false, error: 'Prompt is required.' });
    if (prompt.length > 2000) return resolve({ ok: false, error: 'Prompt too long (max 2000 characters).' });
    if (!GOOGLE_API_KEY) return resolve({ ok: false, error: 'Server has no GOOGLE_API_KEY configured.' });

    const model = MODELS.has(opts.model || '') ? (opts.model as string) : 'flash';
    const aspectRatio = ARS.has(opts.aspectRatio || '') ? (opts.aspectRatio as string) : '1:1';
    let size = SIZES.has(opts.size || '') ? (opts.size as string) : '2K';
    if (size === '512' && model === 'pro') size = '1K'; // 512 is a Flash-only resolution

    if (_busy) return resolve({ ok: false, error: 'A generation is already running — wait for it to finish, then try again.' });
    _busy = true;

    // Args are passed as an array (no shell) → the prompt cannot inject commands.
    // The `--` terminator means a flag-like prompt (e.g. "--v2") is still parsed
    // as the positional prompt, never mistaken for an option.
    const args = [SCRIPT, '--model', model, '--aspect-ratio', aspectRatio, '--size', size, '--', prompt];

    execFile(
      PY,
      args,
      {
        cwd: BM,
        env: { ...process.env, HOME, GOOGLE_API_KEY, GEMINI_API_KEY: GOOGLE_API_KEY },
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        _busy = false;
        const out = `${stdout || ''}\n${stderr || ''}`;
        const saved = out.match(/Image saved to (.+?\.\w+)/);
        if (saved) {
          const file = path.basename(saved[1].trim());
          const notes = out.match(/Model notes:\s*([\s\S]+?)(?:\n[A-Z][a-z]+ |$)/)?.[1]?.trim();
          return resolve({
            ok: true,
            file,
            url: `/api/gallery/file?root=generated&sub=&name=${encodeURIComponent(file)}`,
            notes: notes || undefined,
          });
        }
        // Friendly mapping of the common failure modes.
        let error = 'Generation failed.';
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          error = 'Generation timed out (180s). Try Flash, or a simpler prompt.';
        } else if (/RESOURCE_EXHAUSTED|prepayment credits are depleted|\b429\b/.test(out)) {
          error = 'Gemini image credits are depleted — add billing/credits at AI Studio (ai.studio) to enable generation.';
        } else if (/Neither GOOGLE_API_KEY/.test(out)) {
          error = 'Server has no Gemini API key configured.';
        } else {
          const m = out.match(/Error:\s*(.+)/);
          if (m) error = m[1].trim().slice(0, 300);
          else if (err) error = String(err.message).slice(0, 300);
        }
        resolve({ ok: false, error });
      },
    );
  });
}
