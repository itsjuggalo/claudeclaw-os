// ── AskUserQuestion → Signal numbered-reply bridge (MINDFIELD) ──────────────
// Signal has no inline keyboards (unlike Telegram's #101 callback_query wizard),
// so the built-in AskUserQuestion tool is bridged here as a text stepper: each
// question is sent with numbered options, and the user's NEXT inbound message is
// captured as the answer. The Claude SDK adapter intercepts the tool call (see
// claude-sdk-adapter.ts) and invokes the resolver built by
// makeSignalAskUserQuestionResolver(); signal-bot's onMessage routes the reply
// in via feedPendingSignalQuestion() instead of starting a new agent turn.
import type {
  AskUserQuestionRequest,
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionResolver,
} from './agent-engine/index.js';
import { logger } from './logger.js';

const AUQ_TIMEOUT_MS = 10 * 60 * 1000; // 10 min to reply before giving up

// Mirrors bot.ts: returned to the model when the user types "go" — end the
// clarifying-question flow and continue with whatever was gathered.
const PROCEED_DIRECTIVE =
  'The user has ended the clarifying-question flow and wants you to proceed. ' +
  'Use any answers gathered so far plus your best judgment. Do NOT open further ' +
  'AskUserQuestion prompts for the rest of this turn. If meaningful ambiguity ' +
  'remains, continue with reasonable assumptions, then at the end briefly ' +
  'summarize what you did and ask in plain text whether they want to change ' +
  'anything or take a different direction.';

interface PendingReply {
  resolve: (text: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// One in-flight free-text wait per chat. A new wait supersedes any prior one.
const pendingByChat = new Map<string, PendingReply>();

/** True if an AskUserQuestion in this chat is awaiting the user's reply. */
export function hasPendingSignalQuestion(chatId: string): boolean {
  return pendingByChat.has(chatId);
}

/**
 * Route an inbound message to a waiting question. Returns true if it was
 * consumed as an answer (caller must then NOT start a new agent turn).
 */
export function feedPendingSignalQuestion(chatId: string, text: string): boolean {
  const p = pendingByChat.get(chatId);
  if (!p) return false;
  clearTimeout(p.timeout);
  pendingByChat.delete(chatId);
  p.resolve(text);
  return true;
}

/** Tear down a registered waiter (e.g. when the send that follows it fails). */
function cancelPendingReply(chatId: string): void {
  const p = pendingByChat.get(chatId);
  if (!p) return;
  clearTimeout(p.timeout);
  pendingByChat.delete(chatId);
  p.resolve(null);
}

function waitForReply(chatId: string, abortController?: AbortController): Promise<string | null> {
  // Supersede any stale wait in this chat.
  const prior = pendingByChat.get(chatId);
  if (prior) {
    clearTimeout(prior.timeout);
    pendingByChat.delete(chatId);
    prior.resolve(null);
  }
  return new Promise<string | null>((resolve) => {
    if (abortController?.signal.aborted) {
      resolve(null);
      return;
    }
    const timeout = setTimeout(() => {
      if (pendingByChat.get(chatId) === entry) pendingByChat.delete(chatId);
      resolve(null);
    }, AUQ_TIMEOUT_MS);
    const entry: PendingReply = { resolve, timeout };
    pendingByChat.set(chatId, entry);
    abortController?.signal.addEventListener(
      'abort',
      () => {
        if (pendingByChat.get(chatId) === entry) {
          clearTimeout(timeout);
          pendingByChat.delete(chatId);
          resolve(null);
        }
      },
      { once: true },
    );
  });
}

/** Render one question with numbered options + reply hint (German UI). */
export function renderQuestion(q: AskUserQuestionItem, idx: number, total: number): string {
  const prefix = total > 1 ? `(${idx + 1}/${total}) ` : '';
  const lines = [`❓ ${prefix}${q.question}`];
  q.options.forEach((opt, i) => {
    lines.push(`  ${i + 1}. ${opt.label}${opt.description ? ` — ${opt.description}` : ''}`);
  });
  lines.push('');
  const multi = q.multiSelect ? ' (mehrere mit Komma, z.B. 1,3)' : '';
  lines.push(
    `↳ Antworte mit der Nummer${multi}, eigenem Text, „go" (mit bisherigen Antworten weitermachen) oder „stop" (abbrechen).`,
  );
  return lines.join('\n');
}

export type ParsedReply =
  | { control: 'stop' }
  | { control: 'go' }
  | { selected: string[] };

/** Parse a free-text reply into selected option labels or a control action. */
export function parseReply(reply: string, q: AskUserQuestionItem): ParsedReply {
  const t = reply.trim();
  const lower = t.toLowerCase();
  if (lower === 'stop' || lower === '/stop' || lower === 'abbrechen' || lower === 'cancel') {
    return { control: 'stop' };
  }
  if (lower === 'go' || lower === 'weiter' || lower === 'proceed' || lower === 'los') {
    return { control: 'go' };
  }
  // Number(s)? "2" or "1,3" (multi). Mixed/garbage falls through to free text.
  const tokens = t.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const allNumeric = tokens.length > 0 && tokens.every((n) => /^\d+$/.test(n));
  if (allNumeric) {
    const picked = tokens
      .map((n) => parseInt(n, 10) - 1)
      .filter((i) => i >= 0 && i < q.options.length)
      .map((i) => q.options[i].label);
    if (picked.length > 0) return { selected: q.multiSelect ? picked : [picked[0]] };
  }
  // Free-text answer — pass through verbatim (covers the Telegram "Other" case).
  return { selected: [t] };
}

/**
 * Build the resolver handed to the agent for one Signal chat. Walks the
 * questions one at a time, sending each as numbered text and awaiting the
 * user's reply. "stop" aborts the turn; "go" proceeds with the proceed
 * directive; a timeout returns whatever was gathered (or null if nothing).
 */
export function makeSignalAskUserQuestionResolver(
  chatId: string,
  sendMessage: (recipient: string, text: string) => Promise<void>,
  abortController?: AbortController,
): AskUserQuestionResolver {
  // Turn-level flag: once the user types "go", later AskUserQuestion calls in
  // the same turn are auto-answered with the proceed directive (no prompt).
  let stopAsking = false;
  return async (request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer | null> => {
    if (abortController?.signal.aborted) return null;
    if (stopAsking) return { answers: [], directive: PROCEED_DIRECTIVE };

    const total = request.questions.length;
    const answers: AskUserQuestionAnswerItem[] = [];

    for (let i = 0; i < total; i++) {
      const q = request.questions[i];
      // PR #111 review #8: register the reply waiter BEFORE awaiting the send.
      // Otherwise a reply that arrives during the send round-trip finds no
      // pending waiter and leaks into a brand-new agent turn instead of
      // answering this question.
      const replyPromise = waitForReply(chatId, abortController);
      try {
        await sendMessage(chatId, renderQuestion(q, i, total));
      } catch (err) {
        logger.warn({ err }, 'Failed to send AskUserQuestion to Signal');
        cancelPendingReply(chatId);
        return answers.length ? { answers } : null;
      }

      const reply = await replyPromise;
      if (reply === null) {
        // null = timeout OR external abort (e.g. the user ran /stop). On an
        // explicit abort the turn is already ending, so don't tell the user
        // we're "continuing" — that only applies to the timeout case.
        if (!abortController?.signal.aborted) {
          await sendMessage(chatId, '⏳ Keine Antwort — ich mache mit meiner besten Einschätzung weiter.').catch(() => {});
        }
        return answers.length ? { answers } : null;
      }

      const parsed = parseReply(reply, q);
      if ('control' in parsed && parsed.control === 'stop') {
        await sendMessage(chatId, '✖ Abgebrochen.').catch(() => {});
        abortController?.abort();
        return null;
      }
      if ('control' in parsed && parsed.control === 'go') {
        stopAsking = true;
        return { answers, directive: PROCEED_DIRECTIVE };
      }
      answers.push({ header: q.header, question: q.question, selected: (parsed as { selected: string[] }).selected });
    }

    return { answers };
  };
}
