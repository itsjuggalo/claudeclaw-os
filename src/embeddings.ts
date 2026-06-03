import { GoogleGenAI } from '@google/genai';

import { GOOGLE_API_KEY, OLLAMA_EMBED_URL, OLLAMA_EMBED_MODEL } from './config.js';
import { logger } from './logger.js';

const EMBEDDING_MODEL = 'gemini-embedding-001';

/** Local Ollama embedding (truly $0). Returns [] on any failure so the caller
 * can fall through to Gemini / graceful-skip. */
async function ollamaEmbed(text: string): Promise<number[]> {
  try {
    const resp = await fetch(`${OLLAMA_EMBED_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Ollama embed non-OK');
      return [];
    }
    const data = (await resp.json()) as { embedding?: number[] };
    return data.embedding?.length ? data.embedding : [];
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'Ollama embed error');
    return [];
  }
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set.');
  }
  client = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
  return client;
}

/**
 * Generate an embedding vector for a text string.
 * Returns a float array (768 dimensions for text-embedding-004).
 */
export async function embedText(text: string): Promise<number[]> {
  // Prefer local Ollama ($0) when configured.
  if (OLLAMA_EMBED_URL) {
    const v = await ollamaEmbed(text);
    if (v.length) return v;
    // fall through to Gemini only if a key exists; else graceful skip
  }
  if (!GOOGLE_API_KEY) return [];
  try {
    const ai = getClient();
    const result = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });
    return result.embeddings?.[0]?.values ?? [];
  } catch (err) {
    // 2026-05-30: Gemini embeddings billing is depleted (429) and DeepSeek has no
    // embeddings API, so degrade gracefully — the consolidation INSIGHT is still
    // generated + stored (via DeepSeek); only the vector is skipped. Wire a free
    // LOCAL embedder (e.g. Ollama `nomic-embed-text`) to restore semantic
    // dedup/search of consolidated insights.
    logger.warn({ err: (err as Error)?.message }, 'embedText failed — no free embedder wired; storing insight without a vector');
    return [];
  }
}

/**
 * Cosine similarity between two vectors. Returns -1 to 1.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}
