import { logger } from './logger.js';

// Backstop for one failure mode: the claude-agent-sdk child dies before its
// init write and emits a `write EPIPE` on its stdin socket. That error skips
// the query() iterator (so the adapter can't catch it) and would crash Node,
// which crash-loops the service. The real fix is the executable override in
// the adapter; this only keeps the bot alive if that ever slips through.
//
// The filter is tight (EPIPE + write + SDK frame) so every other crash still
// exits as before. It does not cancel the in-flight turn, so that turn may
// hang instead of failing cleanly — a stuck turn beats a crash-loop.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  const stack = typeof err?.stack === 'string' ? err.stack : '';
  const isSdkEpipe =
    err?.code === 'EPIPE' &&
    err?.syscall === 'write' &&
    stack.includes('@anthropic-ai/claude-agent-sdk');
  if (isSdkEpipe) {
    logger.error(
      { err: err.message },
      'claude-agent-sdk child exited early (EPIPE). Bot stays up; this turn may stall, so retry it.',
    );
    return;
  }
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
