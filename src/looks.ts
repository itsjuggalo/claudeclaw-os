// looks.ts — preset "Looks" for the Create page: one card = a known-good
// checkpoint + LoRA + trigger + size/steps combo so picking a vibe never
// requires knowing which LoRA fits which model.
//
// Two sources, merged at read time (both read fresh per request — tiny files):
//   data/looks.json              — repo-curated builtins (not deletable from UI)
//   ~/.claudeclaw/looks.local.json — user-saved Looks ("Save as Look" button)
//
// Every Look is validated against the files actually on disk; a missing
// checkpoint/LoRA marks it { available:false, missing:[...] } instead of
// silently breaking — so deleting or renaming a model degrades visibly.
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './config.js';
import { readManifest, readCurated, enrichedMetaFor } from './modelmeta.js';

const HOME = process.env.HOME || '/home/itsju';
export const BUILTIN_LOOKS_PATH = path.resolve(PROJECT_ROOT, 'data', 'looks.json');
export const USER_LOOKS_PATH = `${HOME}/.claudeclaw/looks.local.json`;
const CKPT_DIR = `${HOME}/ComfyUI/models/checkpoints`;
const LORA_DIR = `${HOME}/ComfyUI/models/loras`;

export interface Look {
  id: string;
  label: string;
  description: string;
  emoji?: string;
  thumb?: string;
  category?: string;                 // feature tag — feeds the Simple Mode chips
  checkpoint: string;                // exact filename in models/checkpoints
  loras: { name: string; strength: number }[];
  promptPrefix?: string;             // quality tags prepended to the user's subject
  negative?: string;
  triggers?: string[];               // explicit trigger words (overrides auto-injection)
  size: { width: number; height: number };
  steps: number;
  cfg?: number;
  builtin?: boolean;
}

export type ResolvedLook = Look & { available: boolean; missing: string[]; thumbNsfw?: number };

function readJsonArray(p: string): Look[] {
  try {
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'look';
}

// Validate against disk + resolve a thumbnail (explicit > first LoRA's > checkpoint's).
export function listLooks(): ResolvedLook[] {
  const builtins = readJsonArray(BUILTIN_LOOKS_PATH).map(l => ({ ...l, builtin: true }));
  const users = readJsonArray(USER_LOOKS_PATH).map(l => ({ ...l, builtin: false }));
  const manifest = readManifest();
  const curated = readCurated();
  return [...builtins, ...users].map(l => {
    const missing: string[] = [];
    if (!fs.existsSync(`${CKPT_DIR}/${l.checkpoint}`)) missing.push(l.checkpoint);
    for (const lo of l.loras ?? []) {
      if (!fs.existsSync(`${LORA_DIR}/${lo.name}`)) missing.push(lo.name);
    }
    let thumb = l.thumb;
    let thumbNsfw: number | undefined;
    if (!thumb) {
      const firstLora = (l.loras ?? [])[0]?.name;
      const src = firstLora ? enrichedMetaFor(firstLora, manifest, curated) : enrichedMetaFor(l.checkpoint, manifest, curated);
      thumb = src.thumb;
      thumbNsfw = src.thumbNsfw;
    }
    return { ...l, thumb, thumbNsfw, available: missing.length === 0, missing };
  });
}

// Persist a user Look (builtin ids can't be shadowed; duplicate labels get a
// numeric suffix). Returns the saved Look. Throws on missing model files so the
// API can hand back a clear 400 instead of saving a broken preset.
export function saveUserLook(input: Omit<Look, 'id' | 'builtin'> & { id?: string }): Look {
  if (!input.label?.trim()) throw new Error('label is required');
  if (!input.checkpoint?.trim()) throw new Error('checkpoint is required');
  if (!fs.existsSync(`${CKPT_DIR}/${input.checkpoint}`)) throw new Error(`checkpoint not installed: ${input.checkpoint}`);
  for (const lo of input.loras ?? []) {
    if (!fs.existsSync(`${LORA_DIR}/${lo.name}`)) throw new Error(`LoRA not installed: ${lo.name}`);
  }
  const builtinsIds = new Set(readJsonArray(BUILTIN_LOOKS_PATH).map(l => l.id));
  const users = readJsonArray(USER_LOOKS_PATH);
  let id = input.id?.trim() || slugify(input.label);
  if (builtinsIds.has(id)) id = `${id}-custom`;
  let n = 2;
  const taken = new Set(users.map(u => u.id));
  const base = id;
  while (taken.has(id)) id = `${base}-${n++}`;
  const look: Look = {
    ...input,
    id,
    loras: (input.loras ?? []).map(lo => ({ name: lo.name, strength: Number(lo.strength) || 0.8 })),
    size: { width: Number(input.size?.width) || 768, height: Number(input.size?.height) || 1024 },
    steps: Number(input.steps) || 25,
    builtin: false,
  };
  users.push(look);
  fs.mkdirSync(path.dirname(USER_LOOKS_PATH), { recursive: true });
  fs.writeFileSync(USER_LOOKS_PATH, JSON.stringify(users, null, 2));
  return look;
}

// Delete a user Look by id. Builtins are untouchable. Returns true if removed.
export function deleteUserLook(id: string): boolean {
  const users = readJsonArray(USER_LOOKS_PATH);
  const next = users.filter(l => l.id !== id);
  if (next.length === users.length) return false;
  fs.writeFileSync(USER_LOOKS_PATH, JSON.stringify(next, null, 2));
  return true;
}
