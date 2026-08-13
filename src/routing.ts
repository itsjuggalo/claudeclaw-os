/**
 * Deterministic handback routing (RFC: Agent Awareness & Deterministic Comms, Tier 2).
 *
 * The whole point: an agent carries NO routing knowledge and NO roster. It only
 * ever says "reply to whoever queued me" (handback). The CLI resolves the
 * destination from the task's `created_by` with a generic, roster-free rule, so
 * behavior is deterministic and model-independent — safe under an untrusted
 * (non-Claude) model, and identical for every install.
 *
 * Rule:
 *   - a reserved NON-AGENT origin sentinel  -> surface to the human
 *   - anything else                         -> treated as the originating agent id
 *
 * No fleet-specific agent names are compiled in. Lane-based dispatch of NEW work
 * is deliberately out of scope for Tier 2 (it needs a per-install owner map,
 * which is operator config, not global runtime behavior).
 */

/**
 * The runtime's default primary agent id. This is a built-in runtime concept
 * present in every install (the default `created_by`/main session), NOT a
 * customer/fleet agent name. Human-surfaced handbacks are delivered through it
 * because a person has no mission inbox of their own.
 */
export const MAIN_AGENT_ID = 'main';

/**
 * Reserved non-agent origin sentinels. These are runtime concepts, never
 * customer agents, so the rule ships unchanged everywhere.
 */
export const RESERVED_ORIGINS = new Set(['dashboard', 'human', 'scheduled']);

/** True if `createdBy` is a non-agent origin (no mission inbox of its own). */
export function isReservedOrigin(createdBy: string): boolean {
  const id = createdBy.trim().toLowerCase();
  if (RESERVED_ORIGINS.has(id)) return true;
  if (/^-?\d+$/.test(id)) return true;      // a numeric chat id = a person
  if (id.startsWith('cron')) return true;   // cron-origin, unattributable to an inbox
  return false;
}

export type HandbackDestination =
  | { kind: 'agent'; agent: string }
  | { kind: 'human'; via: string; reason: string };

/**
 * Resolve where a handback report goes, given the originating task's
 * `created_by`. Never dead-ends: a reserved origin surfaces to the human (via
 * the runtime's primary agent); anything else routes straight back to the id
 * that queued the task.
 */
export function resolveHandbackDestination(createdBy: string): HandbackDestination {
  const id = createdBy.trim().toLowerCase();

  if (isReservedOrigin(id)) {
    let reason: string;
    if (id === 'dashboard') reason = 'dashboard has no mission inbox';
    else if (id === 'human' || /^-?\d+$/.test(id)) reason = 'originator is a person';
    else reason = 'scheduled/cron origin is unattributable to an agent inbox';
    return { kind: 'human', via: MAIN_AGENT_ID, reason };
  }

  // Catch-all: treat the origin as the agent id that queued the task.
  return { kind: 'agent', agent: id };
}
