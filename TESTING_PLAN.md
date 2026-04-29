# Text War Room — Testing Plan

Covers the work in `PLAN.md` (Phases 1–3). Ordered fastest → deepest. Each test has: **setup**, **action**, **expect** (UI + SQL), and a **fail mode** describing what would block ship vs. ship-with-followup.

Total estimate: **45–75 min** for full pass, **8 min** for the smoke + ship-blockers only.

---

## Pre-flight

### P0. Backup the DB before destructive tests

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
cp "$PROJECT_ROOT/store/claudeclaw.db" "$PROJECT_ROOT/store/claudeclaw.db.pretest-$(date +%s)"
```

### P1. Build + tests baseline

```bash
cd "$PROJECT_ROOT" && npm run build && npm test 2>&1 | tail -10
```

**Expect:** `Tests 347 passed (347)`. If anything is red, stop and triage before manual tests — the manual layer trusts the unit layer.

### P2. Restart the main agent so the migration runs

```bash
launchctl kickstart -k "gui/$(id -u)/com.claudeclaw.main"
sleep 2
launchctl print "gui/$(id -u)/com.claudeclaw.main" | grep -E 'state|last exit code|runs'
```

**Expect:** `state = running`, `last exit code = 0`, `runs ≥ 1`.

### P3. Confirm migrations actually ran

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "PRAGMA table_info(warroom_meetings);" | grep chat_id
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "PRAGMA table_info(conversation_log);" | grep -E 'source|source_meeting_id|source_turn_id'
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_convlog_warroom%';"
```

**Expect:** `chat_id` column visible on `warroom_meetings`; `source`, `source_meeting_id`, `source_turn_id` on `conversation_log`; both partial indexes (`idx_convlog_warroom_user`, `idx_convlog_warroom_assistant`) listed.

**Fail mode:** any missing column/index = **block ship**. The migration is defensive (`addColumnIfMissing` + `CREATE INDEX IF NOT EXISTS`), so absence means a deeper bug.

---

## Smoke test (~8 min — run before everything else)

### S1. Open the war room

Navigate to the dashboard. Click the war-room card. Click "Start text room." Page should load with `chatId=…&meetingId=wr_…` in the URL and the warmup intro should run.

**Expect:** roster on the left, transcript empty state, composer at bottom, status bar reserves a thin row above the composer (you can see a faint top-border).

**Fail mode:** redirect loop back to picker = **block ship** (chat-id guard or migration broken).

### S2. Send a basic message

Type `hey team` and send.

**Expect:** Main responds. No "Routing…" pill (greeting short-circuits). No leading whitespace inside the bubble. Markdown bold (if any) renders raw during stream, formatted at finalize — that's expected.

### S3. Multi-mention smoke

Send `@comms @ops priority for tomorrow?`

**Expect:** Both Comms AND Ops respond, in that order. Critically: ops produces an actual bubble, not an `intervention_skipped` event.

**Fail mode:** ops produces no bubble = **block ship** (the multi-mention bypass is the headline Phase-1 fix).

### S4. Slash command smoke

Send `/discuss should we ship the weekly digest`.

**Expect:** Up to 5 ordered bubbles in canonical order. Each ≤3 sentences. Later agents reference earlier takes.

**Fail mode:** "Unknown command: /discuss" appears = **block ship** (client passthrough broken). Single bubble only = **block ship** (slash dispatch broken).

### S5. SQL sanity on persistence

After S4 completes:

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT role, agent_id, source, substr(content, 1, 60) FROM conversation_log WHERE source = 'warroom-text' ORDER BY id DESC LIMIT 8;"
```

**Expect:** Exactly **one** `role='user'` row with `'/discuss should we ship the weekly digest'` verbatim. **Multiple** `role='assistant'` rows with distinct `agent_id` values, all sharing the same `source_turn_id`.

**Fail mode:** zero rows = **block ship** (persistence path broken). Multiple user rows for the same turn = **block ship** (unique index on user role missing/wrong key).

If S1–S5 all pass, you have ~85% confidence the work is shippable. Continue below for the remaining 15%.

---

## Phase 1 — Bug fix verification

### T1. Multi-mention with skipInterveners path (round-2 #6)

**Setup:** the explicit-mention force-speak fix should keep secondary agents alive even if the primary times out.

**Action:** send `@comms @ops thoughts on this?` with a deliberately complex prompt that might stretch primary's budget. (Hard to force timeout manually — proxy: rely on test that the orchestrator code path runs `agentPromptText = trimmed` for explicit interveners regardless of `primaryText`.)

**Code-level verification (since timeout is hard to trigger by hand):**

```bash
grep -n "isExplicit && !primaryText" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts"
grep -n "if (isExplicit) {" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts"
```

**Expect:** the first grep hits a line; the second hits the bypass branch. Reading that block confirms explicit interveners run on `trimmed` even on empty primary.

**Fail mode:** missing logic = **block ship**.

### T2. Mention regex — punctuation-adjacent

Send each in sequence, watching for both agents to respond:

1. `@comms,@ops priority for tomorrow?`
2. `(@ops) chime in here`
3. `@research: anything from the data side?`

**Expect:** test 1 → both Comms and Ops bubbles. Test 2 → Ops bubble. Test 3 → Research bubble.

**Fail mode:** any of the three fails to recognize the mention = **ship-with-followup** (cosmetic for power users, not a hard block).

### T3. Sticky addressee — happy path

1. Send `@research what's the latest from competitive intel?`
2. After Research replies, send `also can you pull pricing data?` (no @mention, short, no breaker words).

**Expect:** the second message routes to Research without the "Routing…" pill flashing. Status bar should show `Starting Research…` directly.

**SQL check:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT speaker, substr(text, 1, 60) FROM warroom_transcript ORDER BY id DESC LIMIT 6;"
```

The most recent agent row should be `speaker = research`.

### T4. Sticky addressee — disqualifying inputs

In the same meeting from T3, try each (one at a time):

1. `thanks` — should produce **no agent reply** (silent ack).
2. `team, what do you all think?` — should run the **router** (breaker word "team" disqualifies sticky).
3. *(wait 11+ minutes, then)* `also one more thing` — should run the **router** (10-min sticky window expired).

**Expect:** each disqualifier behaves as listed. None should incorrectly route to Research.

**Fail mode:** thanks producing a reply = **block ship** (silent-ack regression). Breaker words being ignored = **ship-with-followup**.

### T5. Sticky cursor timing (round-3 #4)

This is the timing-correctness verification. The risk: sticky inference picks up the *current* user row instead of the *previous* one.

**Action:** Send `@research foo`. Wait for reply. Send `also bar`. Then check: did the second message route to Research?

**SQL verification:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT id, speaker, created_at, substr(text, 1, 40) FROM warroom_transcript ORDER BY id DESC LIMIT 6;"
```

**Expect:** Two `user` rows visible. The orchestrator's `inferStickyAddressee` was passed a cursor `(created_at, id)` of the just-inserted row, so when it queries `beforeTs/beforeId`, it sees the *prior* user row (the one with `@research`).

**Fail mode:** sticky never fires (always Routing pill) = **block ship**. Sticky fires on the wrong target = **block ship**.

### T6. Status pill never clips the last bubble

Send a prompt that produces a long reply: `give me a 6-bullet plan for the next two weeks`.

**Action:** as the agent streams, watch the bottom of the transcript carefully across status transitions: `Routing → Starting → Streaming → Checking interveners`.

**Expect:** the last bubble is never visually covered. The status row is permanently 30px (opacity fades). Try again with a small browser window (~600px tall) — same expectation.

**Fail mode:** any clipping = **ship-with-followup** (annoying but not breaking). Bar collapsing to 0px during transitions = **block ship** (regression of the original bug).

### T7. Streaming whitespace strip

Send: `list our agents in markdown bullets`.

**Expect:** the agent's first chunk produces text immediately at the top of the bubble — no blank vertical gap. Asterisks may appear raw during streaming (acceptable v1) but resolve to bold at finalize.

**Fail mode:** persistent leading blank line/gap inside the bubble = **ship-with-followup**.

---

## Phase 2 — Slash commands + finalizedTurns

### T8. /standup happy path

Pre-condition: queue at least one mission per agent (or accept that agents will say "nothing notable in the last 24h").

```bash
# Optional priming — queue one mission per agent for richer standup output
PROJECT_ROOT=$(git rev-parse --show-toplevel)
node "$PROJECT_ROOT/dist/mission-cli.js" create --agent research --title "comp scan" "Pull last week's competitive intel deltas"
node "$PROJECT_ROOT/dist/mission-cli.js" create --agent ops --title "deploy check" "Verify Tuesday's deploy didn't regress dashboard latency"
node "$PROJECT_ROOT/dist/mission-cli.js" create --agent comms --title "skool inbox" "Triage Skool inbox unread"
node "$PROJECT_ROOT/dist/mission-cli.js" create --agent content --title "yt thumbnail" "Draft thumbnail copy for next video"
```

**Action:** in the war room, send `/standup`.

**Expect:** 5 ordered bubbles (research → ops → comms → content → main), each ≤3 sentences, citing real recent activity if any. No "Unknown command" message. No double-firing.

**SQL verification:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT role, agent_id, source_turn_id, substr(content, 1, 50) FROM conversation_log WHERE source = 'warroom-text' AND source_turn_id = (SELECT source_turn_id FROM conversation_log WHERE source = 'warroom-text' ORDER BY id DESC LIMIT 1);"
```

**Expect:** exactly **one** `role='user'` row with `agent_id` set to the first speaker. Five `role='assistant'` rows, one per agent, all sharing the same `source_turn_id`.

**Fail mode:** fewer than 5 assistant rows when 5 agents are present = **block ship** (per-agent unique index missing or budget timing out). Multiple user rows = **block ship**.

### T9. /standup roster cap (round-3 #5)

**Setup:** add a 6th custom agent.

```bash
mkdir -p "$PROJECT_ROOT/agents/qa"
cat > "$PROJECT_ROOT/agents/qa/agent.yaml" <<'EOF'
id: qa
name: QA
description: Test plan author and quality gatekeeper
model: claude-sonnet-4-6
EOF
echo "# QA agent" > "$PROJECT_ROOT/agents/qa/CLAUDE.md"
```

Restart the main agent so the new roster is picked up:

```bash
launchctl kickstart -k "gui/$(id -u)/com.claudeclaw.main"
sleep 2
```

**Action:** open a fresh war-room meeting and send `/standup`.

**Expect:** 5 ordered bubbles for the canonical agents. **One `system_note`** reading something like `"/standup runs the first 5 agents. Skipped: QA."`

**Fail mode:** 6 bubbles (no cap) = **block ship** (would blow budget at scale). No system_note = **ship-with-followup**.

**Cleanup:**

```bash
rm -rf "$PROJECT_ROOT/agents/qa"
launchctl kickstart -k "gui/$(id -u)/com.claudeclaw.main"
```

### T10. /discuss happy path

Send `/discuss should we ship the new digest format this Friday?`

**Expect:** 5 ordered bubbles. Later agents reference earlier takes (e.g. ops responding to research's data point). Each ≤3 sentences.

**Persistence:** same SQL as T8 — one user row, five assistant rows, shared `source_turn_id`.

### T11. /discuss empty topic

Send `/discuss` (or `/discuss   ` with only whitespace).

**Expect:** a `system_note` reading `"Usage: /discuss <topic>"`. No agent runs. `turn_complete` fires.

**SQL verification:** no new rows in `conversation_log` from this turn.

**Fail mode:** any agent running = **ship-with-followup**.

### T12. Slash command rendering — user bubble shows verbatim

After T8 or T10 completes, scroll up in the transcript.

**Expect:** the user's bubble shows `/standup` or `/discuss …` verbatim (not stripped, not normalized). Memory ingestion got the *normalized* form (`Team discussion on: …`), but the conversation_log row and the visible bubble are verbatim — easy to verify in the UI and via SQL.

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT role, content FROM conversation_log WHERE source = 'warroom-text' AND role = 'user' ORDER BY id DESC LIMIT 5;"
```

**Expect:** the verbatim slash command in `content`.

### T13. Idempotent persistence (round-5 #2)

Hard to trigger naturally. Code-level verification:

```bash
grep -n "if (persisted.assistantInserted)" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts"
```

**Expect:** the `void ingestConversationTurn(...)` call is wrapped by an `if (persisted.assistantInserted)` block. Reading that block confirms a no-op insert (retry replay) does NOT trigger duplicate ingestion.

### T14. finalizedTurns guard (round-3 #4 + round-5 #4)

**Hard to trigger by hand** — would require an SDK that ignores abort signals. Code-level verification:

```bash
grep -n "markTurnFinalized\|isTurnFinalized" "$PROJECT_ROOT/src/warroom-text-events.ts" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts" "$PROJECT_ROOT/src/dashboard.ts"
```

**Expect:** dashboard wrapper calls `markTurnFinalized` after emitting `turn_aborted`; channel emit() drops events for finalized turnIds; `runAgentTurn` checks `isTurnFinalized` before transcript write.

**Manual proxy:** send any normal message, then immediately click Stop. Confirm the bubble finalizes as `incomplete` and no late chunks appear after the next message starts.

---

## Phase 3 — Hive mind connectivity

### T15. Memory injection — Telegram → War Room

**Setup:** save a fact in Telegram. Send your bot a message like `"Remember: we decided to delay the Linear integration until Q3 because of the schema risk."` Wait ~5 seconds for memory ingestion.

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT id, agent_id, importance, summary FROM memories WHERE chat_id = (SELECT chat_id FROM sessions LIMIT 1) ORDER BY id DESC LIMIT 3;"
```

**Expect:** at least one new memory row mentioning Linear/Q3/schema.

**Action:** open a war room, send `@main what's the status on the Linear work?`

**Expect:** Main's reply references the delay decision (or at minimum the schema risk reasoning) — proving memory injection in `runAgentTurn` is using `meetingChatId`, not the synthetic SDK key.

**Fail mode:** Main has no idea = **block ship** (the memory bridge is the headline Phase-3 win).

### T16. Memory injection — strict per-agent isolation (round-3 #3)

**Setup:** ensure agent A and agent B both have their own memories in the same chat.

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT agent_id, COUNT(*) FROM memories WHERE chat_id = (SELECT chat_id FROM sessions LIMIT 1) GROUP BY agent_id;"
```

**Expect:** at least two distinct agent_ids with non-zero counts. If not, queue one mission and respond to ensure each agent generates a memory (or use the API directly).

**Code-level check (since cross-agent leakage is invisible from the UI):**

```bash
grep -n "strictAgentId" "$PROJECT_ROOT/src/memory.ts" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts"
```

**Expect:** war-room callers in the orchestrator pass `strictAgentId: agentId`. `searchMemories`, `getRecentHighImportanceMemories`, `getMemoriesWithEmbeddings` all accept the param and filter on `agent_id = ?`.

### T17. Memory bridge — War Room → Telegram

**Setup:** in a war room, run `/discuss should we deprecate the legacy reports endpoint by Q4?`

After it completes, end the meeting (so the war room's transcript is durable but the room is closed).

**Action:** in Telegram (NOT the war room), ask the main agent: `what was decided about deprecating the legacy reports endpoint?`

**Expect:** Main's reply references the war-room discussion. The bridge fires through one of two paths:
1. `conversation_log` rows persisted by `saveWarRoomConversationTurn` surface in standard memory recall.
2. The war-room transcript bridge in `buildMemoryContext` (when explicitly enabled by the caller — Telegram doesn't enable it by default; check below).

**Code-level check:**

```bash
grep -n "warRoomBridge" "$PROJECT_ROOT/src/memory.ts" "$PROJECT_ROOT/src/bot.ts"
```

**Note:** Telegram's `bot.ts` doesn't currently pass `warRoomBridge` — that's a deferred follow-up. Path #1 (conversation_log surfacing through standard recall) is what carries the bridge in v1. If Main can recall via path #1, **passes**. If not, **ship-with-followup** to wire the explicit bridge in `bot.ts`.

### T18. Mission queue line in agent prompts

**Setup:** queue 5 missions for ops (use the mission-cli loop from T8 or one-liner):

```bash
for i in 1 2 3 4 5; do
  node "$PROJECT_ROOT/dist/mission-cli.js" create --agent ops --title "test queue depth $i" "Mock mission $i"
done
```

**Action:** in a war room, send a question that would route to ops via router (no @mention): `can someone look at the deploy pipeline?`

**Expect:** ops's reply may mention queue depth ("I've got 5 in the queue, want me to triage first?"). Even if not explicit, the agent should be aware.

**Code-level check:**

```bash
grep -n "Your queue:" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts"
```

**Expect:** `[Your queue: N pending, oldest ~Xh old]` injected into `framedText` when `meetingChatId` is set.

**Cleanup:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "DELETE FROM mission_tasks WHERE title LIKE 'test queue depth%';"
```

### T19. War-room context block excludes consolidations + team activity (round-4 #5)

Code-level check:

```bash
grep -A 4 "buildMemoryContext(meetingChatId" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts"
```

**Expect:** the call passes `{ strictAgentId: agentId, includeConsolidations: false, includeTeamActivity: false }`.

Quick confirmation that the OPTIONS work — Telegram's `bot.ts` shouldn't have any of those overrides:

```bash
grep -n "buildMemoryContext" "$PROJECT_ROOT/src/bot.ts" "$PROJECT_ROOT/src/orchestrator.ts" 2>/dev/null
```

**Expect:** Telegram callers omit the opts → defaults preserve original behavior (consolidations + team activity included).

### T20. meetingChatId vs sessionChatId — the synthetic key never leaks (round-4 #4)

This is the runtime assert. Code-level check:

```bash
grep -n "warroom-text:" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts" | head -10
```

**Expect:** `warroom-text:` appears in two contexts only:
1. `sessionChatId = `warroom-text:${meetingId}`` — the SDK key.
2. `setActiveAbort(`${sessionChatId}:${agentId}` …)` and `abortByPrefix(`warroom-text:…`)` — using the renamed local.

**Look for the assert:**

```bash
grep -n "must be the real Telegram chat id" "$PROJECT_ROOT/src/warroom-text-orchestrator.ts"
```

**Expect:** found. Throws if `meetingChatId.startsWith('warroom-text:')`.

---

## Chat-id scoping and endpoint guards

### T21. Strict chat-id validation — basic happy path

Open a war-room meeting normally from the dashboard. Send any message.

**Expect:** works. The page URL should have `chatId=…`. Open browser dev tools → Network. Inspect any war-room API call. Confirm the URL contains `chatId=…`.

### T22. Strict chat-id mismatch — 403

**Setup:** find a meetingId from chat A:

```bash
ALLOWED_CHAT_ID=$(grep -E "^ALLOWED_CHAT_ID=" "$PROJECT_ROOT/.env" | cut -d= -f2 | tr -d '"')
MEETING_A=$(sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT id FROM warroom_meetings WHERE chat_id = '$ALLOWED_CHAT_ID' AND meeting_type='text' ORDER BY started_at DESC LIMIT 1;")
echo "Meeting A: $MEETING_A in chat $ALLOWED_CHAT_ID"
DASHBOARD_TOKEN=$(grep -E "^DASHBOARD_TOKEN=" "$PROJECT_ROOT/.env" | cut -d= -f2 | tr -d '"')
DASHBOARD_PORT=$(grep -E "^DASHBOARD_PORT=" "$PROJECT_ROOT/.env" | cut -d= -f2 | tr -d '"')
DASHBOARD_PORT=${DASHBOARD_PORT:-3001}
```

**Action:** call the history endpoint with a *fake* chatId:

```bash
curl -s "http://localhost:$DASHBOARD_PORT/api/warroom/text/history?token=$DASHBOARD_TOKEN&meetingId=$MEETING_A&chatId=fake_chat_other_user&limit=5" | head -50
```

**Expect:** HTTP response body is `{"error":"chat_mismatch"}` (status 403).

**Re-verify with the correct chatId:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$DASHBOARD_PORT/api/warroom/text/history?token=$DASHBOARD_TOKEN&meetingId=$MEETING_A&chatId=$ALLOWED_CHAT_ID&limit=5"
```

**Expect:** `200`.

**Fail mode:** mismatched chatId returns 200 = **block ship** (cross-chat-access hole still open). Correct chatId returns anything other than 200 = **block ship**.

### T23. Page renderer redirects on chat mismatch

Open the war-room URL with a fake chatId in your browser:

```
http://localhost:3001/warroom/text?token=YOUR_TOKEN&meetingId=YOUR_MEETING_A&chatId=wrong_chat_id
```

**Expect:** redirect to `/warroom?token=…&chatId=wrong_chat_id` (the picker), not the meeting page.

**Fail mode:** meeting page renders = **block ship**.

### T24. Picker chat-scoping (round-3 #6)

Open the picker (`/warroom`). It should fire `/api/warroom/text/list?...&chatId=…`.

**Expect:** the recent-meetings list shows only meetings for the current `chatId`.

**Verification with a second chat:**

```bash
# Insert a meeting under a different chat_id
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "INSERT INTO warroom_meetings (id, started_at, mode, meeting_type, chat_id) VALUES ('wr_other_test_$$', strftime('%s','now'), 'direct', 'text', 'completely_different_chat');"
```

Refresh the picker. The new "other_test" meeting should NOT appear.

**Cleanup:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "DELETE FROM warroom_meetings WHERE id LIKE 'wr_other_test_%';"
```

### T25. /api/warroom/text/new only ends meetings in the same chat

**Setup:** create a meeting in chat A (your real chat), keep it open. Then insert a meeting in a different chat:

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "INSERT INTO warroom_meetings (id, started_at, mode, meeting_type, chat_id) VALUES ('wr_other_open_$$', strftime('%s','now'), 'direct', 'text', 'completely_different_chat');"
OTHER_ID=$(sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT id FROM warroom_meetings WHERE chat_id = 'completely_different_chat' AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1;")
echo "Other meeting: $OTHER_ID"
```

**Action:** in the dashboard, click "Start text room" again (creates a fresh meeting in your chat).

**Verify the other-chat meeting is still open:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT id, ended_at FROM warroom_meetings WHERE id = '$OTHER_ID';"
```

**Expect:** `ended_at` is NULL.

**Fail mode:** `ended_at` populated = **block ship** (cross-chat clobber regression).

**Cleanup:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "DELETE FROM warroom_meetings WHERE id = '$OTHER_ID';"
```

---

## Concurrency and edge cases

### T26. Two tabs in the same meeting — slash queue

Open the same war-room meeting in two browser tabs. In tab 1, send `/standup`. Within a few seconds, in tab 2, send `/standup` again.

**Expect:** the second `/standup` queues behind the first (per-meeting FIFO via `messageQueue`). No interleaved chunks. Both complete cleanly. Two distinct user rows in conversation_log with distinct `source_turn_id`.

**SQL check:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT source_turn_id, COUNT(*) FROM conversation_log WHERE source='warroom-text' AND role='user' AND created_at > strftime('%s','now') - 600 GROUP BY source_turn_id;"
```

**Expect:** two distinct turn_ids, each with count = 1.

### T27. Cancel mid-slash

Send `/discuss what should we ship next quarter?`. While the third agent is streaming, click Stop.

**Expect:** in-flight bubble finalizes as `incomplete=true`. No further bubbles produced (loop breaks on `cancelFlag.cancelled`). Status shows `Turn stopped.`

### T28. Sticky doesn't cross meeting boundaries

In meeting M1, send `@research foo`. Wait for reply. End M1. Open a fresh meeting M2.

**Action:** in M2, send `also bar`.

**Expect:** routes via the router (not sticky to research). The sticky lookup is scoped by `meetingId`, so a new meeting starts fresh.

### T29. Streaming whitespace — multi-chunk

Send a prompt that almost certainly produces a leading newline: `format your reply as a markdown table with 3 columns and 3 rows`.

**Expect:** still no leading vertical gap inside the bubble. The first non-whitespace character flips `dataset.seenNonWS` and subsequent chunks append normally.

---

## Schema migration safety

### T30. Migration is idempotent

Restart the main agent twice in a row (each restart re-runs migrations).

```bash
launchctl kickstart -k "gui/$(id -u)/com.claudeclaw.main"
sleep 3
launchctl kickstart -k "gui/$(id -u)/com.claudeclaw.main"
sleep 3
launchctl print "gui/$(id -u)/com.claudeclaw.main" | grep -E 'state|last exit code'
```

**Expect:** running, exit code 0. The `addColumnIfMissing` and `CREATE INDEX IF NOT EXISTS` mean re-running is safe.

**SQL spot-check:**

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "PRAGMA index_list(conversation_log);" | head
```

**Expect:** both `idx_convlog_warroom_user` and `idx_convlog_warroom_assistant` listed exactly once.

### T31. Pre-migration meetings stay openable (legacy chat_id='')

Find a meeting that pre-dates the migration:

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT id, chat_id FROM warroom_meetings WHERE meeting_type='text' AND chat_id = '' LIMIT 3;"
```

If any exist, navigate to one with the archive flag (since they're likely ended):

```
http://localhost:3001/warroom/text?token=YOUR_TOKEN&meetingId=LEGACY_ID&archive=1
```

**Expect:** opens fine (legacy `chat_id=''` bypasses strict-validate guard).

### T32. New meetings always have a populated chat_id

Open a fresh meeting from the dashboard. Then:

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "SELECT id, chat_id FROM warroom_meetings WHERE meeting_type='text' ORDER BY started_at DESC LIMIT 3;"
```

**Expect:** the most recent row has a non-empty `chat_id` matching your `ALLOWED_CHAT_ID`.

---

## Adversarial / what-if

### T33. Stale meetingId from another tab

You navigate to a war room. In a separate tab, you create a *new* meeting (which auto-ends the old one for the same chat). Go back to the first tab and try to send a message.

**Expect:** the original meeting is now `ended`. Sends should be rejected with `meeting_ended` (HTTP 410). UI banner: error visible.

### T34. /discuss with very long topic

Send `/discuss <very long topic, ~500 chars>` (paste a long sentence).

**Expect:** all 5 agents reply normally. Topic is preserved verbatim in conversation_log. No truncation visible in their responses (they may cite or paraphrase; up to them).

### T35. Mention 4+ agents

Send `@research @ops @comms @content priority list?`

**Expect:** Research (primary) + Comms + Ops respond (the cap is 3 — primary + 2 interveners). A `system_note` reads `"3 of 4 mentioned agents will respond. Skipped: @content."`

### T36. Hostile agent_id in the regex

Send `email me at hello@research.example.com please`.

**Expect:** does NOT match as a Research mention. The regex requires `@` to be preceded by start, whitespace, or specific punctuation — not a word character.

**Fail mode:** Research is summoned by an email address = **ship-with-followup**.

---

## Cleanup

### CL1. Restore the pre-test DB if anything went sideways

```bash
LATEST_BACKUP=$(ls -1t "$PROJECT_ROOT"/store/claudeclaw.db.pretest-* | head -1)
echo "Will restore: $LATEST_BACKUP"
# Stop main agent first so it doesn't write while we copy
launchctl kill TERM "gui/$(id -u)/com.claudeclaw.main"
sleep 2
cp "$LATEST_BACKUP" "$PROJECT_ROOT/store/claudeclaw.db"
launchctl kickstart -k "gui/$(id -u)/com.claudeclaw.main"
```

### CL2. Or just clear test artifacts

```bash
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "DELETE FROM mission_tasks WHERE title LIKE 'test%' OR title LIKE 'comp scan' OR title LIKE 'deploy check' OR title LIKE 'skool inbox' OR title LIKE 'yt thumbnail';"
sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" "DELETE FROM warroom_meetings WHERE id LIKE 'wr_other_%';"
```

---

## Pass / fail summary template

Copy this when running the plan:

```
P0  □  P1  □  P2  □  P3  □
S1  □  S2  □  S3  □  S4  □  S5  □
T1  □  T2  □  T3  □  T4  □  T5  □  T6  □  T7  □
T8  □  T9  □  T10 □  T11 □  T12 □  T13 □  T14 □
T15 □  T16 □  T17 □  T18 □  T19 □  T20 □
T21 □  T22 □  T23 □  T24 □  T25 □
T26 □  T27 □  T28 □  T29 □
T30 □  T31 □  T32 □
T33 □  T34 □  T35 □  T36 □

Block-ship failures:
  -

Ship-with-followup notes:
  -

Decision: SHIP / HOLD
```

---

## Ship gates (the only ones that block)

If any of these fail, do **not** merge:

- **S5** — persistence to conversation_log writes the right rows.
- **T1** — multi-mention force-speak code path exists.
- **T5** — sticky cursor doesn't pick up the just-inserted row.
- **T8** — /standup produces N assistant rows (one per agent), one user row.
- **T15** — Telegram → war-room memory bridge actually works.
- **T22** — strict chat-id validation rejects mismatched requests.
- **T23** — page renderer redirects on chat mismatch.
- **T25** — `/new` doesn't auto-end other chats' meetings.
- **T30** — migration is idempotent.

Everything else is ship-with-followup. Real users won't notice T2 / T6 / T7 / T36 in the first 24h, and they're cheap to patch in a follow-up.
