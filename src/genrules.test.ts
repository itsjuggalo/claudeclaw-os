import { describe, it, expect } from 'vitest';
import { applyGenRules, loraStrength } from './genrules.js';

describe('applyGenRules', () => {
  it('R1: adds medium framing for a person gen with a LoRA and no framing', () => {
    const r = applyGenRules({ prompt: 'a woman in a red dress', kind: 'image', hasLora: true });
    expect(r.prompt).toMatch(/medium shot/i);
    expect(r.notes.join()).toMatch(/framing/);
  });
  it('R1: does NOT touch framing when the user already specified one', () => {
    const r = applyGenRules({ prompt: 'full body shot of a woman', kind: 'image', hasLora: true });
    expect(r.prompt).toBe('full body shot of a woman');
  });
  it('R1: does NOT add framing for non-person or no-LoRA gens', () => {
    expect(applyGenRules({ prompt: 'a mountain landscape', kind: 'image', hasLora: true }).prompt)
      .toBe('a mountain landscape');
    expect(applyGenRules({ prompt: 'a woman', kind: 'image', hasLora: false }).prompt)
      .toBe('a woman');
  });
  it('R2: grounds light when lighting is mentioned without a source', () => {
    const r = applyGenRules({ prompt: 'a glowing face', kind: 'image' });
    expect(r.prompt).toMatch(/visible in-frame light source/i);
  });
  it('R2: leaves it alone when a light source is already named', () => {
    const r = applyGenRules({ prompt: 'face lit by a candle', kind: 'image' });
    expect(r.prompt).toBe('face lit by a candle');
  });
  it('R3: strips camera/tripod tokens from video prompts only', () => {
    const v = applyGenRules({ prompt: 'she turns, camera pan, on a tripod', kind: 'video' });
    expect(v.prompt).not.toMatch(/camera|tripod/i);
    const img = applyGenRules({ prompt: 'a camera on a tripod', kind: 'image' });
    expect(img.prompt).toBe('a camera on a tripod');
  });
  it('R4: clears the negative when cfg≈1 (distilled ignores it)', () => {
    expect(applyGenRules({ prompt: 'x', negative: 'blurry', cfg: 1.0 }).negative).toBe('');
    expect(applyGenRules({ prompt: 'x', negative: 'blurry', cfg: 7.0 }).negative).toBe('blurry');
  });
});

describe('loraStrength (R5)', () => {
  it('honors an explicit user value', () => {
    expect(loraStrength(0.6, true, 0.8)).toBe(0.6);
  });
  it('defaults character LoRAs to ~0.95 and floors at 0.9', () => {
    expect(loraStrength(undefined, true)).toBe(0.95);
    expect(loraStrength(undefined, true, 0.7)).toBe(0.9);  // never below 0.9 for identity
    expect(loraStrength(undefined, true, 0.97)).toBe(0.97);
  });
  it('keeps style LoRAs on the prior 0.8 default', () => {
    expect(loraStrength(undefined, false)).toBe(0.8);
    expect(loraStrength(undefined, false, 0.65)).toBe(0.65);
  });
});
