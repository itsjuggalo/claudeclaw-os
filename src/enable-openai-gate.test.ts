// Native OpenAI (Codex SDK) is a STABLE, UNGATED provider — it does not ride
// ENABLE_ACP or any feature flag. This suite pins that: even with ENABLE_ACP
// off (experimental tier disabled), a saved 'openai' provider is honored,
// routed to the Codex adapter, resolves its GPT model, and owns its system
// prompt. Auth is enforced at call time by the adapter, not as a gate.

import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', () => ({
  PROJECT_ROOT: '/tmp/test',
  agentCwd: undefined,
  agentProvider: { type: 'openai' as const, model: 'gpt-5.5' },
  ENABLE_ACP: false,
  // The SDK stays the default native OpenAI transport; App Server is opt-in.
  CODEX_TRANSPORT: 'sdk',
  OPENAI_API_KEY: '',
  DEFAULT_CLAUDE_MODEL: 'claude-opus-4-8',
  DEFAULT_OPENAI_MODEL: 'gpt-5.5',
  CLAUDE_MODEL_OPUS: 'claude-opus-4-8',
  CLAUDE_MODEL_SONNET: 'claude-sonnet-4-6',
  CLAUDE_MODEL_HAIKU: 'claude-haiku-4-5',
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ClaudeSdkEngineAdapter, CodexSdkEngineAdapter, EngineFactory, engineSupportsSystemPrompt } from './agent-engine/index.js';
import { defaultModelForProvider, getSelectedProviderConfig } from './active-provider.js';
import { providerRunnable } from './provider-registry.js';

describe('native OpenAI provider is ungated (ENABLE_ACP off)', () => {
  it('providerRunnable is true for the stable tier regardless of ENABLE_ACP', () => {
    expect(providerRunnable('openai')).toBe(true);
    expect(providerRunnable('claude')).toBe(true);
    expect(providerRunnable('gemini')).toBe(false); // experimental, ACP off
  });

  it('getSelectedProviderConfig honors a saved openai provider', () => {
    const provider = getSelectedProviderConfig();
    expect(provider.type).toBe('openai');
    expect(provider.model).toBe('gpt-5.5');
  });

  it('EngineFactory routes openai to the Codex SDK adapter', () => {
    expect(EngineFactory.forProvider({ type: 'openai' })).toBeInstanceOf(CodexSdkEngineAdapter);
    expect(EngineFactory.forProvider({ type: 'claude' })).toBeInstanceOf(ClaudeSdkEngineAdapter);
  });

  it('openai models a system prompt — callers must not double-inject the persona', () => {
    expect(engineSupportsSystemPrompt({ type: 'openai' })).toBe(true);
  });

  it('defaultModelForProvider resolves the OpenAI default', () => {
    expect(defaultModelForProvider({ type: 'openai' })).toBe('gpt-5.5');
    expect(defaultModelForProvider({ type: 'openai', model: 'gpt-5.4-mini' })).toBe('gpt-5.4-mini');
  });
});
