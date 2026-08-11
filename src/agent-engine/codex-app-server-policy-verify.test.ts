// Effective-policy verification tests — the release requirement the App Server
// migration rests on.
//
// These are written around the FAILURE modes, not the happy path: the point of
// verification is that a host applying something other than what we requested cannot
// start a turn. Both directions fail — escalation AND downgrade — because a turn that
// silently runs read-only when writes were authorized looks successful and changes
// nothing, which nobody investigates.

import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  HOST_APPS_MCP_SERVER,
  policyLogFields,
  verifyEffectivePolicy as verifyRaw,
  verifyMcpAuthority,
  type PolicyVerdict,
  type RequestedThreadPolicy,
} from './codex-app-server-policy-verify.js';
import type { EffectiveThreadPolicy as Effective } from './codex-app-server-protocol.js';

/**
 * Most rules are BLOCKING, so these tests read against that channel. Warnings —
 * effective configuration that carries no authority — have their own describe block.
 */
function verifyEffectivePolicy(requested: RequestedThreadPolicy, effective: Effective): string[] {
  return verifyRaw(requested, effective).blocking;
}
import type { EffectiveThreadPolicy, SandboxPolicy } from './codex-app-server-protocol.js';
import { resolveCodexCapabilityProfile } from './codex-capability-policy.js';

const CWD = path.resolve('/work/agent');

function requested(overrides: Partial<RequestedThreadPolicy> = {}): RequestedThreadPolicy {
  return {
    model: 'gpt-5.5',
    cwd: CWD,
    sandboxMode: 'workspace-write',
    networkAccess: false,
    ...overrides,
  };
}

function effective(overrides: Partial<EffectiveThreadPolicy> = {}): EffectiveThreadPolicy {
  return {
    thread: { id: 'thread-1' },
    model: 'gpt-5.5',
    modelProvider: 'openai',
    cwd: CWD,
    runtimeWorkspaceRoots: [CWD],
    instructionSources: [],
    approvalPolicy: 'never',
    sandbox: { type: 'workspaceWrite', writableRoots: [CWD], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
    activePermissionProfile: null,
    reasoningEffort: null,
    ...overrides,
  };
}

describe('a matching policy permits the turn', () => {
  it('returns no mismatches when everything agrees', () => {
    expect(verifyEffectivePolicy(requested(), effective())).toEqual([]);
  });

  it('accepts a read-only turn with network confined', () => {
    expect(verifyEffectivePolicy(
      requested({ sandboxMode: 'read-only' }),
      effective({ sandbox: { type: 'readOnly', networkAccess: false } }),
    )).toEqual([]);
  });

  it('accepts danger-full-access without demanding network confinement', () => {
    // Full access is deliberately not additionally confined — that is the point of
    // the explicit trusted-operator escape hatch.
    expect(verifyEffectivePolicy(
      requested({ sandboxMode: 'danger-full-access', networkAccess: true }),
      effective({ sandbox: { type: 'dangerFullAccess' } }),
    )).toEqual([]);
  });

  it('REJECTS an unrequested root nested inside cwd (it may be a junction)', () => {
    // Path containment is not a security property we can establish from strings: on
    // Windows a nested path can be a junction — on POSIX a symlink — whose target is
    // outside the workspace. Exact matching means only cwd itself is excused.
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({
        sandbox: {
          type: 'workspaceWrite',
          writableRoots: [path.join(CWD, 'src')],
          networkAccess: false,
          excludeTmpdirEnvVar: true,
          excludeSlashTmp: true,
        },
      }),
    );
    expect(mismatches.join('\n')).toMatch(/writableRoots broadens access with unrequested root/);
  });

  it('accepts a path that differs only by separator or case on Windows', () => {
    // The host echoes its own normalization; a spurious mismatch here would block
    // every turn on Windows.
    const messy = process.platform === 'win32' ? CWD.toUpperCase() : CWD;
    expect(verifyEffectivePolicy(requested(), effective({ cwd: messy }))).toEqual([]);
  });
});

describe('sandbox mismatches fail in BOTH directions', () => {
  it('rejects an ESCALATION (read-only requested, full access applied)', () => {
    const mismatches = verifyEffectivePolicy(
      requested({ sandboxMode: 'read-only' }),
      effective({ sandbox: { type: 'dangerFullAccess' } }),
    );
    expect(mismatches.join('\n')).toMatch(/sandbox type is "dangerFullAccess", requested "read-only"/);
  });

  it('rejects a DOWNGRADE (workspace-write requested, read-only applied)', () => {
    // The observed native-Windows behaviour. Running anyway would report success
    // while writing nothing.
    const mismatches = verifyEffectivePolicy(
      requested({ sandboxMode: 'workspace-write' }),
      effective({ sandbox: { type: 'readOnly', networkAccess: false } }),
    );
    expect(mismatches.join('\n')).toMatch(/sandbox type is "readOnly", requested "workspace-write"/);
  });

  it('rejects externalSandbox, which is never requested', () => {
    // A fourth variant the RFC's three-mode table does not mention: the host applied
    // a policy we cannot reason about.
    const mismatches = verifyEffectivePolicy(
      requested({ sandboxMode: 'workspace-write' }),
      effective({ sandbox: { type: 'externalSandbox', networkAccess: 'unknown' } as SandboxPolicy }),
    );
    expect(mismatches.join('\n')).toMatch(/sandbox type is "externalSandbox"/);
  });

  it('does not emit shape-specific noise once the type already mismatched', () => {
    const mismatches = verifyEffectivePolicy(
      requested({ sandboxMode: 'workspace-write' }),
      effective({ sandbox: { type: 'readOnly', networkAccess: true } }),
    );
    // One clear cause, not a cascade about network on a sandbox we rejected outright.
    expect(mismatches).toHaveLength(1);
  });
});

describe('network confinement', () => {
  it('rejects a read-only sandbox that reports network ENABLED', () => {
    const mismatches = verifyEffectivePolicy(
      requested({ sandboxMode: 'read-only' }),
      effective({ sandbox: { type: 'readOnly', networkAccess: true } }),
    );
    expect(mismatches.join('\n')).toMatch(/read-only sandbox reports networkAccess=true, requested false/);
  });

  it('rejects a workspace-write sandbox that reports network ENABLED', () => {
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({
        sandbox: { type: 'workspaceWrite', writableRoots: [CWD], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      }),
    );
    expect(mismatches.join('\n')).toMatch(/workspace-write sandbox reports networkAccess=true/);
  });
});

describe('writable roots must not broaden access', () => {
  it('rejects a root outside the requested workspace', () => {
    const outside = path.resolve('/etc');
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({
        sandbox: { type: 'workspaceWrite', writableRoots: [CWD, outside], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      }),
    );
    expect(mismatches.join('\n')).toMatch(/writableRoots broadens access with unrequested root/);
    expect(mismatches.join('\n')).toContain(outside);
  });

  it('accepts a root the caller explicitly configured', () => {
    const extra = path.resolve('/work/shared');
    expect(verifyEffectivePolicy(
      requested({ writableRoots: [extra] }),
      effective({
        sandbox: { type: 'workspaceWrite', writableRoots: [CWD, extra], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      }),
    )).toEqual([]);
  });

  it('rejects a sibling directory that merely shares a prefix', () => {
    // `/work/agent-other` starts with `/work/agent` as a STRING but is not inside it.
    const sibling = path.resolve('/work/agent-other');
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({
        sandbox: { type: 'workspaceWrite', writableRoots: [sibling], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      }),
    );
    expect(mismatches.join('\n')).toMatch(/broadens access with unrequested root/);
  });

  it('rejects a MISSING requested writable root (a narrower policy is still different)', () => {
    // The turn would run with less authority than the caller was told it had and
    // quietly fail to write — which nobody investigates, unlike an error.
    const extra = path.resolve('/work/shared');
    const mismatches = verifyEffectivePolicy(
      requested({ writableRoots: [extra] }),
      effective({
        sandbox: { type: 'workspaceWrite', writableRoots: [CWD], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      }),
    );
    expect(mismatches.join('\n')).toMatch(/writableRoots is missing requested root\(s\)/);
    expect(mismatches.join('\n')).toContain(extra);
  });

  it('does not require cwd to appear in writableRoots (it is implicit)', () => {
    // cwd authority is verified separately via the cwd field; the host may or may not
    // list it, and either way it grants nothing beyond what was already verified.
    expect(verifyEffectivePolicy(
      requested(),
      effective({
        sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      }),
    )).toEqual([]);
  });
});

describe('provider, model, cwd and approvals', () => {
  it('rejects a non-openai provider', () => {
    const mismatches = verifyEffectivePolicy(requested(), effective({ modelProvider: 'azure' }));
    expect(mismatches.join('\n')).toMatch(/modelProvider is "azure", expected "openai"/);
  });

  it('rejects a substituted model', () => {
    const mismatches = verifyEffectivePolicy(requested(), effective({ model: 'gpt-5.4-mini' }));
    expect(mismatches.join('\n')).toMatch(/model is "gpt-5.4-mini", requested "gpt-5.5"/);
  });

  it('rejects a different cwd', () => {
    const mismatches = verifyEffectivePolicy(requested(), effective({ cwd: path.resolve('/tmp/elsewhere') }));
    expect(mismatches.join('\n')).toMatch(/cwd is/);
  });

  it('rejects any approval policy other than the exact string "never"', () => {
    for (const policy of ['untrusted', 'on-request'] as const) {
      const mismatches = verifyEffectivePolicy(requested(), effective({ approvalPolicy: policy }));
      expect(mismatches.join('\n')).toMatch(new RegExp(`approvalPolicy is "${policy}"`));
    }
  });

  it('rejects the granular approval variant', () => {
    // An object variant would reintroduce prompts nothing above the engine seam can
    // answer; they resolve to Cancel mid-turn.
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({ approvalPolicy: { granular: { sandbox_approval: true, rules: false } } }),
    );
    expect(mismatches.join('\n')).toMatch(/approvalPolicy is "granular\(sandbox_approval,rules\)"/);
  });
});

describe('reasoning effort', () => {
  it('accepts the effort we asked for', () => {
    expect(verifyEffectivePolicy(
      requested({ reasoningEffort: 'high' }),
      effective({ reasoningEffort: 'high' }),
    )).toEqual([]);
  });

  it('WARNS about a different effort instead of blocking the turn', () => {
    // Found in real testing: changing the dashboard effort while a thread is open
    // refused every turn with a "host policy" error. Effort is fixed when a Codex
    // thread is created, so a difference on resume is normal, grants no authority,
    // and must not stop safe work.
    const verdict = verifyRaw(
      requested({ reasoningEffort: 'medium', resumedThread: true }),
      effective({ reasoningEffort: 'high' }),
    );
    expect(verdict.blocking).toEqual([]);
    expect(verdict.warnings.join('\n')).toMatch(/continues at "high"[\s\S]*change to "medium" applies to a new chat/);
  });

  it('says the turn RUNS at the host value on a fresh thread, without claiming otherwise', () => {
    const verdict = verifyRaw(
      requested({ reasoningEffort: 'medium', resumedThread: false }),
      effective({ reasoningEffort: 'high' }),
    );
    expect(verdict.blocking).toEqual([]);
    expect(verdict.warnings.join('\n')).toMatch(/Requested reasoning effort "medium" but the host applied "high"; this turn runs at "high"/);
  });

  it('warns when a host pins an effort we never requested', () => {
    const verdict = verifyRaw(requested(), effective({ reasoningEffort: 'xhigh' }));
    expect(verdict.blocking).toEqual([]);
    expect(verdict.warnings.join('\n')).toMatch(/applied reasoning effort "xhigh"/);
  });

  it('an effort difference never masks a REAL policy violation', () => {
    const verdict = verifyRaw(
      requested({ reasoningEffort: 'medium', resumedThread: true }),
      effective({ reasoningEffort: 'high', sandbox: { type: 'dangerFullAccess' } }),
    );
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.blocking.join('\n')).toMatch(/sandbox type is "dangerFullAccess"/);
  });

  it('accepts an absent effort when the model default was requested', () => {
    expect(verifyEffectivePolicy(requested(), effective({ reasoningEffort: null }))).toEqual([]);
  });
});

describe('instruction sources and permission profiles', () => {
  it('rejects non-empty instructionSources (the persona would be double-injected)', () => {
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({ instructionSources: ['/work/agent/AGENTS.md'] }),
    );
    expect(mismatches.join('\n')).toMatch(/instructionSources is non-empty[\s\S]*double-injected/);
  });

  it('requires activePermissionProfile to be null', () => {
    // ClaudeClaw sends a LEGACY sandbox mode, which cannot be combined with the
    // permissions system, so the `sandbox` we verify is a compatibility PROJECTION.
    // It cannot express everything a permission profile may grant or restrict, so a
    // non-null profile means part of the real authority is outside what we proved.
    // The pinned-binary probe returns null, so this is the normal case.
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({ activePermissionProfile: { id: 'built-in-default', extends: null } }),
    );
    expect(mismatches.join('\n')).toMatch(/activePermissionProfile is "built-in-default", expected none/);
    expect(mismatches.join('\n')).toMatch(/legacy sandbox projection cannot prove/);
  });

  it('still reports the profile identity for diagnosis', () => {
    const withProfile = effective({ activePermissionProfile: { id: 'managed-strict', extends: 'base' } });
    expect(policyLogFields(requested(), withProfile).activePermissionProfile).toBe('managed-strict extends base');
  });

  it('reports both the profile AND weaker actual authority when they coincide', () => {
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({
        activePermissionProfile: { id: 'managed-strict', extends: 'base' },
        sandbox: { type: 'readOnly', networkAccess: false },
      }),
    );
    expect(mismatches.join('\n')).toMatch(/sandbox type is "readOnly", requested "workspace-write"/);
    expect(mismatches.join('\n')).toMatch(/activePermissionProfile/);
  });
});

describe('temp directories must not become implicit writable roots', () => {
  const wsWrite = (
    over: Partial<Extract<SandboxPolicy, { type: 'workspaceWrite' }>> = {},
  ): SandboxPolicy => ({
    type: 'workspaceWrite',
    writableRoots: [CWD],
    networkAccess: false,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
    ...over,
  });

  it('rejects excludeTmpdirEnvVar=false', () => {
    // Codex may then add the TMPDIR directory as an IMPLICIT writable root — broader
    // than advertised, with nothing extra in writableRoots to reveal it.
    const mismatches = verifyEffectivePolicy(requested(), effective({ sandbox: wsWrite({ excludeTmpdirEnvVar: false }) }));
    expect(mismatches.join('\n')).toMatch(/excludeTmpdirEnvVar=false[\s\S]*implicit writable root/);
  });

  it('rejects excludeSlashTmp=false', () => {
    const mismatches = verifyEffectivePolicy(requested(), effective({ sandbox: wsWrite({ excludeSlashTmp: false }) }));
    expect(mismatches.join('\n')).toMatch(/excludeSlashTmp=false[\s\S]*implicit writable root/);
  });

  it('reports both when both are disabled', () => {
    const mismatches = verifyEffectivePolicy(
      requested(),
      effective({ sandbox: wsWrite({ excludeTmpdirEnvVar: false, excludeSlashTmp: false }) }),
    );
    expect(mismatches.filter((m) => /implicit writable root/.test(m))).toHaveLength(2);
  });
});

describe('runtimeWorkspaceRoots is verified, not merely consumed', () => {
  it('accepts exactly [cwd] when no runtime roots are requested', () => {
    // The observed default from the account-free pinned-binary probe.
    expect(verifyEffectivePolicy(requested(), effective({ runtimeWorkspaceRoots: [CWD] }))).toEqual([]);
  });

  it('rejects an unrequested extra runtime root', () => {
    // These materialize :workspace_roots, so an unexpected entry changes effective
    // write authority even when the sandbox type matches.
    const extra = path.resolve('/opt/other');
    const mismatches = verifyEffectivePolicy(requested(), effective({ runtimeWorkspaceRoots: [CWD, extra] }));
    expect(mismatches.join('\n')).toMatch(/runtimeWorkspaceRoots broadens access with unrequested root/);
  });

  it('rejects a MISSING requested runtime root', () => {
    const extra = path.resolve('/opt/shared');
    const mismatches = verifyEffectivePolicy(
      requested({ runtimeWorkspaceRoots: [CWD, extra] }),
      effective({ runtimeWorkspaceRoots: [CWD] }),
    );
    expect(mismatches.join('\n')).toMatch(/runtimeWorkspaceRoots is missing requested root/);
  });
});

describe('every capability profile round-trips through verification', () => {
  // The adapter derives the requested policy from the shared Phase 0 helper, so each
  // profile must verify clean against the sandbox the host would report for it.
  const CASES: Array<{ name: string; input: Parameters<typeof resolveCodexCapabilityProfile>[0]; sandbox: SandboxPolicy }> = [
    {
      name: 'tool-less',
      input: { allowedTools: [], disallowedTools: ['*'] },
      sandbox: { type: 'readOnly', networkAccess: false },
    },
    {
      name: 'read-only-research',
      input: { allowedTools: ['Read', 'Grep', 'Glob'] },
      sandbox: { type: 'readOnly', networkAccess: false },
    },
    {
      name: 'workspace-agent',
      input: {},
      sandbox: { type: 'workspaceWrite', writableRoots: [CWD], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
    },
    {
      name: 'full-trust',
      input: { allowDangerouslySkipPermissions: true },
      sandbox: { type: 'dangerFullAccess' },
    },
  ];

  for (const { name, input, sandbox } of CASES) {
    it(`${name} verifies clean against its expected effective policy`, () => {
      const profile = resolveCodexCapabilityProfile(input, { dangerWriteEnabled: false });
      expect(profile.mode).toBe(name);
      const mismatches = verifyEffectivePolicy(
        { model: 'gpt-5.5', cwd: CWD, sandboxMode: profile.sandboxMode, networkAccess: profile.networkAccess },
        effective({ sandbox }),
      );
      expect(mismatches).toEqual([]);
    });

    it(`${name} fails when the host applies full access instead`, () => {
      const profile = resolveCodexCapabilityProfile(input, { dangerWriteEnabled: false });
      if (profile.sandboxMode === 'danger-full-access') return; // nothing to escalate to
      const mismatches = verifyEffectivePolicy(
        { model: 'gpt-5.5', cwd: CWD, sandboxMode: profile.sandboxMode, networkAccess: profile.networkAccess },
        effective({ sandbox: { type: 'dangerFullAccess' } }),
      );
      expect(mismatches.length).toBeGreaterThan(0);
    });
  }
});

describe('all mismatches are reported together', () => {
  it('does not stop at the first failure', () => {
    // An operator should see the whole picture in one log line, not fix causes one
    // at a time across repeated failed turns.
    const mismatches = verifyEffectivePolicy(
      requested({ reasoningEffort: 'high' }),
      effective({
        modelProvider: 'azure',
        model: 'other',
        approvalPolicy: 'untrusted',
        instructionSources: ['/x/AGENTS.md'],
      }),
    );
    // Effort is no longer among the blocking rules; the rest still report together.
    expect(mismatches.length).toBeGreaterThanOrEqual(4);
  });
});

describe('policyLogFields', () => {
  it('keeps requested and effective as separate keys', () => {
    // Logging a requested sandbox as though it were applied is the exact visibility
    // failure App Server exists to fix.
    const fields = policyLogFields(
      requested({ sandboxMode: 'workspace-write' }),
      effective({ sandbox: { type: 'readOnly', networkAccess: false } }),
    );
    expect(fields.requestedSandbox).toBe('workspace-write');
    expect(fields.effectiveSandbox).toBe('readOnly');
    expect(fields.requestedReasoningEffort).toBe('model-default');
  });

  it('reports null effective network access for full access, not a misleading false', () => {
    const fields = policyLogFields(
      requested({ sandboxMode: 'danger-full-access', networkAccess: true }),
      effective({ sandbox: { type: 'dangerFullAccess' } }),
    );
    expect(fields.effectiveNetworkAccess).toBeNull();
  });
});

describe('MCP authority on a resumed thread', () => {
  // The rule behind finding 2. Neither thread response carries an MCP field, so this
  // compares what the turn AUTHORIZED against what the thread can actually reach —
  // read separately via `mcpServerStatus/list`.
  const verify = (authorized: string[], effective: string[], hostAppsEnabled = false): PolicyVerdict =>
    verifyMcpAuthority({ authorized, hostAppsEnabled }, effective);

  it('passes when the inventory is exactly the authorized set', () => {
    expect(verify(['files', 'claudeclaw-dispatch'], ['claudeclaw-dispatch', 'files'])).toEqual({ blocking: [], warnings: [] });
    expect(verify([], [])).toEqual({ blocking: [], warnings: [] });
  });

  it('blocks a server the turn did not authorize', () => {
    // The restricted-resume case: the thread kept a server from an earlier turn.
    const verdict = verify([], ['claudeclaw-dispatch']);
    expect(verdict.blocking).toEqual(['"claudeclaw-dispatch" is reachable but this turn did not authorize it']);
    expect(verdict.warnings).toEqual([]);
  });

  it('blocks a leftover even when the turn authorized something else', () => {
    const verdict = verify(['files'], ['files', 'leftover']);
    expect(verdict.blocking).toEqual(['"leftover" is reachable but this turn did not authorize it']);
  });

  it('blocks when an authorized server is MISSING', () => {
    // Not merely less authority than requested: the resume is supposed to REPLACE
    // the thread's table, so a server we authorized and cannot see proves the
    // replacement never applied — and nothing else in the inventory can then be
    // trusted either. Same rule as a narrowed sandbox.
    const verdict = verify(['files'], []);
    expect(verdict.blocking).toEqual([
      '"files" was authorized for this turn but is not reachable on the thread; the requested MCP table did not replace the thread\'s own',
    ]);
    expect(verdict.warnings).toEqual([]);
  });

  it('blocks in BOTH directions at once, naming each side', () => {
    const verdict = verify(['files'], ['leftover']);
    expect(verdict.blocking).toEqual([
      '"leftover" is reachable but this turn did not authorize it',
      '"files" was authorized for this turn but is not reachable on the thread; the requested MCP table did not replace the thread\'s own',
    ]);
  });

  it('allows the host-owned apps server only when the profile allows host apps', () => {
    // It is materialized from the ACCOUNT rather than from our table, so its presence
    // is expected on a trusted profile — and a failed gate on a restricted one.
    expect(verify([], [HOST_APPS_MCP_SERVER], true).blocking).toEqual([]);
    expect(verify([], [HOST_APPS_MCP_SERVER], false).blocking).toEqual([
      `the host-owned "${HOST_APPS_MCP_SERVER}" server is still reachable although this turn denies host apps (features.apps=false did not take effect)`,
    ]);
  });

  it('reports every unauthorized server, not just the first', () => {
    const verdict = verify([], ['a', 'b'], true);
    expect(verdict.blocking).toHaveLength(2);
  });
});
