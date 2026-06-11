import pino from 'pino';

// Mask Telegram bot tokens anywhere they appear in a serialized string. grammy's
// FetchError carries the full request URL (https://api.telegram.org/bot<TOKEN>/…)
// and pino logged the whole error object, which leaked the token into PM2 logs.
const TG_TOKEN_RE = /(api\.telegram\.org\/bot)\d{6,12}:[A-Za-z0-9_-]{30,}/g;
// Catch-all for a bare "<digits>:<30+ token chars>" too (e.g. logged separately).
const BARE_TOKEN_RE = /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g;
function redact(s: string): string {
  return s.replace(TG_TOKEN_RE, '$1<REDACTED>').replace(BARE_TOKEN_RE, '<REDACTED_TOKEN>');
}

// Redact an error WITHOUT losing its diagnostics: serialize to pino's standard
// shape (type/message/stack) first, then scrub the token out of message + stack.
function redactErr(e: unknown): unknown {
  const base = pino.stdSerializers.err(e as Error) as Record<string, unknown> | undefined;
  if (base && typeof base === 'object') {
    if (typeof base.message === 'string') base.message = redact(base.message);
    if (typeof base.stack === 'string') base.stack = redact(base.stack);
  }
  return base;
}

// Applied to the common error-carrying fields. Strings get scrubbed; Error
// objects get serialized-then-scrubbed (keeping message/stack, minus the token).
// Anything else passes through untouched, so a non-error value logged under one
// of these field names is never mangled.
const errSerializer = (v: unknown) => {
  if (typeof v === 'string') return redact(v);
  if (v instanceof Error) return redactErr(v);
  return v;
};

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: { err: errSerializer, error: errSerializer, e: errSerializer },
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
