import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

// Mocks must register before the module-under-test is imported. We
// inject the agent registry by mocking agent-config, and stub out the
// LLM + DB writes so the classifier is pure.
const mockExtract = vi.fn();
const mockHive = vi.fn();
const mockAudit = vi.fn();
let mockSwitches: Record<string, boolean> = {};

vi.mock('./memory-ingest.js', () => ({
  extractViaClaude: (prompt: string, timeoutMs?: number) => mockExtract(prompt, timeoutMs),
}));
vi.mock('./kill-switches.js', () => ({
  isEnabled: (name: string) => mockSwitches[name] !== false,
}));
vi.mock('./db.js', () => ({
  logToHiveMind: (...args: unknown[]) => mockHive(...args),
  createInterAgentTask: vi.fn(),
  completeInterAgentTask: vi.fn(),
  insertAuditLog: (...args: unknown[]) => mockAudit(...args),
}));
vi.mock('./agent-config.js', () => ({
  listAgentIds: () => ['boba', 'jazzy'],
  loadAgentConfig: (id: string) => ({
    name: id,
    description: id === 'boba'
      ? 'Aggressive options trader specialising in flow alerts'
      : 'Conservative long-only equity researcher',
  }),
  resolveAgentClaudeMd: () => null,
}));
vi.mock('./memory.js', () => ({ buildMemoryContext: vi.fn() }));
vi.mock('./agent.js', () => ({ runAgent: vi.fn() }));
vi.mock('./active-provider.js', () => ({ getSelectedProviderConfig: vi.fn() }));

// PROJECT_ROOT can be anything for these tests.
process.env.CLAUDECLAW_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'cclaw-test-'));

import { initOrchestrator, classifyAndAssignAgent } from './orchestrator.js';

describe('classifyAndAssignAgent (Pack 05)', () => {
  beforeEach(() => {
    mockExtract.mockReset();
    mockHive.mockReset();
    mockAudit.mockReset();
    mockSwitches = { MISSION_AUTO_ASSIGN_ENABLED: true, LLM_SPAWN_ENABLED: true };
    initOrchestrator();
  });

  it('returns null when MISSION_AUTO_ASSIGN_ENABLED is off', async () => {
    mockSwitches.MISSION_AUTO_ASSIGN_ENABLED = false;
    const out = await classifyAndAssignAgent('analyze NVDA flow today', 'main', 'chat-1');
    expect(out).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('returns null for simple/ack messages without calling LLM', async () => {
    const out = await classifyAndAssignAgent('thanks', 'main', 'chat-1');
    expect(out).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('routes to a specialist when classifier picks one', async () => {
    mockExtract.mockResolvedValue('{"agentId":"boba","reason":"flow alert specialist"}');
    const out = await classifyAndAssignAgent(
      'NVDA $500c calls just printed 2000 lots, what do you think about following the flow?',
      'main',
      'chat-1',
    );
    expect(out).toEqual({ agentId: 'boba', prompt: expect.stringContaining('NVDA') });
    expect(mockHive).toHaveBeenCalledWith('main', 'chat-1', 'auto_assign', expect.stringContaining('boba'));
    expect(mockAudit).toHaveBeenCalled();
  });

  it('returns null when classifier picks main', async () => {
    mockExtract.mockResolvedValue('{"agentId":"main","reason":"general chitchat"}');
    const out = await classifyAndAssignAgent(
      'just thinking about the markets today, what is your read?',
      'main',
      'chat-1',
    );
    expect(out).toBeNull();
    expect(mockHive).not.toHaveBeenCalled();
  });

  it('returns null when classifier hallucinates an unknown agent', async () => {
    mockExtract.mockResolvedValue('{"agentId":"ghost","reason":"made up"}');
    const out = await classifyAndAssignAgent(
      'please run a full DCF on NVDA with 5y projections and a sensitivity table',
      'main',
      'chat-1',
    );
    expect(out).toBeNull();
  });

  it('returns null on LLM error without throwing', async () => {
    mockExtract.mockRejectedValue(new Error('Haiku timeout'));
    const out = await classifyAndAssignAgent(
      'help me think through whether to add to the SOXL position',
      'main',
      'chat-1',
    );
    expect(out).toBeNull();
  });
});
