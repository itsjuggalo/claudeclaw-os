// Higgsfield generation — shells out to the official `higgsfield` CLI
// (`npm i -g @higgsfield/cli`, authed once via `higgsfield auth login`). Billed
// to Mike's Higgsfield SUBSCRIPTION, not an API key — the CLI owns auth, so
// nothing lives in .env. Output (a hosted result URL) is downloaded into the
// `higgsfield` gallery-watched folder, so it shows up on /gallery automatically.
//
// Mirrors the GenResult contract + execFile pattern of generate.ts (banana).
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { higgsfieldDir } from './gallery.js';

export interface HiggsfieldInput {
  kind: 'image' | 'video';
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
}
export interface HiggsfieldResult { ok: boolean; file?: string; url?: string; notes?: string; error?: string; }

// Resolve the CLI binary. pm2 runs claudeclaw under nvm node WITHOUT the npm
// global bin on PATH, so `higgsfield` alone won't resolve — derive it from the
// running node's bin dir (where `npm i -g` placed it for the SAME node), with an
// env override and a bare-name PATH fallback.
function higgsfieldBin(): string {
  const override = process.env.HIGGSFIELD_BIN;
  if (override && fs.existsSync(override)) return override;
  const sibling = path.join(path.dirname(process.execPath), 'higgsfield');
  if (fs.existsSync(sibling)) return sibling;
  return 'higgsfield';
}

const MODEL_RE = /^[a-z0-9_]+$/i;             // CLI model ids: nano_banana_2, kling3_0, …
const AR_RE = /^\d{1,2}:\d{1,2}$/;            // 16:9, 1:1, 9:16
const RES_RE = /^(?:512|480p|720p|1080p|1k|2k|4k)$/i;

// Pull the result media URL out of `--wait` stdout. The CLI prints the result
// URL(s) on completion; prefer a media-extension URL, else the last URL seen.
function extractResultUrl(out: string): string | null {
  const urls = out.match(/https?:\/\/[^\s"'<>)\]]+/g);
  if (!urls || urls.length === 0) return null;
  const media = urls.filter((u) => /\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u));
  return (media.length ? media[media.length - 1] : urls[urls.length - 1]).replace(/[.,)]+$/, '');
}

function extFromUrl(url: string, contentType: string | null): string {
  const m = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,4})$/i);
  if (m) return `.${m[1].toLowerCase()}`;
  if (contentType?.includes('video')) return '.mp4';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('gif')) return '.gif';
  return '.jpg';
}

async function downloadToGallery(url: string, kind: 'image' | 'video'): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFromUrl(url, res.headers.get('content-type'));
  const dir = higgsfieldDir();
  const stamp = `${Date.now()}-${Math.floor(performance.now() % 1e6)}`;
  const file = `hf-${kind}-${stamp}${ext}`;
  fs.writeFileSync(path.join(dir, file), buf);
  return file;
}

// Per-model param schema (`model get <id> --json` → params[]). Cached per id.
// Lets us pass --aspect_ratio/--resolution ONLY when the model accepts that exact
// value — enums differ wildly (image res = 1k/2k/4k, seedance = 480p/720p/1080p,
// kling has no resolution param at all), so blindly forcing flags would 400.
const _schemaCache = new Map<string, Map<string, string[] | null>>();
async function getModelParams(model: string): Promise<Map<string, string[] | null> | null> {
  if (_schemaCache.has(model)) return _schemaCache.get(model)!;
  const res = await runHf(['model', 'get', model, '--json']);
  if (res.code !== 0) return null;
  try {
    const start = res.out.search(/[{[]/);
    const j = JSON.parse(start >= 0 ? res.out.slice(start) : res.out);
    const m = new Map<string, string[] | null>();
    for (const p of (j.params || [])) {
      if (p && typeof p.name === 'string') m.set(p.name, Array.isArray(p.enum) ? p.enum.map(String) : null);
    }
    _schemaCache.set(model, m);
    return m;
  } catch { return null; }
}

export async function generateHiggsfield(opts: HiggsfieldInput): Promise<HiggsfieldResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) return { ok: false, error: 'Prompt is required.' };
  if (prompt.length > 2000) return { ok: false, error: 'Prompt too long (max 2000 characters).' };
  const model = (opts.model || '').trim();
  if (!MODEL_RE.test(model)) return { ok: false, error: 'A Higgsfield model must be selected.' };

  // Build the param flags from the model's own schema (falls back to a regex
  // guard if the schema can't be fetched).
  const schema = await getModelParams(model);
  const args = ['generate', 'create', model, '--prompt', prompt];
  const ar = opts.aspectRatio?.trim();
  if (ar && AR_RE.test(ar)) {
    if (schema) { const e = schema.get('aspect_ratio'); if (e !== undefined && (e === null || e.includes(ar))) args.push('--aspect_ratio', ar); }
    else args.push('--aspect_ratio', ar);
  }
  const res = opts.resolution?.trim().toLowerCase();
  if (res && RES_RE.test(res)) {
    if (schema) { const e = schema.get('resolution'); if (e !== undefined && (e === null || e.includes(res))) args.push('--resolution', res); }
    else args.push('--resolution', res);
  }
  // Video can take minutes; block on the CLI and let it print the result URL.
  const waitTimeout = opts.kind === 'video' ? '12m' : '4m';
  args.push('--wait', '--wait-timeout', waitTimeout, '--wait-interval', '5s');

  return new Promise((resolve) => {
    execFile(
      higgsfieldBin(),
      args,
      { env: { ...process.env }, timeout: (opts.kind === 'video' ? 13 : 5) * 60_000, maxBuffer: 8 * 1024 * 1024 },
      async (err, stdout, stderr) => {
        const out = `${stdout || ''}\n${stderr || ''}`;
        if (/Not authenticated/i.test(out)) {
          return resolve({ ok: false, error: 'Higgsfield CLI is not authenticated — run `higgsfield auth login` on the box.' });
        }
        const url = extractResultUrl(out);
        if (url) {
          try {
            const file = await downloadToGallery(url, opts.kind);
            return resolve({ ok: true, file, url: `/api/gallery/file?root=higgsfield&sub=&name=${encodeURIComponent(file)}` });
          } catch (e) {
            // Generation succeeded but the download failed — still hand back the
            // raw hosted URL so the result isn't lost.
            return resolve({ ok: true, url, notes: `saved remotely only (download failed: ${String(e).slice(0, 120)})` });
          }
        }
        let error = 'Higgsfield generation failed.';
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          error = `Generation timed out (${waitTimeout}). Try a faster model or simpler prompt.`;
        } else if (/plan_required|minimum_\w+_plan/i.test(out)) {
          error = `"${model}" needs a higher Higgsfield plan — upgrade (Basic/Pro/Ultimate) or pick a model your plan allows.`;
        } else if (/insufficient|out of credit|balance|payment_required|\b402\b/i.test(out)) {
          error = 'Higgsfield credits exhausted — top up your plan.';
        } else if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          error = 'higgsfield CLI not found on the server — `npm i -g @higgsfield/cli`.';
        } else {
          // CLI errors print either `Error: <msg>` or a raw JSON body {error_type,text}.
          const j = out.match(/\{[^{}]*"(?:error_type|text|message)"[^{}]*\}/);
          if (j) { try { const o = JSON.parse(j[0]); error = String(o.text || o.message || o.error_type || error).slice(0, 300); } catch { /* keep */ } }
          if (error === 'Higgsfield generation failed.') {
            const m = out.match(/Error:\s*(.+)/);
            if (m) error = m[1].trim().slice(0, 300);
            else if (err) error = String(err.message).slice(0, 300);
          }
        }
        resolve({ ok: false, error });
      },
    );
  });
}

// ── Model catalogue (for the UI dropdowns) ────────────────────────────────
export interface HiggsfieldModel { id: string; name: string; kind: 'image' | 'video'; }
let _modelCache: { ts: number; models: HiggsfieldModel[] } | null = null;
const MODELS_TTL_MS = 5 * 60_000;

function runHf(args: string[]): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    execFile(higgsfieldBin(), args, { env: { ...process.env }, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ out: `${stdout || ''}\n${stderr || ''}`, code: (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? -1 : (err ? 1 : 0) }));
  });
}

// `model list --json` returns an array of { display_name, job_set_type, type }.
// id = job_set_type, name = display_name, kind = type ('image' | 'video').
function parseModels(out: string): HiggsfieldModel[] {
  let data: unknown;
  // The CLI may print a banner line before the JSON — grab the array/object slice.
  const start = out.search(/[[{]/);
  try { data = JSON.parse((start >= 0 ? out.slice(start) : out).trim()); } catch { return []; }
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    const found = Object.values(data as Record<string, unknown>).find((v) => Array.isArray(v));
    if (Array.isArray(found)) arr = found;
  }
  const out2: HiggsfieldModel[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = String(o.job_set_type ?? o.id ?? o.slug ?? '').trim();
    if (!id || !MODEL_RE.test(id)) continue;
    const t = String(o.type ?? '').toLowerCase();
    if (t !== 'image' && t !== 'video') continue;
    out2.push({ id, name: String(o.display_name ?? o.name ?? id), kind: t });
  }
  return out2;
}

export async function listHiggsfieldModels(): Promise<{ ok: boolean; models?: HiggsfieldModel[]; error?: string }> {
  const now = Date.now();
  if (_modelCache && now - _modelCache.ts < MODELS_TTL_MS) return { ok: true, models: _modelCache.models };
  const res = await runHf(['model', 'list', '--json']);
  if (res.code === -1) return { ok: false, error: 'higgsfield CLI not installed' };
  if (/Not authenticated/i.test(res.out)) return { ok: false, error: 'not authenticated — run `higgsfield auth login`' };
  const models = parseModels(res.out);
  if (models.length === 0) return { ok: false, error: 'no models returned (check CLI auth/output)' };
  _modelCache = { ts: now, models };
  return { ok: true, models };
}
