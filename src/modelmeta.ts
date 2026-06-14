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
import path from 'path';
import { PROJECT_ROOT } from './config.js';

const HOME = process.env.HOME || '/home/itsju';
export const MANIFEST_PATH = `${HOME}/ComfyUI/models/model-metadata.json`;
// Repo-curated friendly metadata (labels/descriptions/categories) — survives
// manifest rewrites and re-downloads. User edits go to the manifest instead.
export const CURATED_PATH = path.resolve(PROJECT_ROOT, 'data', 'model-friendly.json');

export interface ModelMeta {
  family: string;            // pony | sdxl | illustrious | sd15 | flux | zimage | other
  baseModel?: string;        // raw Civitai string, e.g. "Pony", "SDXL 1.0"
  type?: string;             // checkpoint | lora | other
  triggers?: string[];       // trainedWords
  source?: string;           // civitai | hash-backfill | filename-heuristic
  verified?: boolean;        // true only when it came from Civitai
  thumb?: string;            // Civitai preview image URL (looked up by file sha256)
  thumbNsfw?: number;        // Civitai nsfwLevel of that image: 1=PG 2=PG13 4=R 8=X 16=XXX
  sha256?: string;           // cached file hash, so a thumb refresh never re-hashes GBs
  label?: string;            // friendly display name, e.g. "Real Feet (SDXL)"
  description?: string;      // one-line plain-English "what this does"
  category?: string;         // feature tag: feet | cow | style | eyes | skin | photo | character
  recommendedStrength?: number; // sensible default LoRA strength (e.g. 0.7)
  requiresCheckpointFamily?: string; // explicit compat override; defaults to `family`
}

// Normalize Civitai's `baseModel` string into a small fixed family set.
export function normalizeFamily(baseModel: string | undefined | null): string {
  const b = (baseModel || '').toLowerCase();
  if (!b) return 'other';
  if (b.includes('pony')) return 'pony';
  if (b.includes('illustrious') || b.includes('noob')) return 'illustrious';
  if (b.includes('flux')) return 'flux';
  if (/z[\s_-]?image|\bzit\b|\bzib\b/.test(b)) return 'zimage';
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
  if (/z[\s_-]?image|\bzit\b|\bzib\b/.test(n)) return 'zimage';
  if (/xl/.test(n)) return 'sdxl';
  if (n.includes('sd15') || n.includes('sd_15') || n.includes('1.5')) return 'sd15';
  return 'other';
}

// Tri-state LoRA↔checkpoint compatibility. 'unknown' means we can't prove a
// match either way (one side has no real family) — Simple Mode hides these,
// Advanced Mode allows them only behind an explicit confirm.
//
// B4 — Pony/SDXL/Illustrious all share the SDXL architecture and can load
// each other's LoRAs without ComfyUI errors (e.g. RealFeet_xl on a Pony
// checkpoint). Treating them as 'mismatch' was a false hard-block. True
// cross-arch (sd15 vs sdxl/pony, flux vs anything, etc.) stays 'mismatch'.
export type Compat = 'ok' | 'unknown' | 'mismatch';
const SDXL_ARCH_FAMILIES = new Set(['sdxl', 'pony', 'illustrious']);
export function loraCompat(loraFam?: string, ckptFam?: string): Compat {
  const l = loraFam || 'other', c = ckptFam || 'other';
  if (l === 'other' || c === 'other') return 'unknown';
  if (l === c) return 'ok';
  // Allow any mix within the SDXL architecture family (pony ↔ sdxl ↔ illustrious)
  if (SDXL_ARCH_FAMILIES.has(l) && SDXL_ARCH_FAMILIES.has(c)) return 'ok';
  return 'mismatch';
}

export function readManifest(): Record<string, ModelMeta> {
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, ModelMeta>; }
  catch { return {}; }
}

export function writeManifest(m: Record<string, ModelMeta>): void {
  try { fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2)); } catch {}
}

// Replace one entry in the manifest on disk (read-modify-write, best-effort).
export function upsertMeta(name: string, meta: ModelMeta): void {
  const m = readManifest();
  m[name] = meta;
  writeManifest(m);
}

// Merge a partial patch into an entry WITHOUT clobbering existing fields
// (labels, thumbs, sha256 survive re-downloads and meta edits).
export function mergeMeta(name: string, patch: Partial<ModelMeta>): ModelMeta {
  const m = readManifest();
  const merged = { ...(m[name] ?? metaFor(name, m)), ...patch } as ModelMeta;
  m[name] = merged;
  writeManifest(m);
  return merged;
}

// Look up a file's metadata; falls back to an unverified filename guess so the
// UI always has a `family` to reason about (never undefined). Entries stored as
// 'other' but carrying a real baseModel get their family re-derived at read
// time — fixes old manifests when a new family (e.g. zimage) is added, without
// rewriting the file.
export function metaFor(name: string, manifest?: Record<string, ModelMeta>): ModelMeta {
  const m = manifest ?? readManifest();
  const entry = m[name];
  if (entry) {
    if (entry.family === 'other' && entry.baseModel) {
      const derived = normalizeFamily(entry.baseModel);
      if (derived !== 'other') return { ...entry, family: derived };
    }
    return entry;
  }
  return { family: familyFromFilename(name), source: 'filename-heuristic', verified: false };
}

// Curated friendly metadata overlay (repo file, hand-edited). Read fresh per
// call — file is tiny and this keeps edits live without a restart.
export type CuratedMeta = Pick<ModelMeta, 'label' | 'description' | 'category' | 'recommendedStrength' | 'requiresCheckpointFamily'>;
export function readCurated(): Record<string, CuratedMeta> {
  try { return JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8')) as Record<string, CuratedMeta>; }
  catch { return {}; }
}

// Full metadata for a file: manifest user-set fields win, then the curated
// seed, then derived fallbacks. `label` always resolves to something readable.
export function enrichedMetaFor(
  name: string,
  manifest?: Record<string, ModelMeta>,
  curated?: Record<string, CuratedMeta>,
): ModelMeta & { label: string } {
  const base = metaFor(name, manifest);
  const cur = (curated ?? readCurated())[name] ?? {};
  return {
    ...cur,
    ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined && v !== null)),
    label: base.label || cur.label || cleanName(name),
  } as ModelMeta & { label: string };
}

// "kFeetMix101_v2-000006.safetensors" -> "kFeetMix101 v2 000006" — last-resort
// display name when nobody has curated a label.
export function cleanName(name: string): string {
  return name.replace(/\.(safetensors|ckpt|gguf|pt)$/i, '').replace(/[_-]+/g, ' ').trim();
}
