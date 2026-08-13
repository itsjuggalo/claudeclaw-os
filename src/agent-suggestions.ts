/**
 * Agent-split suggestion analyzer (Power Pack 04).
 *
 * Scans hive_mind for the last 200 actions per agent, sends the bag
 * (agent description + their recent action summaries) to Haiku, and
 * asks "is any one agent doing several distinct domains that warrant
 * a split?". Suggestions land in agent_suggestions and surface as a
 * lightbulb badge on the AgentCard. The user can dismiss (= "no
 * thanks") or act (= "open the wizard pre-filled"); both states stick
 * so re-running analysis doesn't keep re-suggesting the same split.
 *
 * Extracted from dashboard.ts so the same logic can be invoked both
 * from the manual refresh endpoint and from a periodic 24h cron job.
 */

import { listAgentIds, loadAgentConfig } from './agent-config.js';
import {
  AgentSuggestion,
  getHiveMindEntries,
  getRecentlySuggestedSplits,
  insertAgentSuggestion,
  insertAuditLog,
  listActiveAgentSuggestions,
} from './db.js';
import { parseJsonResponse } from './gemini.js';
import { logger } from './logger.js';
import { extractViaClaude } from './memory-ingest.js';

export interface RefreshResult {
  ok: true;
  inserted: number;
  skipped: number;
  suggestions: AgentSuggestion[];
  /** Populated when there isn't enough hive_mind activity to analyze. */
  reason?: string;
}

/**
 * Run the agent-split analysis once. Inserts new rows into
 * `agent_suggestions`, audits the run, and returns the active list.
 *
 * Safe to call concurrently — the only shared resource is the DB and
 * each successful insert is idempotent against the 30-day dedup set.
 *
 * Throws on Haiku unavailability so the caller can decide whether to
 * surface 503 (dashboard) or just log and try again later (cron).
 */
export async function refreshAgentSuggestions(): Promise<RefreshResult> {
  const liveAgents = ['main', ...listAgentIds()];
  const agentMeta: Array<{ id: string; description: string; rawCount: number; recentSummaries: string[] }> = [];

  for (const id of liveAgents) {
    let description = '';
    if (id !== 'main') {
      try { description = loadAgentConfig(id).description || ''; } catch { /* skip */ }
    } else {
      description = 'Primary ClaudeClaw bot — general triage and routing';
    }
    const entries = getHiveMindEntries(200, id);
    const allFiltered = entries
      .map((e) => `[${e.action}] ${e.summary}`)
      .filter((s) => s.length > 0);

    // Sample evenly across the agent's last 200 entries, picking 12
    // representative summaries. We want diversity (different domains,
    // not just the latest cluster) without bloating the prompt past
    // Haiku's comfort zone — total prompt with 6 agents × 12
    // summaries × ~80 chars stays under ~2 KB and typically completes
    // in 15–25s.
    const target = 12;
    const recentSummaries = allFiltered.length <= target
      ? allFiltered
      : allFiltered.filter((_, i) => i % Math.ceil(allFiltered.length / target) === 0).slice(0, target);
    agentMeta.push({ id, description, rawCount: allFiltered.length, recentSummaries });
  }

  // Skip agents with too little signal — splitting an agent that's
  // done 5 things isn't useful, and Haiku will hallucinate splits.
  const eligible = agentMeta.filter((a) => a.rawCount >= 20);
  if (eligible.length === 0) {
    insertAuditLog('main', '', 'agent_suggestion_refresh', 'skipped — no agent has >=20 hive_mind entries', false);
    return { ok: true, inserted: 0, skipped: 0, suggestions: listActiveAgentSuggestions(), reason: 'not enough hive_mind activity to analyze' };
  }

  const recentlySuggested = new Set(
    getRecentlySuggestedSplits(30).map((r) => `${r.from_agent}::${r.suggested_id}`),
  );

  // Prompt: "for each agent, is one doing many distinct domains?"
  // Constrain the model to suggest AT MOST one split per agent and
  // require activity_share_pct so the user knows whether the
  // suggestion is meaningful (a 5%-share split isn't worth doing).
  const promptParts = [
    'You analyze a multi-agent system to spot when an agent has drifted into doing many distinct things and should be split.',
    '',
    'For each agent below, decide: is there ONE coherent sub-domain handling >= 25% of their recent activity that would benefit from being its own specialized agent? Only suggest a split when the new agent would have a clean scope and the parent agent would be more focused after the split.',
    '',
    'Return JSON with this exact shape:',
    '{ "suggestions": [{ "from_agent": "<id>", "suggested_id": "<lowercase-id>", "suggested_name": "<Title Case>", "suggested_description": "<one-sentence scope, 80 chars max>", "reasoning": "<why now, 200 chars max>", "activity_share_pct": <integer 0-100> }] }',
    '',
    'Rules:',
    '- suggested_id must be lowercase letters, numbers, hyphens; not match an existing agent.',
    '- Suggest at most one split per from_agent.',
    '- Skip suggestions where activity_share_pct < 25.',
    '- If no agent needs splitting, return { "suggestions": [] }.',
    '',
    'Agents:',
  ];
  for (const a of eligible) {
    promptParts.push('');
    promptParts.push(`AGENT: ${a.id}`);
    promptParts.push(`DESCRIPTION: ${a.description || '(no description)'}`);
    promptParts.push('RECENT ACTIVITY:');
    for (const s of a.recentSummaries) {
      promptParts.push(`  - ${s}`);
    }
  }
  const existingIds = new Set(liveAgents);

  let raw = '';
  const promptStr = promptParts.join('\n');
  logger.info({ promptBytes: promptStr.length, agentCount: eligible.length }, 'agent suggestion: starting analysis');
  const t0 = Date.now();

  // 120s timeout — the dashboard process spawns the SDK subprocess
  // alongside its own busy event loop (war-room polling, memory
  // ingest, scheduler). Cold-starts under load have measured up to
  // 90s in practice, vs 4–5s for a standalone CLI call with the
  // same prompt size. Better to wait than fail spuriously.
  raw = await extractViaClaude(promptStr, 120_000);
  logger.info({ elapsedMs: Date.now() - t0, responseBytes: raw.length }, 'agent suggestion: Haiku replied');

  const parsed = parseJsonResponse<{ suggestions: any[] }>(raw);
  const list = Array.isArray(parsed?.suggestions) ? parsed!.suggestions : [];

  let inserted = 0;
  let skipped = 0;
  for (const s of list) {
    if (!s || typeof s !== 'object') { skipped++; continue; }
    const fromAgent = String(s.from_agent || '').trim();
    const suggestedId = String(s.suggested_id || '').trim().toLowerCase();
    const suggestedName = String(s.suggested_name || '').trim();
    const suggestedDescription = String(s.suggested_description || '').trim();
    const reasoning = String(s.reasoning || '').trim();
    const sharePct = Math.max(0, Math.min(100, Math.round(Number(s.activity_share_pct) || 0)));

    if (!fromAgent || !existingIds.has(fromAgent)) { skipped++; continue; }
    if (!/^[a-z0-9-]{2,32}$/.test(suggestedId)) { skipped++; continue; }
    if (existingIds.has(suggestedId)) { skipped++; continue; }
    if (!suggestedName || !suggestedDescription || !reasoning) { skipped++; continue; }
    if (sharePct < 25) { skipped++; continue; }
    // Don't re-suggest the exact same split we already proposed in
    // the last 30 days (whether dismissed or still active).
    if (recentlySuggested.has(`${fromAgent}::${suggestedId}`)) { skipped++; continue; }

    insertAgentSuggestion({
      from_agent: fromAgent,
      suggested_id: suggestedId,
      suggested_name: suggestedName,
      suggested_description: suggestedDescription.slice(0, 200),
      reasoning: reasoning.slice(0, 500),
      activity_share_pct: sharePct,
    });
    inserted++;
  }
  insertAuditLog('main', '', 'agent_suggestion_refresh', `inserted=${inserted} skipped=${skipped}`, false);
  return { ok: true, inserted, skipped, suggestions: listActiveAgentSuggestions() };
}
