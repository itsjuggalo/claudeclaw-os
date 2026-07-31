import { describe, it, expect } from 'vitest';
import {
  COMPLETION_DONE_GLYPH,
  COMPLETION_FAILED_GLYPH,
  COMPLETION_NOTICE_GLYPH,
  completionStatusGlyph,
} from './completion-glyph.js';

describe('completionStatusGlyph', () => {
  it('flags a failure rather than closing it out as a success', () => {
    expect(completionStatusGlyph('failed')).toBe(COMPLETION_FAILED_GLYPH);
    expect(completionStatusGlyph('error')).toBe(COMPLETION_FAILED_GLYPH);
  });

  it('renders a notice as advisory: not a win, not a failure', () => {
    expect(completionStatusGlyph('notice')).toBe(COMPLETION_NOTICE_GLYPH);
    expect(completionStatusGlyph('notice')).not.toBe(COMPLETION_FAILED_GLYPH);
    expect(completionStatusGlyph('notice')).not.toBe(COMPLETION_DONE_GLYPH);
  });

  it('treats anything else, including an absent status, as done', () => {
    expect(completionStatusGlyph('completed')).toBe(COMPLETION_DONE_GLYPH);
    expect(completionStatusGlyph(undefined)).toBe(COMPLETION_DONE_GLYPH);
    expect(completionStatusGlyph('some-future-status')).toBe(COMPLETION_DONE_GLYPH);
  });

  it('never reports an adverse status under the success glyph', () => {
    for (const status of ['failed', 'error', 'notice']) {
      expect(completionStatusGlyph(status)).not.toBe(COMPLETION_DONE_GLYPH);
    }
  });

  it('keeps the three glyphs distinct so a reader can tell the rungs apart', () => {
    const glyphs = new Set([COMPLETION_DONE_GLYPH, COMPLETION_FAILED_GLYPH, COMPLETION_NOTICE_GLYPH]);
    expect(glyphs.size).toBe(3);
  });
});
