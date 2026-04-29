# Voice war room smoke results

Run date: 2026-04-29 14:46 EDT
Build: post-Phase-1 (agent_error + hand_down fixes) + Phase 0 (kill switches at voice bridge)

## Static verification (automated, PASS)

Code paths confirmed in `warroom/server.py`:

| Symptom from prior testing | Code fix | Location |
|---|---|---|
| Hand-up animation stuck after `answer_as_agent` failure/timeout | `_push_event({"event": "hand_down", ...})` on every failure path | `warroom/server.py:427`, `:448`, `:460`, `:472` |
| Vague Gemini stutter on OAuth expiry / bridge crash, no user-visible reason | `_push_event({"event": "agent_error", ...})` with classified message | `warroom/server.py:434`, `:449`, `:461` |
| Bridge SDK call running while LLM_SPAWN_ENABLED is off | `requireEnabled('LLM_SPAWN_ENABLED')` at top of `agent-voice-bridge.ts:main()` | `src/agent-voice-bridge.ts:84` |

Browser-side handlers confirmed in `src/warroom-html.ts:1122`:
- `hand_down` clears the agent's `.hand-up` class on its card
- `agent_error` appends a system entry: `<agent> failed: <error message>`

Voice subprocess confirmed alive (`pgrep -f warroom/server.py` → 2 PIDs).

## Manual sub-tests (require real Pipecat session — TODO Mark)

These cannot be fully automated because they require:
- Microphone access (browser `getUserMedia`)
- Audio I/O verification (you can't tell if Gemini is actually speaking from a tool call)
- Multi-second wall-clock observation

### D-1: Happy path
1. Open `/warroom?mode=voice` (with token + chatId)
2. Click "Start Meeting", grant mic
3. Say "what time is it" — Gemini should respond verbally
4. Click an agent card to switch — agent's voice changes after ~6s respawn
5. Click "End Meeting"
6. Verify `pgrep -f warroom/server.py` shows the subprocess is still alive (Pipecat keeps it warm) but no Daily room is connected; `ps -ef | grep agent-voice-bridge` is empty

**Expected**: smooth speech, no stuck hand-up, no orphan subprocesses.

### D-2: OAuth failure path (the fix we shipped)
1. Stop the war room: `pgrep -f warroom/server.py | xargs kill`
2. Edit `.env`: temporarily set `CLAUDE_CODE_OAUTH_TOKEN=BROKEN_VALUE_FOR_TEST` (save the real value first)
3. Wait for main to respawn the subprocess
4. Open voice meeting, switch to **auto/hand-raise mode**
5. Ask any question that requires `answer_as_agent` (e.g. "@research what's trending in agents?")
6. Watch for: hand-up appears briefly, then drops; transcript shows "Research failed: auth failed (token expired?). Run `claude login` and restart the war room."
7. Restore the real token in `.env`, restart subprocess

**Expected**: visible system note in transcript, hand-up clears within 30s.
**Anti-symptom (would be a fail)**: silent stuck hand-up animation, vague Gemini "I had trouble reaching that".

### D-3: Timeout path
Hard to force without code changes. Cheapest reproduction:
1. Edit `warroom/server.py:196` (`ANSWER_TIMEOUT_SEC = 25`) → `ANSWER_TIMEOUT_SEC = 2`
2. Restart subprocess
3. Open auto-mode meeting, ask a real question
4. Within ~3s, the subprocess timeout fires; verify hand_down + agent_error events arrive in transcript
5. Restore the original value

**Expected**: same as D-2 but error reads "voice bridge failed" instead of auth-specific.

### D-4: Pin race (already-fixed in earlier work, sanity check)
1. Open voice meeting
2. Click 3 different agent cards in <500ms
3. Last-clicked agent should be the one that respawns; no zombie respawns; no stuck "Switching to X…" status banner

**Expected**: clean switch, last click wins.

### D-5: Kill switch end-to-end
1. Set `WARROOM_VOICE_ENABLED=false` in `.env`
2. Wait ~2s for hot reload
3. Click "Start Meeting" → 503 with "voice war room disabled"
4. Set `LLM_SPAWN_ENABLED=false`, restart subprocess
5. Already-running meeting: ask a question in auto-mode → bridge subprocess refuses with KillSwitchDisabledError; agent_error frame should still fire
6. Restore both

**Expected**: route refused at start; bridge refused inside the running meeting.

## Verdict

Static verification: **PASS** for all four shipped fixes.
Manual sub-tests: **DEFERRED to Mark** — runnable in <15 min when he picks this up. None are blocking the static rollout.
