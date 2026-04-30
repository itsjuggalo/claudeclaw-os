# ClaudeClaw Ecosystem TLDR

A complete map of how the multi-agent system fits together. Reference document for the upcoming frontend rewrite. File:line citations throughout.

---

## 1. Process Architecture

ClaudeClaw is **N OS processes** sharing one SQLite database. There is no message bus, no HTTP between agents, no shared memory. SQLite WAL mode plus a 5s busy timeout is the entire IPC story.

```
┌──────────────────────────────────────────────────────────────┐
│ main process (node dist/index.js --agent main)               │
│   ├─ Telegram bot polling (own bot token)                    │
│   ├─ Dashboard HTTP server (Hono, port 3141)                 │
│   ├─ Scheduler (60s tick, polls scheduled+mission tasks)     │
│   ├─ Memory consolidation loop (every 30 min)                │
│   ├─ Decay sweep (startup + every 24h)                       │
│   ├─ War Room Python subprocess (spawn + respawn)            │
│   └─ Orchestrator agent registry (in-memory cache)           │
├──────────────────────────────────────────────────────────────┤
│ research / comms / content / ops / <user-created>            │
│   ├─ Telegram bot polling (own bot token per agent)          │
│   ├─ Scheduler (60s tick, polls only its own mission tasks)  │
│   └─ NO dashboard, NO decay sweep, NO war room owner         │
├──────────────────────────────────────────────────────────────┤
│ Pipecat Python subprocess (warroom/server.py)                │
│   ├─ Voice War Room only                                     │
│   ├─ WebSocket server on WARROOM_PORT                        │
│   ├─ Reads /tmp/warroom-agents.json once at import           │
│   ├─ Reads /tmp/warroom-pin.json per voice utterance         │
│   └─ Owned by main process; auto-respawn up to 3 crashes     │
└──────────────────────────────────────────────────────────────┘

All processes share: store/claudeclaw.db (SQLite, WAL)
All Node processes share: .env (kill-switches re-read every 1.5s)
```

PID files at `store/claudeclaw.pid` (main) and `store/agent-<id>.pid` (others). Process aliveness is checked by reading PID + `kill(pid, 0)`.

**Key rule:** Only `main` runs the dashboard. Only `main` owns the Pipecat subprocess. Decay sweep, mission task cleanup, and SSE all run on main exclusively.

---

## 2. Agent Lifecycle (6 States)

```
NONEXISTENT → CONFIG-ONLY → ACTIVATED-NOT-STARTED → RUNNING ⇄ STOPPED → FULLY-DELETED
```

| State | What's on disk | What's running | Visible in Mission Control? | Mission tasks for it execute? |
|---|---|---|---|---|
| NONEXISTENT | nothing | nothing | no | N/A |
| CONFIG-ONLY | yaml + .env + plist template | nothing | yes, dead dot | **NO, sit queued forever** |
| ACTIVATED-NOT-STARTED | + LaunchAgents plist | nothing yet | yes, dead dot | **NO** |
| RUNNING | all + PID file | own bot polling, own scheduler | yes, live dot | **YES, claimed in 60s** |
| STOPPED | all minus LaunchAgents plist | nothing | yes, dead dot | **NO, sit queued forever** |
| FULLY-DELETED | nothing | nothing | no | N/A (DB rows orphan) |

### Transitions

| Transition | Trigger | File:line |
|---|---|---|
| NONEXISTENT → CONFIG-ONLY | `POST /api/agents/create` → `createAgent()` | `agent-create.ts:164` |
| CONFIG-ONLY → ACTIVATED-NOT-STARTED | `POST /api/agents/:id/activate` → `activateLaunchd()` | `agent-create.ts:465` |
| ACTIVATED-NOT-STARTED → RUNNING | Process startup, `acquireLock()` writes PID | `index.ts:99` |
| RUNNING → RUNNING | `POST /api/agents/:id/restart` → `launchctl kickstart -k` | `agent-create.ts:699` |
| RUNNING → STOPPED | `POST /api/agents/:id/deactivate` | `agent-create.ts:574` |
| STOPPED → RUNNING | `POST /api/agents/:id/activate` again | `agent-create.ts:465` |
| any → FULLY-DELETED | `DELETE /api/agents/:id/full` → `deleteAgent()` | `agent-create.ts:616` |
| RUNNING → ACTIVATED-NOT-STARTED | crash, launchd `KeepAlive: true` respawns after 30s | OS / launchd |

### Sharp edges in the lifecycle

1. **Mission tasks routed to non-RUNNING agents pile up forever.** No expiry, no warning. The dashboard shows the agent listed; the user has no signal that nothing will ever claim those rows.
2. **`deactivateAgent` swallows `launchctl unload` errors** (`agent-create.ts:583`) and always returns `{ ok: true }`. The process may still be running.
3. **Plist generation failure inside `createAgent` orphans the agent.** Wizard step 3 calls activate which fails with "Plist not found"; nothing in the UI re-runs `createAgent` to regenerate.
4. **5-second PID poll in `activateLaunchd`** returns `{ ok: true, pid: undefined }` even when the process never started. Crash is invisible until next health check.

---

## 3. Agent Metadata Storage Map

Every place an agent's identity, config, or runtime state can live.

| Storage | Path / Table | Schema | Read cadence | Stale-cache risk |
|---|---|---|---|---|
| agent.yaml | `agents/<id>/agent.yaml` or `~/.claudeclaw/agents/<id>/agent.yaml` | name, description, telegram_bot_token_env, model, mcp_servers, warroom_tools | live every call | none |
| CLAUDE.md | same dir | system prompt markdown | once at process startup (sub-agents); live per delegation (main) | running process holds frozen copy |
| .env bot token | `PROJECT_ROOT/.env` key `<ID>_BOT_TOKEN` | string | live in `loadAgentConfig`; 1.5s TTL in kill-switches | none |
| plist template | `launchd/com.claudeclaw.<id>.plist` | XML with `__PROJECT_DIR__` `__HOME__` `__LOG_DIR__` placeholders | snapshot at activate time | none |
| resolved plist | `~/Library/LaunchAgents/com.claudeclaw.<id>.plist` | XML | read by launchd OS daemon | none |
| log file | `~/Library/Logs/claudeclaw/<id>.log` | append-only text | external (Console.app, tail) | none |
| PID file | `store/agent-<id>.pid` | integer | live every call | stale on crash, OK |
| voice roster | `/tmp/warroom-agents.json` | `[{id, name, description}]` | snapshot at Pipecat import | bounce required to refresh |
| voice pin | `/tmp/warroom-pin.json` | `{agent, mode, pinnedAt}` | mtime-cached per utterance | live mode reads once at session start |
| in-memory config.ts | per agent process | AGENT_ID, agentDefaultModel, agentSystemPrompt, agentMcpAllowlist | once at startup, never refreshed | model changes invisible until restart |
| orchestrator agentRegistry | per main process | `{id, name, description}[]` | refreshed on createAgent / deleteAgent (after recent fix) | acceptable, on-miss refresh fallback in delegateToAgent |
| router.py AGENT_NAMES | per Pipecat process | mutable set | mtime-cached from roster JSON (after recent fix) | acceptable |
| kill-switches `_cache` | per process | 6 boolean flags | TTL 1500ms | not agent metadata, just env flags |

### SQLite tables that reference agent_id

| Table | agent_id role | Pruning |
|---|---|---|
| `sessions` | composite PK `(chat_id, agent_id)` | none |
| `conversation_log` | per-turn ownership | 500 rows per (chat, agent) via decay sweep |
| `token_usage` | per-turn cost attribution | none, grows forever |
| `memories` | per-agent memory isolation | salience decay, deleted < 0.05 |
| `scheduled_tasks` | which agent owns which cron | none |
| `mission_tasks` | `assigned_agent` (nullable) | 7 days after completion |
| `hive_mind` | per-agent action log | none |
| `audit_log` | who triggered what | none |
| `inter_agent_tasks` | from_agent / to_agent | none |
| `warroom_meetings` | pinned_agent | 90 days |
| `meet_sessions` | which agent is in which video meeting | none |

---

## 4. Synchronization Surfaces (Where Agent Existence Shows Up)

A single `createAgent()` call propagates to all of these. The cadence column tells you how fast each surface picks it up.

| Surface | Source of truth | Cadence | Refresh trigger |
|---|---|---|---|
| Dashboard `/api/agents` | `listAgentIds()` scans agent dirs | live every HTTP request | none needed |
| Dashboard agent dropdowns | client fetches `/api/agents` | per dashboard load | client poll (60s) |
| Chat panel agent tabs | `/api/agents` | live | 60s poll |
| Text War Room `getRoster()` | `listAllAgents()` | live every turn | none needed |
| Voice War Room `VALID_AGENTS` | `/tmp/warroom-agents.json` snapshot | once at Pipecat import | `bounceVoiceWarRoom()` SIGKILL + respawn |
| Voice prefix routing `AGENT_NAMES` | mtime-cached roster JSON | refreshes when JSON mtime changes | automatic |
| Voice pin validation | mtime-cached roster JSON | per utterance check | automatic |
| Telegram bot polling | each agent's own process | continuous | process must be RUNNING |
| Scheduler `claimNextMissionTask` | SQLite atomic transaction | 60s tick per agent | nothing, agent must be RUNNING |
| Orchestrator `@delegate:` syntax | in-memory registry | refreshed on create/delete | automatic |
| Gemini auto-assign classifier | live `loadAgentConfig` per click | per click | none needed |

### What `createAgent` does, in order

```
createAgent(opts)                                   [agent-create.ts:164]
├─ validateAgentId + 20-agent cap                   [line 175]
├─ validateBotToken via api.telegram.org/getMe      [line 187]
├─ check token uniqueness across existing agents    [line 195]
├─ fs.mkdirSync(agentDir)                           [line 201]
├─ copy CLAUDE.md from template                     [line 218]
├─ write agent.yaml                                 [line 231]
├─ atomicEnvWrite to .env                           [line 239]
├─ generateLaunchdPlist (template only)             [line 246]
├─ refreshWarRoomRoster() → /tmp/warroom-agents.json [line 255]
├─ refreshAgentRegistry() (orchestrator cache)      [line 256]
└─ bounceVoiceWarRoom() → SIGKILL Pipecat           [line 257]
```

### What's NOT done by `createAgent`

- The agent's process is NOT spawned. User must click "Activate" in step 3 of the wizard, which calls `activateAgent()`.
- Existing mission tasks are NOT reassigned to the new agent.
- Existing conversation history is NOT migrated.
- The Telegram bot itself is NOT created. The user creates it via @BotFather externally and pastes the token into step 2.

---

## 5. The Wizard Flow (Create Agent)

3-step modal driven by `caw*` JS functions in `dashboard-html.ts`.

### Step 1: Basics
- Agent ID (auto-lowercased, validated against `^[a-z][a-z0-9_-]{0,29}$`)
- Display name (auto-suggested from ID unless manually edited)
- Description
- Model (hardcoded select: opus-4-6, sonnet-4-6, sonnet-4-5, haiku-4-5)
- Template (populated from `GET /api/agents/templates` which scans `agents/*/agent.yaml(.example)`)
- Validation: `GET /api/agents/validate-id?id=<id>` debounced 400ms

### Step 2: BotFather token
External prerequisites the user must do themselves:
1. Open @BotFather in Telegram
2. Send `/newbot`
3. Type the suggested display name (provided as copy-to-clipboard)
4. Type the suggested username (provided as copy-to-clipboard, format `claudeclaw_<id>_bot`)
5. Copy the token BotFather returns

ClaudeClaw never calls Telegram's bot-creation API. It only validates a pasted token via `POST /api/agents/validate-token` which calls `getMe`.

### Step 3: Activate
`POST /api/agents/create` runs the createAgent flow above. UI advances to step 3 with summary. Single button: "Activate". `POST /api/agents/:id/activate` substitutes plist placeholders, copies to `~/Library/LaunchAgents/`, runs `launchctl load`, polls PID file 5x.

If the user closes the tab between create and activate: agent is in CONFIG-ONLY state on disk, will appear in Mission Control with a dead dot, can be activated later by clicking Start in the agent detail modal.

---

## 6. Model Change Semantics

`PATCH /api/agents/:id/model` behavior depends on whether the target is `main`:

| Target | What happens | Restart needed? |
|---|---|---|
| `main` | `setMainModelOverride()` writes to in-memory `chatModelOverride` map in bot.ts | No, takes effect on next message |
| any sub-agent | `setAgentModel()` writes new value to agent.yaml on disk | **Yes** (process froze `agentDefaultModel` at startup) |

After the recent fix, the API now returns `restartRequired: true` for non-main agents so the UI can prompt deliberately. We don't auto-restart because that would kill in-flight mission tasks.

`PATCH /api/agents/model` (bulk) returns `restartRequired: string[]` listing every non-main agent that was updated.

---

## 7. War Room (Text vs Voice)

Two completely separate orchestration paths that share only the meeting metadata table (`warroom_meetings`).

### Text War Room
- Pure Node, runs inside the dashboard process
- SSE channel per meeting at `/api/warroom/text/stream` with monotonic seq + ring buffer (500 events) + sinceSeq replay + replay_gap signal
- 20+ named SSE event types: `meeting_state`, `turn_start`, `status_update`, `router_decision`, `agent_selected`, `agent_typing`, `agent_chunk`, `agent_done`, `tool_call`, `tool_result`, `turn_complete`, `turn_aborted`, `system_note`, `divider`, `meeting_state_update`, `meeting_ended`, `replay_gap`, `error`, `intervention_skipped`, `ping`
- Roster read live per turn from `listAllAgents()`
- Per-meeting FIFO turn queue via `messageQueue.enqueue('warroom-text:<meetingId>', ...)`
- 300-second watchdog per turn

### Voice War Room
- Pipecat Python subprocess (`warroom/server.py`) owned by main
- WebSocket server on `WARROOM_PORT`; dashboard exposes `/ws/warroom` as a transparent proxy
- Browser connects via the dashboard token (no separate auth)
- `VALID_AGENTS` snapshot at import time (frozen until subprocess respawn)
- `AGENT_NAMES` mtime-cached from roster JSON (after recent fix)
- Pin file at `/tmp/warroom-pin.json` controls default route target
- Direct mode (always pin) vs Auto mode (router decides per utterance)
- Voice respawn triggers: `bounceVoiceWarRoom` (create/delete agent), `/api/warroom/pin`, `/api/warroom/voices/apply`
- 3-strikes-and-out crash limit per session

### Voice respawn behavior

| Event | Server | Browser |
|---|---|---|
| Intentional bounce (SIGKILL) | dies, respawns in 300ms | sees disconnect, auto-reconnects once at 2s |
| Crash (3 in a row) | respawner disabled, Telegram alert sent | TCP refused on next start-meeting |
| `/api/warroom/start` | probes TCP, respawns if pin file modified < 30s ago | only attempts WS upgrade after 200 OK |

---

## 8. Mission Task Lifecycle

```
mission-cli create / dashboard POST → mission_tasks row (status=queued)
        ↓ (up to 60s)
target agent's scheduler tick → claimNextMissionTask(<id>)
        ↓ atomic SELECT+UPDATE in SQLite transaction
status=running, started_at=now
        ↓
runAgent(prompt, ...) inside messageQueue.enqueue
        ↓
result delivered: completeMissionTask(id, text|null, status, error?)
        ↓
Telegram notification + conversation_log injection
```

### State machine

```
queued → running → {completed | failed | cancelled}
   ↑                       ↓
   └── cancelled (cancelMissionTask flips status, the running poll picks it up)
```

### Cancel semantics (after recent fix)
- Dashboard writes `cancelled` to DB
- Scheduler's 5-second polling loop notices and aborts the live AbortController
- `runAgent` returns `aborted: true`
- Status stays `cancelled` (not overwritten to `failed`)

### Reliability
- 10-minute hard timeout per mission task via `AbortController`
- `resetStuckMissionTasks(agentId)` on process startup flips orphaned `running` rows back to `queued`
- 7-day cleanup runs in main process at startup + every 24h
- **No retry on failure**: failed tasks stay failed permanently
- **No notification to creating agent**: originator must poll `mission-cli result <id>` or watch the dashboard

### Auto-assign
- Per-task: `POST /api/mission/tasks/:id/auto-assign` calls Gemini once, assigns
- Bulk: `POST /api/mission/tasks/auto-assign-all` parallelizes Gemini calls (concurrency=5) after the recent fix; previously sequential

---

## 9. Backend HTTP Contract Snapshot

~70 endpoints. Every request requires `?token=DASHBOARD_TOKEN` (no header path). CSRF middleware rejects cross-origin POSTs unless Origin is localhost or matches `DASHBOARD_URL`. Mutation kill switch (`DASHBOARD_MUTATIONS_ENABLED`) re-reads `.env` every 1.5s; flip to `false` to lock the dashboard read-only.

### Route families

| Family | Examples |
|---|---|
| Health/info | `GET /api/health`, `GET /api/info` |
| Chat | `GET /api/chat/history`, `POST /api/chat/send`, `POST /api/chat/abort`, `GET /api/chat/stream` (SSE) |
| Scheduled tasks | `GET /api/tasks`, `DELETE`, `POST /pause`, `POST /resume` |
| Mission tasks | `GET /api/mission/tasks`, `POST`, `PATCH`, `DELETE`, `/cancel`, `/auto-assign`, `/auto-assign-all`, `GET /api/mission/history` |
| Agents | `GET /api/agents`, `:id/{conversation,tasks,tokens,status}`, `PATCH /model`, `:id/{activate,deactivate,restart}`, `DELETE :id/full` |
| Wizard | `GET /api/agents/templates`, `GET /validate-id`, `POST /validate-token`, `POST /create` |
| Memory | `GET /api/memories`, `/pinned`, `/list` |
| Tokens | `GET /api/tokens` |
| Hive mind | `GET /api/hive-mind` |
| Audit | `GET /api/audit`, `/blocked` |
| Security | `GET /api/security/status` |
| Voice war room | `POST /start`, `GET /agents`, `GET /pin`, `POST /pin`, `POST /unpin`, `GET /voices`, `POST /voices`, `POST /voices/apply`, `GET /meetings`, `GET /meeting/:id/transcript` |
| Text war room | `GET /text/list`, `POST /text/new`, `POST /text/warmup`, `GET /text/history`, `GET /text/stream` (SSE), `POST /text/{send,abort,pin,unpin,clear,end}` |
| Live meetings | `GET /api/meet/sessions`, `POST /join`, `POST /join-daily`, `POST /leave` |
| WebSocket | `GET /ws/warroom` (transparent proxy to Pipecat) |
| Static | `GET /favicon.ico`, `/warroom-music`, `/warroom-client.js`, `/warroom-avatar/:id`, `/warroom-test-audio` |
| Upload | `POST /warroom-music-upload` |

### SSE channels

**`/api/chat/stream`**: emits named events `user_message`, `assistant_message`, `processing`, `progress`, `error`, `hive_mind`, `ping`. No replay, no seq. `ChatEvent.timestamp` is milliseconds (everything else in the system uses unix seconds).

**`/api/warroom/text/stream`**: every frame is generic `message` event with `JSON.stringify({seq, event})` payload. Initial `meeting_state` always seq=0. Pass `?sinceSeq=<latestSeq from /history>` to resume. 500-event ring buffer per meeting; idle TTL 1 hour; sweeper every 10 min.

### Contract landmines (the new frontend MUST honor)

1. `AuditLogEntry.blocked` is integer 0/1, not boolean
2. `Memory.entities/topics/connections/embedding` are JSON-encoded strings, must `JSON.parse`
3. `/text/history` reverses to ASC server-side; `/voice/transcript` returns DESC
4. `/text/send` reads `chatId` from body OR query param (camelCase, not snake_case)
5. `PATCH /api/agents/model` (bulk) MUST register before `/:id/model` (Hono first-match). Already registered correctly.
6. `POST /text/new` returns `autoEnded: string[]`, can be empty array, never null
7. `POST /voices` always returns `applied: false`. Must call `/voices/apply` separately.
8. Use `latestSeq` from `/text/history` response for SSE resume, not the seq=0 in `meeting_state` event
9. Text meeting IDs match `/^wr_[a-z0-9_]{4,64}$/i`; voice meetings use UUID v4
10. `clientMsgId` for `/text/send` must be lowercase v4 UUID, regex-validated server-side
11. Roster in SSE comes from `getRoster()` at call time, can drift between calls
12. After model PATCH for non-main, response includes `restartRequired: true`. UI should surface a restart prompt.

---

## 10. Frontend Wiring (Current `dashboard-html.ts`)

### Polling cadence (don't exceed in the rewrite)

| Cadence | What |
|---|---|
| 1s | `.countdown` element ticker (DOM only, no network) |
| 5s | `/api/meet/sessions` |
| 15s | `/api/mission/tasks` |
| 60s | `refreshAll()` parallel fan-out (all sections) |

### SSE lifecycle

Single `EventSource` opened on first chat-panel open at `dashboard-html.ts:2580`. Never closed until next reconnect (intentional, drives FAB unread badge while panel closed). Token is in URL. Reconnect is native `EventSource` auto-retry; status dot goes red on error then optimistically green after 3s.

### Dataset-attribute conventions

- `data-mid` / `data-mact` (mission task id + action)
- `data-drop-agent` (kanban column)
- `data-agent` / `data-model` (model picker)
- `data-task` / `data-action` (scheduled task buttons)
- `data-ts` (countdown timestamp)
- `data-section` / `data-idx` (privacy blur)

This pattern exists because escaped single quotes inside the TypeScript template literal produce literal `\'` characters that break inline JS handlers. Any new code that adds `onclick="fn('${id}')"` will silently break. Use `data-*` + `this.dataset.*`.

### localStorage keys
- `privacyBlur_tasks` (per-item map)
- `privacyBlur_tasks_all` ('revealed'|'blurred' override)
- `privacyBlur_hive` / `privacyBlur_hive_all`

### UX behaviors that must survive a rewrite

- All updates pessimistic (no optimistic UI)
- Send is fire-and-forget over SSE
- Enter-to-send + Shift-Enter-newline (only keyboard shortcut)
- Viewport zoom locked
- Completed mission tasks auto-expire from kanban after 30 min (only history drawer shows them)
- Body scroll locked when any drawer is open
- Refresh button SVG gets `.refresh-spin` class during fetches

---

## 11. Database Schema Quick Reference

13 tables. WAL mode, 5s busy timeout, 0o600 file permissions. All timestamps unix seconds EXCEPT `sessions.updated_at` (ISO-8601) and `inter_agent_tasks.created_at`/`completed_at` (ISO-8601).

| Table | Role | Retention |
|---|---|---|
| `sessions` | Claude Code session id per (chat, agent) | none |
| `conversation_log` | Turn-by-turn history | 500 rows per (chat, agent) |
| `token_usage` | Cost attribution | none, fastest-growing table |
| `memories` | Extracted semantic memory | salience decay, deleted < 0.05 |
| `consolidations` | Memory insights | none |
| `scheduled_tasks` | Cron-triggered prompts | none |
| `mission_tasks` | One-shot async delegation | 7 days post-terminal |
| `inter_agent_tasks` | Synchronous delegation log | none |
| `hive_mind` | Cross-agent action feed | none |
| `audit_log` | Blocked actions + security events | none |
| `warroom_meetings` | Voice + text meeting metadata (`meeting_type` distinguishes) | 90 days |
| `warroom_transcript` | Per-meeting messages | cascades from meetings |
| `meet_sessions` | Pika/Daily/Recall video bot sessions | none |

### Notable invariants

- Status enums are app-enforced (no CHECK constraints)
- Priority range 0-10 is dashboard-clamped only; `mission-cli` can write outside
- Boolean-ish columns (`did_compact`, `blocked`, `pinned`, `consolidated`) are integer 0/1
- JSON columns (`memories.entities/topics/connections/embedding`, `consolidations.source_ids/embedding`) are raw JSON strings, never parsed by db.ts
- `warroom_meetings.chat_id` is empty string `''` for legacy voice meetings, never NULL
- `mission_tasks.assigned_agent` is NULL for unassigned, never empty string

### Atomic writes (transactions)
Only `claimNextMissionTask` and `saveWarRoomConversationTurn` use transactions. `endWarRoomMeeting` was non-transactional (recent fix collapsed two UPDATEs into one bound statement).

---

## 12. Side Effects (What Routes Touch Outside the DB)

### Filesystem writes during request handling

| Path | Endpoints |
|---|---|
| `/tmp/warroom-pin.json` | `/api/warroom/pin`, `/unpin` |
| `/tmp/warroom-agents.json` | implicit via `refreshWarRoomRoster()` from create/delete |
| `warroom/voices.json` | `/api/warroom/voices` |
| `warroom/music.mp3` | `/warroom-music-upload` (now magic-byte validated) |
| `agents/<id>/agent.yaml` | model PATCH |
| `~/Library/LaunchAgents/<id>.plist` | activate / deactivate |
| `.env` | agent create / delete (now atomic temp+rename, mode 0600) |

### Subprocesses

| Binary | Triggered by | Timeout |
|---|---|---|
| `dist/meet-cli.js` | `/api/meet/{join,join-daily,leave}` | 220s / 120s / 45s |
| `warroom/server.py` (Pipecat) | spawn at main startup; SIGKILL via `/voices/apply`, `/pin`, `/unpin`, agent create/delete | none |
| `launchctl` (`execSync`) | activate/deactivate/restart agent | **no timeout, blocks event loop** |

### EventEmitters

- `chatEvents` (state.ts): global, `maxListeners=20`. One listener per open chat SSE.
- `MeetingChannel.emitter`: per-meeting, `maxListeners=50`. One per text war room SSE client.
- `messageQueue`: per-chat FIFO promise chain. Used by Telegram bot AND `/api/warroom/text/send` (keyed `warroom-text:<meetingId>`).

### Required call orderings (must preserve in rewrite)

**Text War Room**: `/text/new` → `/text/warmup` (parallel) → `/text/history` (capture latestSeq) → `/text/stream?sinceSeq=` → `/text/send` → `/text/end`

**Voice War Room**: `/warroom/pin` → `/warroom/start` (probes TCP) → browser opens `/ws/warroom`. Browser must wait for `/start` returning `{ok:true}` before WS upgrade.

**Agent**: `create` → `activate` → process spawns. Cannot parallelize activate calls for the same agent.

---

## 13. Auth and Access Model

- One token (`DASHBOARD_TOKEN`) gates everything in the dashboard
- Token travels in `?token=...` URL parameter, not header. Logged by access logs and proxies. `Referrer-Policy: no-referrer` mitigates Referer leaks for outbound clicks.
- CSRF: cross-origin POSTs rejected unless Origin matches `DASHBOARD_URL` or is localhost. **Gap**: requests with no Origin header (curl, REST clients) bypass the check entirely; only the token gate stands.
- Mutation kill switch: `DASHBOARD_MUTATIONS_ENABLED=false` → 503 on every non-GET. Re-read every 1.5s.
- WebSocket auth: same `?token=` query string, validated before upgrade. 401 + socket destroyed on mismatch.

---

## 14. The 10 Hardening Fixes Shipped This Session

Committed in `e9411e6` "fix(agents,dashboard): pre-rewrite hardening sweep". 6 files, 251 insertions, 78 deletions, 372/372 tests pass.

### Bug fixes from adversarial review

1. **`/api/mission/tasks/auto-assign-all` was returning 404**. Route was registered after `:id/auto-assign` and Hono first-match captured `auto-assign-all` as the id. Reordered + parallelized Gemini calls (concurrency=5).
2. **`endWarRoomMeeting` could leave `duration_s` NULL on crash**. Two non-transactional UPDATEs collapsed into one bound statement.
3. **`cancelMissionTask` didn't actually cancel**. Wired a 5-second SQLite status poll inside the scheduler that aborts the live `AbortController`. Status preserved as `cancelled` (not overwritten to `failed`).
4. **`.env` writes were torn during agent create**. `kill-switches.ts` re-reads `.env` every 1.5s; concurrent agent create read a half-written file. Fix: atomic temp file + rename, mode 0600.
5. **Plist log paths caused launchd exit-78 when PROJECT_ROOT contained spaces**. Routed logs through `~/Library/Logs/claudeclaw/<id>.log` (space-free macOS path).
6. **`/api/chat/send` had no concurrency guard**. 100 rapid POSTs queued 100 agent invocations. Returns 429 when `getIsProcessing().processing` is true.
7. **`/warroom-music-upload` accepted any 20MB file**. Added MP3 magic-byte check (ID3v2 header or MPEG frame sync).

### Synchronization hardening

8. **Orchestrator `agentRegistry` was frozen at main startup**. New agents invisible to `@delegate:` syntax until restart. Fix: export `refreshAgentRegistry()`, called from `createAgent` and `deleteAgent`. `delegateToAgent` rebuilds on cache miss as a safety net.
9. **`PATCH /api/agents/:id/model` silently no-op for non-main**. Yaml updated, running process keeps old model until restart. Fix: response now returns `restartRequired: true` for sub-agents so the UI can prompt deliberately. Bulk endpoint returns `restartRequired: string[]`.
10. **`router.py AGENT_NAMES` was hardcoded**. Voice prefix routing failed forever for custom agents. Fix: mtime-cached read of `/tmp/warroom-agents.json`, regex rebuilt lazily on roster change. Verified live: `analytics` agent matches `"hey analytics, ..."`.

Bonus: `bounceVoiceWarRoom` failures promoted from `warn` to `error` with explicit "voice roster may be stale" message so silent text/voice divergence is visible in logs.

---

## 15. Known Sharp Edges Not Yet Fixed

These were flagged in the audit but deliberately left for later (not blocking the rewrite).

1. **Mission tasks routed to non-RUNNING agents pile up forever** with no UI warning. Possible fix: dashboard banner when `assigned_agent` is in CONFIG-ONLY/STOPPED state.
2. **`deactivateAgent` swallows `launchctl unload` errors** and returns `{ok: true}` even if the process is still running.
3. **5-second PID poll in `activateLaunchd` returns success even if process never started**. No log inspection, no service-state check.
4. **No rollback on partial `createAgent` failure**. Plist write throws → agent yaml + .env entry orphaned.
5. **`launchctl`/`systemctl` use `execSync` with no timeout**. A hung command blocks the entire Node event loop.
6. **No rate limiting on Gemini-calling endpoints** (`auto-assign`, `auto-assign-all`). A leaked token can rack up costs.
7. **CSRF gap when Origin header is absent**. Token is the only remaining gate. Not exploitable without the token.
8. **Token in URL leaks to access logs and browser history**. `Referrer-Policy: no-referrer` mitigates Referer leak only.
9. **Markdown renderer (`renderMarkdown`)** is a hand-rolled regex parser with placeholder tokens. Theoretical XSS via `%%BLOCK0%%` literal injection from Telegram messages. Recommended: replace with `marked` + `DOMPurify` during the frontend rewrite.

---

## 16. Frontend Rewrite Migration Strategy (Recommended)

### Stack
**Vite + vanilla TypeScript with Preact Signals.** Bundle target <80KB gzip. Add `marked` + `DOMPurify` for the chat panel. No HTMX (backend is JSON, would require BE changes). Chart.js stays on CDN.

### Approach
**Big-bang rewrite gated by contract tests.** Strangler is awkward (no seam in a single HTML string). Parallel `/v2` doubles maintenance.

### Contract test suite (write FIRST, before any rewrite code)
- Use `hono/testing` `app.request()` (no port spinup)
- File at `src/dashboard.contract.test.ts`
- Snapshot shapes via Vitest `toMatchObject`, not values
- ~20 baseline tests covering every endpoint family + 401/CSRF behavior
- Required CI step before frontend build

### Build integration
`npm run build` becomes composite `vite build && tsc`. Hono serves the built HTML file. Single-process deploy model is non-negotiable.

### Rollback
Keep `dashboard-html.legacy.ts` for 30 days. `DASHBOARD_LEGACY=true` env flag dispatches between old and new. Two-line change in `dashboard.ts:303`. Restart main agent to flip.

### Pre-merge checklist (paste in PR description)
- [ ] Every endpoint family hit at least once
- [ ] Every SSE event type observed
- [ ] Polling cadence verified ≤ current values
- [ ] Drag-drop kanban reassigns task via PATCH
- [ ] Custom dropdowns close on outside click
- [ ] Privacy blur preserves localStorage state
- [ ] Drawer body scroll lock works on iOS Safari
- [ ] Token in `?token=` on every fetch including SSE
- [ ] No optimistic updates (preserve pessimistic model)
- [ ] Mobile responsive (summary bar 2-col below 640px)
- [ ] Build size under 100KB gzip
- [ ] All 372 existing tests still pass

---

## 17. File Reference Index

**Backend core**
- `src/dashboard.ts` (~2100 lines): all HTTP routes, middleware, SSE channels, WS proxy
- `src/dashboard-html.ts` (~2841 lines): entire frontend as a TypeScript template literal
- `src/db.ts` (~2820 lines): all SQLite schemas, query helpers, migrations

**Agent system**
- `src/agent-create.ts`: `createAgent`, `activateAgent`, `deactivateAgent`, `deleteAgent`, `bounceVoiceWarRoom`, `writeBotTokenToEnv`, `generateLaunchdPlist`
- `src/agent-config.ts`: `loadAgentConfig`, `listAgentIds`, `listAllAgents`, `setAgentModel`, `refreshWarRoomRoster`
- `src/orchestrator.ts`: `initOrchestrator`, `refreshAgentRegistry`, `delegateToAgent`, `parseDelegation`
- `src/scheduler.ts`: `initScheduler`, `runDueTasks`, `runDueMissionTasks` (with cancel poll)
- `src/agent.ts`: `runAgent`, `runAgentWithRetry` (the Claude SDK call)
- `src/index.ts`: process startup, PID lock, Pipecat respawn loop
- `src/config.ts`: AGENT_ID, env var contract, hot vs frozen settings

**War Room**
- `src/warroom-text-events.ts`: `MeetingChannel` ring buffer, SSE event types, idle sweeper
- `src/warroom-text-orchestrator.ts`: text turn handling, `getRoster()`, intervener logic
- `src/warroom-text-db.ts`: text-meeting-specific DB helpers
- `warroom/server.py`: Pipecat entry, voice pipeline, `VALID_AGENTS`, pin reading
- `warroom/router.py`: voice prefix routing, mtime-cached `AGENT_NAMES`
- `warroom/agent_bridge.py`: Pipecat-to-Node bridge for voice agent invocations

**Other**
- `src/state.ts`: `chatEvents` emitter, processing state, abort controllers
- `src/kill-switches.ts`: 6 runtime gates, 1.5s TTL `.env` re-read
- `src/message-queue.ts`: per-chat FIFO promise chain
- `src/memory.ts`: ingestion, decay sweep, consolidation
- `src/bot.ts`: Telegram bot polling, `chatModelOverride`, `setMainModelOverride`
- `src/mission-cli.ts`: external CLI for creating mission tasks
- `src/schedule-cli.ts`: external CLI for cron tasks
- `migrations/version.json`: semver gating for external migrations (currently empty)

**Config and infra**
- `agents/<id>/agent.yaml`: per-agent config schema
- `agents/<id>/CLAUDE.md`: per-agent system prompt
- `launchd/com.claudeclaw.<id>.plist`: macOS service template
- `~/Library/LaunchAgents/com.claudeclaw.<id>.plist`: resolved plist
- `~/Library/Logs/claudeclaw/<id>.log`: per-agent log file
- `store/claudeclaw.db`: SQLite, WAL, 0o600
- `store/agent-<id>.pid`: PID file per agent process
- `/tmp/warroom-agents.json`: voice roster snapshot
- `/tmp/warroom-pin.json`: voice pin state
- `.env`: bot tokens (atomic writes, mode 0600), kill switches, dashboard config

---

## TLDR of the TLDR

- **5+ OS processes share one SQLite database.** No other IPC. WAL mode, 5s busy timeout.
- **Only main runs the dashboard, decay sweep, and Pipecat subprocess.** Sub-agents only run their own bot + scheduler.
- **6 agent states.** Mission tasks pile up forever against non-RUNNING agents with no warning.
- **Most surfaces read agent metadata live.** Three exceptions: Pipecat `VALID_AGENTS` (snapshot, bounced on change), agent-process model (frozen at startup, restart required), router.py `AGENT_NAMES` (mtime-cached after recent fix).
- **`createAgent` propagates to 5 surfaces.** `bounceVoiceWarRoom` is the only failure-prone link; failures now logged at error level.
- **The wizard creates the bot via @BotFather externally.** ClaudeClaw never calls Telegram's bot-creation API.
- **Model PATCH for sub-agents requires explicit restart.** API now returns `restartRequired: true` so the UI can prompt.
- **Backend contract is locked.** Frontend rewrite has 70+ endpoints, 2 SSE channels, 1 WS proxy as a frozen interface.
- **10 hardening fixes shipped before the rewrite.** Build clean, 372 tests green.
