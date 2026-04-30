# Mission Control v2 — Functionality Audit (after this session's work)

Vite dev validated against running backend on `:3141` (legacy code) plus new `/api/*` endpoints proxied through Vite.

## Pages now live with full data + actions

### Workspace

| Page | What works | What needs the running backend rebuilt to work |
|---|---|---|
| **Mission Control** | Kanban with Inbox + per-agent columns. Live agent avatars (initials fallback). New Task modal (title + prompt + assign + priority). Auto-assign all + per-task auto-assign + manual reassign + cancel + delete. Drag-drop reassign. History drawer with pagination. 15s polling. | Auto-assign-all route ordering fix (was 404, fixed in this session) — backend restart needed. |
| **Scheduled** | All real cron tasks listed with pause / resume / delete buttons. Cron expression rendered with countdown. Per-agent tag (@comms, @content, @ops). Last-status pill (success/failed/timeout). Expandable last result. | None — works against current backend. |
| **Agents** | All 5 of your agents (Main / Research / Comms / Content / Ops) with names, descriptions, models, today turns + cost. Per-card model picker (Opus 4.6 / Sonnet 4.6 / Sonnet 4.5 / Haiku 4.5). Bulk "Set all" picker. Stop / Start / Restart / Delete buttons. **Full 3-step Create Agent wizard** with debounced ID validation, Telegram getMe token validation, copy-to-clipboard BotFather instructions, summary + activate. | Avatar endpoint (Telegram profile photos) requires backend restart. Currently shows initials. |
| **Chat** | Full-page chat replacing the old slide-over. Per-agent tabs at top with live status dot. SSE stream connection indicator. Send via Enter, Stop button when processing. Messages stream in via SSE. Per-agent conversation history loads. | None — works against current backend. |

### Intelligence

| Page | What works |
|---|---|
| **Memories** | All 85 of your real memories. Sort tabs (Importance / Salience / Recent). Importance score color-coded pill. Salience bar visual. Tags below each row. Click any row to expand and see raw text. Pagination ready. |
| **Hive Mind** | Full activity log of every agent session with color-coded agent badges. |
| **Usage** | $639.75 lifetime cost rendered. 30-day cost sparkline. System health (16% context, 9 turns, 20d session age). Connections (Telegram/WhatsApp/Slack all green). 6 kill switches as pills (all on). |
| **Audit** | All / Blocked filter tabs. Action + agent + blocked badge + detail in a table. |

### Collaborate

| Page | What works |
|---|---|
| **War Room** | Mode picker preserved (Voice / Text / Live Meetings cards) plus "Open in classic" link to legacy pages. Voice tab: pin one of your 5 agents (with avatar) for direct or auto mode, "Launch voice meeting" CTA opens legacy `/warroom?mode=voice`. Text tab: list of recent text meetings + "New text meeting" creates one and routes to legacy `/warroom/text`. Meet tab: active and recent video sessions. |

### Configure

| Page | What works |
|---|---|
| **Voices** | Per-agent Gemini voice config table. Live `/api/warroom/voices` data. Save (record) and Save & Apply (record + bounce Pipecat). Dirty-state highlighting per row. |
| **Settings** | All 6 kill switches with descriptions, on/off pills, refusal counters. Read-only display of default model and context %. Theme switcher pointer to the workspace switcher. |

## Backend additions in this session

- **`GET /api/agents/:id/avatar`** — lazy fetch via Telegram `getMe` → `getFile` → cache as `agents/<id>/avatar.png`. 1h browser cache. Returns 204 if bot has no photo, 404 if agent doesn't exist. **Needs backend restart to ship.**

## Commands the new UI hits (verified wired)

- `GET /api/agents` — agent list with running + cost stats
- `GET /api/agents/:id/avatar` — Telegram profile photo (new)
- `GET /api/agents/:id/conversation` — per-agent chat history
- `GET /api/agents/templates`, `/validate-id`, `POST /validate-token`, `POST /create`, `POST /:id/{activate,deactivate,restart}`, `DELETE /:id/full`, `PATCH /:id/model`, `PATCH /model`
- `GET /api/mission/tasks`, `GET /api/mission/history`, `POST /api/mission/tasks`, `POST /:id/cancel`, `POST /:id/auto-assign`, `POST /auto-assign-all`, `PATCH /:id`, `DELETE /:id`
- `GET /api/tasks`, `POST /:id/pause`, `POST /:id/resume`, `DELETE /:id`
- `GET /api/memories`, `/memories/list`, `/memories/pinned`
- `GET /api/hive-mind`
- `GET /api/tokens`, `GET /api/health`, `GET /api/security/status`
- `GET /api/audit`, `GET /api/audit/blocked`
- `GET /api/warroom/agents`, `GET /pin`, `POST /pin`, `POST /unpin`
- `GET /api/warroom/voices`, `POST /voices`, `POST /voices/apply`
- `GET /api/warroom/meetings`
- `GET /api/warroom/text/list`, `POST /text/new`
- `GET /api/meet/sessions`
- `GET /api/chat/history`, `POST /chat/send`, `POST /chat/abort`, `GET /chat/stream` (SSE)

## Two things that still need the backend restart

1. **Telegram avatars** — endpoint exists in `dashboard.ts` but the running backend on `:3141` is from before this session's changes. Show initials until restart.
2. **`auto-assign-all` route fix** — was 404 before; now ordered correctly. The dev server proxies through, so the bug still exists on the running backend.

To restart: `launchctl kickstart -k gui/$(id -u)/com.claudeclaw.main`. The Vite dev server keeps working through the restart since it proxies `/api/*`.

## Bundle

- 138KB total / 36KB gzip (was 26KB before this session). Still under 90KB target.
- 408/408 tests pass, including 36 contract tests pinning the API surface.

## Known gaps — what's still placeholder or missing

- **Detail panel on Agents** (the click-into-an-agent two-pane view with Conversation / Tasks / Hive Mind tabs). Today the cards have inline actions but no deep view.
- **Memory drawers**: Pinned, Insights, Search bar across memories.
- **Chat: agent-specific send.** Today all messages go to main agent's chat. Per-agent messaging happens via Telegram, not the dashboard.
- **War Room Live Meetings launcher** — list works but the "Send agent into Meet" / "Create Daily room" buttons aren't wired in v2 yet (they live in legacy classic page).
- **Audit log pagination** — first 100 only.
- **Hive Mind agent filter** — table renders all agents intermingled, no filter UI yet.

Each of these is a 30–60 minute follow-up.
