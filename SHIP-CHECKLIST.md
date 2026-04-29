# Ship Checklist — War Room

One-page summary of what was added, what was tested, what's deferred. Read this before deciding to commit.

## What was added (per phase)

| Phase | Theme | Highlights |
|---|---|---|
| 1 | Ship-blocking fixes | `"""` prompt-injection escape; voice `agent_error` + `hand_down` frames; SSE typing-stuck reset; `chatId` in POST bodies; `renderTranscriptRow` unified |
| 2 | Tier A security | `getScrubbedSdkEnv()` (least-privilege env); kill-switches module; CSRF middleware; untrusted-data delimiters |
| 3 | Audit profile + smoke | `scripts/audit-profile.sh` (canary tokens, fail-closed); `docs/release-smoke.md`; pre-migration backup with chmod 0600 + rotation |
| 4 | Tests | MeetingChannel + finalizedTurns; saveWarRoomConversationTurn idempotency; multi-agent dedup; memory strict-agent isolation; retention prune; kill-switch enforcement |
| 5 | Operational hardening | `voices/apply` 3s cooldown; `endTextMeeting` clears SDK sessions; `docs/incident-runbook.md` |
| 6 | Defense in depth | Security headers (Referrer-Policy, X-Content-Type-Options, X-Frame-Options, Cache-Control no-store on `/api/`); default `127.0.0.1` bind |
| 7 | Audit-program retention | `pruneWarRoomMeetings(90 days)` integrated into decay sweep; FK cascade + conversation_log cleanup |
| Tool-call UX | Disclosure | `<details>` collapsed-by-default tool-call strip; auto-counting summary; click to expand |
| maxTurns + honesty | Empty-bubble fix | maxTurns 4→8 specialist / 6→10 main; smart fallback when text empty + tools used; "ALWAYS FINALIZE WITH TEXT" hint |
| Memory ingest | 429 backoff | 5-min cooldown; `/api/health.memoryIngestion` |
| **0** (added late) | Centralize kill-switch enforcement | `requireEnabled()` at every LLM boundary (runAgent, war-room orchestrator, router, gate, voice bridge, Gemini); single mutation middleware replacing scattered route checks; refusal counter |
| **A** (added late) | Memory off Gemini | Primary path now Anthropic Haiku via OAuth; Gemini retained as fallback |
| **B** (added late) | War-room tool boundary | `permissionMode: 'default'` (no bypass); per-agent `allowedTools`/`disallowedTools` policy; MCP filter; per-turn 8-tool budget; `audit_log` writes for every tool call; `agent.yaml warroom_tools:` opt-in |
| **C** (added late) | Red-team validation | 5/5 PASS — read-side exfil, write-side exfil, env probe, policy-enforcement, negative-test all behave correctly. `docs/redteam-results.md` |
| **D** (added late) | Voice verification | Static fixes verified in `warroom/server.py`; manual sub-tests documented for Mark in `docs/voice-smoke-results.md` |
| **E** (added late) | Router observability | Elapsed_ms + outcome on every router call; sticky-addressee path already short-circuits the router |

## Test status

- Build: clean (`tsc` passes)
- Unit/integration: 368+ tests pass (last run: post-Phase A/B)
- Red-team: 5/5 PASS against live war room (`docs/redteam-results.md`)
- Voice manual: deferred to Mark (`docs/voice-smoke-results.md` has the runbook)

## Documents created

- `PLAN.md` — full audit (5-round Codex-reviewed; reference, not working plan)
- `PLAN-PHASED.md` — original 7-phase exec plan (Phases 1-7 done)
- `PLAN-SHIP.md` — adjusted post-Codex-adversarial-review plan (Phase 0 + A-F)
- `docs/release-smoke.md` — release runbook
- `docs/incident-runbook.md` — kill-switch playbook
- `docs/warroom-mcp-policy.md` — per-agent tool allowlist
- `docs/redteam-results.md` — adversarial test results
- `docs/voice-smoke-results.md` — voice fix verification
- `scripts/audit-profile.sh` — isolated red-team harness

## Known gaps (deferred, not blocking)

- **Persistent-injection live test** — requires direct DB INSERT of malicious memory, not run live; Mark should run against `audit-profile.sh` when ready.
- **Full canary-token verification** — would require booting a separate full ClaudeClaw stack inside `$AUDIT_TMP`. Mark can run when needed.
- **Voice manual sub-tests (D-1 through D-5)** — runbook provided; ~15 min of manual cycle.
- **Browser-MCP autonomous-tab issue** — defense in place via tool policy (default-deny `claude-in-chrome` MCP), but root-cause investigation deferred.
- **Router cold-start latency** — measurement instrumentation now in place; bumping `ROUTER_TIMEOUT_MS` from 20s deferred until data shows >5% fallback rate.

## Blocked / requires Mark

- **`git commit`** — explicitly held per Mark's "battle-test before commit" instruction. All work sits in working tree (`git status` shows ~40 changed/new files). Suggested logical commits in `PLAN-SHIP.md` Phase F.
- **Real OAuth-failure voice test** — requires temporarily breaking `.env`.
- **Canary-token isolated profile run** — requires manual environment setup.

## What "shipped" looks like for Mark's personal use

After Mark runs:
1. The voice manual sub-tests (D-1 to D-5) once
2. A real conversation in the text war room with the new tool policy active
3. `git commit` of his choosing (suggested commits in PLAN-SHIP.md)

Then this is shipped for personal use. Public-template release is a separate gate.
