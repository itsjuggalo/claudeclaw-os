---
Type: RFC
Title: In-Process Dispatch API for Fleet CLIs
Author: Michael Kidder
Decision: Accepted
Decision date: 2026-07-31
Implementation: Complete
Implemented in: v1.8.0 (PR #174)
Scope: Phase 2 of the Agent CLI Tooling roadmap (mission / schedule / hive)
Related: docs/agent-cli-reference.md (Phase 1, v1.5.1, #153), PR #163 (#157), .claude/plans/backlog/agent-cli-tooling.md
Last reviewed: 2026-08-01
---

# In-Process Dispatch API for Fleet CLIs

## Outcome

The scoped mission, schedule, and hive actions shipped in v1.8.0 through PR
#174. Claude-backed agents receive the shared in-process MCP tools, while native
OpenAI uses the stdio dispatch bridge backed by the same action handlers and
descriptor-derived schemas. The remaining fleet CLIs stay outside this RFC.

## Summary

Promote the load-bearing fleet CLIs — `mission-cli`, `schedule-cli`, `hive-cli` —
from subprocess shell-outs (`node "$PROJECT_ROOT/dist/<x>-cli.js"`) to
**first-class in-process tools**, whose schemas and handlers derive from the
same `CliDescriptor` registry that already backs the CLI reference generator.
One descriptor drives the `--help` text, the injected prompt index, and now the
executable tool.

## Problem

An agent's ability to coordinate with the fleet currently depends on shelling
out to `node dist/*-cli.js`. That works for Claude-backed agents but breaks for
sandboxed providers, and it is fragile and slow even where it works.

Concretely, confirmed on a live Codex/GPT test:

- The native Codex-SDK provider holds a full custom persona end-to-end on
  Telegram and reports failures honestly (tagged `[openai]`). Chat and web
  search work.
- It **cannot** dispatch a mission or create a scheduled job. The Codex adapter
  runs each turn in a `workspace-write` sandbox confined to `workingDirectory =
  input.cwd`. Agent turns launch with `cwd = the agent config dir`, and PR #163
  (fixes #157) deliberately keeps it there so the SDK still loads each agent's
  own `CLAUDE.md`. The fleet CLIs live under `PROJECT_ROOT`, which sits outside
  that cwd, so the sandbox refuses read/exec.
- PR #163 fixed only the *path discovery* problem for the Claude harness (it
  stamps the absolute `PROJECT_ROOT` into the injected index and forbids
  `git rev-parse` rediscovery). It does not — and by design cannot — help Codex:
  the model now knows exactly where `mission-cli` is and the sandbox still
  blocks it. Path known, gate shut.

Notably, **memory read/recall works on the same Codex agent**, because memory is
handled in-process by the runtime rather than via a subprocess. That is the
existence proof for this RFC: in-process capabilities are sandbox-immune.

## Proposal

Add an in-process dispatch layer:

1. Extend the `CliDescriptor` shape (in the leaf module `src/cli-descriptors.ts`)
   with per-command **input schemas**. Keep it a leaf — no import cycle into
   `db.ts` — preserving the inversion that lets `config.ts` consume descriptors.
2. Refactor the shared logic out of each `*-cli.ts` entrypoint into callable
   functions. The CLI entrypoint and the in-process handler call **one
   implementation**; neither re-parses argv independently.
3. Build a registry mapping descriptor -> handler. Tool schemas are **derived**
   from the descriptors, never hand-authored, so capability and documentation
   cannot drift.
4. Register tools at **global config** so scheduled turns (which fire in a
   scrubbed env) still see them.

Scope for this phase: `mission-cli`, `schedule-cli`, `hive-cli`.
`agent-create-cli`, `meet-cli`, `slack-cli` are a follow-up.

## Benefits

- **Provider-agnostic fleet access.** Codex/ACP/openrouter agents rejoin
  missions, scheduling, and the Hive Mind without widening any sandbox scope.
- **Performance.** Eliminates the per-call `node` process spawn + full module
  load (db init, config parse, encryption-key read) on every dispatch; it
  becomes a direct in-process function call.
- **Single source of truth.** The descriptor drives docs *and* the tool. This
  closes the discoverability class of failure that hid `mission-cli` fleet-wide
  for months (Phase 1's original motivation).
- **Discoverability without prompt text.** The capability is advertised in the
  tool schema, not just described in the injected index.

## Security / interplay

- Tools must respect the existing chat-path **tool-lockdown / `/code`
  escalation** gate — they go through it, never bypass.
- Enforce the **asymmetric access policy**: Claude full; non-Claude (ACP/Codex)
  restricted. Enforced at registration/invocation.
- This composes with the standing containment gates (output sanitizer,
  OS-level containment RFC) that block *seating* a non-Claude model; it does not
  relax them. It only changes *how* a permitted agent reaches fleet tools.

## Alternatives considered

- **Widen the Codex sandbox roots** to include `PROJECT_ROOT`/`STORE_DIR`.
  Unblocks quickly but keeps the subprocess coupling and widens the sandbox —
  acceptable as a temporary stopgap for a trusted operator agent, not the target
  design. Tracked as a fallback, not adopted.
- **Repoint agent cwd to `PROJECT_ROOT`** (Option 1 of #157). Fixes the path but
  breaks per-agent `CLAUDE.md` loading fleet-wide; rejected in #163 for that
  reason.

## Explicitly out of scope

- The sandbox-root widening stopgap (documented as fallback only).
- Phase 3 (doctor / health governance scan).
- The remaining three CLIs.

## Rollout

Build on a clean branch off `main`, full test suite green (per-handler unit
tests on an isolated store, a schema-derivation test, a lockdown test, plus the
existing Phase 1 drift/coverage guards). Runtime-aware vetting + Claude/Codex
smoke tests before merge. Merge is user + Mark only.

---

*Analysis note (Holden): this is the cleanest fix because it removes a
dependency rather than loosening a boundary. The memory subsystem already proves
in-process survives the sandbox, so this is a known-good pattern applied to the
fleet CLIs, not a bet. The perf win is a real bonus, but the strategic point is
provider-agnosticism: it decouples fleet participation from any one provider's
filesystem policy, which is exactly what a multi-provider Host needs.*
