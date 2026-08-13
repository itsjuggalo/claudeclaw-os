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

export interface GenInput { prompt: string; model?: string; aspectRatio?: string; size?: string; references?: string[]; }
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
    // Reference images (img2img / "edit my photo") are passed as repeated
    // --reference flags BEFORE the `--` terminator (the skill supports up to 14).
    const refArgs = (opts.references || [])
      .filter((r) => typeof r === 'string' && r.trim())
      .slice(0, 14)
      .flatMap((r) => ['--reference', r]);
    const args = [SCRIPT, '--model', model, '--aspect-ratio', aspectRatio, '--size', size, ...refArgs, '--', prompt];

    execFile(
      PY,
      args,
      {
        cwd: BM,
        env: { ...process.env, HOME, GOOGLE_API_KEY, GEMINI_API_KEY: GOOGLE_API_KEY },
        // 240s: Nano Banana Pro with a reference image (img2img edits) + thinking
        // mode runs ~145s at 1K and can exceed 180s — give real headroom so a slow
        // cloud round-trip doesn't fail an otherwise-good transform.
        timeout: 240_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        _busy = false;
        const out = `${stdout || ''}\n${stderr || ''}`;
        // Greedy (.+) to capture the FULL path — a non-greedy (.+?\.\w+) stopped at
        // the first dot-word, returning ".claude" from paths like ~/.claude/.../file.jpg
        // (broke the result thumbnail → looked like a black image). Matches localgen.ts.
        const saved = out.match(/Image saved to (.+)/);
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
          error = 'Generation timed out (240s). Try Flash, a smaller size (1K), or a simpler prompt.';
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
