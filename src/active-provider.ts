import { agentProvider } from './config.js';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_MODEL,
  getMainProviderConfig,
  type ProviderConfig,
} from './provider.js';

export function getSelectedProviderConfig(): ProviderConfig {
  return agentProvider ?? getMainProviderConfig();
}

export function defaultModelForProvider(
  provider: ProviderConfig,
  claudeDefault = DEFAULT_CLAUDE_MODEL,
): string | undefined {
  return provider.model
    ?? (provider.type === 'claude'
      ? claudeDefault
      : provider.type === 'codex'
        ? DEFAULT_CODEX_MODEL
        : undefined);
}
