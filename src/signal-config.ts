// Mindfield-only file. Holds Signal-Messenger configuration that is not part
// of upstream ClaudeClaw. Keeping these vars out of src/config.ts means Mark's
// config.ts stays pristine and we don't get merge conflicts on every upstream
// update. signal-bot.ts and signal-entry.ts import from here.

import { readEnvFile } from './env.js';

const env = readEnvFile([
  'MESSENGER_TYPE',
  'SIGNAL_PHONE_NUMBER',
  'SIGNAL_RPC_HOST',
  'SIGNAL_RPC_PORT',
  'SIGNAL_AUTHORIZED_RECIPIENTS',
]);

export type MessengerType = 'telegram' | 'signal';

export const MESSENGER_TYPE: MessengerType =
  ((process.env.MESSENGER_TYPE || env.MESSENGER_TYPE || 'telegram').toLowerCase() as MessengerType);

export const SIGNAL_PHONE_NUMBER =
  process.env.SIGNAL_PHONE_NUMBER || env.SIGNAL_PHONE_NUMBER || '';

export const SIGNAL_RPC_HOST =
  process.env.SIGNAL_RPC_HOST || env.SIGNAL_RPC_HOST || '127.0.0.1';

export const SIGNAL_RPC_PORT = parseInt(
  process.env.SIGNAL_RPC_PORT || env.SIGNAL_RPC_PORT || '7583',
  10,
);

export const SIGNAL_AUTHORIZED_RECIPIENTS = (
  process.env.SIGNAL_AUTHORIZED_RECIPIENTS || env.SIGNAL_AUTHORIZED_RECIPIENTS || ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
