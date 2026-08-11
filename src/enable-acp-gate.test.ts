// Verifies the ENABLE_ACP feature flag forces Claude on every path when off,
// regardless of saved provider config. This is the gated-state counterpart
// to the existing multi-provider tests that run with the flag on.

import { describe, it, expect, vi } from 'vitest';

// Experimental (ACP-family) providers are gated by ENABLE_ACP; stable
// providers (Claude, OpenAI) are NOT — see src/provider-registry.ts. This
// suite pins the flag-off behavior for the experimental tier.
vi.mock('./config.js', () => ({
  PROJECT_ROOT: '/tmp/test',
  agentCwd: undefined,
  agentProvider: { type: 'gemini' as const, model: 'gemini-2.5-pro' },
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

import { ClaudeSdkEngineAdapter, CodexSdkEngineAdapter, EngineFactory } from './agent-engine/index.js';
import { getSelectedProviderConfig } from './active-provider.js';

describe('ENABLE_ACP gate (flag off)', () => {
  it('getSelectedProviderConfig falls back to Claude when the saved provider is an experimental (ACP) type', () => {
    // agentProvider is gemini (experimental) → not runnable with ACP off.
    const provider = getSelectedProviderConfig();
    expect(provider.type).toBe('claude');
  });

  it('EngineFactory returns the Claude adapter for every experimental provider type', () => {
    for (const type of ['gemini', 'acp-codex', 'opencode', 'acp', 'openrouter'] as const) {
      expect(EngineFactory.forProvider({ type })).toBeInstanceOf(ClaudeSdkEngineAdapter);
    }
  });

  it('stable providers are unaffected by ENABLE_ACP: claude→Claude, openai→Codex', () => {
    expect(EngineFactory.forProvider({ type: 'claude' })).toBeInstanceOf(ClaudeSdkEngineAdapter);
    expect(EngineFactory.forProvider({ type: 'openai' })).toBeInstanceOf(CodexSdkEngineAdapter);
  });
});
