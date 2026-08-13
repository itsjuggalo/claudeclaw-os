import { describe, it, expect } from 'vitest';
import { splitMessage, SIGNAL_MAX_MESSAGE_LENGTH, redactAuditDetail } from './signal-bot.js';

// splitMessage chunks a long reply so Signal doesn't drop or wall-of-text it.
// 2026-07-12: hardened for Niko's "abgeschnitten" complaint — word-safe breaks
// + "(n/m)" continuation markers so a follow-on message reads as a continuation,
// not a cut-off fragment.

const stripMarker = (p: string) => p.replace(/\n\n\(\d+\/\d+\)$/, '');

describe('splitMessage (Signal)', () => {
  it('returns a single unmarked part for short text', () => {
    expect(splitMessage('Kurze Antwort.')).toEqual(['Kurze Antwort.']);
  });

  it('splits text longer than the limit into multiple parts', () => {
    const long = 'wort '.repeat(1200); // 6000 chars
    const parts = splitMessage(long);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('never emits a part longer than the Signal limit', () => {
    const long = 'wort '.repeat(1200);
    for (const p of splitMessage(long)) {
      expect(p.length).toBeLessThanOrEqual(SIGNAL_MAX_MESSAGE_LENGTH);
    }
  });

  it('appends "(n/m)" continuation markers to every part', () => {
    const long = 'wort '.repeat(1200);
    const parts = splitMessage(long);
    const total = parts.length;
    parts.forEach((p, i) => {
      expect(p.endsWith(`(${i + 1}/${total})`)).toBe(true);
    });
  });

  it('breaks on word boundaries — no word is split across parts', () => {
    const long = 'wort '.repeat(1200).trim();
    const parts = splitMessage(long);
    const rejoined = parts.map(stripMarker).join(' ').replace(/\s+/g, ' ').trim();
    expect(rejoined).toBe(long.replace(/\s+/g, ' ').trim());
  });

  it('prefers a line break when one is available in the window', () => {
    const block = ('a'.repeat(100) + '\n').repeat(60); // ~6060 chars, many newlines
    const parts = splitMessage(block);
    // every break landed on a newline → no part-content line is a merged 200-char run
    for (const p of parts) {
      for (const line of stripMarker(p).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('still splits a pathological unbreakable string without looping or overflowing', () => {
    const blob = 'x'.repeat(9000); // no whitespace at all
    const parts = splitMessage(blob);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(SIGNAL_MAX_MESSAGE_LENGTH);
    expect(parts.map(stripMarker).join('')).toBe(blob);
  });
});

describe('redactAuditDetail (Signal audit log, PR #111 #10)', () => {
  it('redacts a token= query value in a pasted dashboard URL', () => {
    expect(redactAuditDetail('schau: https://host/dashboard?token=SECRET123&chatId=%2B49'))
      .toBe('schau: https://host/dashboard?token=[REDACTED]&chatId=%2B49');
  });

  it('redacts a trailing token= value with no further params', () => {
    expect(redactAuditDetail('url?token=abc.def-ghi')).toBe('url?token=[REDACTED]');
  });

  it('leaves token-free text untouched', () => {
    expect(redactAuditDetail('ganz normale Nachricht ohne Geheimnis')).toBe('ganz normale Nachricht ohne Geheimnis');
  });
});
