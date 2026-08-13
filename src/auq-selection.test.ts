import { describe, it, expect } from 'vitest';

import { applyOtherSelection, stepHint, isSkipped } from './auq-selection.js';

describe('applyOtherSelection', () => {
  it('single-select: replaces the one allowed choice', () => {
    expect(applyOtherSelection(['Obey'], 'Pursue the Maze', false)).toEqual(['Pursue the Maze']);
  });

  it('single-select: sets the choice when nothing was selected', () => {
    expect(applyOtherSelection([], 'Amadeus Mozart', false)).toEqual(['Amadeus Mozart']);
  });

  it('multi-select: appends to already-toggled options (the fix)', () => {
    // The regression: an Other reply used to wipe the toggles, leaving only
    // the typed value. It must now coexist with them.
    expect(applyOtherSelection(['Vulcan', 'Klingon'], 'Romulans', true)).toEqual([
      'Vulcan',
      'Klingon',
      'Romulans',
    ]);
  });

  it('multi-select: dedupes a re-typed value', () => {
    expect(applyOtherSelection(['Vulcan', 'Klingon'], 'Vulcan', true)).toEqual(['Vulcan', 'Klingon']);
  });

  it('trims whitespace from the typed answer', () => {
    expect(applyOtherSelection([], '  Defiant  ', false)).toEqual(['Defiant']);
    expect(applyOtherSelection(['A'], '  B  ', true)).toEqual(['A', 'B']);
  });
});

describe('stepHint', () => {
  it('signals pick-one for single-select', () => {
    expect(stepHint(false)).toBe('(pick one)');
  });
  it('signals check-all + Done for multi-select', () => {
    expect(stepHint(true)).toBe('(check all that apply — tap to toggle, then Done)');
  });
});

describe('isSkipped', () => {
  it('true only when the slot is empty/undefined', () => {
    expect(isSkipped(undefined)).toBe(true);
    expect(isSkipped([])).toBe(true);
  });
  it('false once any answer — including an Other free-text — is present', () => {
    expect(isSkipped(['Bernard'])).toBe(false);
    expect(isSkipped(['do analysis on the behaviors'])).toBe(false);
  });
});
