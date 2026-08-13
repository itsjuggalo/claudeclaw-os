import type { ProviderConfig } from './provider.js';
import type { ClaudeThinking } from './model-catalog.js';
import { modelDisplayLabel } from './model-catalog.js';

export interface RuntimeIdentityOptions {
  /** Already normalized + validated against the model (`normalizedEffortForProvider`). */
  effort?: string;
  /** Claude only. The resolved thinking directive actually sent with the turn. */
  thinking?: ClaudeThinking;
}

// The clause describes what the turn REQUESTS, which is what the turn runs at.
// A model that carries no explicit value (adaptive-only, or the picker left on
// Default) omits the clause rather than printing a default that isn't real.
function thinkingClause(thinking: ClaudeThinking | undefined): string | undefined {
  if (!thinking) return undefined;
  switch (thinking.type) {
    case 'adaptive':
      return 'thinking: adaptive';
    case 'disabled':
      return 'thinking: off';
    case 'enabled':
      return thinking.budgetTokens
        ? `thinking: on (${thinking.budgetTokens} token budget)`
        : 'thinking: on';
  }
}

export function runtimeModelIdentity(
  provider: ProviderConfig,
  model?: string,
  options: RuntimeIdentityOptions = {},
): string {
  const label = model ? modelDisplayLabel(model) : 'the provider-selected default model';
  // Claude spends `runtimeMode` on effort and has a separate thinking switch;
  // OpenAI has one dial and the dashboard calls it "Reasoning effort".
  const effortLabel = provider.type === 'openai' ? 'reasoning effort' : 'effort';
  const parts = [`provider: ${provider.type}`];
  if (options.effort) parts.push(`${effortLabel}: ${options.effort}`);
  const thinking = thinkingClause(options.thinking);
  if (thinking) parts.push(thinking);
  return `You are currently running on ${label} (${parts.join(', ')}).`;
}

export function composeSystemPrompt(persona?: string, identity?: string): string | undefined {
  const parts = [persona?.trim(), identity?.trim()].filter((part): part is string => !!part);
  return parts.length ? parts.join('\n\n') : undefined;
}
