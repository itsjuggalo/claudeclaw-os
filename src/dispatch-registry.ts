/**
 * A tiny LEAF indirection between `runAgent` and the in-process dispatch tools.
 *
 * `runAgent` (agent.ts) must merge the dispatch MCP server into every Claude
 * turn's `mcpServers`, but it must NOT eagerly import the heavy dispatch stack
 * (`dispatch-tools → cli-actions → agent-config/db/…`). Doing so would pull
 * `agent-config`'s module-top `path.join(WARROOM_TMP_DIR, …)` into the import
 * graph of every test that imports `agent.ts` with a minimal `config.js` mock,
 * breaking them.
 *
 * So this module holds only a resolver function pointer (set once at runtime
 * boot by `registerDispatchTools()` in dispatch-tools.ts). It has ZERO runtime
 * imports — the two imports below are type-only and erased at compile time — so
 * `agent.ts` can depend on it freely. Until boot registers a resolver,
 * `dispatchMcpServersForTurn` returns `{}`, so unit tests that never boot the
 * runtime see no dispatch tools and load none of the heavy graph.
 *
 * This is also the "register at global config" mechanism the Phase 2 brief calls
 * for: the resolver is process-module state, not env, so scheduled turns (which
 * run with a scrubbed env) still resolve the tools.
 */

import type { ProviderConfig } from './provider.js';
import type { McpServerConfig, TurnToolPolicy } from './agent-engine/types.js';

/**
 * Everything the dispatch authorization decision depends on. The turn's TOOL
 * POLICY is part of it, not just the provider: a caller that granted no tools
 * (memory ingestion, routing/warmup, untrusted voice, default-deny war-room)
 * must not be handed the state-changing mission/schedule/hive server. Keeping
 * the policy in the decision — rather than filtering downstream — is what makes
 * this the single authorization point.
 */
export interface DispatchTurnContext extends TurnToolPolicy {
  provider: ProviderConfig | undefined;
  /**
   * Explicit caller decision, overriding the inferred default:
   *  - 'grant' — this turn is authorized for dispatch even though its tool
   *    policy is restricted. The sanctioned opt-in for a restricted-but-trusted
   *    path (e.g. a war-room ops agent) that genuinely needs mission/schedule
   *    tools. Still loses to a deny-all policy.
   *  - 'deny'  — never grant dispatch on this turn, whatever the defaults say.
   *
   * Absent means "use the per-provider default", which is deliberately
   * conservative for providers whose runtime cannot apply our allow-list to MCP
   * tools. Prefer this field over widening a tool allow-list to signal intent.
   */
  dispatchAccess?: 'grant' | 'deny';
}

/** Resolves the dispatch MCP servers to merge for a turn. */
export type DispatchResolver = (
  ctx: DispatchTurnContext,
) => Record<string, McpServerConfig>;

let resolver: DispatchResolver | null = null;

/** Register the in-process dispatch tools. Called once at runtime boot. */
export function setDispatchResolver(fn: DispatchResolver): void {
  resolver = fn;
}

/** True once a resolver has been registered (i.e. the runtime has booted). */
export function dispatchToolsRegistered(): boolean {
  return resolver !== null;
}

/**
 * The dispatch MCP servers to merge into a turn's `mcpServers`. Returns `{}`
 * when nothing is registered (unit tests), when the provider is not granted the
 * tools, or when the turn's tool policy grants nothing — all enforced in the
 * registered resolver.
 *
 * This is the ONLY place `claudeclaw-dispatch` may enter a turn. Engine adapters
 * consume `AgentTurnInput.mcpServers` as the complete authorized set and must
 * never add to it; a direct engine caller that does not come through here gets
 * no dispatch by design.
 */
export function dispatchMcpServersForTurn(
  ctx: DispatchTurnContext,
): Record<string, McpServerConfig> {
  return resolver ? resolver(ctx) : {};
}
