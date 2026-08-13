import { describe, it, expect } from 'vitest';
import { signArtifact, verifyArtifact } from './bunker.js';

const SECRET = 'test-dashboard-secret';

describe('bunker scoped artifact capability', () => {
  it('verifies a freshly signed token for the same slug', () => {
    const { t, exp } = signArtifact('alpha', SECRET);
    expect(verifyArtifact('alpha', exp, t, SECRET)).toBe(true);
  });

  it('rejects a token minted for a different slug (slug binding)', () => {
    const { t, exp } = signArtifact('alpha', SECRET);
    expect(verifyArtifact('beta', exp, t, SECRET)).toBe(false);
  });

  it('rejects an expired token', () => {
    const past = Date.now() - 1000;
    const { t } = signArtifact('alpha', SECRET, past);
    expect(verifyArtifact('alpha', past, t, SECRET)).toBe(false);
  });

  it('rejects a tampered token', () => {
    const { t, exp } = signArtifact('alpha', SECRET);
    const tampered = (t[0] === '0' ? '1' : '0') + t.slice(1);
    expect(verifyArtifact('alpha', exp, tampered, SECRET)).toBe(false);
  });

  it('rejects a token bound to a different exp than presented', () => {
    const { t, exp } = signArtifact('alpha', SECRET);
    expect(verifyArtifact('alpha', exp + 1, t, SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const { t, exp } = signArtifact('alpha', SECRET);
    expect(verifyArtifact('alpha', exp, t, 'other-secret')).toBe(false);
  });

  it('rejects empty/missing inputs', () => {
    const { t, exp } = signArtifact('alpha', SECRET);
    expect(verifyArtifact('', exp, t, SECRET)).toBe(false);
    expect(verifyArtifact('alpha', exp, '', SECRET)).toBe(false);
    expect(verifyArtifact('alpha', exp, t, '')).toBe(false);
    expect(verifyArtifact('alpha', NaN, t, SECRET)).toBe(false);
  });
});
