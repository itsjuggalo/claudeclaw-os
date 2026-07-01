# Phase 2 — Trading Pipeline Reliability — STATUS

Plan: `~/.claude/plans/start-phase-2-binary-cocke.md`. Master: `~/.claude/plans/something-happened-over-the-snappy-canyon.md`.
Started 2026-07-01. HALT+STRESS untouched (active since 06-26). No cron cadence changed. No order path armed.

## Reality vs Codex docs
The 06-27/28 Codex docs were stale. Grounded against the live system today:
- **flow_pulse 400** — root cause was NOT general escaping (already done) but one literal `<ticker>` in the static footer.
- **exit_watcher** — the OCC-format 400 was already RESOLVED; only 429 remained.
- **decipher `--offline`** — the footgun was ALREADY FIXED (guard already in place). Verify-only.

## Shipped + committed (SAFE, verified live)
| Item | Commit | Repo | Proof |
|------|--------|------|-------|
| A. flow_pulse `<ticker>` escape | `87f2dcc` | option-scraper | forced send `sent=True`, was 100% `sent=False`+400 |
| B. logrotate cfg + `current_incidents.py` + 3:30am cron | `440827c` | trading/daemons | forced rotation archived 22MB, daemons kept appending (copytruncate); helper caught 3 live jazzy timeouts |
| C. `lib/http_retry.py` shared wrapper | `ef1296866` | 05_AUTOMATION/scripts | 9/9 fault-injection tests; code-reviewed; POST-retry guard proven |
| C. exit_watcher → wrapper (429 backoff) | `e8c3ddd` | option-scraper | exit 0, polls clean, QuoteRateLimited semantics preserved |

**http_retry contract:** retries GET/DELETE/HEAD only; POST/PUT/PATCH with retries>0 raises ValueError
(no order can double-submit); exp backoff + jitter; Retry-After honored but capped 30s; `get_json()` = drop-in for old `_get`.

## E. decipher `--offline` — VERIFIED, no work
`select_and_size.py:525-543` already guards it: `should_write_picks()` + `--allow-offline-write` danger flag +
`--offline` auto-implies `--dry-run`. Synthetic READY/$2.00-ask picks cannot reach live `decipher_picks`
without the explicit danger flag. Closed.

---

## GATED items

### G1. shock_guard → http_retry  ✅ SHIPPED (`4298cc9bd`, Mike's go 2026-07-01 14:32 ET)
- **File:** `/home/itsju/scripts/shock_guard.py` (→ `05_AUTOMATION/scripts/`), every 2 min via cron.
- Was **38 of 41 today's 429s**. Wired `_get` to the wrapper (`retries=1`) + suppressed the 429 error log
  (real DNS/5xx/timeout still surface). Contract unchanged — a data miss returns None, never triggers a halt.
- **Verified live:** state advances every 2 min (main completes), 3 rapid runs added **0** log lines,
  HALT/STRESS untouched (Jun 26 16:00), DRY fetches real data (VIX 16.41, SPY z, BTC). No cadence change.

### G2. select_and_size → http_retry  ✅ SHIPPED (`4a0478067`, missionctrl main)
- `_get` now `http_retry.get_json(..., retries=3)`. Zero sizing-logic change. Verified: offline dry-run
  respects HALT (0 picks); live reads OK (market_is_open True, account equity read).

### Reporters → http_retry  ✅ SHIPPED
- `grader` + `journal_sync` (`ff6e3c402`) — urllib `_get`/`fills` swapped; verified live.
- `brief_data_fetcher` + `kronos_forecast_v2` (`e5e7f757a`) — requests GETs → `requests_session()`;
  kronos's non-order POST left untouched.

### G3. Order daemons  ✅ WIRED + STAGED (not restarted — watch=False, run old code until `pm2 restart`)
- **`requests_session()` helper** (`fd8f4cd78`): urllib3 Retry, `allowed_methods` excludes POST → order
  submits never auto-retried.
- **6 requests daemons** (`f08900b`): profit_lock boba+jazzy, trail boba+jazzy, alpaca_fill_listener,
  crypto_profit_lock — `requests.get/delete` → `SESSION`; every `requests.post` order submit byte-identical.
- **2 urllib daemons** (`fd6958a`): equity_swing (_get/_delete retry, _post→post_once), auto_bracket
  (api() retries GET/DELETE only). Bonus: fixes auto_bracket's SSL-timeout crash-loop once activated.
- Per file verified: compile, POST count unchanged, 0 stray get/delete, import clean, POST excluded.
- **ACTIVATE:** `pm2 restart <name>` per daemon (Mike's call — recommended after market close or on next
  natural restart). No behavior change to order submission; only GET/DELETE gain retry.

### G4. Order-submit CRON scripts  ✅ SHIPPED (`dc0d85917`, 05_AUTOMATION/scripts, 2026-07-01 ~15:52 ET)
`auto_trader.py`, `position_sell_daemon.py`, `jazzy_decision_cycle.py` — all `requests`-based, so wired via
module-level `SESSION = requests_session()` (POST excluded from `allowed_methods` → order submits are a single
attempt, never auto-retried — same guarantee as `post_once`). Every `requests.post` order path left byte-identical.
- **Live-state correction:** only `jazzy_decision_cycle.py` is actually scheduled (cron 5×/day: 9:46/11:01/12:31/
  14:01/15:31 ET). `auto_trader.py` + `position_sell_daemon.py` are **dormant** (no cron/PM2/.sh launcher) — wired
  anyway (pure additive hardening for if/when reactivated). jazzy's last cycle ran 15:34; next tick 9:46 tomorrow,
  so no live order-code touched mid-session.
- **Verified per file:** py_compile ✓, import ✓ (SESSION object live in all 3), POST counts unchanged (3/2/10),
  0 stray `requests.get/delete`, SESSION excludes POST (`allowed_methods` has no POST). Working tree clean.
- Closes G3's remaining cron-script piece. All order-submit HTTP paths across Phase 2 now hardened.

---

## D. Cadence proposal (PROPOSE-ONLY — no cadence changed)
Data (today): shock_guard **38** 429s, exit_watcher **3**. shock_guard is the entire problem.
Cron contention on `data.alpaca.markets`: decision cycles (5 each boba/jazzy), 7× skill_to_discord, flow_* posters, etc.

Proposals, in ROI order:
1. **shock_guard `/news` poll 2 → 5 min** ✅ SHIPPED (`d06322091`, Mike's go 2026-07-01 15:06 ET). NEWS_POLL_SEC=300, caches headlines between polls; VIX/SPY-z stay at 2 min. Verified: run #2 within 300s skips the poll. ~⅓ fewer shock_guard data calls.
2. **G1 429 log-suppression** ✅ SHIPPED with `4298cc9bd`.
3. **Shared 15–30s quote cache** for the many cron scripts hitting the same snapshots within a minute — bigger project, better fit for Phase 4 (API/proxy hardening). Noted, not proposed for now. *(still open)*

---

## Phase 2 — COMPLETE (2026-07-01)
All items shipped: A–E, G1–G4, reporters, cadence #1/#2. Every order-submit HTTP path (cron + PM2 daemons)
now routes GET/DELETE through retry, POST single-attempt/never-retried. HALT/STRESS untouched (06-26 16:00).

Remaining activation (not code):
- **8 staged PM2 daemons** — `pm2 restart profit-lock-boba profit-lock-jazzy trail-daemon trail-daemon-jazzy
  alpaca-fill-listener crypto-profit-lock-boba crypto-profit-lock-jazzy equity-swing auto-bracket` to load their
  already-committed retry code (queued for 16:01 ET after close; verify online + HALT/STRESS sha256 unchanged).

## Next: Phase 3
- Audit-ledger infra per master plan (`~/.claude/plans/something-happened-over-the-snappy-canyon.md`) — SAFE/additive.
- Deferred to Phase 4: shared 15–30s Alpaca quote cache (many crons hammer the same snapshots → collective 429s).
