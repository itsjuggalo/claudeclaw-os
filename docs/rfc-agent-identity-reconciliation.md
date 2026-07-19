---
Author: Michael Kidder
Title: Agent Identity Reconciliation
Status: Draft (plan-first, no code yet)
Created: 2026-07-08
Component: agent identity / name-to-id routing
---

# Agent Identity Reconciliation

## Problem

Agent identity is split across two names — an immutable canonical **id** (`main`,
`amos`, `naomi`, `drummer`, `alex`) and a mutable **display name** (`Holden`,
`Amos`, ...) set in `agent.yaml`. Earlier "display-name" work fixed only the
read/UI path. Two classes of defect remain on the write/routing side:

1. **Dead-letter routing.** Every routing path matches the canonical id with raw
   exact SQL (`assigned_agent = ?`, `agent_id = ?`). There is **no display-name →
   id resolver anywhere**, and the CLIs do **zero** validation. Agents are LLMs
   that only ever see display names, so any agent dispatching by the name it sees
   (`--agent holden` when the id is `main`) writes a row no poller ever claims. It
   fails silently — no error, no match, no report.
   - Live example: Amos's SCCHA handback (`fdfec14a`) sat `queued @holden`
     forever; had to be claimed by hand. Root cause: `assigned_agent='holden'`
     never matched the poller's `WHERE assigned_agent='main'`.

2. **`main` special-casing is now stale-to-wrong.** The disk layout and runtime
   already normalized `main` into the standard per-agent shape, but the dashboard
   still guards against the old shape. See Phase 2.

### Why this keeps happening

The id is user-typed at creation (`--id`) and never derived from a role, so
renames don't orphan the id. But the moment id ≠ display name (now true for every
named agent), any name-based reference that isn't resolved to the canonical id can
mismatch. This is a structural gap, not a one-off.

## Evidence (code map)

> **Anchors are indicative, not authoritative.** Line numbers below reflect the
> 2026-07-08 tree and drift with every commit. Locate each site by symbol/grep
> (function name, SQL fragment, path string), not by line. Known-drifted as of
> 2026-07-09: the `mission-cli`/`schedule-cli` write boundaries and the dashboard
> `CLAUDECLAW_CONFIG/CLAUDE.md` path (now ~`dashboard.ts:2658`).

- ID minting: `agent-create-cli.ts` (`--id`, `--name` separate) → `agent-create.ts:236,308`.
- ID validation regex: `agent-config.ts:48` `AGENT_ID_RE = /^[a-z0-9_-]+$/i`.
- Display name read: `agent-config.ts:24` `resolveAgentDisplayName(id)` (id→name only; **no inverse**).
- Routing matches (canonical id, exact):
  - Mission: `db.ts:2264` `claimNextMissionTask`, `db.ts:2236` `getMissionTasks`, store at `mission-cli.ts:79`.
  - Scheduled: `db.ts:1296` `getDueTasks`, store at `schedule-cli.ts:69`.
  - Inter-agent: `db.ts:2155` `createInterAgentTask`.
  - Dashboard assign: `dashboard.ts:1938/1959/1972` (this path *does* validate via `agentExists`/`validAgents`; the CLIs do not).
- Resolver / alias table: **none** ("direct matching only").
- Runtime self-id: `index.ts:29,32` sets `process.env.CLAUDECLAW_AGENT_ID`.

## Decision to lock (Phase 1 identity model)

Preference: identity should preserve an agent's **history across renames**.
Options:

- **A. Display-name resolver only.** `resolveAgentId` matches id or current
  display name. Fixes the reported bug and single renames. But a *second* rename
  (Naomi→Nova) orphans references still saying "Naomi".
- **B. Resolver + `aliases[]` in agent.yaml (recommended).** Same resolver, plus
  an append-only `aliases:` list. On rename, the previous display name is appended
  to `aliases`, so every historical label keeps resolving to the same canonical
  id forever. History is retained because the canonical id (the value actually
  stored in every table) never changes — aliases only affect *lookup*, never
  *storage*. This is the "actual id # that retains history" outcome Mike asked
  for, achieved without changing the id.

**Recommendation: B.** Canonical id stays the permanent primary key (all history
already keys off it); display name is presentation; aliases are an append-only
lookup set so no past reference ever dead-letters.

## Phase 1 — Resolver + reject-unknown guard

**New (single source, existing module):** `agent-config.ts`

```
resolveAgentId(input: string): string | null
  norm = input.trim().toLowerCase()
  1. if norm in listAgentIds()                       -> return norm      // canonical id (already includes 'main')
  2. for each agent: if norm === name.toLowerCase()  -> return that id   // display name
  3. for each agent: if norm in aliases[] (lowered)  -> return that id   // alias (Phase 1b)
  4. return null                                                          // unknown
```

Reads the same `agent.yaml` source `agentExists`/`resolveAgentDisplayName`
already use — **no new registry table, no second source of truth, no migration.**

**Wire resolve-then-store into every write boundary** (store canonical id only):
- `mission-cli.ts` create (the path that dead-lettered)
- `schedule-cli.ts` create
- `dashboard.ts` assign / PATCH / auto-assign classifier output
- `db.ts:createInterAgentTask` (or its callers)

**Reject-unknown guard:** if `resolveAgentId` returns null, the CLI exits non-zero
with `unknown agent '<x>' — known: main, amos, naomi, drummer, alex`. No dead
letters, ever. Pollers are untouched — they still match canonical id, which is now
the only thing ever stored.

**Phase 1b (aliases):** add optional `aliases: []` to `agent.yaml`; teach the
rename path (dashboard config save + any rename CLI) to append the outgoing
display name. Small, additive, ships right after 1a.

### Phase 1 test cases
- `--agent holden` → resolves to `main`, mission claimed (regression for `fdfec14a`).
- `--agent Naomi` / `--agent naomi` / `--agent research` (if that were the id) → same id.
- `--agent bogus` → non-zero exit, known-list printed, nothing written.
- After rename Naomi→Nova with alias append: `--agent Naomi` still resolves.
- Existing rows with canonical ids keep claiming (no behavior change for pollers).

## Phase 2 — De-special-case `main` in the dashboard

Disk + runtime already normalized (verified 2026-07-08):
- `~/.claudeclaw-os/agents/main/agent.yaml` **exists** (full standard shape:
  name=Holden, description, telegram_bot_token_env, voice_prompt, obsidian,
  `provider.model: claude-opus-4-8`).
- `~/.claudeclaw-os/agents/main/CLAUDE.md` **exists** (5.4KB persona); runtime
  loads it from cwd via the SDK.
- `main-config.json` is **gone** — model persistence already migrated into
  `agent.yaml` `provider.model`.
- `~/.claudeclaw-os/CLAUDE.md` (dashboard's "preferred" main-persona path) **does
  not exist**.

So the migration happened organically; only the dashboard lags. Two defects:

1. **Cosmetic — grayed buttons.** Editor hides main's Config tab and rejects
   editing its `agent.yaml` (`dashboard.ts:2682, 2760-2762`), guarding a
   "no agent.yaml" condition that is now false. Fix: drop the special-case; let
   main use the normal read/write path.
2. **Dangerous — silent no-op persona write.** Dashboard writes main's persona to
   `CLAUDECLAW_CONFIG/CLAUDE.md` (`dashboard.ts:2716`), a path that does not exist
   and the runtime never reads (runtime reads `agents/main/CLAUDE.md`). A persona
   edit via dashboard today writes to the wrong file and never reaches the running
   agent. Fix: repoint main's persona read/write to `agents/main/CLAUDE.md`.

**Also:** audit `index.ts` / `agent-config.ts` for remaining `=== 'main'` branches
and remove the ones the normalization made dead, so we kill the whole class rather
than the two the dashboard surfaces. Keep only the genuinely-needed ones (e.g.
pid-file name `claudeclaw.pid` vs `agent-<id>.pid`, ordering main first in lists).

Risk: **low** — mostly deleting stale branches + repointing one path. No data
migration (already done). Verify after: dashboard shows main's Config tab, saves
`agent.yaml`, and a persona edit reaches the running agent on the next turn.

## Sequencing & branching

Every file here is upstream-owned (`agent-config.ts`, `db.ts`, `dashboard.ts`,
`mission-cli.ts`, `schedule-cli.ts`), so per the overlay principle this branches
off **`main`**, not the runtime — it must not live as runtime drift. Build on a
throwaway clone and open a PR to `main` (same flow as PR #132); do **not** commit
to `runtime/claudeclaw-os`.

These changes are small and low-risk, so a branch-per-phase is overkill. **One
branch** off `main` — `feature/agent-identity-reconciliation` — with **one commit
per concern** so triage can bisect/revert a single piece without unwinding the
rest:

1. `resolveAgentId` + unit tests (no wiring yet — pure, safe)
2. reject-unknown guard wired into mission-cli / schedule-cli / dashboard / inter-agent
3. `aliases[]` support + rename-append
4. dashboard main de-special-case + persona-write path fix
5. `=== 'main'` audit cleanup
6. existing-user backfill migration (see below)
7. docs

Commit 1 alone closes the dead-letter root cause and is trivially revertable. If
initial testing flags something, we split only that commit onto its own branch.
`main` stays releasable throughout; the runtime picks these up after the PR merges
via the normal rebase-onto-new-main step.

## Test cases (vitest — co-located `*.test.ts`)

Framework is `vitest run`; homes already exist. Concrete additions:

`agent-config.test.ts` — **resolveAgentId**
- id passthrough: `main`→`main`, `amos`→`amos`
- display name: `Holden`/`holden`→`main`; `Naomi`→`naomi`
- case/whitespace: `  HOLDEN  `→`main`
- alias (1b): after alias append, old display name still resolves
- unknown: `bogus`→`null`; empty string→`null`
- collision guard: a display name equal to another agent's canonical id resolves
  id-first (documented precedence: id > name > alias)

`schedule-cli.test.ts` + new `mission-cli.test.ts` — **guard + resolve-then-store**
- `--agent holden` stores `assigned_agent='main'` (regression for `fdfec14a`)
- `--agent bogus` exits non-zero, prints known-list, writes **nothing**
- omitted `--agent` still yields unassigned (unchanged behavior)

`db.test.ts` — **poller unchanged**
- claim still matches canonical id only; a row stored via resolver is claimable

`dashboard.contract.test.ts` — **main normalized**
- GET editor for `main` returns a Config tab (not hidden) and reads
  `agents/main/agent.yaml`
- PUT persona for `main` writes `agents/main/CLAUDE.md` (not
  `CLAUDECLAW_CONFIG/CLAUDE.md`); assert target path
- PUT `agent.yaml` for `main` succeeds (no "edit .env directly" rejection)

`migrations.test.ts` — **backfill idempotency** (see below)
- install missing `agents/main/agent.yaml` → backfill creates a valid one
- running backfill twice is a no-op (no duplicate/overwrite of user edits)
- legacy `main-config.json` present → values folded into `agent.yaml`, json retired

## Documentation impact

- `README.md` — agent-identity section: canonical id vs display name vs aliases;
  note you can address an agent by any of the three.
- `docs/agent-common.md` — mission-cli / schedule-cli `--agent` now accepts
  id **or** display name **or** alias, and errors on unknown (was: silent).
- Agent-creation docs / `agent-create-cli` help — document `--name` and (1b)
  `aliases`, and that renames preserve history via alias append.
- Upgrade guide — mention the one-time backfill runs automatically on first start
  (self-healing; nothing for the user to do). Keep it in the agent-prompt style
  per the casual-user guide convention.
- This RFC — flip Status to Accepted once approved.

## Existing-user upgrade / self-heal

Yes — take advantage. New installs already scaffold `agents/main/agent.yaml`, but
installs that predate that still carry the old shape (missing main yaml, orphaned
`main-config.json`, persona at the legacy path). Add an **idempotent startup
backfill migration** (alongside the existing migration mechanism) that, for `main`:
- if `agents/main/agent.yaml` is missing → synthesize from `.env` + defaults +
  `main-config.json` (name from display, telegram_bot_token_env, provider/model)
- if `main-config.json` exists → fold `provider.model` into the yaml, then retire
  the json (rename to `.bak`, don't delete)
- if persona lives only at `CLAUDECLAW_CONFIG/CLAUDE.md` and `agents/main/CLAUDE.md`
  is absent → copy it into the standard location
- **never overwrite** an existing, user-edited `agents/main/agent.yaml`

Idempotent, logged, safe to run every boot. This is what makes the enhancement
reach existing users without a manual step.

### Migration validation — REQUIRED, do not skip

The unit tests (`migrations.test.ts`) cover synthesized/hand-constructed layouts,
but the backfill has **never been exercised against a real stale install** — this
workstation already migrated organically (2026-07-08: `main-config.json` gone,
yaml present, legacy root `CLAUDE.md` absent), so there is no genuine legacy shape
here to test against. That is a real gap: the unit fixtures approximate the old
shape, they don't reproduce it.

**Explicit requirement for whoever builds this:** validate the migration against a
genuine pre-scaffolding install, not just the unit fixtures. Concretely:

- Stand up an **early ClaudeClaw version** (pre-`agents/main/agent.yaml`
  scaffolding), let it create the legacy shape naturally: `main-config.json`
  present, persona at the legacy `CLAUDECLAW_CONFIG/CLAUDE.md` path, no
  `agents/main/agent.yaml`.
- Upgrade to the version carrying this RFC and boot once.
- Assert the self-heal did all four moves: yaml synthesized, `main-config.json`
  → `.bak`, legacy persona copied into `agents/main/CLAUDE.md`, and a
  user-edited yaml (if present) left untouched.
- Boot a **second** time and assert a clean no-op (idempotency on a real tree,
  not just the unit mock).

**Planned dry-run (Mike):** validate on a **macOS** environment — install an early
ClaudeClaw version, do initial testing to establish the legacy shape, then run this
upgrade/migration once the RFC lands to confirm all of the above end-to-end.
Cross-platform matters here: the backfill touches file paths and rename/copy ops,
so a Mac pass guards against Windows-only path assumptions leaking into the
migration.

## Safety guards / exception handling

Explicit handling for the "no agent.yaml found" class and friends:
- `resolveAgentId` **returns null, never throws** — callers decide (CLI = error
  and exit; dashboard = 4xx with message; internal = fall back to prior behavior).
- Config loader for any agent with a missing/malformed `agent.yaml`: log a clear
  warning, fall back to safe defaults, and **do not crash the process** (a broken
  sub-agent yaml must not take down the fleet). `main` keeps a hardcoded last-ditch
  default so the hub always boots.
- Malformed yaml (parse error) is treated as "missing" for fallback, with the bad
  file left untouched for inspection (never auto-clobbered).
- Backfill wrapped in try/catch; failure logs and continues boot rather than
  blocking startup.
- Guard messages name the offending input and list known agents, so a bad
  `--agent` is self-diagnosing instead of silent.

## Addendum (2026-07-09): display-name prettify sweep (frontend)

Orthogonal to the `name → id` routing core above (this is the reverse, `id →
display name`, presentation-only), but bundle it into the same identity pass so
every surface renders configured display names consistently.

**Root cause found.** The frontend helper `resolveAgentName` (`web/src/lib/format.ts`)
returns `_agentNameCache[id]` or, on a miss, **capitalizes the raw id**. The cache is
seeded only by pages that call `seedAgentNames()` off an `/api/agents` fetch. Pages
that don't seed it fall back to the capitalized id — so `main → "Main"` (the real
display name is **Holden**), while `naomi → "Naomi"`, `amos → "Amos"` coincidentally
match. That's why only `main`/Holden visibly breaks.

Affected surfaces (use `resolveAgentName`, mis-render `main` when cache unseeded):
- `web/src/pages/Audit.tsx` — agent filter tabs (:77) and the row cell (:109).
- `web/src/components/BrainGraph.tsx` + `BrainGraph3D.tsx` — Hive Mind hover/labels.

**Fix options (pick one):**
1. Seed the name cache once **globally at app init** (fetch `/api/agents` in the root
   shell, call `seedAgentNames`) so every page resolves correctly — recommended.
2. Add a hard `main → Holden` fallback in `resolveAgentName` (cheap stopgap).
3. Unify with the backend `resolveAgentDisplayName` source so front/back agree.

**Already done** (on the cache-savings metrics branch `feat/cache-savings-metrics`,
not yet merged): `/savings` and the dashboard Cache-savings panel render display
names via the **backend** resolver (`resolveAgentDisplayName`), so those are correct
independent of the frontend cache. The sweep above covers the remaining
frontend-only surfaces.

## Out of scope

- Changing canonical ids (they stay; that's the point).
- Central registry table (rejected — `agent.yaml` is already the single source).
- Renaming/UX for the rename flow itself beyond appending aliases.
