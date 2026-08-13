import { describe, expect, it } from 'vitest';

import { chatToolProfileFor, STRICTEST_CHAT_TOOL_PROFILE } from './chat-tool-policy.js';
import type { ProviderConfig, ProviderType } from './provider.js';

const p = (type: ProviderType): ProviderConfig => ({ type });

describe('chatToolProfileFor — per-provider chat tool profiles', () => {
  it('Claude is unrestricted (full → undefined policy)', () => {
    expect(chatToolProfileFor(p('claude'))).toBeUndefined();
  });

  it('native Codex (openai) is unrestricted, same as Claude (full → undefined)', () => {
    // trust layers proven out; OS sandbox (workspace-write) is the boundary, not
    // a trimmed tool list, so openai carries the same chat surface as Claude.
    expect(chatToolProfileFor(p('openai'))).toBeUndefined();
  });

  it('unvetted non-Claude providers stay strictest (no WebSearch)', () => {
    for (const t of ['acp-codex', 'gemini', 'opencode', 'openrouter', 'acp'] as ProviderType[]) {
      expect(chatToolProfileFor(p(t))?.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
      expect(chatToolProfileFor(p(t))?.allowedTools).not.toContain('WebSearch');
    }
  });

  it('undefined provider and unknown types fall to STRICTEST (safe-by-default)', () => {
    expect(chatToolProfileFor(undefined)).toEqual(STRICTEST_CHAT_TOOL_PROFILE);
    // an unknown/new provider type must not accidentally get full access
    expect(chatToolProfileFor({ type: 'brand-new-provider' as ProviderType })?.allowedTools)
      .toEqual(['Read', 'Grep', 'Glob']);
  });
});
