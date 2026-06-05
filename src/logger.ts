import pino from 'pino';

// Mask Telegram bot tokens anywhere they appear in a serialized string. grammy's
// FetchError carries the full request URL (https://api.telegram.org/bot<TOKEN>/…)
// and pino logs the whole error object, which leaked the token into PM2 logs.
const TG_TOKEN_RE = /(api\.telegram\.org\/bot)\d{6,12}:[A-Za-z0-9_-]{30,}/g;
// Catch-all for a bare "<digits>:<35+ token chars>" too (e.g. logged separately).
const BARE_TOKEN_RE = /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g;
function redact(s: string): string {
  return s.replace(TG_TOKEN_RE, '$1<REDACTED>').replace(BARE_TOKEN_RE, '<REDACTED_TOKEN>');
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: {
    // Applied to any `{ err }` (and `{ error }`) field. Redacts message + stack so
    // a Telegram API failure can never write a live token to disk.
    err: (e: unknown) => {
      const base = pino.stdSerializers.err(e as Error);
      if (base && typeof base === 'object') {
        if (typeof base.message === 'string') base.message = redact(base.message);
        if (typeof base.stack === 'string') base.stack = redact(base.stack);
      }
      return base;
    },
  },
  // Final safety net: redact tokens from every emitted log line, regardless of
  // which field or serializer produced them.
  formatters: {
    log: (obj: Record<string, unknown>) => {
      try { return JSON.parse(redact(JSON.stringify(obj))); } catch { return obj; }
    },
  },
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
