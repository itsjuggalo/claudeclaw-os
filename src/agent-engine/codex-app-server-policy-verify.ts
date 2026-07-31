/**
 * Effective-policy verification for a Codex App Server thread.
 *
 * This is the release requirement the whole App Server migration rests on. The SDK
 * transport can REQUEST a sandbox but cannot observe what the host actually applied;
 * App Server returns the effective policy on `thread/start` / `thread/resume`, so
 * ClaudeClaw compares the two BEFORE `turn/start` and refuses to run when they
 * differ.
 *
 * Fail closed in BOTH directions. A more permissive effective policy is an obvious
 * escalation, but a more RESTRICTIVE one is rejected too: silently running read-only
 * when the caller authorized writes produces a turn that looks successful and
 * changes nothing, which is worse than an error because nobody investigates it.
 * That rule applies to write ROOTS as much as to the sandbox type — a dropped
 * writable root is a different policy, not a safe one.
 *
 * Ground truth from an account-free `thread/start` probe against pinned 0.144.6 on
 * native Windows (no turn started, so no model call):
 *  - requesting `workspace-write` yields an effective `{type:'readOnly'}`. This host
 *    genuinely does not provide contained writes, so workspace-agent turns fail
 *    verification here by design (RFC acceptance criterion 18) rather than reporting
 *    a write sandbox that does not exist.
 *  - `runtimeWorkspaceRoots` comes back as exactly `[cwd]` when none are requested.
 *  - `activePermissionProfile` is `null`, `instructionSources` is `[]`, and
 *    `reasoningEffort` echoes `config.model_reasoning_effort`.
 *
 * Pure and I/O-free: the caller canonicalizes paths (this module cannot call
 * realpath) and decides how to surface failures.
 */

import path from 'path';

import type {
  ActivePermissionProfile,
  AskForApproval,
  EffectiveThreadPolicy,
  SandboxMode,
  SandboxPolicy,
} from './codex-app-server-protocol.js';

/** What ClaudeClaw asked for, derived from the shared capability profile. */
export interface RequestedThreadPolicy {
  model: string;
  /** Canonical absolute path; compared against the effective cwd. */
  cwd: string;
  sandboxMode: SandboxMode;
  /** From `CodexCapabilityProfile.networkAccess`: false = must be confined. */
  networkAccess: boolean;
  /**
   * The reasoning effort set via `config.model_reasoning_effort`, or undefined when
   * ClaudeClaw deliberately left the model default in place.
   */
  reasoningEffort?: string;
  /**
   * Writable roots requested BEYOND cwd, which is implicit. Empty in the first
   * release. The effective additional-root set must match this EXACTLY — extra roots
   * broaden authority, missing roots silently narrow it.
   */
  writableRoots?: string[];
  /**
   * Runtime workspace roots requested. These materialize `:workspace_roots` and so
   * affect effective write authority; when none are requested the host reports
   * exactly `[cwd]`.
   */
  runtimeWorkspaceRoots?: string[];
  /**
   * True when this turn RESUMED an existing thread. Only affects how a reasoning
   * effort difference is explained: effort is fixed when a Codex thread is created,
   * so on resume the thread's own value is expected to win.
   */
  resumedThread?: boolean;
}

/**
 * The outcome of verification, split by what a difference actually MEANS.
 *
 * `blocking` covers authorization and containment: sandbox type, network, write and
 * runtime roots, temp exclusions, approvals, provider, model, cwd, instruction
 * sources, permission profile. Any of these differing means the turn would run under
 * authority nobody granted (or would silently fail to do what it was asked), so it
 * must not start.
 *
 * `warnings` covers effective CONFIGURATION that carries no authority. Reporting one
 * of these as a "policy" refusal was wrong twice over: it blocked a turn that was
 * safe to run, and it told the operator to check their host policy layer for
 * something that is simply how Codex threads work.
 */
export interface PolicyVerdict {
  blocking: string[];
  warnings: string[];
}

/**
 * Response-side sandbox tag expected for each requested mode. The request uses
 * kebab-case modes, the response camelCase tags; comparing them directly would
 * always "mismatch", and comparing loosely would accept the wrong sandbox.
 */
const EXPECTED_SANDBOX_TAG: Record<SandboxMode, SandboxPolicy['type']> = {
  'read-only': 'readOnly',
  'workspace-write': 'workspaceWrite',
  'danger-full-access': 'dangerFullAccess',
};

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** Normalized set difference, preserving the original spelling for messages. */
function missingFrom(expected: string[], actual: string[]): string[] {
  const have = new Set(actual.map(normalizePath));
  return expected.filter((p) => !have.has(normalizePath(p)));
}

function describeApproval(policy: AskForApproval): string {
  return typeof policy === 'string' ? policy : `granular(${Object.keys(policy.granular ?? {}).join(',')})`;
}

function describeProfile(profile: ActivePermissionProfile | null): string {
  return profile ? `${profile.id}${profile.extends ? ` extends ${profile.extends}` : ''}` : 'none';
}

/**
 * Verify the effective thread policy against what was requested.
 *
 * Returns a list of human-readable mismatches — EMPTY means the turn may start.
 * Every rule is checked (rather than returning on the first failure) so an operator
 * sees the whole picture in one log line instead of fixing one cause at a time.
 */
export function verifyEffectivePolicy(
  requested: RequestedThreadPolicy,
  effective: EffectiveThreadPolicy,
): PolicyVerdict {
  const mismatches: string[] = [];
  const warnings: string[] = [];

  // 1. provider pinning — no stray config may redirect the turn (and the injected
  //    key) to a custom or OpenAI-compatible endpoint.
  if (effective.modelProvider !== 'openai') {
    mismatches.push(`modelProvider is "${effective.modelProvider}", expected "openai"`);
  }

  // 2. exact model. The first release does not enable provider/model fallback, so a
  //    different model means the host silently substituted one.
  if (effective.model !== requested.model) {
    mismatches.push(`model is "${effective.model}", requested "${requested.model}" (model fallback is not enabled)`);
  }

  // 3. working directory
  if (!samePath(effective.cwd, requested.cwd)) {
    mismatches.push(`cwd is "${effective.cwd}", requested "${requested.cwd}"`);
  }

  // 4. approvals. Only the exact string "never" is acceptable: there is no
  //    interactive approval channel above the engine seam, and the `granular`
  //    variant would reintroduce prompts nothing can answer (they resolve to
  //    Cancel mid-turn).
  if (effective.approvalPolicy !== 'never') {
    mismatches.push(`approvalPolicy is "${describeApproval(effective.approvalPolicy)}", expected "never"`);
  }

  // 5. sandbox: exact type, network confinement, exact write roots, temp exclusions.
  verifySandbox(requested, effective.sandbox, mismatches);

  // 6. runtime workspace roots. These materialize `:workspace_roots`, so an
  //    unexpected entry changes effective write authority even when the sandbox type
  //    matches. Compared EXACTLY, in both directions.
  verifyRootSet(
    'runtimeWorkspaceRoots',
    requested.runtimeWorkspaceRoots ?? [requested.cwd],
    effective.runtimeWorkspaceRoots,
    mismatches,
  );

  // 7. reasoning effort — a WARNING, never blocking.
  //
  // Effort is fixed when a Codex thread is created, so resuming a thread whose effort
  // differs from the current dashboard setting is normal, not a violation: the
  // conversation genuinely continues at the thread's effort until a new one is
  // started. It grants no authority either way, so refusing the turn would block safe
  // work and point the operator at a host policy layer that has nothing to do with it.
  const effort = effective.reasoningEffort;
  const requestedEffort = requested.reasoningEffort;
  if (requestedEffort === undefined) {
    if (effort !== null && effort !== undefined) {
      warnings.push(
        requested.resumedThread
          ? `This conversation continues at reasoning effort "${effort}", which was fixed when its thread was created. Start a new chat to use the model default.`
          : `The host applied reasoning effort "${effort}" although ClaudeClaw requested the model default; this turn runs at "${effort}".`,
      );
    }
  } else if (effort !== requestedEffort) {
    warnings.push(
      requested.resumedThread
        ? `Reasoning effort is set per Codex thread: this conversation continues at "${effort ?? 'the model default'}". Your change to "${requestedEffort}" applies to a new chat.`
        : `Requested reasoning effort "${requestedEffort}" but the host applied "${effort ?? 'the model default'}"; this turn runs at "${effort ?? 'the model default'}".`,
    );
  }

  // 8. instruction sources must be empty: the persona is delivered exactly once, as
  //    developerInstructions. A non-empty value means Codex ALSO loaded project docs
  //    (AGENTS.md, which ClaudeClaw agents symlink to CLAUDE.md), duplicating the
  //    persona and diluting it.
  if (effective.instructionSources.length > 0) {
    mismatches.push(
      `instructionSources is non-empty (${effective.instructionSources.join(', ')}); `
      + 'the persona would be double-injected — project_doc_max_bytes=0 did not take effect',
    );
  }

  // 9. no active permission profile.
  //
  // ClaudeClaw sends a LEGACY sandbox mode, which cannot be combined with the
  // permissions system. The `sandbox` we verify above is therefore a legacy
  // compatibility PROJECTION of the effective policy — it cannot express everything a
  // permission profile may grant or restrict, so a non-null profile means part of the
  // real authority is outside what we just proved. The account-free probe against
  // pinned 0.144.6 returns null here, so requiring null is the normal case rather
  // than a brittle assumption.
  //
  // If a later release deliberately requests a profile, this must become an exact
  // identity-and-policy check, not a relaxation back to "ignore it".
  if (effective.activePermissionProfile !== null) {
    mismatches.push(
      `activePermissionProfile is "${describeProfile(effective.activePermissionProfile)}", expected none; `
      + 'the legacy sandbox projection cannot prove what a permission profile grants or restricts',
    );
  }

  return { blocking: mismatches, warnings };
}

/**
 * The host-owned Codex Apps MCP server.
 *
 * It is materialized from the ACCOUNT, not from `config.mcp_servers`, so it can
 * legitimately appear in a thread's effective inventory for a profile that allows
 * host apps. `features.apps = false` is the gate that removes it, and when a
 * profile sets that gate its presence is a real failure, not an exemption.
 *
 * The NAME is the one part of this that an account-free probe cannot confirm (the
 * probe home has no account, so the server never materializes). If a future host
 * names it differently, the effect is a refused turn that names the unexpected
 * server — a diagnosable failure rather than a silent inheritance.
 */
export const HOST_APPS_MCP_SERVER = 'codex_apps';

/** The MCP set a turn authorizes, as the sanitized ids sent to Codex. */
export interface RequestedMcpAuthority {
  /**
   * Sanitized `config.mcp_servers` keys — the COMPLETE authorized set for this
   * turn. An empty array means the turn authorizes no caller-owned server.
   */
  authorized: string[];
  /** `CodexCapabilityProfile.hostAppsEnabled`: may the host-owned apps server remain? */
  hostAppsEnabled: boolean;
}

/**
 * Verify the MCP inventory a thread can actually reach against what this turn
 * authorized.
 *
 * Why this cannot be inferred from the resume response: `thread/start` and
 * `thread/resume` report the effective SANDBOX policy and nothing about MCP. On
 * pinned 0.144.6 a `thread/resume` that REJOINS a thread already loaded in the App
 * Server process ignores the resume parameters wholesale, so a caller-owned server
 * authorized for an earlier turn stays live on the thread even though this turn
 * sent `mcp_servers: {}`. The effective inventory has to be READ, not assumed.
 *
 * BOTH directions block, and for the same reason. An extra server is authority
 * nobody granted this caller. A MISSING one is not merely a capability loss: the
 * whole point of the resume is that this turn's table REPLACES whatever the thread
 * had, so a server we authorized and cannot see proves the replacement did not
 * apply — and if it did not apply, nothing about the rest of the inventory can be
 * trusted either. That mirrors the sandbox rules above, where a narrower effective
 * policy fails just as an escalation does.
 */
export function verifyMcpAuthority(
  requested: RequestedMcpAuthority,
  effective: string[],
): PolicyVerdict {
  const authorized = new Set(requested.authorized);
  const blocking: string[] = [];
  const warnings: string[] = [];

  for (const name of effective) {
    if (authorized.has(name)) continue;
    if (name === HOST_APPS_MCP_SERVER && requested.hostAppsEnabled) continue;
    blocking.push(
      name === HOST_APPS_MCP_SERVER
        ? `the host-owned "${HOST_APPS_MCP_SERVER}" server is still reachable although this turn denies host apps (features.apps=false did not take effect)`
        : `"${name}" is reachable but this turn did not authorize it`,
    );
  }

  const present = new Set(effective);
  for (const name of requested.authorized) {
    if (!present.has(name)) {
      blocking.push(
        `"${name}" was authorized for this turn but is not reachable on the thread; `
        + 'the requested MCP table did not replace the thread\'s own',
      );
    }
  }

  return { blocking, warnings };
}

/** Exact, order-insensitive comparison of a root set, reported in both directions. */
function verifyRootSet(
  label: string,
  requested: string[],
  effective: string[],
  mismatches: string[],
): void {
  const added = missingFrom(effective, requested);
  const removed = missingFrom(requested, effective);
  if (added.length > 0) {
    mismatches.push(`${label} broadens access with unrequested root(s): ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    // A narrower policy is still a DIFFERENT policy: the turn would run with less
    // authority than the caller was told it had, and quietly fail to write.
    mismatches.push(`${label} is missing requested root(s): ${removed.join(', ')}`);
  }
}

function verifySandbox(
  requested: RequestedThreadPolicy,
  sandbox: SandboxPolicy,
  mismatches: string[],
): void {
  const expectedTag = EXPECTED_SANDBOX_TAG[requested.sandboxMode];
  if (sandbox.type !== expectedTag) {
    // Covers the escalation case (read-only requested, dangerFullAccess applied),
    // the downgrade case (workspace-write requested, readOnly applied — the observed
    // native Windows behaviour), and `externalSandbox`, which we never request.
    mismatches.push(
      `sandbox type is "${sandbox.type}", requested "${requested.sandboxMode}" (expected "${expectedTag}")`,
    );
    return; // the shape-specific checks below would be meaningless
  }

  if (sandbox.type === 'dangerFullAccess') {
    // Nothing further to verify: full access is not additionally confined, which is
    // the whole point of the explicit trusted-operator escape hatch.
    return;
  }

  if (sandbox.type === 'readOnly') {
    if (sandbox.networkAccess !== requested.networkAccess) {
      mismatches.push(
        `read-only sandbox reports networkAccess=${sandbox.networkAccess}, requested ${requested.networkAccess}`,
      );
    }
    return;
  }

  if (sandbox.type === 'workspaceWrite') {
    if (sandbox.networkAccess !== requested.networkAccess) {
      mismatches.push(
        `workspace-write sandbox reports networkAccess=${sandbox.networkAccess}, requested ${requested.networkAccess}`,
      );
    }

    // Temp exclusions. When either is false Codex may add temporary directories as
    // IMPLICIT writable roots, so "writes confined to the workspace" would be
    // broader than advertised without any extra root appearing in writableRoots.
    if (sandbox.excludeTmpdirEnvVar !== true) {
      mismatches.push(
        'workspace-write sandbox reports excludeTmpdirEnvVar=false; the TMPDIR directory becomes an implicit writable root',
      );
    }
    if (sandbox.excludeSlashTmp !== true) {
      mismatches.push(
        'workspace-write sandbox reports excludeSlashTmp=false; /tmp becomes an implicit writable root',
      );
    }

    // Write roots, compared EXACTLY. Only cwd ITSELF is excluded — it is implicit and
    // verified separately (rule 3), and the host may or may not list it.
    //
    // A root merely NESTED inside cwd is not excused. It looks harmless, but on
    // Windows a nested path can be a junction (or on POSIX a symlink) whose target
    // lies outside the workspace, so containment cannot be established from the path
    // string we were handed. Since this module cannot call realpath, an unrequested
    // nested root is a policy difference and fails.
    const additional = sandbox.writableRoots.filter((root) => !samePath(root, requested.cwd));
    verifyRootSet('workspace-write writableRoots', requested.writableRoots ?? [], additional, mismatches);
  }
}

// NOTE: there is deliberately no "is this path inside that one?" helper here. Path
// containment is not a security property we can establish from strings — a nested
// path may be a junction or symlink pointing anywhere — so root comparison is exact.

/**
 * Non-secret policy fields for structured logging. Requested and effective are kept
 * as SEPARATE keys on purpose: logging a requested sandbox as though it were the
 * applied one is exactly the visibility failure App Server exists to fix.
 */
export function policyLogFields(
  requested: RequestedThreadPolicy,
  effective: EffectiveThreadPolicy,
): Record<string, unknown> {
  return {
    requestedModel: requested.model,
    effectiveModel: effective.model,
    effectiveModelProvider: effective.modelProvider,
    requestedSandbox: requested.sandboxMode,
    effectiveSandbox: effective.sandbox.type,
    requestedNetworkAccess: requested.networkAccess,
    effectiveNetworkAccess: 'networkAccess' in effective.sandbox ? effective.sandbox.networkAccess : null,
    effectiveWritableRoots: effective.sandbox.type === 'workspaceWrite' ? effective.sandbox.writableRoots.length : 0,
    effectiveExcludeTmpdirEnvVar: effective.sandbox.type === 'workspaceWrite' ? effective.sandbox.excludeTmpdirEnvVar : null,
    effectiveExcludeSlashTmp: effective.sandbox.type === 'workspaceWrite' ? effective.sandbox.excludeSlashTmp : null,
    runtimeWorkspaceRoots: effective.runtimeWorkspaceRoots.length,
    effectiveApprovalPolicy: describeApproval(effective.approvalPolicy),
    requestedReasoningEffort: requested.reasoningEffort ?? 'model-default',
    effectiveReasoningEffort: effective.reasoningEffort ?? 'none',
    instructionSources: effective.instructionSources.length,
    // Diagnostic only — see the note in verifyEffectivePolicy.
    activePermissionProfile: describeProfile(effective.activePermissionProfile),
  };
}
