// modelmeta.ts — single source of truth for model compatibility metadata.
//
// Compatibility ("which LoRAs work with which checkpoint") and trigger words are
// NOT guessed from filenames. They come from Civitai's own API (baseModel +
// trainedWords), captured at download time (see /api/models/download) or via the
// one-time `model-meta-backfill` script, and stored in this manifest:
//
//   ~/ComfyUI/models/model-metadata.json
//     { "<filename>": { family, baseModel, type, triggers, source, verified } }
//
// The frontend uses `family` to lock incompatible LoRAs and `triggers` to inject
// the right words into the prompt. `verified:false` means we fell back to a
// filename guess (Civitai had no record) — the UI flags that with a "?" badge.
import fs from 'fs';

const HOME = process.env.HOME || '/home/itsju';
export const MANIFEST_PATH = `${HOME}/ComfyUI/models/model-metadata.json`;

export interface ModelMeta {
  family: string;            // pony | sdxl | illustrious | sd15 | flux | other
  baseModel?: string;        // raw Civitai string, e.g. "Pony", "SDXL 1.0"
  type?: string;             // checkpoint | lora | other
  triggers?: string[];       // trainedWords
  source?: string;           // civitai | hash-backfill | filename-heuristic
  verified?: boolean;        // true only when it came from Civitai
  thumb?: string;            // Civitai preview image URL (looked up by file sha256)
  thumbNsfw?: number;        // Civitai nsfwLevel of that image: 1=PG 2=PG13 4=R 8=X 16=XXX
  sha256?: string;           // cached file hash, so a thumb refresh never re-hashes GBs
}

// Normalize Civitai's `baseModel` string into a small fixed family set.
export function normalizeFamily(baseModel: string | undefined | null): string {
  const b = (baseModel || '').toLowerCase();
  if (!b) return 'other';
  if (b.includes('pony')) return 'pony';
  if (b.includes('illustrious') || b.includes('noob')) return 'illustrious';
  if (b.includes('flux')) return 'flux';
  if (b.includes('sdxl') || b.includes('sd xl') || b.includes('pdxl') || /\bxl\b/.test(b)) return 'sdxl';
  if (b.includes('sd 1') || b.includes('sd1') || b.includes('1.5') || b.includes('1.4')) return 'sd15';
  if (b.includes('sd 2') || b.includes('sd2')) return 'sd15';
  return 'other';
}

// Last-resort guess from a filename when Civitai has no record. Always unverified.
export function familyFromFilename(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('pony')) return 'pony';
  if (n.includes('illustrious') || n.includes('noob')) return 'illustrious';
  if (n.includes('flux')) return 'flux';
  if (/xl/.test(n)) return 'sdxl';
  if (n.includes('sd15') || n.includes('sd_15') || n.includes('1.5')) return 'sd15';
  return 'other';
}

export function readManifest(): Record<string, ModelMeta> {
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, ModelMeta>; }
  catch { return {}; }
}

export function writeManifest(m: Record<string, ModelMeta>): void {
  try { fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2)); } catch {}
}

// Merge one entry into the manifest on disk (read-modify-write, best-effort).
export function upsertMeta(name: string, meta: ModelMeta): void {
  const m = readManifest();
  m[name] = meta;
  writeManifest(m);
}

// Look up a file's metadata; falls back to an unverified filename guess so the
// UI always has a `family` to reason about (never undefined).
export function metaFor(name: string, manifest?: Record<string, ModelMeta>): ModelMeta {
  const m = manifest ?? readManifest();
  if (m[name]) return m[name];
  return { family: familyFromFilename(name), source: 'filename-heuristic', verified: false };
}
