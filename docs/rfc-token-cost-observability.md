---
Author: Michael Kidder
Title: Token / Cost Observability (metered-billing readiness)
Status: Foundation SHIPPED (per-turn capture + `/savings` + dashboard panel, live under overlay test on `feat/cache-savings-metrics`, no PR yet); suite features #1–#3 designed, not yet built
Created: 2026-07-09
Component: token/cost telemetry / metered-billing observability
---

# Token / Cost Observability (metered-billing readiness)

## Why

Anthropic plans to move the SDK from subscription to **credit/usage billing** (delayed
until further notice). When that flips, per-token spend becomes real money and users
need to *see* and *forecast* it. Everything here is read-side observability over data
the SDK result object already carries — near-zero per-turn overhead (no extra API
calls, no extra tokens; we read exhaust that's already parsed).

## Shipped foundation (on `feat/cache-savings-metrics`)

Per-turn row in `token_usage` now carries:
`input_tokens, output_tokens, cache_read, cache_creation, context_tokens,
context_window, cost_usd, did_compact, agent_id` **plus telemetry**
`model, duration_ms, duration_api_ms, num_turns, stop_reason, is_error`.

Key decisions baked in:
- **No vanity metrics.** The fabricated "$ saved" (flat Opus rate × tokens) was
  removed. `/savings` and the dashboard panel lead with **cache hit rate**
  (cached-read share of prompt input) + token-based saved + raw read/write.
- **Cumulative, not last-call.** `cache_read`/`cache_creation` log the cumulative
  per-turn totals so cold-start writes (TTL-lapsed first calls) are counted;
  `context_tokens` stays last-call because it sizes the live context gauge. This is
  what makes the hit-rate honest rather than pinned near 100%.
- **`/savings [days]`** command (process-level, no `/newchat`), and a 30-day
  per-agent panel on the dashboard Usage page.
- Telemetry columns populate from the capture-restart forward; historical rows are
  null/0 for the new fields (no backfill).

## 1. Burn-rate & runway  (highest operational value under credits)

- Daily spend rate over a trailing window → project to a **config cap**
  (`MONTHLY_CREDIT_CAP` in `agent.yaml`/`.env`, per Mike's choice) → "at today's rate
  you hit your cap on the 22nd." Threshold pings at 50/80/90%.
- Surface: `/budget` command + a line in the daily digest.

## 2. Metered-bill preview  (most timely — pre-switch value)

- Sum real `cost_usd` over the window → "your last 30d ≈ $N metered," now
  **model-accurate** because we log per-turn `model` (per-agent + per-model
  breakdown shows the expensive lane).
- Honest (logged `cost_usd`, not a flat rate); label as an estimate.
- Open Q (unchanged): confirm what `cost_usd` reflects under the current subscription
  SDK (API-equivalent vs 0) before trusting it.

## 3. Hit-rate KPI + anomaly alerts  (cheap, high-leverage sleeper)

- Headline KPI (cache hit rate): **shipped** — lead metric in `/savings` + panel.
- Anomaly alert (to build): a `schedule-cli` job comparing each agent's rolling hit
  rate against its own baseline; sharp drop pings Mike ("Naomi 90%→15%, likely a
  prompt/model/tool change") — catches a silently broken cache (timestamp in a
  CLAUDE.md, model switch, changed tool set) = money leaking under metering. With the
  new telemetry it can **also** flag latency (`duration_ms`) and error-rate
  (`is_error`) regressions.

## Build order (when triggered)

Ship gate = billing switch re-announced, or Mike's go. Order: **#3 anomaly job** →
**#2 preview** → **#1 runway**. All off `token_usage`; the only new moving part is the
#3 scheduled job. Own branch off `main` → PR (same overlay-test flow).

## Overhead note (for the PR / validation)

Capture is effectively free: values come off the already-parsed SDK result; persistence
is the same per-turn INSERT (wider row); reporting is on-demand or scheduled, on the
indexed `idx_token_usage_chat` path — never on the hot path. `token_usage` grows one
row/turn (already did); a retention/rollup is a trivial future add if volume warrants.

## Technical-depth content angles (posts / videos)

Marketing constraint: **cite only real measured metrics — cache-hit-rate and metered
`cost_usd`. Never claim "savings" as a dollar figure.**

1. **"We deleted our own fake metric."** The hook: we shipped a dollar "savings"
   number, realized it was rate-times-tokens vanity math, and replaced it with honest
   cache-hit-rate + real metered cost. Leading with "we killed our false metric" reads
   as credible where everyone else inflates. (Drummer's lane.)
2. **Caching is Claude Code's, not ours — the edge is utilization + visibility.**
   Prompt caching is an Anthropic/CC feature; a plain CC harness caches identically.
   ClaudeClaw's genuine advantage is (a) *utilization* — persistent always-on agents
   with byte-stable CLAUDE.md prefixes and long-lived sessions keep caches warm and
   reused at high sustained hit rates a cold, ad-hoc CC session rarely reaches; and
   (b) *observability* — per-agent metrics you can actually see. Don't claim CC-vs-CClaw
   caching savings; claim better capture + measurement of it.
3. **A "turn" isn't what you think.** Caching accrues at the API-request level, not the
   conversational turn: one user question fires many tool-call round-trips, and the
   cached prefix is re-read on each. Savings compound *within* a turn and *across* the
   growing conversation prefix — great explainer content.
4. **Cheap, not free; the slope, not the sign.** Caching makes the reused prefix cost
   ~0.1×, but the prefix grows every turn, so cost climbs slower — it doesn't reverse.
   1M context is the hard ceiling; compaction resets the prefix. Honest framing beats
   "it keeps getting cheaper."
5. **Why naive hit-rate metrics lie (the TTL / last-call trap).** The strongest
   technical-depth piece: sampling the last API call of a turn shows ~100% hit because
   the cache is always warm by then; you miss the cold-start write on the first call of
   a turn that began after the 5-min TTL lapsed. Fix = log cumulative per-turn read +
   write. This is a real "measure the right thing" lesson with a concrete before/after.
6. **Metered-billing readiness.** Burn-rate/runway, metered preview, and cache-hit
   regression alerts as the operational suite for when subscription → credits flips —
   position ClaudeClaw as the layer that makes metered spend legible and forecastable.
7. **Observability for ~free.** Capturing per-turn model/latency/turns/stop-reason is
   reading exhaust already in the SDK result — no extra API cost. Good "how we
   instrument without overhead" angle.
8. **Onboarding-flavored comment seeds** (Naomi's note): "what cache-hit-rate actually
   means for your bill" and "how to read it on your own dashboard" — pre-empt the
   power-user honesty pressure-test.

## Out of scope

- Fabricated dollar savings (removed, not coming back).
- Per-turn model rate tables — rely on logged `cost_usd`, don't re-derive.

---

> **Holden's analysis.** The through-line here is honesty over vanity: we shipped a dollar "savings" number, realized it was rate-times-tokens vanity math, and deleted our own fake metric in favor of cache-hit-rate + real metered `cost_usd`. The genuine edge isn't the caching (that's Claude Code's) — it's *utilization* from always-on agents with byte-stable prefixes plus *observability* you can actually see. Leading with "we killed our false metric" reads as credible where everyone else inflates, and it's the right posture for the moment the SDK flips from subscription to credit billing. — Holden
