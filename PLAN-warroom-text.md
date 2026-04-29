# Text War Room: Bugs, Slash Commands, Hive Mind

Scope: in-process TS war room (`src/warroom-text-*.ts`, `src/dashboard.ts`, `src/db.ts`, `src/memory.ts`). Two additive schema migrations:
- `warroom_meetings.chat_id TEXT` (default `''`) for chat scoping.
- `conversation_log` gains `source TEXT NOT NULL DEFAULT 'telegram'` and `source_meeting_id TEXT`, `source_turn_id TEXT`, plus **two partial unique indexes** to keep dedupe semantics clean *(round-5 #3)*:
  - `idx_convlog_warroom_user ON conversation_log(source, source_meeting_id, source_turn_id) WHERE source != 'telegram' AND role = 'user'` — singleton user row per turn.
  - `idx_convlog_warroom_assistant ON conversation_log(source, source_meeting_id, source_turn_id, agent_id) WHERE source != 'telegram' AND role = 'assistant'` — one assistant row per agent per turn.
  - This avoids storing the same `/discuss` user prompt 5 times (once per agent), which would have bloated history search and recall. The user row is written once with `agent_id = decision.primary` (the first responder); assistant rows have their respective `agent_id`.

Single-tenant assumption (per existing config): `mission_tasks` are NOT scoped by `chat_id`. ClaudeClaw runs with `ALLOWED_CHAT_ID` (singular) per agent; missions are global on the box. If multi-tenant is added later, a follow-up migration adds `mission_tasks.chat_id`. **Documented limitation, not a bug.**

## Phase 1 — Bug fixes

1. **Multi-mention force-speak**: in `warroom-text-orchestrator.ts:149`, build `explicitMentions: Set<string>` from `extractAllAtMentions`. In the intervener loop (`:313-336`), when `explicitMentions.has(candidateId)`, bypass `interventionGate()` and run the agent with the original `trimmed` text (no gate seed).
2. **Multi-mention survives primary-empty** *(Codex finding #6)*: the existing `skipInterveners` short-circuit at `:292` kills all interveners when primary produced no reply. For explicitly-mentioned interveners, do NOT skip — they were directly addressed; let them run on `trimmed` even if primary timed out. Refactor: split `skipInterveners` into per-candidate decisions; gate-driven interveners skip on empty primary, explicit ones don't.
3. **Mention dedupe + cap**: `extractAllAtMentions` already dedupes. Cap total speakers at 3 (1 primary + 2 interveners); on overflow, emit a `system_note` "3 of N mentioned agents will respond."
3a. **Mention tokenization** *(round-4 #6)*: current regex at `:592` only matches `@id` at start-of-string or after whitespace, so `@comms,@ops`, `(@ops)`, `@research:`, and newline-prefix mentions miss. Broaden to `(?:^|[\s,(\[\{:;])@([a-z][a-z0-9_-]{0,29})\b` (allow common punctuation before `@`). Add unit tests for: comma-separated, parenthesized, colon-prefixed, newline-prefixed, end-of-line. Update `extractAllAtMentions` and add a regression test in `src/warroom-text-orchestrator.test.ts` (or wherever orchestrator tests live).
4. **Sticky addressee — timing-correct** *(round-1 #1 + round-3 #4)*: must run BEFORE the current user row is persisted, OR query strictly before the inserted row's `(created_at, id)`. The existing `getWarRoomTranscript(meetingId, {beforeId})` ignores `beforeId` unless `beforeTs` is also provided — confirmed in code. Two acceptable paths:
    - **(preferred)** Make `addWarRoomTranscript` return `{id, created_at}` (it already gets the row id from `lastInsertRowid`; just expose `created_at` too). Pass both as a `(beforeTs, beforeId)` cursor.
    - **(alternative)** Add a true id-only filter path to `getWarRoomTranscript`: `WHERE meeting_id = ? AND id < ?`. Smaller change but adds a second query mode.
    - Branch order at orchestrator `:148-228`: `@mention → pinned → sticky → ack/greeting → router`. **Pinned wins over sticky.** Sticky is explicitly guarded by `if (!meeting.pinned_agent)`. Both round-1's "between @mention and pinned" wording and the precedence claim were inconsistent — committing to this order *(round-4 #3)*.
5. **Sticky body**: `inferStickyAddressee(meetingId, currentText, roster, beforeCursor)` — pull last 10 transcript rows strictly before `beforeCursor`, find the most recent `speaker==='user'` row, run `extractAllAtMentions` on it. Returns the agent id only when: (a) exactly one mention, (b) prev row is within 10 minutes, (c) current text ≤ 200 chars, (d) not greeting/ack, (e) no contradicting "everyone/team/all of you" or different `@<other>` mention.
6. **Sticky precedence (final)**: `@mention > pinned > sticky > ack/greeting > router`. Sticky never fires when `pinned_agent` is set.
7. **Status pill overlay** *(Codex finding #9)*: change `.status-bar` from animated `height: 0 ↔ 30px` to permanent reserved `min-height: 30px` with opacity fade on the `.active` class. Use the existing `nearBottom` flag and `scrollToBottom(force)` helper at `warroom-text-html.ts:994-1020` (NOT `userScrolled` which doesn't exist). Inside `setStatus(text, true)`, if `nearBottom` is true, call `scrollToBottom(false)` to keep the last bubble pinned to the visible area now that the bar is permanent height.
8. **Streaming whitespace**: per-bubble `dataset.seenNonWS` flag. Strip leading whitespace from each chunk until first non-WS char arrives in `agent_chunk` handler at `warroom-text-html.ts:1428-1442`.
9. **Defer (documented)**: live markdown during stream — stays as raw `**foo**` until finalize. Acceptable v1.

## Phase 2 — Slash commands

10. **Lifecycle-respecting intercept** *(Codex finding #7)*: branch happens INSIDE `handleTextTurn`, AFTER allocating `turnId`, AFTER persisting the user transcript row via `addWarRoomTranscript`, AFTER emitting `turn_start`. Slash detection: `parseSlashCommand(trimmed)` returns `null | {cmd:'standup'|'discuss', args:string}`. Skip dedup-suppression of slash commands? No — keep dedup; replays are still bad. Then dispatch to `handleStandup(...)` or `handleDiscuss(...)` instead of the normal route+primary+interveners flow.
11. **Watchdog and budgets** *(round-1 #5 + round-2 #5 + round-3 #7)*: the 300s turn watchdog lives in the dashboard queue wrapper at `dashboard.ts:707-780` (NOT inside `handleTextTurn`); it fires a generic abort with a 2s grace then releases the FIFO **even if `handleTextTurn` never returns**. Therefore the wrapper owns the user-facing timeout UX, not the slash handler.
    - **Wrapper** emits the final `system_note` "Slash command timed out — try again." and `turn_complete` (or `turn_aborted`) on hard timeout. This is a small enhancement to the existing wrapper to detect that the active turn was a slash command (look up turnId metadata or pass a `commandKind` flag through state).
    - **Slash handler** uses **45s per-agent** budget (intervener-style); 5 × 45s = 225s under the 300s threshold with margin. It subscribes to `cancelFlag` purely for *cooperative* cleanup: finalize the in-flight bubble incomplete, break the loop. It does NOT race the wrapper to emit the user-facing timeout message.
    - Pass an explicit `roleBudgetMs` override into `runAgentTurn` (small param add).
    - **Per-turn finality guard** *(round-5 #4)*: when the wrapper abandons a slash turn at 300s and releases the FIFO, the SDK subprocess for the abandoned turn can still emit late chunks/done events that would land on the channel and look like they belong to the *next* queued turn. Add a `finalizedTurns: Set<string>` on the channel; the wrapper adds a turnId to it when emitting timeout. `MeetingChannel.emit` drops events whose `ev.turnId` is in `finalizedTurns`. `runAgentTurn` checks `finalizedTurns.has(turnId)` before each chunk write and transcript persist; if true, exits cleanly without writing anything. Garbage-collect entries from `finalizedTurns` when the next turn for that meeting starts (or via the existing channel sweeper).
12. **/standup** *(round-5 #5)*: sequential `runAgentTurn` per agent. Roster semantics:
    - Build the speaker list as: canonical-order intersection (`['research', 'ops', 'comms', 'content', 'main']` filtered to those present in `getRoster()`), THEN any other configured agents in roster order, capped at **N = 5 max speakers**.
    - If roster has > 5 agents, the slash command speaks only the first 5 (canonical first, then config-order). Emit a `system_note` listing skipped agents: `"Skipped: <id1>, <id2> — slash commands cap at 5 speakers."`
    - If a canonical agent (e.g. `content`) is absent from the roster, skip silently.
    - Per-agent context = recent agent activity. Add a bounded helper `getRecentConversationByAgent(meetingChatId, agentId, sinceTs, limit=20)` (verified via grep that no equivalent exists).
    - Mission helper: add `getRecentMissionTasks(agentId, status, sinceTs, limit=10)` if the existing one is unbounded.
    - Prompt frame: "2-3 sentence status: wrapped, queued, blockers."
13. **/discuss <topic>**: same fixed council order, same 45s budget per agent. Each agent sees prior takes via `buildMeetingContextBlock` (already includes just-emitted bubbles).
    - Frame: "Council opinion. 2-3 sentences. Build on or push back against earlier takes."
    - Empty topic → `system_note "Usage: /discuss <topic>"` and `turn_complete`. No agents run.
14. **Edges**:
    - Missing roster member → skip silently.
    - Cancel mid-sequence → `cancelFlag` already breaks loops; in-flight bubble finalized incomplete by `runAgentTurn`.
    - Per-meeting concurrency → `messageQueue` (per-meeting FIFO) already serializes; two `/standup` back-to-back queue cleanly.
    - Slash inside @mention (`@research /standup`) → @mention path takes precedence; slash ignored as literal text.
    - No recent activity → still post; agent says "nothing notable in the last 24h."
15. **Client affordance** *(round-4 #1)*: there's an existing client-side slash handler at `warroom-text-html.ts:2065` that intercepts `/pin`, `/unpin`, `/clear`, `/end` locally and shows "Unknown command" for anything else. Update that handler so it ONLY intercepts the existing local commands; `/standup` and `/discuss` must fall through to `sendMessage` so the server orchestrator handles them. Add a small dropdown when composer starts with `/` listing `/standup`, `/discuss <topic>` (server-side), `/pin <agent>`, `/unpin`, `/clear`, `/end` (client-side); Tab completes.

## Phase 3 — Hive mind connectivity

16. **Schema: `warroom_meetings.chat_id`** *(Codex round-1 #2)*: add a `chat_id TEXT NOT NULL DEFAULT ''` column. The dashboard URL already carries `chatId` in query strings; the picker passes it in the POST body to `/api/warroom/text/new` (already verified). Thread through to `createTextMeeting(meetingId, chatId)` so it persists. Legacy meetings (`chat_id = ''`) → bridge no-ops.
17. **Schema: chat-scoped meeting queries** *(round-2 #7 + round-3 #5, #6)*: after the column lands, scope ALL text-war-room endpoints by chat_id, not just creation/list/cleanup. Otherwise a stale or copied `meetingId` from chat A could be exercised in a session running as chat B.
    - **Helpers**: `getOpenTextMeetingIds(excludeId, chatId)`, `getTextMeetings(limit, chatId?)` (optional param so legacy callers work), `getTextMeeting(meetingId)` unchanged (id-keyed).
    - **Endpoint guards** *(round-4 #2 + round-5 #1, #7)*: round-4 weakened this to derive-from-meeting-row, but that still leaves the cross-chat-access hole open: a stale `meetingId` from chat A used by a session running in chat B would happily proceed. Restore strict validation, AND update the client to actually send `chatId`:
        - **Client change**: extend `Q` to `?token=…&chatId=…` and `MEETING_Q` to `Q + '&meetingId=…'`. Single one-line edit at `warroom-text-html.ts:839-840`. All existing fetches automatically pick up the new shape.
        - **Server guards**: each text-war-room endpoint (`/api/warroom/text/{stream, send, history, abort, pin, unpin, clear, end}` and `/warroom/text` page renderer) loads the meeting via `getTextMeeting(meetingId)`, then validates `requestChatId === meeting.chat_id` (or both empty for legacy). Mismatch → 403 (page renderer redirects to picker).
        - **Authoritative chat context** for memory/missions/conv-log inside handlers: still use `meeting.chat_id` (the row), not the request param. The request param exists only to enforce the guard.
        - **`warmup`** has no `meetingId` today; keep it global / non-meeting-scoped (no user data flows through it). Optionally pass `chatId` for logging only.
        - **Internal SSE proxy / replay**: confirm SSE `sinceSeq` resume sends `chatId` too. `warroom-text-html.ts:1345` builds the URL with `MEETING_Q` — automatically inherits chatId after the Q change.
    - **Picker fetch** *(round-3 #6)*: `warroom-text-picker-html.ts:335` calls `/api/warroom/text/list?token=…&limit=15` without `chatId`. Update the fetch to include `&chatId=<CHAT_ID>` so the server-side filter returns the right list. Legacy meetings with `chat_id=''` are returned only when `chatId=''` (no current chat); otherwise hidden. Document this in the picker's empty-state copy ("no prior text meetings for this chat yet").
17a. **`meetingChatId` vs SDK session key — naming and threading** *(round-4 #4)*: `runAgentTurn` already uses a synthetic `chatId = warroom-text:${meetingId}` as the **SDK session key** at `warroom-text-orchestrator.ts:727`. If the new memory/persistence wiring reads that variable as "the chat id", every memory query and conv-log write will use the synthetic key and miss the real Telegram chat entirely.
    - Rename the existing local: `chatId` → `sessionChatId` (or `warRoomSessionKey`) inside `runAgentTurn`. SDK calls keep using it.
    - Thread `meetingChatId` separately into `runAgentTurn` from `handleTextTurn` (loaded once via `getTextMeeting(meetingId).chat_id` at the top of the function and passed down).
    - **All memory/missions/conv-log calls use `meetingChatId`, never `sessionChatId`.** Empty string (`''`) means legacy meeting → bridge no-ops, no memory injection, no persistence.
    - Add a unit test or runtime assert that `meetingChatId` does NOT start with `'warroom-text:'`.

18. **War-room → conversation_log persistence — explicit API** *(round-2 #1, #2 + round-3 #1, #2 + round-4 #7)*: existing `saveConversationTurn` signature treats arg 4 as `sessionId` and has no `source`/dedupe support. Don't overload it. Instead:
    - Migrate `conversation_log` to add `source TEXT NOT NULL DEFAULT 'telegram'`, `source_meeting_id TEXT NULL`, `source_turn_id TEXT NULL`. Add the two partial unique indexes per top-of-doc *(round-5 #3)*: `idx_convlog_warroom_user` (singleton user) and `idx_convlog_warroom_assistant` (per-agent assistant).
    - New helper `saveWarRoomConversationTurn({meetingChatId, agentId, originalUserText, agentReply, meetingId, turnId, isFirstAssistantOfTurn})`. Insert ONE user row IF this is the first agent of the turn (caller signals via `isFirstAssistantOfTurn`); the user-row index ensures repeated calls within the same turn no-op. Always insert ONE assistant row tagged `source='warroom-text'`. Use `INSERT OR IGNORE` against the partial unique indexes so retries are safe.
    - **Critical: `originalUserText`, NOT framed/seeded text.** Interveners receive seeded prompts ("[You were pulled in to add your angle. The primary just spoke...]"); persisting that would poison memory ingestion. Thread `originalUserText` separately from `agentPromptText` through `runAgentTurn`. Add `originalUserText` field to `RunAgentTurnArgs`.
    - Skip if `chat_id === ''` (legacy meeting).
    - For `/standup` and `/discuss`, the `originalUserText` is the user's slash command verbatim (e.g. `/discuss should we ship X`). All five agent replies share the same `source_turn_id` and dedupe correctly because `agent_id` differs.
    - **Memory ingestion path** *(round-3 #2)*: `ingestConversationTurn` at `src/memory-ingest.ts:78` hard-skips messages starting with `/`. Persisting the verbatim slash command for audit/idempotency is correct, but for memory extraction we pass a **normalized ingestion text** instead:
        - `/discuss <topic>` → `Team discussion on: <topic>`
        - `/standup` → `Team standup: <agentName>'s status` (per-agent, since each agent's reply has standalone value)
        - Multi-mention non-slash → unchanged (already passes the leading-`/` filter).
    - Implementation: `saveWarRoomConversationTurn` writes both rows in a `db.transaction(() => { ... })` block *(round-4 #7)* so a SQLite error or crash can't leave a half-persisted turn. The transaction returns `{userInserted: boolean, assistantInserted: boolean}` derived from the `INSERT OR IGNORE` `result.changes`. Validate `meetingId` and `turnId` are non-empty for `source != 'telegram'`. After commit:
        - **Only invoke `ingestConversationTurn(meetingChatId, normalizedText, agentReply, agentId)` if `assistantInserted === true`** *(round-5 #2)*. A retry where the assistant row already existed (no insert) MUST NOT re-ingest — that would create duplicate or divergent memories even though `conversation_log` is unchanged.
        - On transaction failure, do NOT trigger ingestion.
        - Only normalize for `/`-prefixed user text.
19. **Memory injection in war room turns** *(round-4 #5)*: existing `buildMemoryContext` at `src/memory.ts:64-145` unconditionally pulls in consolidations (Layer 3) and `getOtherAgentActivity` (Layer 4) — both incompatible with strict per-agent isolation in the war room. Don't call it as-is.
    - Add an options param: `buildMemoryContext(chatId, userMessage, agentId, opts?: {includeConsolidations?: boolean, includeTeamActivity?: boolean, includeRecallHistory?: boolean})`. Defaults preserve current behavior so Telegram callers don't change.
    - War-room calls pass `{includeConsolidations: false, includeTeamActivity: false, includeRecallHistory: true}`. Recall (Layer 5) is fine — it's keyword-gated, agent-scoped already, and useful in the war room.
    - In `runAgentTurn`, before SDK invoke, prepend three blocks to the agent prompt (NOT to `originalUserText` — keep that pristine for persistence per item 18):
        - Memory block from `buildMemoryContext(meetingChatId, originalUserText, agentId, {includeConsolidations: false, includeTeamActivity: false})`. Uses **`meetingChatId`** per item 17a, never `sessionChatId`.
        - Last 10 `conversation_log` rows for `(meetingChatId, agentId)` from past 24h via `getRecentConversationByAgent`, formatted `[Telegram earlier] User: … / You: …`.
        - Mission queue line: `[Your queue: N pending, oldest <age>]`.
20. **Memory filtering coverage — read AND write side** *(round-1 #4 + round-2 #3 + round-3 #3)*: drop the `agent_id IS NULL` clause — the migration at `src/db.ts:566` makes that column `NOT NULL DEFAULT 'main'`, so no nulls exist. Use strict equality on both retrieval AND ingestion paths.
    - **Semantics**: each memory belongs to the agent that wrote it. War-room transcripts are shared (public room) but private agent insights from Telegram aren't. **Strict isolation per agent**; introduce sharing later if needed.
    - **Retrieval-side patches** (audit before editing): `searchMemories`, `getRecentHighImportanceMemories`, vector lookup helpers. Filter `WHERE chat_id = ? AND agent_id = ?` (strict). Vector helpers: filter candidate set BEFORE similarity ranking.
    - **Write-side patches** *(round-3 #3)* — currently the larger leak. `ingestConversationTurn` does duplicate detection by calling `getMemoriesWithEmbeddings(chatId)` and rejecting at cosine sim > 0.85; this checks across ALL agents in the chat. Patch:
        - Add `agentId` parameter to `getMemoriesWithEmbeddings(chatId, agentId)`; filter so duplicate detection only compares against same-agent memories. Otherwise agent B's first attempt to save a similar fact silently no-ops because agent A wrote one yesterday.
        - Same for any consolidation candidate selection — only consolidate same-agent memories. The `consolidations` table itself stays unmigrated (still no `agent_id` column) for v1; defer that migration. To avoid mixed consolidations, scope the *input* selection to one agent at a time. Existing pre-migration consolidation rows that mixed agents stay; we just don't read them in the war-room flow (per item 20 below: skip consolidations in war-room context entirely).
    - **Consolidations in war-room context**: skip entirely for v1 — simpler than the migration. Document and defer adding `consolidations.agent_id`.
    - **`getOtherAgentActivity`**: scope by chat where applicable; do NOT include in war-room agent prompts (cross-pollination risk). Audit usages.
    - Unit tests: (a) agent A writes 3 memories, B writes 3, `buildMemoryContext(chat, q, 'A')` recalls only A's; (b) agent A and agent B independently save *near-duplicate* memories — both succeed (no cross-agent dedupe).
21. **Mission awareness — single-tenant scope**: in `routerContextFor` (`warroom-text-orchestrator.ts:566`), inject `pendingMissionsByAgent: Record<string, number>` so the router prompt can mention workload. Mission queries are NOT chat-scoped (per top-of-doc single-tenant assumption). Wrap mission queries in try/catch; on error, prepend nothing (don't fail turn).
22. **War room → Telegram bridge** in `buildMemoryContext` *(round-5 #6)*: when `chatId !== ''`, append last 10 `warroom_transcript` rows from past 24h across that chat's meetings as `[War room earlier] <speaker>: …`. Reuses existing transcript queries; filter `warroom_meetings WHERE chat_id = ?` then join transcript.
    - **Exclude current meeting**: war-room callers ALSO call `buildMemoryContext` (item 19), and `buildMeetingContextBlock` already injects the current meeting's transcript. Without exclusion, the same content appears twice. Add an `excludeMeetingId?: string` option to `buildMemoryContext`; the war-room bridge query becomes `WHERE chat_id = ? AND meeting_id != ?`. Telegram callers omit it (no exclusion).
    - Combined with item 19: war-room callers now pass `{includeConsolidations: false, includeTeamActivity: false, excludeMeetingId: currentMeetingId}`; Telegram callers default everything.
23. **Token bloat caps**: memories block 1500 chars, conv-log block 2000 chars, war-room block 1500 chars, mission line 200 chars. Truncate oldest first.
24. **Cross-agent leakage prevention** *(reinforces #20)*: never inject one agent's `conversation_log` into another's prompt. Filter is strict `agent_id = currentAgentId`. War-room transcript is shared (it's a public room and visible to all agents in that meeting).
25. **Defer**: SSE event broadcast across surfaces (mission complete → war room banner). Polling fine for v1.
26. **Defer**: `inter_agent_tasks` table read path. Audit-only.
27. **Defer**: consolidations agent-scoping migration (per item 20).
28. **Defer**: `mission_tasks.chat_id` migration (single-tenant assumption per top-of-doc).

## Verification

29. **Build gates**: `npm run build` after each phase. Run `npm test` — existing tests stay green plus new memory-filter and persistence tests.
30. **Bug 1 (multi-mention)**: `@comms @ops priority?` → both bubbles in sequence; no `intervention_skipped` for ops.
31. **Bug 2 (multi-mention + empty primary)**: stub primary timeout; explicitly-mentioned ops still produces a bubble on `originalUserText` (not seeded text).
32. **Bug 4 (sticky timing)**: `@research foo` then `also bar` → routes to research; reason `sticky from prior @research`; verify SSE log shows the cursor query was strictly before the current message's row id.
33. **Bug 7 (pill)**: long reply across status transitions; last bubble never clipped at any viewport height. Test small-window case where the 30px reservation matters most.
34. **Bug 8 (whitespace)**: prompt eliciting markdown; first chunk has no leading vertical gap.
35. **/standup**: queue 1 mission per agent in last 24h; expect 5 ordered bubbles (full roster, no cap), ≤3 sentences each, citing real activity.
36. **/standup budgets** *(round-4 #8)*: stub each agent at ~30s; total well under 225s; clean completion. Stub one agent at 60s — that agent hits the **per-agent 45s budget** (item 11), is finalized as incomplete, and the loop continues to the next agent. Separately, for the **300s queue watchdog test**: stub `runAgentTurn` (or the SDK stream) to ignore abort and never resolve, force the wrapper's 300s watchdog to fire; confirm wrapper emits the timeout `system_note` and `turn_complete`/`turn_aborted` within the 2s grace and releases the FIFO.
37. **/discuss**: `/discuss should we ship X this quarter` → 5 ordered bubbles; later agents reference earlier takes.
38. **Persistence — original text only** *(item 18)*: run `/discuss x` in war room; check `conversation_log` rows: `role='user'` row has `'/discuss x'` (verbatim slash command), NOT a seeded "[You were pulled in to add your angle…]" string. Run a multi-mention `@comms @ops bar` turn; ops's persisted user row has `'@comms @ops bar'`, not the seeded intervener prompt.
39. **Persistence — multi-agent rows preserved** *(round-3 #1)*: `/discuss topic` produces 5 distinct `role='assistant'` rows in `conversation_log` with the same `source_turn_id` but different `agent_id` values. None get dropped by the unique index.
40. **Persistence — idempotent**: simulate a retry of `saveWarRoomConversationTurn` with same `(source_meeting_id, source_turn_id, agent_id)`; second insert no-ops via partial unique index.
41. **Slash → memory ingestion** *(round-3 #2)*: run `/discuss should we ship X this quarter` in war room. Confirm: (a) `conversation_log` has the verbatim `/discuss …` user rows, (b) `memories` table eventually contains an extracted memory whose source text was the normalized `Team discussion on: should we ship X this quarter` (NOT silently dropped by the leading-`/` filter).
42. **Cross-agent duplicate isolation** *(round-3 #3)*: agent A saves "user prefers TS" via Telegram; later, agent B tries to save the same. B's save is NOT silently dropped; both rows exist with distinct `agent_id`.
40. **Memory bridge T → W**: save fact in Telegram via main; ask in war room → main agent recalls.
41. **Memory bridge W → T**: run `/discuss` in war room; later in Telegram, ask main about it. Main's `buildMemoryContext` includes the war-room transcript bridge (item 22) AND the persisted conversation_log rows surface in standard memory recall. Confirm both paths.
42. **Memory filter — strict isolation** *(item 20)*: agent A writes memories with chat_id=X; agent B builds context for same chat_id=X — does NOT see A's memories. Verify across `searchMemories`, `getRecentHighImportanceMemories`, and vector helpers.
43. **Mission awareness**: queue 5 missions for ops; ambiguous war room question — router prompt log shows workload hint; ops reply may mention queue depth.
44. **Concurrency**: two browser tabs in same meeting both send `/standup` → second queues behind first; no interleaving; both complete.
45. **Schema migration safety**: on a DB pre-migration: (a) `warroom_meetings.chat_id` added with default `''`, existing meetings still openable; (b) `conversation_log.source` added with default `'telegram'`, existing rows untouched; (c) partial unique index built without conflicting with existing data. Re-run migration; idempotent.
46. **Chat scoping — creation** *(item 17)*: with two `chat_id`s in DB, opening `/api/warroom/text/new` for chat A does NOT auto-end chat B's open meetings.
47. **Chat scoping — endpoint guards** *(round-3 #5)*: with a meeting created under chat A, requesting `/api/warroom/text/{stream,send,history,abort,pin,unpin,clear,end}` with `chatId=B` returns 403. Page renderer `/warroom/text` redirects to picker.
48. **Picker chat scoping** *(round-3 #6)*: in chat A, the picker's "Recent meetings" list shows only chat A's meetings; chat B's are hidden. Legacy meetings (`chat_id=''`) appear only when the picker is loaded with no `chatId`.
49. **Watchdog ownership** *(round-3 #7)*: stub a slash agent to hang past the 300s window. Wrapper emits the timeout `system_note` and `turn_complete`/`turn_aborted`; slash handler does cooperative cleanup (finalize bubble incomplete, break loop) but does NOT race the wrapper to emit the final user-facing message.
50. **Mention regex broadening** *(round-4 #6)*: tests confirm `@comms,@ops`, `(@ops)`, `@research:`, and `\n@content` all parse to the expected ids; existing word-boundary cases still work; non-mention text (`email@host.com`, `@/path`) does NOT match.
51. **Atomic persistence** *(round-4 #7)*: simulate a SQLite error on the assistant insert (e.g. by violating a CHECK constraint in test); verify the user row was NOT persisted (transaction rolled back) and `ingestConversationTurn` was NOT called.
52. **chatId vs sessionChatId** *(round-4 #4)*: search the implemented diff for any new memory/missions/conv-log call whose chat_id arg starts with `'warroom-text:'`. None should exist. Add a runtime assert in `saveWarRoomConversationTurn` that throws if `meetingChatId.startsWith('warroom-text:')`.
53. **War-room memory shape** *(round-4 #5)*: in war room, dump the assembled prompt for an agent turn; confirm it contains the memory block (Layer 1+2) but NOT a `[Team activity …]` block and NOT consolidation insights. In Telegram, confirm those blocks STILL appear (default opts unchanged).
54. **Client slash passthrough** *(round-4 #1)*: type `/standup` and `/discuss x` in the composer; both POST to `/api/warroom/text/send` (verify network tab). `/pin foo`, `/unpin`, `/clear`, `/end` still intercept locally.
55. **Strict chat-id validation restored** *(round-5 #1)*: deploy with the `Q`/`MEETING_Q` client edit. Confirm a meeting opened in chat A returns 403 from any `/api/warroom/text/*` mutation when called with `chatId=B`. The page renderer redirects chat-mismatched URL loads to the picker.
56. **Idempotent ingestion** *(round-5 #2)*: simulate a `saveWarRoomConversationTurn` retry where the assistant row already exists. `result.changes` reads 0; `ingestConversationTurn` is NOT invoked the second time. Memory table has exactly one new memory row from the original call.
57. **User row stored once per turn** *(round-5 #3)*: run `/discuss x`. `SELECT COUNT(*) FROM conversation_log WHERE source='warroom-text' AND source_turn_id=? AND role='user'` returns 1. Same query for `role='assistant'` returns N (per-agent count).
58. **Late chunks dropped** *(round-5 #4)*: stub one slash agent to keep streaming chunks for 30s after the wrapper times out at 300s. Confirm those chunks are dropped (not appended to the next turn's bubble); inspect channel logs for "dropped-after-finalize" debug entries (or a counter).
59. **Slash roster cap** *(round-5 #5)*: add a 6th custom agent. `/standup` runs the canonical 5; emits a `system_note` listing the skipped 6th agent.
60. **War-room bridge dedup** *(round-5 #6)*: in war room, dump the agent prompt for a turn. The `[War room earlier]` block does NOT contain rows from the current meeting (excluded by `excludeMeetingId`). In Telegram, the same bridge DOES include all war-room rows for that chat.

## Out of scope

47. Voice war room, Telegram bot loop core, Mission Control UI rewrite, auth/security; SSE cross-surface event broadcast, `inter_agent_tasks` read path, consolidations agent-scoping migration, `mission_tasks.chat_id` migration.

---

## Changelog

### Round 1 — Codex review (2026-04-26)

Took:
- **#1 (high)**: Sticky addressee timing. Plan now requires capturing `userTranscriptRowId` and using it as a strict `beforeId` cursor in `getWarRoomTranscript`. (Items 4, 5, 29.)
- **#2 (high)**: chat_id scoping. Added an additive migration `warroom_meetings.chat_id` and threaded `chatId` from `/api/warroom/text/new`. Updated scope line at top. (Items 16, 40.)
- **#3 (high)**: Persist war-room replies through `saveConversationTurn` so they become durable Telegram memory. Source-tagged for idempotency, skipped for legacy meetings. (Items 17, 36.)
- **#4 (high)**: Memory filter coverage extended to `searchMemories`, `getRecentHighImportanceMemories`, and vector helpers — not just `getRecentMemories`. Added unit-test obligation. (Items 19, 23, 37.)
- **#5 (high)**: Slash-command watchdog. 5 × 75s exceeded the 300s turn watchdog. Now uses 45s per-agent budget (5×45=225s), capped roster to 4 for `/standup` if needed, and emits partial-completion `system_note` on watchdog hit. (Items 11, 12, 33.)
- **#6 (medium)**: Multi-mention survives primary-empty. Split `skipInterveners` so explicitly-mentioned interveners still run on `trimmed` even when primary produced nothing. (Items 1, 2, 28.)
- **#7 (medium)**: Slash intercept point clarified — branches inside `handleTextTurn` AFTER turnId allocation, user-row persistence, and `turn_start` emit. (Item 10.)
- **#8 (medium)**: Helpers spelled correctly with explicit bounding. Plan now adds `getRecentConversationByAgent(chatId, agentId, sinceTs, limit)` and `getRecentMissionTasks(agentId, status, sinceTs, limit)` rather than relying on assumed-existing names. (Items 12, 18.)
- **#9 (low)**: Status-pill scroll flag corrected to `nearBottom` + `scrollToBottom(force)`; the `userScrolled` name was wrong. (Item 7.)

Rejected: none — all nine findings are real.

Scope adjustments: original plan said "no schema migrations". Codex finding #2 makes one migration unavoidable for the cross-surface bridge to work; accepted as a single-column additive migration with safe defaults.

### Round 2 — Codex review (2026-04-26)

Took:
- **#1 (high)** — `saveConversationTurn` signature mismatch + no idempotency: don't overload it. New helper `saveWarRoomConversationTurn`, plus an additive migration adding `source`, `source_meeting_id`, `source_turn_id`, and a partial unique index for dedupe. (Item 18, scope line, items 38–39, 45.)
- **#2 (high)** — Persisting framed/seeded prompt text would poison memory: thread `originalUserText` separately through `runAgentTurn`. Persistence and memory ingestion always use `originalUserText`. (Item 18, item 19, item 38.)
- **#3 (high)** — Memory isolation gaps: dropped the wrong `agent_id IS NULL` clause (column is `NOT NULL DEFAULT 'main'`); switched to strict equality. Audited `consolidations` (defer scoping migration; skip in war-room context for v1) and `getOtherAgentActivity` (do not include in war-room prompts). Defined "strict per-agent" semantics. (Item 20, deferred items 27, item 42.)
- **#4 (high)** — Mission tasks not chat-scoped: documented as single-tenant assumption per existing `ALLOWED_CHAT_ID` (singular) config. Deferred `mission_tasks.chat_id` migration. (Top-of-doc scope line, item 21, deferred item 28.)
- **#5 (medium)** — Watchdog ownership: kept ownership in the dashboard queue wrapper; slash handler subscribes to the same `cancelFlag` and finalizes inside the 2s grace. No architectural change. (Item 11.)
- **#6 (medium)** — `/standup` count was inconsistent (5 vs ≤4). Committed: full roster, fixed order, no cap; budgets keep total ≤ 225s under the 300s watchdog. (Item 12, verification 35.)
- **#7 (medium)** — chat_id scoping for meeting cleanup: `getOpenTextMeetingIds` and meeting list/history helpers now take chat_id; `/api/warroom/text/new` only auto-ends meetings for the same chat. (Item 17, verification 46.)

Rejected: none — all seven findings are real.

Scope adjustments: a second additive migration on `conversation_log` (`source`, `source_meeting_id`, `source_turn_id` + partial unique index) accepted to make war-room persistence safe and idempotent. `mission_tasks.chat_id` and `consolidations.agent_id` deferred behind the single-tenant assumption.

### Round 3 — Codex review (2026-04-26)

Took:
- **#1 (high)** — Unique-index key was wrong: `agent_id` added to the partial unique index `(source, source_meeting_id, source_turn_id, agent_id, role)`. Without this, `/standup`, `/discuss`, and multi-mention turns would silently drop every assistant row after the first because they share `source_turn_id`. (Top-of-doc scope, item 18, verification 39, 40.)
- **#2 (high)** — Slash commands would never become memory: `ingestConversationTurn` skips messages starting with `/`. Plan now persists the verbatim slash command for audit/idempotency but feeds a normalized text (`Team discussion on: <topic>` / `Team standup: <agentName>'s status`) to memory extraction. (Item 18, verification 41.)
- **#3 (high)** — Memory isolation only covered retrieval, not write-side duplicate detection or consolidation. Plan now patches `getMemoriesWithEmbeddings(chatId, agentId)` and consolidation candidate selection so cross-agent duplicates and consolidations don't suppress legitimate memories. (Item 20, verification 42.)
- **#4 (high)** — Sticky cursor: `getWarRoomTranscript` ignores `beforeId` without `beforeTs`. Plan now requires `addWarRoomTranscript` to return `{id, created_at}` (or alternatively adding a true id-only filter path) and passes both. (Item 4.)
- **#5 (medium)** — Chat scoping was leaky on every endpoint that keyed solely on `meetingId`. Plan now requires endpoint guards on every text-war-room route (`stream`, `send`, `history`, `abort`, `pin`, `unpin`, `clear`, `end`, `warmup`, page renderer) — strict-validate request `chatId` against `meeting.chat_id`. (Item 17, verification 47.)
- **#6 (medium)** — Picker `/api/warroom/text/list` fetch missing `chatId`. Updated the fetch and defined explicit legacy fallback. (Item 17, verification 48.)
- **#7 (medium)** — Watchdog UX ownership: queue wrapper proceeds even if `handleTextTurn` doesn't return, so the slash handler can't be the source of truth for timeout messaging. Plan now puts the user-facing timeout `system_note` and `turn_complete` in the wrapper; slash handler only does cooperative cleanup. (Item 11, verification 49.)

Rejected: none — all seven findings are real.

Scope adjustments: no new migrations, but the `conversation_log` partial unique index gains `agent_id`. Endpoint-guard work is an additional small surface change across roughly 9 routes.

### Round 4 — Codex review (2026-04-26)

Took:
- **#1 (high)** — Existing client slash handler at `warroom-text-html.ts:2065` would intercept `/standup` and `/discuss` with "Unknown command". Plan now updates the handler to pass server-side commands through `sendMessage`. (Item 15, verification 54.)
- **#2 (high)** — Strict request-`chatId` validation would break the page since the existing client-side `Q`/`MEETING_Q` requests don't include `chatId`. Switched to **derive-from-meeting-row** server-side; client unchanged. (Item 17.)
- **#3 (high)** — Sticky precedence wording was contradictory. Committed branch order: `@mention → pinned → sticky → ack/greeting → router`. Sticky guarded by `if (!meeting.pinned_agent)`. (Items 4, 6.)
- **#4 (high)** — `runAgentTurn` already names the SDK session key `chatId = warroom-text:${meetingId}`. New memory/persistence wiring would silently use that synthetic key. Plan now renames it to `sessionChatId` and threads `meetingChatId` separately for memory/missions/conv-log; runtime assert added. (New item 17a, item 19, verification 52.)
- **#5 (medium)** — `buildMemoryContext` always includes consolidations and `getOtherAgentActivity`, breaking strict isolation. Plan now adds an options param so war-room callers can disable both. Telegram default behavior preserved. (Item 19, verification 53.)
- **#6 (medium)** — Mention regex misses `@a,@b`, `(@a)`, `@a:`. Broadened tokenization with regression tests. (New item 3a, verification 50.)
- **#7 (medium)** — `saveWarRoomConversationTurn` was not atomic. Wrapped two inserts in a `db.transaction`; ingestion only fires on commit; defensive non-null guards on source fields. (Item 18, verification 51.)
- **#8 (low)** — Verification 36 conflated per-agent budget vs queue-watchdog tests. Split into two distinct tests. (Verification 36.)

Rejected: none — all eight findings are real.

Scope adjustments: rename `chatId → sessionChatId` inside `runAgentTurn` is a localized refactor (one symbol). `buildMemoryContext` gains an optional opts param; callers default-preserved.

### Round 5 — Codex review (2026-04-26)

Took:
- **#1 (high)** + **#7 (medium)** — Round-4's "derive chat from meeting row, don't validate request chatId" still left the cross-chat-access hole open. Reverted to **strict-validate** with a one-line client change extending `Q`/`MEETING_Q` to include `chatId`. Verification 47 is now consistent (and strengthened in 55). (Item 17, verification 55.)
- **#2 (high)** — Ingestion ran on every `saveWarRoomConversationTurn` call even when `INSERT OR IGNORE` was a no-op. Now ingestion is gated on `assistantInserted === true` (derived from `result.changes`). Prevents duplicate memories on retry. (Item 18, verification 56.)
- **#3 (medium)** — Single unique key stored the same `/discuss` user prompt 5 times (once per agent). Split into TWO partial unique indexes: singleton user (per turn), per-agent assistant. User row tagged with `decision.primary` as agent_id. (Top-of-doc scope, item 18, verification 57.)
- **#4 (high)** — Wrapper releases FIFO at 300s but the abandoned SDK subprocess can still emit late chunks/done events that would attach to the next queued turn. Added a per-meeting `finalizedTurns: Set<string>`; the wrapper marks turnIds finalized; `MeetingChannel.emit` and `runAgentTurn` drop events/writes for finalized turns. (Item 11, verification 58.)
- **#5 (medium)** — Roster semantics were contradictory: "all roster members" plus a hardcoded 5-agent order. Now: canonical-order intersection with the configured roster, capped at 5 speakers, with a `system_note` listing skipped agents on overflow. (Item 12, verification 59.)
- **#6 (medium)** — War-room bridge inside `buildMemoryContext` would duplicate the current meeting's transcript (already injected by `buildMeetingContextBlock`). Added `excludeMeetingId?` option; war-room callers exclude the current meeting; Telegram callers omit. (Item 22, verification 60.)

Rejected: none — all seven findings are real.

Scope adjustments: one-line client change to `Q`/`MEETING_Q` shape; second partial unique index on `conversation_log`; small `finalizedTurns` set on the channel struct (no new schema). Total surface still small.

---

**Loop status (round 5 / max 5):** Codex flagged 7 substantive findings this round. All taken. Loop budget exhausted. Ending turn so the hook detects max-rounds-reached and exits cleanly.
