import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { logger } from './logger.js';
import { requireEnabled } from './kill-switches.js';

const execFileAsync = promisify(execFile);

/**
 * Generate text content via the Claude Code CLI on the claude.ai subscription.
 *
 * OAuth/CLI-only policy (2026-06-17, per Mike): memory ingestion, consolidation and
 * classifiers used to run on the Gemini / DeepSeek api_key wallets — now they route
 * through `claude -p` (sonnet) with ANTHROPIC_API_KEY stripped, so this can only bill the
 * subscription, never pay-per-token. Returns the model text ('' on any failure so callers
 * degrade gracefully). The function/file name is kept for import compatibility.
 */
export async function generateContent(prompt: string, _modelOverride?: string): Promise<string> {
  // Kill-switch: refuse LLM calls when LLM_SPAWN_ENABLED is off.
  requireEnabled('LLM_SPAWN_ENABLED');

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force the OAuth/subscription path, never an api key
  const bin = process.env.CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`;
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['-p', prompt, '--model', 'sonnet', '--effort', 'high', '--output-format', 'json'],
      { env, maxBuffer: 16 * 1024 * 1024, timeout: 240_000 },
    );
    const result = (JSON.parse(stdout) as { result?: string })?.result ?? '';
    return result.toString();
  } catch (err) {
    logger.error({ err }, 'claude CLI generateContent failed');
    return '';
  }
}

/**
 * Parse a JSON response from the model, with fallback on malformed output.
 * Returns null if parsing fails.
 */
export function parseJsonResponse<T>(text: string): T | null {
  // Try four extraction strategies in order, most permissive last:
  //   1. Bare JSON
  //   2. JSON inside ```json ... ``` fences
  //   3. JSON inside generic ``` ... ``` fences
  //   4. First {...} block in the text
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
