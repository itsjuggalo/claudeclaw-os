import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  searchMemories: vi.fn(),
  getRecentHighImportanceMemories: vi.fn(),
  touchMemory: vi.fn(),
  decayMemories: vi.fn(),
  logConversationTurn: vi.fn(),
  pruneConversationLog: vi.fn(),
  pruneWaMessages: vi.fn(() => ({ messages: 0, outbox: 0, map: 0 })),
  pruneSlackMessages: vi.fn(() => 0),
  searchConsolidations: vi.fn(),
  getRecentConsolidations: vi.fn(),
}));

vi.mock('./memory-ingest.js', () => ({
  ingestConversationTurn: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('./embeddings.js', () => ({
  embedText: vi.fn(() => Promise.resolve([])),
  cosineSimilarity: vi.fn(() => 0),
}));

import {
  buildMemoryContext,
  saveConversationTurn,
  runDecaySweep,
} from './memory.js';

import {
  searchMemories,
  getRecentHighImportanceMemories,
  touchMemory,
  decayMemories,
  logConversationTurn,
  searchConsolidations,
  getRecentConsolidations,
} from './db.js';

import { ingestConversationTurn } from './memory-ingest.js';

const mockSearchMemories = vi.mocked(searchMemories);
const mockGetRecentHighImportance = vi.mocked(getRecentHighImportanceMemories);
const mockTouchMemory = vi.mocked(touchMemory);
const mockDecayMemories = vi.mocked(decayMemories);
const mockLogConversationTurn = vi.mocked(logConversationTurn);
const mockSearchConsolidations = vi.mocked(searchConsolidations);
const mockGetRecentConsolidations = vi.mocked(getRecentConsolidations);
const mockIngest = vi.mocked(ingestConversationTurn);

function makeMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    chat_id: 'chat1',
    source: 'conversation',
    raw_text: 'raw text',
    summary: 'A test memory',
    entities: '[]',
    topics: '[]',
    connections: '[]',
    importance: 0.7,
    salience: 1.0,
    consolidated: 0,
    embedding: null,
    created_at: 100,
    accessed_at: 100,
    ...overrides,
  };
}

describe('buildMemoryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([]);
  });

  it('returns empty string when no memories found', async () => {
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'hello');
    expect(result).toBe('');
  });

  it('returns formatted string when FTS results exist', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'User enjoys pizza', topics: '["food"]', importance: 0.8 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'pizza');
    expect(result).toContain('[Memory context]');
    expect(result).toContain('User enjoys pizza');
    expect(result).toContain('food');
    expect(result).toContain('[0.8]');
    expect(result).toContain('[End memory context]');
  });

  it('deduplicates between FTS and recent results', async () => {
    const mem = makeMemory({ summary: 'shared memory' });
    mockSearchMemories.mockReturnValue([mem]);
    mockGetRecentHighImportance.mockReturnValue([mem]);

    const result = await buildMemoryContext('chat1', 'shared');
    const occurrences = result.split('shared memory').length - 1;
    expect(occurrences).toBe(1);
  });

  it('touches returned memories', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ id: 10 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([
      makeMemory({ id: 20 }),
    ]);

    await buildMemoryContext('chat1', 'test');
    expect(mockTouchMemory).toHaveBeenCalledWith(10);
    expect(mockTouchMemory).toHaveBeenCalledWith(20);
    expect(mockTouchMemory).toHaveBeenCalledTimes(2);
  });
});

describe('saveConversationTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs both user and assistant messages to conversation log', () => {
    saveConversationTurn('chat1', 'hello world from the user!!!', 'Noted.');
    expect(mockLogConversationTurn).toHaveBeenCalledWith('chat1', 'user', 'hello world from the user!!!', undefined, 'main');
    expect(mockLogConversationTurn).toHaveBeenCalledWith('chat1', 'assistant', 'Noted.', undefined, 'main');
  });

  it('fires async ingestion', () => {
    saveConversationTurn('chat1', 'I prefer TypeScript over JavaScript always and forever', 'Noted.');
    expect(mockIngest).toHaveBeenCalledWith('chat1', 'I prefer TypeScript over JavaScript always and forever', 'Noted.');
  });
});

describe('buildMemoryContext with consolidations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentHighImportance.mockReturnValue([]);
  });

  it('includes consolidation insights when searchConsolidations returns results', async () => {
    mockSearchConsolidations.mockReturnValue([
      { id: 1, chat_id: 'chat1', source_ids: '[1,2]', summary: 'Morning routine synthesis', insight: 'User has structured morning workflow', created_at: 100 },
    ]);

    const result = await buildMemoryContext('chat1', 'morning routine');
    expect(result).toContain('Insights:');
    expect(result).toContain('User has structured morning workflow');
  });

  it('falls back to recent consolidations when search returns empty', async () => {
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([
      { id: 1, chat_id: 'chat1', source_ids: '[1]', summary: 'General insight', insight: 'User values productivity', created_at: 100 },
    ]);

    const result = await buildMemoryContext('chat1', 'unrelated query');
    expect(result).toContain('User values productivity');
  });

  it('returns empty when no memories and no insights exist', async () => {
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'anything');
    expect(result).toBe('');
  });

  it('includes both memories and insights when both exist', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'Prefers dark mode', importance: 0.8, topics: '["UI"]' }),
    ]);
    mockSearchConsolidations.mockReturnValue([
      { id: 1, chat_id: 'chat1', source_ids: '[1]', summary: 'UI summary', insight: 'User cares deeply about UI aesthetics', created_at: 100 },
    ]);

    const result = await buildMemoryContext('chat1', 'UI preferences');
    expect(result).toContain('Prefers dark mode');
    expect(result).toContain('User cares deeply about UI aesthetics');
    expect(result).toContain('Relevant memories:');
    expect(result).toContain('Insights:');
  });
});

describe('buildMemoryContext topic formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([]);
  });

  it('includes parsed topics in the formatted output', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'Likes hiking', topics: '["outdoor", "fitness"]', importance: 0.7 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'hiking');
    expect(result).toContain('outdoor');
    expect(result).toContain('fitness');
  });

  it('handles empty topics gracefully', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'No topics memory', topics: '[]', importance: 0.6 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'query');
    expect(result).toContain('No topics memory');
    // Should not have trailing topic parentheses
    expect(result).not.toContain('()');
  });

  it('handles malformed topics JSON gracefully', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'Bad topics', topics: 'not-json', importance: 0.6 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'query');
    expect(result).toContain('Bad topics');
    // Should not crash
  });
});

describe('runDecaySweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls decayMemories once', () => {
    runDecaySweep();
    expect(mockDecayMemories).toHaveBeenCalledOnce();
  });
});
