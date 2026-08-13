import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';

import { redactString, redactValue, hasSecret } from './log-redact.js';

// Structurally valid but fake credentials. Nothing here is a live secret.
const FAKE_TG = '1234567890:AAFAKEfakeFAKEfakeFAKEfakeFAKEfake123';
const FAKE_URL = `https://api.telegram.org/bot${FAKE_TG}/getUpdates`;

describe('redactString', () => {
  it('redacts the exact shape that leaked into production logs', () => {
    // Verbatim structure of the node-fetch message grammy propagated on every
    // Telegram network hiccup — this is what put the token on disk ~190 times.
    const real = `FetchError: request to ${FAKE_URL} failed, reason: getaddrinfo ENOTFOUND api.telegram.org`;

    const out = redactString(real);

    expect(out).not.toContain('AAFAKEfake');
    expect(out).toContain('<redacted>');
    // The numeric bot id survives: it identifies which bot without being a secret.
    expect(out).toContain('/bot1234567890:<redacted>');
    // Everything else must be preserved or the log stops being diagnostic.
    expect(out).toContain('getaddrinfo ENOTFOUND');
  });

  it('redacts a bare telegram token outside a URL', () => {
    expect(redactString(`token=${FAKE_TG}`)).not.toContain('AAFAKEfake');
  });

  it.each([
    ['authorization header', 'Authorization: Bearer abcdef0123456789ghij', 'abcdef0123456789ghij'],
    ['url userinfo', 'https://x-access-token:ghs_FAKEFAKEFAKEFAKEFAKE1234@github.com/o/r', 'ghs_FAKE'],
    ['anthropic key', 'key=sk-ant-FAKEfakeFAKEfake0123456789', 'sk-ant-FAKE'],
    ['github token', 'ghp_FAKEfakeFAKEfake0123456789ab', 'ghp_FAKE'],
    ['slack token', 'xoxb-1111-2222-FAKEfakeFAKEfake', 'xoxb-1111'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.FAKEfakeFAKEfake', 'eyJhbGci'],
  ])('redacts %s', (_label, input, secretFragment) => {
    expect(redactString(input)).not.toContain(secretFragment);
  });

  it('leaves ordinary log lines untouched', () => {
    const clean = 'Dashboard GET /api/health 200 in 4ms';
    expect(redactString(clean)).toBe(clean);
  });

  it('does not mangle a plain telegram chat id', () => {
    // Chat ids are numeric and must stay readable — they are not credentials.
    const line = 'Processing message for chat 1234567890';
    expect(redactString(line)).toBe(line);
  });
});

describe('hasSecret', () => {
  it('detects and then clears', () => {
    expect(hasSecret(FAKE_URL)).toBe(true);
    expect(hasSecret(redactString(FAKE_URL))).toBe(false);
  });

  it('is repeatable — global regex lastIndex must not leak between calls', () => {
    expect(hasSecret(FAKE_URL)).toBe(true);
    expect(hasSecret(FAKE_URL)).toBe(true);
    expect(hasSecret(FAKE_URL)).toBe(true);
  });
});

describe('redactValue', () => {
  it('redacts an Error message and stack without mutating the original', () => {
    const err = new Error(`request to ${FAKE_URL} failed`);
    const out = redactValue(err) as Error;

    expect(out.message).not.toContain('AAFAKEfake');
    expect(out).not.toBe(err);
    // The live error object is still handled by callers — leave it alone.
    expect(err.message).toContain('AAFAKEfake');
  });

  it('preserves the error name and extra properties', () => {
    const err = Object.assign(new Error(`bad ${FAKE_URL}`), { code: 'ENOTFOUND', attempt: 3 });
    err.name = 'FetchError';
    const out = redactValue(err) as Error & { code: string; attempt: number };

    expect(out.name).toBe('FetchError');
    expect(out.code).toBe('ENOTFOUND');
    expect(out.attempt).toBe(3);
  });

  it('walks nested objects and arrays', () => {
    const payload = { err: { detail: [{ url: FAKE_URL }] }, ok: true, count: 2 };
    const out = redactValue(payload) as typeof payload;

    expect(JSON.stringify(out)).not.toContain('AAFAKEfake');
    expect(out.ok).toBe(true);
    expect(out.count).toBe(2);
  });

  it('survives circular references', () => {
    const node: Record<string, unknown> = { url: FAKE_URL };
    node.self = node;

    expect(() => redactValue(node)).not.toThrow();
    expect(JSON.stringify(redactValue(node))).not.toContain('AAFAKEfake');
  });

  it('passes non-string leaves through untouched', () => {
    const d = new Date(0);
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(undefined)).toBe(undefined);
    expect(redactValue(false)).toBe(false);
    expect(redactValue(d)).toEqual(d);
  });
});

describe('pino integration', () => {
  /** Capture what a pino instance actually writes, hooks included. */
  function capture(): { log: pino.Logger; lines: string[] } {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = pino(
      {
        hooks: {
          logMethod(args, method) {
            return method.apply(this, args.map((a) => redactValue(a)) as Parameters<typeof method>);
          },
        },
      },
      sink,
    );
    return { log, lines };
  }

  it('redacts through the merging object — the path that leaked', () => {
    const { log, lines } = capture();
    log.error({ err: new Error(`request to ${FAKE_URL} failed`) }, 'Telegram bot error');

    expect(lines.join('')).not.toContain('AAFAKEfake');
    expect(lines.join('')).toContain('Telegram bot error');
  });

  it('redacts through the message string', () => {
    const { log, lines } = capture();
    log.error(`boom: ${FAKE_URL}`);

    expect(lines.join('')).not.toContain('AAFAKEfake');
  });

  it('redacts through interpolation arguments', () => {
    const { log, lines } = capture();
    log.error('boom: %s', FAKE_URL);

    expect(lines.join('')).not.toContain('AAFAKEfake');
  });
});
