import { describe, it, expect } from 'vitest';
import { formatForSignal } from './bot.js';

// formatForSignal converts Markdown/HTML to plain text for Signal, which renders
// no markup (unlike Telegram's HTML parse mode). These lock in the stripping
// rules so a regression can't silently start leaking <b>/**bold**/etc. into
// Signal messages.

describe('formatForSignal', () => {
  it('strips bold/italic/strikethrough markers but keeps the text', () => {
    expect(formatForSignal('**bold** and *italic* and ~~gone~~')).toBe('bold and italic and gone');
  });

  it('drops heading hashes, keeps the heading text', () => {
    expect(formatForSignal('# Titel\n## Untertitel')).toBe('Titel\nUntertitel');
  });

  it('renders links as "text (url)"', () => {
    expect(formatForSignal('[Shop](https://mindfield-shop.com)')).toBe('Shop (https://mindfield-shop.com)');
  });

  it('unwraps fenced and inline code', () => {
    expect(formatForSignal('```\nconst x = 1;\n```')).toContain('const x = 1;');
    expect(formatForSignal('use `npm run dev`')).toBe('use npm run dev');
  });

  it('strips stray HTML tags and decodes entities', () => {
    expect(formatForSignal('<b>Hallo</b> &amp; tsch&uuml;ss'.replace('&uuml;', 'ü'))).toBe('Hallo & tschüss');
    expect(formatForSignal('a &lt;tag&gt; b')).toBe('a <tag> b');
  });

  it('converts checkbox list items', () => {
    expect(formatForSignal('- [x] done\n- [ ] todo')).toBe('✓ done\n☐ todo');
  });

  it('collapses 3+ blank lines to a single gap and trims', () => {
    expect(formatForSignal('a\n\n\n\n\nb\n')).toBe('a\n\nb');
  });

  it('is idempotent on already-clean text', () => {
    const clean = 'Plain text with a number 42 and an emoji 🙂';
    expect(formatForSignal(clean)).toBe(clean);
    expect(formatForSignal(formatForSignal(clean))).toBe(clean);
  });

  it('preserves German umlauts and currency words', () => {
    expect(formatForSignal('**Größe**: 5 EUR für Müller')).toBe('Größe: 5 EUR für Müller');
  });

  // ── 2026-07-12: readability hardening (Niko: HTML leaks, technical noise, structure) ──

  it('unwraps <a href> HTML links to "text (url)" (Telegram-HTML leaking to Signal)', () => {
    expect(formatForSignal('Mehr: <a href="https://mindfield-shop.com/esense">hier</a>'))
      .toBe('Mehr: hier (https://mindfield-shop.com/esense)');
  });

  it('handles a realistic scheduler line with bold + link together', () => {
    expect(formatForSignal('<b>Fertig.</b> Siehe <a href="https://x.de">Report</a>'))
      .toBe('Fertig. Siehe Report (https://x.de)');
  });

  it('turns <br> into a real line break', () => {
    expect(formatForSignal('Zeile1<br>Zeile2')).toBe('Zeile1\nZeile2');
    expect(formatForSignal('Zeile1<br/>Zeile2')).toBe('Zeile1\nZeile2');
  });

  it('strips ANSI colour escape codes (raw terminal output leaking in)', () => {
    expect(formatForSignal('\x1b[31mFehler\x1b[0m beim Build')).toBe('Fehler beim Build');
  });

  it('renders Markdown bullet lists with a clean • bullet', () => {
    expect(formatForSignal('- Apfel\n- Birne')).toBe('• Apfel\n• Birne');
    expect(formatForSignal('* Apfel')).toBe('• Apfel');
  });

  it('renders <li> items as bullets and drops list wrappers', () => {
    expect(formatForSignal('<ul><li>eins</li><li>zwei</li></ul>')).toBe('• eins\n• zwei');
  });

  it('does NOT eat literal comparison operators (real < > from math, arriving as entities)', () => {
    // whitelist-strip must not treat "a < b > c" as an HTML tag
    expect(formatForSignal('wenn a &lt; b und b &gt; c')).toBe('wenn a < b und b > c');
  });

  it('stays idempotent after the new rules', () => {
    const msg = 'Fertig. Siehe Report (https://x.de)\n• Apfel\n• Birne';
    expect(formatForSignal(msg)).toBe(msg);
  });
});
