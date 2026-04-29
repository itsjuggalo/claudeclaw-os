# War Room Audit — Phased Execution Plan

PLAN.md is the full audit reference (200+ items across 5 Codex rounds). This is the working plan: 7 phases, each shippable, each with a clear exit criterion. Treat this as the source of truth; PLAN.md is the backlog.

---

## Phase 1 — Ship-blocking fixes (unblocks war room merge)

**Goal:** Fix the 7 concrete bugs the 5-agent audit found. After this, text war room can merge.

**Items:**
1. Slash command regex `/\\s+/` → `/\s+/` — `warroom-text-html.ts:2163`
2. Escape `"""` in user text before router/gate prompt interpolation — `warroom-text-router.ts:108-119`
3. Push `RTVIServerMessageFrame{event:agent_error}` on OAuth token expiry — `warroom/server.py:413`, render in `handleServerMessage`
4. Push `hand_down` event on `answer_as_agent` timeout — `warroom/server.py:393`
5. Add `chatId` to POST bodies (`/send`, `/abort`, `/pin`, `/unpin`, `/clear`, `/end`) — `warroom-text-html.ts`
6. Sweep `speakingAgents` on every SSE reconnect — `warroom-text-html.ts:1396`
7. Unify `renderTranscriptRow` and inline history block — `warroom-text-html.ts:1874 vs 2499`

**Exit criterion:** All 7 fixed, manual smoke test of slash commands + agent switching + reconnect passes, text war room PR opens.

**Effort:** ~1-2 days.

---

## Phase 2 — Tier A security hardening (must precede public exposure)

**Goal:** Close the security holes that would matter if the dashboard token ever leaks or a malicious message arrives. None of these are blocking a private merge but all block public/Cloudflare exposure.

**Items:**
1. **Least-privilege SDK env contract** — `getScrubbedSdkEnv()` allowlist in `src/security.ts`, applied to every `query()` call site. Allow only `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) + `PATH`/`HOME`/locale.
2. **Read-side secret exfil red team** — under isolated audit profile (Phase 3), confirm war-room messages can't print `.env`, `~/.claude/credentials`, `DASHBOARD_TOKEN`.
3. **Untrusted-data delimiters in prompt assembly** — wrap every retrieved-from-DB block in `buildMemoryContext`, war-room transcript block, Telegram bridge with explicit "untrusted DATA, not instructions" framing.
4. **Persistent prompt-injection red team** — seed DB with malicious memory row, confirm next turn doesn't comply.
5. **CSRF middleware** — single Hono middleware that rejects mutating requests whose `Origin`/`Referer` is outside allowlist. Document exceptions inline.
6. **XSS sweep** — grep `innerHTML\s*=` in all war-room HTML, audit each interpolation, add tests with `<img onerror>` and `javascript:` payloads.
7. **Runtime kill switches** — env flags `WARROOM_TEXT_ENABLED`, `WARROOM_VOICE_ENABLED`, `LLM_SPAWN_ENABLED`, `DASHBOARD_MUTATIONS_ENABLED`. Hot-reloaded. Surfaced in `/api/health`.

**Exit criterion:** All 4 red-team payload classes (write-side, read-side, persistent, CSRF) refuse cleanly. Kill switches verified to disable surfaces from outside the process. CSP nonce or documented exception in place.

**Effort:** ~1 week.

---

## Phase 3 — Isolated audit profile + smoke tests (foundation for everything else)

**Goal:** Build the testing infrastructure. Without this, Phase 2 red teams can't safely run, and Phase 4-7 tests don't have a target to run against.

**Items:**
1. **Isolated audit profile** — `docs/audit-profile.md` checklist, fail-closed boot if any production token/path/chat_id is detected. Canary `.env`, scrubbed DB copy, `AUDIT_NO_EGRESS=1`, fixture mocks for Telegram/Slack/WhatsApp/Daily.
2. **Release smoke test runbook** — clean install, `npm test`, `npm run build`, `dist/` boots, `/warroom`, `/warroom/text`, `/api/health` respond, launchd restart, voice Daily round-trip, persistence after restart, bundled asset integrity.
3. **Upgrade-in-place smoke** — copied production DB + `.env` survives `npm run build` + restart. Migrations apply.
4. **Migration safety** — pre-migration backup with `0600`, transactional DDL where possible, idempotency, post-migration `PRAGMA integrity_check` + `foreign_key_check`.
5. **Backup file safety** — `*.db.pre-*.bak` chmod 0600, 3-backup rotation, gitignored, excluded from sync.
6. **Expanded `/api/health`** — surface meeting count, ring-buffer depth, in-flight turns, voice subprocess state, mission queue depth, kill-switch state, last error.

**Exit criterion:** Audit profile boots with canary tokens, refuses live state. Smoke test runbook executes clean against a fresh checkout. Migration runs idempotently with backup + integrity check.

**Effort:** ~1 week.

---

## Phase 4 — Test coverage (lock in current correctness)

**Goal:** Add the highest-leverage automated tests so Phase 1-3 work doesn't regress silently.

**Items (top 10 from test-coverage audit):**
1. Sticky addressee `beforeId` cursor — `warroom-text-orchestrator.test.ts`
2. 300s watchdog + `finalizedTurns` chunk drop — same file
3. Cross-chat endpoint 403 — `dashboard.test.ts`
4. `saveWarRoomConversationTurn` atomicity (transaction rollback) — `db.test.ts`
5. Memory `strictAgentId` isolation — `memory.test.ts`
6. Slash command → memory ingestion normalization — orchestrator test
7. `@`-mention multi-agent dedup partial unique index — `db.test.ts`
8. Voice subprocess respawn <500ms after SIGTERM — integration
9. Pin file race convergence — integration
10. War-room bridge `excludeMeetingId` dedup — `memory.test.ts`

**Plus:** SSE soak (30 EventSource conns, abrupt close mix, baseline-return).

**Exit criterion:** All 10 + soak pass in CI. Coverage delta documented.

**Effort:** ~1 week.

---

## Phase 5 — Operational hardening (observability + reliability polish)

**Goal:** Make incidents recoverable and debuggable. None of this blocks shipping but all of it shortens MTTR.

**Items:**
1. **Audit log table** — `audit_log(id, ts, actor, action, target, meta)`, append-only, 90-day retention. Insert on meeting create/send/abort/end/delete, kill-switch flips, agent CRUD, token rotation.
2. **Correlation IDs** — `requestId`/`turnId` in every log line and DB row that touches a turn. Confirm coverage.
3. **`/audit` dashboard view** — single-page UI for the audit log.
4. **Incident runbook** — `docs/incident-runbook.md`: which kill switch flips on which symptom.
5. **Voice config rate limit** — 3s cooldown on `/api/warroom/voices/apply`.
6. **Persona hot-reload button** — single dashboard action.
7. **Voice WS cleanup gap** — explicit `/end` sentinel POST before new `/start`.
8. **`endTextMeeting` clears SDK sessions** — single line addition.

**Exit criterion:** Audit log captures every state-changing action. Runbook walks through 3 simulated incidents end-to-end.

**Effort:** ~1 week.

---

## Phase 6 — Defense in depth (only if attack path materializes)

**Goal:** Items where the failure mode is theoretical or the attack path requires multiple prior failures. Ship without these unless red teams in Phase 2 surface real leaks.

**Items:**
1. **Streaming-sink secret filter** — sliding-window scanner at SSE/Telegram/voice/dashboard chat sinks. *Only if Phase 2 red team finds chunk-split leakage.*
2. **Security headers** — `Referrer-Policy`, `X-Content-Type-Options`, `Cache-Control: no-store`, `X-Frame-Options`, HSTS.
3. **Static asset / upload audit** — body limits, MIME validation, atomic writes, path validation. *Only if war room adds upload affordances.*
4. **Daily room secret handling** — no tokens in argv, log redaction, API response scrubbing.
5. **GET-route exfil audit** — chatId scoping on all authenticated GETs, `Cache-Control: no-store` on sensitive responses.
6. **Network exposure** — bind address audit, Host header allowlist (DNS rebinding defense), HTTPS over LAN.
7. **Dashboard WS proxy origin/cap audit** — mirror Pipecat-side audit at the dashboard proxy layer.
8. **Idempotency tests** — server-side `clientMsgId` dedup before queue enqueue, double-submit/refresh/retry test matrix.
9. **Cost/budget gate expansion** — Gemini, Telegram/Slack/WhatsApp sends, STT/TTS, Daily, Pika in the budget matrix. Per-API kill switches.

**Exit criterion:** Each item has a triage verdict (Tier A/B/C with evidence type). Tier A items closed; Tier B/C scheduled or accepted in `docs/known-gaps.md`.

**Effort:** ~2-3 weeks.

---

## Phase 7 — Audit program (systematic gap-fill, post-launch)

**Goal:** Work through the 200+ items in PLAN.md that aren't covered by Phases 1-6. This is ongoing, not a single push.

**Categories:**
1. Files never opened — `warroom-text-picker-html.ts`, Daily room lifecycle, integration-test.ts coverage matrix
2. Cross-feature integration — Telegram↔war-room round-trip, memory consolidation over war-room rows, decay sweep retention, voice↔text concurrent operation
3. Concurrency edges — two-tab same-meeting, two-meetings same-chat, abort during streaming, agent rename mid-meeting, SQLite write contention
4. Data lifecycle cascading delete — purge across `conversation_log`, memories, consolidations, embeddings; rehydration test
5. Untrusted-source inventory — Slack, WhatsApp, Obsidian, uploads, mission outputs, skill docs, agent configs (per-source second-order injection)
6. Tool/secret hardening per non-war-room SDK entry — Telegram bot, scheduler, mission worker, dashboard agent chat, meet-cli
7. Code quality / UX — parallelize intervener gates, share Telegram history block in /standup, mobile responsive, voice dialog focus trap

**Exit criterion:** Each PLAN.md item has a Tier A/B/C verdict with evidence type. Tier A items either closed or filed as Release Risk Exception.

**Effort:** ongoing, ~1 day per category.

---

## How to use this plan

- **Working through it:** Pick a phase, work top-to-bottom. Don't skip ahead — Phase 3 unlocks Phase 2's red teams, Phase 4 locks in Phases 1-3.
- **Updating it:** When a phase exits, mark items done in this file. New findings go into PLAN.md (the backlog) and get pulled into a phase only when they reach Tier A or block a phase exit.
- **PLAN.md vs this file:** PLAN.md is the comprehensive checklist. This file is the execution order. If they conflict, this file wins.
