// Telegram entry point. Supplies a Telegram Messenger to the shared
// bootMessenger() path (src/messenger.ts) — all the non-transport boot logic
// (DB, security, dashboard, War Room, scheduler, shutdown) lives there and is
// shared with the Signal entry (src/signal-entry.ts). This realises upstream
// #98 (bootMessenger(messengerFactory)).
// Imported first so the process-level uncaughtException guard registers before
// any transport module (bot.ts → agent.ts) transitively pulls in the SDK.
import './crash-guard.js';
import { createBot, splitMessage } from './bot.js';
import { activeBotToken, ALLOWED_CHAT_ID } from './config.js';
import { logger } from './logger.js';
import { bootMessenger, Messenger, MessengerFactory } from './messenger.js';
import { setTelegramConnected, setBotInfo } from './state.js';

/** Build the Telegram Messenger (called after DB init — createBot() reads the DB). */
function createTelegramMessenger(agentId: string): Messenger {
  const bot = createBot();

  return {
    kind: 'telegram',
    primaryRecipient: ALLOWED_CHAT_ID,
    dashboardApi: bot.api,

    async sendToPrimary(text: string): Promise<void> {
      if (!ALLOWED_CHAT_ID) return;
      // Telegram's 4096-char limit + HTML parse mode.
      for (const chunk of splitMessage(text)) {
        await bot.api.sendMessage(ALLOWED_CHAT_ID, chunk, { parse_mode: 'HTML' }).catch((err) =>
          logger.error({ err }, 'Telegram status message failed'),
        );
      }
    },

    async start(interactive: boolean): Promise<void> {
      if (!interactive) {
        // Automation-only agent: do NOT poll Telegram (no getUpdates), so it can
        // share a bot token with an interactive agent without a 409. It still
        // sends outbound (scheduler results, alerts) via bot.api.
        try {
          const me = await bot.api.getMe();
          setTelegramConnected(true);
          setBotInfo(me.username ?? '', me.first_name ?? 'ClaudeClaw');
          logger.info({ agentId, username: me.username }, 'ClaudeClaw agent running (automation-only, no polling)');
          console.log(`\n  ClaudeClaw agent [${agentId}] online (automation-only): @${me.username}\n`);
        } catch (err) {
          logger.warn({ err, agentId }, 'Could not fetch bot identity (non-fatal)');
        }
        return;
      }

      // Clear any existing webhook so polling works cleanly.
      try {
        await bot.api.deleteWebhook({ drop_pending_updates: false });
      } catch (err) {
        logger.warn({ err }, 'Could not clear webhook (non-fatal)');
      }

      await bot.start({
        onStart: (botInfo) => {
          setTelegramConnected(true);
          setBotInfo(botInfo.username ?? '', botInfo.first_name ?? 'ClaudeClaw');
          logger.info({ username: botInfo.username }, 'ClaudeClaw is running');
          if (agentId === 'main') {
            console.log(`\n  ClaudeClaw online: @${botInfo.username}`);
            if (!ALLOWED_CHAT_ID) {
              console.log('  Send /chatid to get your chat ID for ALLOWED_CHAT_ID');
            }
            console.log();
          } else {
            console.log(`\n  ClaudeClaw agent [${agentId}] online: @${botInfo.username}\n`);
          }
        },
      });
    },

    async stop(): Promise<void> {
      await bot.stop();
    },
  };
}

const telegramFactory: MessengerFactory = {
  preflight(agentId: string): void {
    if (!activeBotToken) {
      if (agentId === 'main') {
        logger.error('Bot token is not set. Run npm run setup to configure it.');
      } else {
        logger.error({ agentId }, `Configuration for agent "${agentId}" is broken: bot token not set. Check .env or re-run npm run agent:create.`);
      }
      process.exit(1);
    }
  },
  create: createTelegramMessenger,
};

void bootMessenger(telegramFactory);
