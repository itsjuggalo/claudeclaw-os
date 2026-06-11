import { GoogleGenAI } from '@google/genai';

import { GOOGLE_API_KEY, DEEPSEEK_API_KEY } from './config.js';
import { logger } from './logger.js';
import { requireEnabled } from './kill-switches.js';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set. Add it to .env for memory extraction.');
  }
  client = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
  return client;
}

/**
 * DeepSeek (OpenAI-compatible) text generation. Used as the default provider
 * for consolidation/extraction because the Gemini project hit "prepayment
 * credits depleted" (429) and Mike wants a free/cheap path. DeepSeek is ~$0 at
 * this volume. Returns the raw text; parseJsonResponse handles extraction.
 */
async function deepseekGenerate(prompt: string, model: string, apiKey: string): Promise<string> {
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    logger.error({ status: resp.status, body: body.slice(0, 300) }, 'DeepSeek generateContent failed');
    throw new Error(`DeepSeek HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * Generate text content. Provider-aware (read at call time so dotenv ordering
 * can't bite): DEEPSEEK_API_KEY present (or LLM_PROVIDER=deepseek) → DeepSeek
 * (free/cheap, the default); otherwise Gemini (GEMINI_MODEL || gemini-2.5-flash).
 * Memory ingestion, consolidation, classifiers all flow through here.
 */
export async function generateContent(prompt: string, modelOverride?: string): Promise<string> {
  // Kill-switch: refuse LLM calls when LLM_SPAWN_ENABLED is off.
  requireEnabled('LLM_SPAWN_ENABLED');

  const deepseekKey = DEEPSEEK_API_KEY;  // loaded via config.js (.env allowlist), not raw process.env
  const provider = (process.env.LLM_PROVIDER || (deepseekKey ? 'deepseek' : 'gemini')).toLowerCase();

  if (provider === 'deepseek' && deepseekKey) {
    const model = modelOverride?.startsWith('deepseek')
      ? modelOverride
      : (process.env.CONSOLIDATION_MODEL || 'deepseek-chat');
    try {
      return await deepseekGenerate(prompt, model, deepseekKey);
    } catch (err) {
      if (!GOOGLE_API_KEY) return '';
      logger.warn({ err }, 'DeepSeek failed — falling back to Gemini');
      // fall through to the Gemini path below
    }
  }

  // No Gemini key — silently return empty so callers degrade gracefully.
  if (!GOOGLE_API_KEY) return '';

  const model = modelOverride?.startsWith('gemini')
    ? modelOverride
    : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const ai = getClient();
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });
    if (!response.text) {
      logger.warn({ model }, 'Gemini returned empty response');
      return '';
    }
    return response.text;
  } catch (err) {
    logger.error({ err, model }, 'Gemini generateContent failed');
    throw err;
  }
}

/**
 * Parse a JSON response from Gemini, with fallback on malformed output.
 * Returns null if parsing fails.
 */
export function parseJsonResponse<T>(text: string): T | null {
  // Try four extraction strategies in order, most permissive last:
  //   1. Bare JSON (Gemini's responseMimeType=application/json case)
  //   2. JSON inside ```json ... ``` fences (Haiku tends to wrap)
  //   3. JSON inside generic ``` ... ``` fences
  //   4. First {...} block in the text (Haiku also tends to add prose
  //      AFTER the fence, which broke the previous regex anchor).
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const firstObj = trimmed.match(/\{[\s\S]*\}/);
  if (firstObj) candidates.push(firstObj[0]);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next
    }
  }
  logger.warn({ text: text.slice(0, 200) }, 'Failed to parse JSON response');
  return null;
}
