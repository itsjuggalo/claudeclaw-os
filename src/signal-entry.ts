// Signal entry point (MINDFIELD). Selected at boot by src/main-entry.ts when
// MESSENGER_TYPE=signal. Supplies a Signal Messenger to the shared
// bootMessenger() path (src/messenger.ts) — the same path src/index.ts uses for
// Telegram. This replaces the old literal fork of index.ts: all non-transport
// boot logic (PID lock, DB, security, dashboard, War Room, scheduler, shutdown,
// main-agent CLAUDE.md + provider resolution) is now shared, so the fork-drift
// bugs that plagued the old signal-entry.ts (unconditional releaseLock, missing
// provider config, /tmp warroom path) cannot recur. Realises upstream #98.
// Imported first so the process-level uncaughtException guard registers before
// any transport module (signal-bot.ts → agent.ts) transitively pulls in the SDK.
import './crash-guard.js';
import { createSignalBot, SignalBot } from './signal-bot.js';
import { SIGNAL_AUTHORIZED_RECIPIENTS, SIGNAL_PHONE_NUMBER } from './signal-config.js';
import { groupForAgent } from './signal-groups.js';
import { groupRecipient } from './signal-rpc.js';
import { logger } from './logger.js';
import { bootMessenger, Messenger, MessengerFactory } from './messenger.js';
import { setTelegramConnected, setBotInfo } from './state.js';

/** Build the Signal Messenger (called after DB init). */
function createSignalMessenger(agentId: string): Messenger {
  const signalBot: SignalBot = createSignalBot();

  // Status-message recipient: an agent with a mapped Signal group delivers its
  // scheduler/status messages INTO that group; otherwise the first authorized
  // number, else the daemon's own number (sync-to-self works for testing).
  const ownGroup = groupForAgent(agentId);
  const primaryRecipient = ownGroup
    ? groupRecipient(ownGroup)
    : (SIGNAL_AUTHORIZED_RECIPIENTS[0] ?? SIGNAL_PHONE_NUMBER);

  return {
    kind: 'signal',
    primaryRecipient,

    // The dashboard's /api/chat/send route only calls `sendMessage`; a minimal
    // Telegram-Api-shaped shim relays the agent reply back to Signal via the
    // same code path (so processMessageFromDashboard works under Signal).
    dashboardApi: {
      sendMessage: async (_chatId: unknown, text: string, _opts?: unknown) => {
        await signalBot.sendTo(primaryRecipient, text);
        return undefined;
      },
    },

    async sendToPrimary(text: string): Promise<void> {
      await signalBot.sendTo(primaryRecipient, text).catch((err) =>
        logger.error({ err }, 'Signal status message failed'),
      );
    },

    async start(_interactive: boolean): Promise<void> {
      await signalBot.start();
      setTelegramConnected(true); // reuse the connected flag for dashboard state
      setBotInfo('signal', 'ClaudeClaw (Signal)');
      if (agentId === 'main') {
        console.log(`\n  ClaudeClaw online via Signal: ${SIGNAL_PHONE_NUMBER}`);
        if (SIGNAL_AUTHORIZED_RECIPIENTS.length === 0) {
          console.log('  No SIGNAL_AUTHORIZED_RECIPIENTS set — only sync-to-self messages will be accepted.');
        }
        console.log();
      } else {
        console.log(`\n  ClaudeClaw agent [${agentId}] online via Signal\n`);
      }
    },

    async stop(): Promise<void> {
      await signalBot.stop();
    },
  };
}

const signalFactory: MessengerFactory = {
  preflight(_agentId: string): void {
    if (!SIGNAL_PHONE_NUMBER) {
      logger.error('SIGNAL_PHONE_NUMBER not set. Link signal-cli first, then set it in .env.');
      process.exit(1);
    }
  },
  create: createSignalMessenger,
};

void bootMessenger(signalFactory);
