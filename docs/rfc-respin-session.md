---
Author: Michael Kidder
Title: /respin enhancement + /respin-session checkpoint restore
Status: Draft — earmarked for Claude Code handoff
Created: 2026-07-10
Component: session restore / context management
---

# `/respin` enhancement + `/respin-session` checkpoint restore

## 1. Summary

Give ClaudeClaw Messenger users a deliberate way to restore context: enhance
`/respin` to clear-then-rehydrate the recent conversation in one move, and add
`/respin-session` — a picker that restores from a chosen **checkpoint** (pinned
memory) rather than raw recency. Both **replace** context rather than stack on
top of it.

The one-line pitch: *checkpoints are an underused power play — `/respin-session`
turns a passive memory mechanism into a button you can press to teleport back to
a deliberate save state.*

---

## 2. How we got here (discovery → design)

Captured because the evolution is the rationale.

### 2.1 Initial discovery
While parking a session (cache-savings/telemetry work, checkpoint #789 pinned),
Mike planned to test a `newchat → respin → resume <message>` flow to pick the
work back up on a lean prefix the next day. Before he could run it, the weekly
memory-hygiene job fired on top of an already-fat prefix and the next turn hit
**"Prompt is too long."** He fell back to `newchat → respin` and observed:

> on respin the conversation essentially continues, so not sure `resume` is even
> needed.

That observation exposed the real gap.

### 2.2 The gap
`/respin` rehydrates the **last ~20 turns by recency** — not by importance. That
is why it "just continues" for a session you were actively in. But it is blind to
*salience*: it surfaces whatever you typed last (today: memory hygiene, timeout
explainers), not the work you actually intend to resume (the pinned checkpoint).

So two different jobs were being conflated:
- **recency restore** — "put me back in the room I just left"
- **checkpoint restore** — "drop me at the deliberate save point, regardless of
  the noise that happened after it"

`/respin` only ever did the first.

### 2.3 First rough cut (rejected naming)
Initial proposal borrowed Claude Code vocabulary:
- `/resume` → most recent pinned checkpoint + thin recency tail
- `/resume-session [id]` → named/selectable checkpoint restore

**Rejected** because `/resume` and `/recall` are already Claude Code's commands.
Reusing them in the Messenger layer invites "which resume did I mean" confusion
across the ecosystem.

### 2.4 Where we landed
Keep everything in ClaudeClaw's own `/respin` namespace — unambiguously ours, no
CC collision:
- **`/respin`** (enhanced): clear-then-rehydrate, recency-anchored, zero args.
- **`/respin-session`**: picker of ClaudeClaw sessions/checkpoints,
  checkpoint-anchored restore.

---

## 3. Design

### 3.1 `/respin` (enhanced)
- **Behavior:** clear the session, then re-inject the last ~20 turns (10
  exchanges), same recency window as today.
- **Change from current:** today `/respin` rehydrates *on top of* existing
  context, which is what fattened the prefix and caused "Prompt is too long."
  Enhanced `/respin` does the `newchat` implicitly — **clear then rehydrate** —
  collapsing the old two-step `newchat → respin` into one command and
  structurally eliminating the fat-prefix trap.
- **Args:** none. Recency-anchored.
- **Model:** "reset me back into the room I just left."

### 3.2 `/respin-session` (new)
- **Behavior:** present a picker (Telegram inline keyboard, via the existing
  AskUserQuestion → inline-keyboard bridge, PR #101). User selects an entry; the
  bot clear-then-rehydrates **that** state.
- **What it lists (settled):** **pinned checkpoints first**, most-recent first
  (rows in `memories` with `pinned = 1`, scoped to the agent/chat). **Fallback:**
  if no pinned checkpoints exist, offer a recency slice so the command is never
  a dead end.
- **Model:** "reset me to a chosen save point." Salience/pin-anchored, not
  recency.

### 3.3 Shared invariants
- Both commands **replace** context, never stack — this is the core fix for
  "Prompt is too long."
- Both live in the `/respin` namespace. No `/resume`, no `/recall`.

---

## 4. Data model notes

- Checkpoints already live in the `memories` table of `store/claudeclaw.db`
  (`pinned = 1`), distinct from static `CLAUDE.md`. No new table required.
- Picker query: pinned memories for the current agent/chat, `ORDER BY
  created_at DESC`, capped to a sane list length for the inline keyboard.
- Reuse the existing respin rehydration path (last-N-turns from
  `conversation_log`, filtered to the agent) for the recency tail/fallback.

---

## 5. Open questions

1. **Recency tail on `/respin-session`:** after restoring a checkpoint, do we
   also append a thin recency tail, or checkpoint-only? (Lean: checkpoint-only
   to keep the prefix lean; the whole point is to *escape* recent noise.)
2. **Picker label format:** what does each checkpoint row show — summary snippet
   + date? Needs to be scannable in a Telegram keyboard.
3. **Cross-agent scope:** `/respin-session` lists this agent's checkpoints only,
   or fleet-wide? (Lean: current agent only, matching respin's existing filter.)

---

## 6. Handoff

Earmarked for Claude Code. No branch yet, no code started. Relevant existing
mechanics to build on:
- Respin handler + rehydration path in `bot.ts` (last-20-turns from
  `conversation_log`).
- AskUserQuestion → Telegram inline-keyboard bridge (`bot.ts`, PR #101; multi-
  select + Other free-text extensions).
- `memories` table (`pinned` column) in `store/claudeclaw.db`.

---

> **Holden's analysis.** This one came out of a real failure — parking a session, watching memory-hygiene fatten the prefix, and hitting "Prompt is too long." The insight that fell out of it: `/respin` was silently conflating two jobs, recency-restore ("put me back in the room I just left") and checkpoint-restore ("drop me at the deliberate save point"), and only ever did the first. Checkpoints are an underused power play — `/respin-session` turns a passive memory mechanism into a button you can press to teleport back to a deliberate save state, and making both commands *replace* context rather than stack is what structurally kills the fat-prefix trap. — Holden
