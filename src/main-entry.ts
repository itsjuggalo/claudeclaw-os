// Mindfield-only file. Tiny dispatcher that picks the right entry point
// based on MESSENGER_TYPE. Keeps Mark's src/index.ts pristine; signal-entry
// handles the Signal-aware boot. The launchd plist for the main process
// targets dist/main-entry.js. Specialists keep using dist/index.js because
// they only delegate to main and don't open their own messenger transport.
//
// Reads MESSENGER_TYPE from .env directly because launchd does not load
// .env automatically (and we don't want to add MESSENGER_TYPE to Mark's
// launchd plist, which would create a future conflict surface).

import { readEnvFile } from './env.js';

const env = readEnvFile(['MESSENGER_TYPE']);
const messenger = (process.env.MESSENGER_TYPE || env.MESSENGER_TYPE || 'telegram').toLowerCase();

// MINDFIELD: propagate into process.env so downstream modules that read
// process.env.MESSENGER_TYPE directly (scheduler.formatTaskOutput,
// bot.formatForActiveMessenger, signal-bot defensive sanitizer) see the
// right value. Without this, launchd-spawned services fall back to
// 'telegram' default and emit <b>/<pre> HTML into Signal messages.
process.env.MESSENGER_TYPE = messenger;

if (messenger === 'signal') {
  await import('./signal-entry.js');
} else {
  await import('./index.js');
}
