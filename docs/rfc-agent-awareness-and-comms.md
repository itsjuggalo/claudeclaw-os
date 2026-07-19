---
Author: Michael Kidder
Title: Agent Awareness & Deterministic Comms
Status: Draft — Tier 1 built (feat/agent-self-location, PR #142); Tier 2 built (feat/deterministic-comms); tracked via GH issue
Created: 2026-07-12
Component: setup / config generation / mission-cli / hive accessor / docs
---

# Agent Awareness & Deterministic Comms

## Summary

Two fundamental gaps, one theme: **agents should know less and rely on the system more.** Today a
fresh agent doesn't reliably know where its own store lives, and inter-agent routing depends on the
sending model guessing the right recipient. Both push judgment onto the model, and judgment drifts.
This RFC makes both properties of the runtime/CLIs instead of the prompt:

- **Tier 1 — Self-location:** every agent knows, from setup, its identity, config path, and resolved
  store path, and uses a **store-aware accessor** to touch its hive mind (never a raw sqlite path).
- **Tier 2 — Deterministic comms:** a handback resolves to the task's originator (`created_by`), so an
  agent only needs to know "reply to whoever queued me." The resolution is generic (agent id vs. a
  small set of non-agent origin sentinels) — no fleet-specific roster or org chart in shipped code.

Net effect: behavior is deterministic and **model-independent**, which is exactly what we need as
non-Claude/untrusted models (e.g. GPT via proxy) get put in the seat.

## Motivation

Two live findings on 2026-07-12, both verified from source:

1. **Agents don't know their own store.** A relocated sandbox agent (store pinned in its **`.env`**,
   not the process env) still surfaced the **live** fleet hive mind — because it had no documented way
   to read its own store, so it improvised a raw `sqlite3` call and found the main DB by absolute path.
   On Claude/opus with no proxy: structural, not a GPT quirk.
   - Root cause A: the shipped main template (`CLAUDE.md.example`) has **zero** hive-mind or
     self-location awareness (`CLAUDECLAW_STORE`/`STORE_DIR`/`CLAUDECLAW_CONFIG`/`agent-common` refs = 0).
     Never shipped — the live fleet only has it via hand-curated `~/.claudeclaw-os`. So **every fresh
     install** ships agents blind to their own store.
   - Root cause B (the strong one): `config.ts` (L133) resolves the store as
     `process.env.CLAUDECLAW_STORE_DIR || envConfig.CLAUDECLAW_STORE_DIR || PROJECT_ROOT/store`. In this
     env the pin lives in **`.env` (the `envConfig` branch), not a process env var** — so a raw `bash`
     `sqlite3`/`find` call **cannot see the pin at all**; only a Node process that loads `config.ts`
     can. The sanctioned how-to compounds it by hardcoding `sqlite3 "$PROJECT_ROOT/store/claudeclaw.db"`.
     So the real indictment isn't "the doc hardcodes a build-relative path" — it's that **bash has no
     access to the resolution logic, period.** That is the single strongest argument for a `hive-cli`:
     only a Node accessor can honor the `.env`-based pin. Any shell command is blind to it by
     construction.

2. **Routing depends on the sender guessing.** In the Skool-scraper incident, the fix's re-run was
   dispatched to Amos (wrong lane); Amos noticed and re-routed to Naomi. It self-corrected, but only
   because an agent caught another agent's mistake. The originating error was a model picking the
   wrong recipient from memory.

## Design

### Tier 1 — Self-location

- **Store-aware `hive-cli` (canonical accessor).** A small CLI (read/write) that **imports
  `config.ts`'s `STORE_DIR`** — including the `envConfig` (`.env`) branch — NOT a re-derivation from
  `process.env`. This is load-bearing: if it only read `process.env` it would reproduce the exact bug
  in every agent bash shell that lacks the var (which is all of them here). It also exposes
  **`hive-cli path`** to print its resolved DB. Docs/templates point agents at `hive-cli`, never a raw
  `sqlite3 $PROJECT_ROOT/store` string. Kills the improvise-and-hunt behavior: only a Node accessor can
  honor the `.env` pin, so agents stop shell-searching for a `.db` and can't accidentally hit the live
  store.
- **Setup stamps self-awareness (informational only).** Setup writes agent id + display name,
  `CLAUDECLAW_CONFIG`, and the resolved store path into the generated CLAUDE.md — but **the stamped path
  is a hint, not the source of truth.** A stamped path is a static snapshot that goes stale the moment
  anyone relocates the store; if agents trusted it we'd have just swapped one hardcoded path for another
  in a nicer file. The **canonical** answer is always `hive-cli path` / the accessor. The CLAUDE.md line
  says as much ("for reference; run `hive-cli path` for the live value"). Ship in `CLAUDE.md.example`
  (main) and align `agents/_template` (sub-agents already carry hive_mind refs) to the accessor.
- **Fix `agent-common.md`** to reference `hive-cli` instead of the build-relative sqlite command; ship
  it (or its substance) so fresh installs get the how-to, not just the hand-curated live config.
- **Template hygiene (from the 2026-07-12 self-diagnosis).** The loaded template still carried
  unedited bracket placeholders (`Michael [does what you do]`) and **install-time scaffolding** —
  "Copy to `~/.claudeclaw-os/agents/main/CLAUDE.md`", "the always-on claudeclaw-os runtime" — which the
  agent read as *runtime fact* and used to infer the production path. Keep install/copy instructions
  **out of the runtime-loaded file** (they belong in setup docs/README), and make setup **enforce
  placeholder replacement**. Combined with a shared `$HOME` (`~/.claudeclaw-os` exists at
  `/c/Users/mikek`) and leaked env like `GEMINI_CLI_IDE_WORKSPACE_PATH` pointing at production, those
  strings are active misdirection, not inert.

### Tier 2 — Deterministic comms

- **Handback resolves to `created_by`.** Add `mission-cli handback <task-id> "<report>"`: recipient is
  the task's originator, looked up from the row — the agent supplies no agent id. Store `parent_task_id`
  for the chain. **`created_by` is not always an agent, so resolution must never dead-end.** The rule is
  generic and roster-free: a small set of **reserved non-agent origin sentinels** routes to the human;
  **anything else is treated as an agent id and the mission routes straight back to it.** No list of
  specific agent names is compiled into shipped code.
  | `created_by` | Handback destination |
  |---|---|
  | a reserved sentinel: `dashboard` (default origin), `human`, or a numeric chat id | surface to the human (dashboard/human have no mission inbox) |
  | `scheduled` / cron-origin | surface to the human (unattributable to an agent inbox by itself) |
  | anything else | treated as the originating agent id → that agent's mission board |

  Reserved sentinels are runtime concepts (not customer agents), so the rule ships unchanged for every
  install. The failure case to eliminate is a handback that resolves to *nothing*; the catch-all "route
  back to the id that queued me" guarantees it can't.

**Deferred:** owner-validated / lane-based dispatch of *new* work (motivation #2) is **out of scope for
Tier 2** — it can't be done without a per-install owner map, which is customer-specific config, not
global runtime behavior. It belongs in a later RFC that treats the lane map as external, operator-owned
config. Tier 2 is handback-only.

### Tier 3 — Gather / join primitive

**Locked orchestration taxonomy.** Work units are **mission-task** (one-shot, `mission-cli`) and
**schedule-job** (recurring/cron, `schedule-cli`) — the CLIs are the mechanism, the units are what we
name in doctrine. **Dispatch** is the umbrella verb: you *dispatch* a mission-task in one of three
modes. The mode names the delivery, not the send:

| Mode | Fan-out | Blocks caller | Result returns via | Shape | Mechanism |
|---|---|---|---|---|---|
| **delegate** | 1 → 1 | no | optional handback, later, as its own mission-task | async, non-blocking | `mission-cli create` (+ `handback`) |
| **await** | 1 → N | yes | caller waits inline, one summary in the same turn | synchronous, blocking | orchestrator behavior (no CLI verb) |
| **gather** | 1 → N | no | scheduler notifies on the last completion (join) | async, non-blocking (promise-like) | `mission-cli gather` |

Naming rule: the blocking mode is **await** (it literally waits); **gather** is the non-blocking join;
both are distinct from the umbrella verb *dispatch*. Defaults — delegate for 1→1, gather for fan-out,
await only when the answer is needed inside the current turn.

Tier 2 delivered **delegate** (deterministic handback). This tier delivers **gather** — the fan-out
case Tier 2 doesn't solve. The three, side by side, and why gather is the scalable default:

1. **delegate (Tier 2).** Async and scalable, but each handback fires as its **own isolated
   mission turn** with no view of its siblings — so a fan-out of them yields N separate replies and any
   "still outstanding" claim is an unverified guess (observed live: a later handback listing
   already-returned siblings as pending). Right for 1→1, wrong for a fan-out.
2. **await (manual, orchestrator).** The orchestrator fans out, then **blocks and waits** until
   all complete, then emits one summary. Clean result, but it ties up the orchestrator's turn and *is*
   the polling we otherwise forbid. Acceptable only as an **explicitly named** mode, never the default.
3. **gather (this tier).** The **scheduler** — not the orchestrator — releases a single
   aggregation turn once the last child of a group finishes. Non-blocking, no polling, one summary.

**Design.**
- **Group tag.** A fan-out is created with a shared `group_id`; children complete normally with their
  findings as their result (**no per-child handback turn**), so nothing auto-narrates.
- **Join mission.** One "join" mission is created for the group, assigned to the aggregating agent, but
  parked in a new **`waiting`** status the scheduler does **not** claim.
- **Scheduler-released.** When any child completes, the scheduler checks whether every sibling in its
  group is terminal (`completed`/`failed`/`cancelled`); if so, it releases the join mission
  (`waiting` → `queued`) and assembles the child results into the join prompt. The join then runs **once**
  and produces the single consolidated summary — exactly like manual **await**, but the *system*
  waits, not a person.
- **Atomic last-child release (the one hard part).** Two children finishing near-simultaneously must not
  both release (double summary) or both skip (no summary). Release is a single conditional update —
  `UPDATE mission_tasks SET status='queued' WHERE group_id=? AND role='join' AND status='waiting'` — and
  only the caller that sees `changes()==1` owns the release. Everything else is straightforward.
- **Never dead-ends.** A group whose join can't attribute a destination falls back to the human-surface
  path (same rule as Tier 2). A stuck child (timeout/failed) still counts as terminal, so the join
  always eventually fires.

Net: fan-out gather becomes a first-class, non-blocking primitive. `/gather` stays as the manual,
zero-infrastructure fallback; the join primitive is the scalable default once it lands.

### What each agent must "know" (the whole point)

- **Self:** who I am, where my config + store are, and `hive-cli` to reach my hive mind.
- **Callback:** results go back to whoever queued me (the CLI resolves it from `created_by`).
- Nothing about the org chart, and no compiled-in roster of agent names.

## Containment (scoped OUT here → next RFC, and it is a NEAR-term priority, not someday)

This RFC removes the **accidental** footgun. It does **not** close the hole, and the hole is proven,
not theoretical (verified 2026-07-12):
- Production's ~31MB live DB is **writable** by this sandbox agent.
- **Six** `claudeclaw.db` files are reachable under the same OS user.
- `agent.ts` runs `permissionMode: 'bypassPermissions'` + `settingSources: ['user']`, so a project
  `.claude/settings.json` deny-rule is **ignored**. A curious or untrusted model with Bash
  absolute-paths straight to the live store — read *and* write.

Self-location + `hive-cli` stop the well-behaved agent from *stumbling* onto it; nothing here stops a
model that *chooses* to. The only real fix is **OS-level isolation** (separate user / WSL / container),
optionally plus a permission-mode code change. That belongs in its own RFC — **prioritized, not
deferred**: the moment a non-Claude model sits in this seat, a writable production DB reachable by
absolute path is the whole ballgame. Do not run an untrusted provider in this seat until that RFC lands.

## Implementation surface

- new `src/hive-cli.ts` (+ `dist`) — **imports `config.ts` `STORE_DIR`** (incl. `.env`/`envConfig`
  branch), not a `process.env` re-derivation; adds `hive-cli path` (print resolved DB) + read/write.
- `CLAUDE.md.example` — add self-location + `hive-cli` usage (main agent); **strip install/copy
  scaffolding** ("Copy to ~/.claudeclaw-os…", "always-on runtime") out of the runtime-loaded file.
- `agents/_template/CLAUDE.md` — align to `hive-cli`; same scaffolding strip.
- `scripts/setup.ts` (~L893–952) — stamp resolved config/store paths as **informational** (point to
  `hive-cli path` as canonical); **enforce placeholder replacement** (no `[YOUR NAME]`/`Michael [does
  what you do]` left in a generated config); ship/point-to `agent-common.md`.
- `src/mission-cli.ts` — `handback` subcommand resolving `created_by` per the roster-free rule
  (reserved sentinels → human; anything else → that agent id). No `--lane` / owner-map in Tier 2.
- `mission_tasks` schema — add `parent_task_id` (Tier 2); add `group_id`, `role` ('task'|'join'), and a
  `waiting` status (Tier 3).
- `src/scheduler.ts` (Tier 3) — on child completion, detect group membership, atomically release the
  group's `waiting` join mission when all siblings are terminal, and assemble child results into the join
  prompt.
- `src/mission-cli.ts` (Tier 3) — `gather` verbs to create a grouped fan-out plus its parked join mission.
- `~/.claudeclaw-os/docs/agent-common.md` (and shipped copy) — replace raw sqlite with `hive-cli`.
- sandbox launch hygiene — scrub production-pointing env (`GEMINI_CLI_IDE_WORKSPACE_PATH`, etc.) so
  they can't seed the wrong path (belongs to the containment RFC but note the vector here).
- Tests per repo standard (append to existing *.test.ts).

## Out of scope

- OS-level untrusted-provider containment (separate RFC).
- Agent identity/display-name reconciliation (separate, existing RFC).

## Rollout

Tracked via a GitHub issue (the paper trail); code PRs reference it with `Closes #`. This RFC lands in
`docs/` on `main`. Build the fix on a clean clone → PR per tier. One-concern discipline: split Tier 1
(self-location) and Tier 2 (deterministic comms) into two PRs, Tier 1 first (it's the fundamental fix
and unblocks the sandbox work).

---

> **Holden's analysis.** The through-line is that our agents currently have to *figure out* things
> that should be givens — where their own data lives, and who to talk to. Every time we lean on the
> model to remember, we inherit its drift, and that drift is worse the less we trust the model. The
> 2026-07-12 sandbox test made this concrete: a store-relocated agent still read the live hive mind on
> plain Claude, because "read your hive mind" wasn't a capability it had, it was a puzzle it solved
> with a raw sqlite call. Verified in source that the main template never shipped self-location or
> hive awareness — so this isn't a regression to restore, it's a fundamental gap to close, and it hits
> every install, not just this sandbox. Tier 1 is the one I'd build first: give agents a correct,
> store-aware accessor and tell them where they live, and the whole class of "hunt the filesystem for a
> db" behavior disappears — which also quietly shrinks the data-egress surface before we ever layer a
> non-Claude model on top. Tier 2 then makes handbacks deterministic — an agent only ever "replies to
> whoever queued me," resolved by the CLI from `created_by` with a generic, roster-free rule — so
> autonomy scales without any agent (or shipped code) carrying a fleet-specific roster. Lane-based
> dispatch of new work is deliberately deferred: it needs a per-install owner map, which is operator
> config, not global runtime behavior.
