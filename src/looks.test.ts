import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Looks resolve model paths from HOME at module load, so stub HOME to a temp
// dir with fake model files BEFORE importing the module.
let tmpHome: string;
let looks: typeof import('./looks.js');

beforeAll(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'looks-test-'));
  fs.mkdirSync(`${tmpHome}/ComfyUI/models/checkpoints`, { recursive: true });
  fs.mkdirSync(`${tmpHome}/ComfyUI/models/loras`, { recursive: true });
  fs.writeFileSync(`${tmpHome}/ComfyUI/models/checkpoints/test-ckpt.safetensors`, '');
  fs.writeFileSync(`${tmpHome}/ComfyUI/models/loras/test-lora.safetensors`, '');
  vi.stubEnv('HOME', tmpHome);
  vi.resetModules();
  looks = await import('./looks.js');
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('listLooks validation', () => {
  it('marks builtin looks unavailable when their models are not on disk', () => {
    const all = looks.listLooks();
    expect(all.length).toBeGreaterThan(0);
    const builtin = all.find(l => l.builtin);
    expect(builtin).toBeTruthy();
    // temp HOME has none of the real checkpoints — every builtin must degrade visibly
    expect(builtin!.available).toBe(false);
    expect(builtin!.missing.length).toBeGreaterThan(0);
  });
});

describe('saveUserLook / deleteUserLook round-trip', () => {
  it('saves a valid user look and lists it as available', () => {
    const saved = looks.saveUserLook({
      label: 'My Test Look',
      description: 'test',
      checkpoint: 'test-ckpt.safetensors',
      loras: [{ name: 'test-lora.safetensors', strength: 0.7 }],
      size: { width: 512, height: 768 },
      steps: 20,
    });
    expect(saved.id).toBe('my-test-look');
    expect(saved.builtin).toBe(false);
    const found = looks.listLooks().find(l => l.id === saved.id);
    expect(found?.available).toBe(true);
    expect(found?.missing).toEqual([]);
  });

  it('rejects looks referencing missing files', () => {
    expect(() => looks.saveUserLook({
      label: 'Broken',
      description: '',
      checkpoint: 'nope.safetensors',
      loras: [],
      size: { width: 512, height: 768 },
      steps: 20,
    })).toThrow(/not installed/);
  });

  it('suffixes duplicate ids instead of overwriting', () => {
    const again = looks.saveUserLook({
      label: 'My Test Look',
      description: 'second',
      checkpoint: 'test-ckpt.safetensors',
      loras: [],
      size: { width: 512, height: 768 },
      steps: 20,
    });
    expect(again.id).toBe('my-test-look-2');
  });

  it('deletes user looks but never builtins', () => {
    expect(looks.deleteUserLook('my-test-look')).toBe(true);
    expect(looks.deleteUserLook('my-test-look')).toBe(false);
    expect(looks.deleteUserLook('realistic-photo')).toBe(false); // builtin id, not in user file
    expect(looks.listLooks().find(l => l.id === 'my-test-look')).toBeUndefined();
  });
});
