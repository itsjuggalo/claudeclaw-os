// character.ts — ClaudeClaw bridge to the local Character Studio
// (/AIWorkWSL/tools/character-studio): trained, reusable character LoRAs that hold
// one identity across every gen (the DaForgeLayer "trained character" method on
// this box's SDXL substrate).
//
// Split of duties:
//   • Training is a heavy GPU step owned by the CLI (`cstudio train`) — this module
//     never trains. It reads the studio's characters/ dir, surfaces status, builds
//     a character-aware gen request, runs the (light, CPU) config/publish/qa steps,
//     and returns the exact train command for a human to launch.
//   • A PUBLISHED character LoRA is symlinked into the ComfyUI loras dir, so it also
//     shows up in the normal Create-page LoRA picker for free. buildCharacterGen()
//     here just assembles the right prompt + lora + strength so "gen as <character>"
//     is one call.
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { applyGenRules } from './genrules.js';

const execFileAsync = promisify(execFile);

const STUDIO = process.env.CHARACTER_STUDIO || '/AIWorkWSL/tools/character-studio';
const CHARS_DIR = path.join(STUDIO, 'characters');
const CSTUDIO = path.join(STUDIO, 'bin', 'cstudio');

export type CharStatus = 'new' | 'configured' | 'trained' | 'validated' | 'published';

export interface Character {
  name: string;
  trigger: string;
  klass?: string;
  status: CharStatus;
  recommendedStrength: number;
  baseName?: string;            // base checkpoint the LoRA was trained against
  nImages?: number;
  maxTrainSteps?: number;
  resolution?: number;
  hasLora: boolean;             // a trained .safetensors exists on disk
  published: boolean;           // symlinked into ComfyUI loras
  loraPath?: string;
  meanSimilarity?: number;      // last ArcFace identity score, if validated
}

function safeName(name: string): string {
  // names are folder names — allow only a safe charset so a route param can't
  // escape the characters/ dir.
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : '';
}

function readMeta(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** List every character in the studio with live on-disk status. Pure FS read. */
export function listCharacters(): Character[] {
  if (!fs.existsSync(CHARS_DIR)) return [];
  const out: Character[] = [];
  for (const entry of fs.readdirSync(CHARS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(CHARS_DIR, entry.name);
    const m = readMeta(dir);
    if (!m) continue;
    const trigger = String(m.trigger || `ohwx_${entry.name}`);
    const loraPath = path.join(dir, 'out', `${trigger}.safetensors`);
    const hasLora = fs.existsSync(loraPath);
    const published = fs.existsSync(
      path.join('/AIWorkWSL/tools/comfyui/models/loras', `${trigger}.safetensors`),
    );
    out.push({
      name: entry.name,
      trigger,
      klass: (m.class as string) || undefined,
      status: (m.status as CharStatus) || (hasLora ? 'trained' : 'new'),
      recommendedStrength: typeof m.recommendedStrength === 'number' ? m.recommendedStrength : 0.95,
      baseName: (m.base_name as string) || undefined,
      nImages: (m.n_images as number) || undefined,
      maxTrainSteps: (m.max_train_steps as number) || undefined,
      resolution: (m.resolution as number) || undefined,
      hasLora,
      published,
      loraPath: hasLora ? loraPath : undefined,
      meanSimilarity: (m.mean_similarity as number) || undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCharacter(name: string): Character | null {
  const n = safeName(name);
  if (!n) return null;
  return listCharacters().find((c) => c.name === n) || null;
}

export interface CharacterGenRequest {
  prompt: string;
  negative?: string;
  lora: { name: string; strength: number };
  checkpoint?: string;
  notes: string[];
}

/**
 * Assemble a character-aware gen request: prepend the trigger, run the shared
 * gen hard-rules (framing/lighting/camera), and attach the LoRA at its
 * recommended strength. Pure — unit-tested. The caller submits this through the
 * normal ComfyUI generate path (which enforces preflightGate()).
 */
export function buildCharacterGen(
  c: Pick<Character, 'trigger' | 'recommendedStrength' | 'baseName'>,
  userPrompt: string,
  opts: { negative?: string; strength?: number } = {},
): CharacterGenRequest {
  const raw = (userPrompt || '').trim();
  // trigger leads the prompt; identity lives in the trigger (guide rule).
  const withTrigger = raw ? `${c.trigger}, ${raw}` : c.trigger;
  const ruled = applyGenRules({
    prompt: withTrigger,
    negative: opts.negative,
    kind: 'image',
    hasLora: true,                 // gates the medium-or-closer framing rule
  });
  const strength = clampStrength(opts.strength ?? c.recommendedStrength);
  const notes = [...ruled.notes];
  if (strength < 0.85) {
    // guide rule: never lower LoRA strength to chase realism — it drifts identity.
    notes.push('⚠ strength <0.85 drifts identity — fix CG look with framing + grounded light, not lower strength');
  }
  return {
    prompt: ruled.prompt,
    negative: ruled.negative,
    lora: { name: `${c.trigger}.safetensors`, strength },
    checkpoint: c.baseName,        // prefer the base it was trained on
    notes,
  };
}

function clampStrength(s: number): number {
  if (!Number.isFinite(s)) return 0.95;
  return Math.max(0.1, Math.min(1.2, s));
}

// ── light CLI actions (CPU only; training is intentionally NOT here) ──────────
async function runCstudio(args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [CSTUDIO, ...args], {
      timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, HOME: process.env.HOME || '/home/itsju' },
    });
    return { ok: true, out: `${stdout || ''}${stderr || ''}`.trim() };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return { ok: false, out: (err.stdout?.toString() || err.stderr?.toString() || err.message || 'failed').trim() };
  }
}

/** Generate the kohya config + train command for a character (CPU, no training). */
export async function configureCharacter(
  name: string, base?: string, res = 768, steps = 0,
): Promise<{ ok: boolean; out: string; trainCommand?: string }> {
  const n = safeName(name);
  if (!n) return { ok: false, out: 'invalid character name' };
  const args = ['config', n, '--res', String(res)];
  if (base) args.push('--base', base);
  if (steps > 0) args.push('--steps', String(steps));
  const r = await runCstudio(args);
  const trainCommand = `bash ${path.join(CHARS_DIR, n, 'TRAIN_COMMAND.sh')}`;
  return { ...r, trainCommand };
}

/** Publish (symlink LoRA into ComfyUI) — C:-safe, no real bytes on C:. */
export async function publishCharacter(name: string): Promise<{ ok: boolean; out: string }> {
  const n = safeName(name);
  if (!n) return { ok: false, out: 'invalid character name' };
  return runCstudio(['use', n]);
}

/** The exact heavy launch command for a character (so the UI can show it). */
export function trainCommandFor(name: string): string | null {
  const n = safeName(name);
  if (!n) return null;
  const sh = path.join(CHARS_DIR, n, 'TRAIN_COMMAND.sh');
  return fs.existsSync(sh) ? `bash ${sh}` : null;
}

export const _studioPaths = { STUDIO, CHARS_DIR, CSTUDIO };
