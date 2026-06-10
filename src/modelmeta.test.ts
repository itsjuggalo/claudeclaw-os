import { describe, it, expect } from 'vitest';
import { normalizeFamily, familyFromFilename, loraCompat, metaFor, cleanName, enrichedMetaFor, ModelMeta } from './modelmeta.js';

describe('normalizeFamily', () => {
  it('maps known base models', () => {
    expect(normalizeFamily('Pony')).toBe('pony');
    expect(normalizeFamily('SDXL 1.0')).toBe('sdxl');
    expect(normalizeFamily('SD 1.5')).toBe('sd15');
    expect(normalizeFamily('Flux.1 D')).toBe('flux');
    expect(normalizeFamily('Illustrious')).toBe('illustrious');
  });
  it('maps Z-Image variants to zimage (not other, not sdxl)', () => {
    expect(normalizeFamily('ZImageTurbo')).toBe('zimage');
    expect(normalizeFamily('Z-Image Turbo')).toBe('zimage');
    expect(normalizeFamily('z_image')).toBe('zimage');
  });
  it('falls back to other', () => {
    expect(normalizeFamily('')).toBe('other');
    expect(normalizeFamily(undefined)).toBe('other');
    expect(normalizeFamily('SomethingWeird')).toBe('other');
  });
});

describe('familyFromFilename', () => {
  it('detects zimage markers in filenames', () => {
    expect(familyFromFilename('RLY-thot_shot-ZiB-ZiT-helena-v1.safetensors')).toBe('zimage');
  });
  it('keeps existing behavior', () => {
    expect(familyFromFilename('cow-ponyxl-v1.safetensors')).toBe('pony');
    expect(familyFromFilename('RealFeet_xl_v1.safetensors')).toBe('sdxl');
  });
});

describe('loraCompat tri-state', () => {
  it('ok when families match', () => {
    expect(loraCompat('pony', 'pony')).toBe('ok');
    expect(loraCompat('sdxl', 'sdxl')).toBe('ok');
  });
  it('mismatch when both known and differ', () => {
    expect(loraCompat('zimage', 'pony')).toBe('mismatch');
    expect(loraCompat('sd15', 'sdxl')).toBe('mismatch');
    expect(loraCompat('flux', 'pony')).toBe('mismatch');
  });
  it('unknown when either side is other/missing (no longer auto-allowed)', () => {
    expect(loraCompat('other', 'pony')).toBe('unknown');
    expect(loraCompat('pony', 'other')).toBe('unknown');
    expect(loraCompat(undefined, 'pony')).toBe('unknown');
    expect(loraCompat('pony', undefined)).toBe('unknown');
  });
});

describe('metaFor read-time family re-derivation', () => {
  it('re-derives family from baseModel when stored as other', () => {
    const manifest: Record<string, ModelMeta> = {
      'zit-lora.safetensors': { family: 'other', baseModel: 'ZImageTurbo', verified: true },
    };
    expect(metaFor('zit-lora.safetensors', manifest).family).toBe('zimage');
  });
  it('leaves genuinely-other entries alone', () => {
    const manifest: Record<string, ModelMeta> = {
      'mystery.safetensors': { family: 'other', baseModel: 'SomethingWeird' },
    };
    expect(metaFor('mystery.safetensors', manifest).family).toBe('other');
  });
  it('does not touch entries with a real family', () => {
    const manifest: Record<string, ModelMeta> = {
      'a.safetensors': { family: 'pony', baseModel: 'Pony' },
    };
    expect(metaFor('a.safetensors', manifest).family).toBe('pony');
  });
});

describe('enrichedMetaFor precedence', () => {
  it('manifest label wins over curated, curated over cleanName', () => {
    const manifest: Record<string, ModelMeta> = { 'x.safetensors': { family: 'pony', label: 'Manifest Label' } };
    const curated = { 'x.safetensors': { label: 'Curated Label' } };
    expect(enrichedMetaFor('x.safetensors', manifest, curated).label).toBe('Manifest Label');
    expect(enrichedMetaFor('x.safetensors', { 'x.safetensors': { family: 'pony' } }, curated).label).toBe('Curated Label');
    expect(enrichedMetaFor('kFeetMix101_v2-000006.safetensors', {}, {}).label).toBe('kFeetMix101 v2 000006');
  });
  it('curated fills fields manifest lacks', () => {
    const manifest: Record<string, ModelMeta> = { 'x.safetensors': { family: 'pony' } };
    const curated = { 'x.safetensors': { category: 'cow', recommendedStrength: 0.7 } };
    const got = enrichedMetaFor('x.safetensors', manifest, curated);
    expect(got.category).toBe('cow');
    expect(got.recommendedStrength).toBe(0.7);
    expect(got.family).toBe('pony');
  });
});

describe('cleanName', () => {
  it('strips extension and separators', () => {
    expect(cleanName('zy_AmateurStyle_v2.safetensors')).toBe('zy AmateurStyle v2');
  });
});
