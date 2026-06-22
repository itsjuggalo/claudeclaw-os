import { describe, it, expect } from 'vitest';
import { buildCharacterGen } from './character.js';

const JANE = { trigger: 'ohwx_jane', recommendedStrength: 0.95, baseName: 'cyberrealisticPony_v170.safetensors' };

describe('buildCharacterGen', () => {
  it('leads the prompt with the trigger word', () => {
    const r = buildCharacterGen(JANE, 'in a red dress at a cafe');
    expect(r.prompt.startsWith('ohwx_jane,')).toBe(true);
    expect(r.prompt).toMatch(/red dress/);
  });

  it('attaches the LoRA at the recommended strength and matching checkpoint', () => {
    const r = buildCharacterGen(JANE, 'portrait');
    expect(r.lora).toEqual({ name: 'ohwx_jane.safetensors', strength: 0.95 });
    expect(r.checkpoint).toBe('cyberrealisticPony_v170.safetensors');
  });

  it('applies the framing hard-rule (hasLora person, no framing → medium)', () => {
    const r = buildCharacterGen(JANE, 'a woman walking');
    expect(r.prompt).toMatch(/medium shot/i);
    expect(r.notes.join()).toMatch(/framing/);
  });

  it('respects an explicit framing instead of forcing medium', () => {
    const r = buildCharacterGen(JANE, 'full body shot on a beach');
    expect(r.prompt).not.toMatch(/medium shot/i);
  });

  it('grounds an ungrounded light source', () => {
    const r = buildCharacterGen(JANE, 'her glowing face in the dark');
    expect(r.prompt).toMatch(/visible in-frame light source/i);
  });

  it('warns and does not silently lower strength when asked too low', () => {
    const r = buildCharacterGen(JANE, 'portrait', { strength: 0.5 });
    expect(r.lora.strength).toBe(0.5);
    expect(r.notes.join()).toMatch(/drifts identity/i);
  });

  it('clamps absurd strengths into a safe band', () => {
    expect(buildCharacterGen(JANE, 'x', { strength: 99 }).lora.strength).toBe(1.2);
    expect(buildCharacterGen(JANE, 'x', { strength: -3 }).lora.strength).toBe(0.1);
  });

  it('falls back to the bare trigger for an empty prompt', () => {
    expect(buildCharacterGen(JANE, '').prompt).toBe('ohwx_jane');
  });
});
