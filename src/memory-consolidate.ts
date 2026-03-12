import { generateContent, parseJsonResponse } from './gemini.js';
import {
  getUnconsolidatedMemories,
  markMemoriesConsolidated,
  saveConsolidation,
  updateMemoryConnections,
} from './db.js';
import { logger } from './logger.js';

interface ConsolidationResult {
  summary: string;
  insight: string;
  connections: Array<{
    from_id: number;
    to_id: number;
    relationship: string;
  }>;
}

const CONSOLIDATION_PROMPT = `You are a memory consolidation agent. You find patterns and connections across a user's recent memories.

Given these unconsolidated memories:
{MEMORIES}

Your job:
1. Find cross-cutting patterns, themes, or connections between memories
2. Create a synthesized summary that captures the overall picture
3. Identify one key insight that emerges from these memories together
4. Map connections between specific memories (use their IDs)

Return JSON:
{
  "summary": "A synthesized view across all source memories",
  "insight": "One key pattern or insight that emerges",
  "connections": [
    {"from_id": N, "to_id": M, "relationship": "description of how they relate"}
  ]
}

If memories are unrelated, still summarize but note they cover different topics. Connections array can be empty if no clear links exist.`;

// Guard against overlapping consolidation runs
let isConsolidating = false;

/**
 * Run consolidation for a given chat. Finds patterns across unconsolidated
 * memories and creates synthesis records. Safe to call frequently; it's
 * a no-op if fewer than 2 memories are pending or if already running.
 */
export async function runConsolidation(chatId: string): Promise<void> {
  if (isConsolidating) {
    logger.debug('Consolidation already running, skipping');
    return;
  }

  isConsolidating = true;
  try {
    const memories = getUnconsolidatedMemories(chatId, 20);

    if (memories.length < 2) {
      logger.debug({ count: memories.length }, 'Not enough memories to consolidate');
      return;
    }

    // Format memories for Gemini
    const memoriesJson = memories.map((m) => ({
      id: m.id,
      summary: m.summary,
      entities: JSON.parse(m.entities),
      topics: JSON.parse(m.topics),
      importance: m.importance,
      created_at: new Date(m.created_at * 1000).toISOString(),
    }));

    const prompt = CONSOLIDATION_PROMPT.replace(
      '{MEMORIES}',
      JSON.stringify(memoriesJson, null, 2),
    );

    const raw = await generateContent(prompt);
    const result = parseJsonResponse<ConsolidationResult>(raw);

    if (!result || !result.summary || !result.insight) {
      logger.warn({ raw: raw.slice(0, 200) }, 'Consolidation produced invalid result');
      return;
    }

    const sourceIds = memories.map((m) => m.id);

    // Save the consolidation record
    saveConsolidation(chatId, sourceIds, result.summary, result.insight);

    // Wire up connections between memories
    if (result.connections && result.connections.length > 0) {
      for (const conn of result.connections) {
        if (!conn.from_id || !conn.to_id) continue;
        // Verify both IDs are in our source set
        if (!sourceIds.includes(conn.from_id) || !sourceIds.includes(conn.to_id)) continue;

        updateMemoryConnections(conn.from_id, [
          { linked_to: conn.to_id, relationship: conn.relationship },
        ]);
        updateMemoryConnections(conn.to_id, [
          { linked_to: conn.from_id, relationship: conn.relationship },
        ]);
      }
    }

    // Mark all source memories as consolidated
    markMemoriesConsolidated(sourceIds);

    logger.info(
      {
        chatId,
        sourceCount: sourceIds.length,
        connections: result.connections?.length ?? 0,
        insight: result.insight.slice(0, 80),
      },
      'Consolidation complete',
    );
  } catch (err) {
    logger.error({ err }, 'Consolidation failed');
  } finally {
    isConsolidating = false;
  }
}
