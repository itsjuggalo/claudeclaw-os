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

### DEFERRED — order-submit CRON scripts [market-closed + dry-run, per doctrine]
`auto_trader`, `position_sell_daemon`, `jazzy_decision_cycle` submit paper orders and run via **cron**
(edits go live on the next tick, not staged like PM2). Editing live order-submit code mid-market is the
one tiered-STOP line. Do these market-closed: GET→get_json(retry), POST→post_once(retries=0). ~1 hr of work.

---

## D. Cadence proposal (PROPOSE-ONLY — no cadence changed)
Data (today): shock_guard **38** 429s, exit_watcher **3**. shock_guard is the entire problem.
Cron contention on `data.alpaca.markets`: decision cycles (5 each boba/jazzy), 7× skill_to_discord, flow_* posters, etc.

Proposals, in ROI order:
1. **shock_guard `/news` poll 2 → 5 min** ✅ SHIPPED (`d06322091`, Mike's go 2026-07-01 15:06 ET). NEWS_POLL_SEC=300, caches headlines between polls; VIX/SPY-z stay at 2 min. Verified: run #2 within 300s skips the poll. ~⅓ fewer shock_guard data calls.
2. **G1 429 log-suppression** ✅ SHIPPED with `4298cc9bd`.
3. **Shared 15–30s quote cache** for the many cron scripts hitting the same snapshots within a minute — bigger project, better fit for Phase 4 (API/proxy hardening). Noted, not proposed for now. *(still open)*

---

## Next session picks up
1. Get Mike's go on G1 (+ cadence #1) → G2 → G3 per-daemon. Stage, paper dry-run, review, commit, verify.
2. Optionally wire the 4 safe reporters.
3. Verification per item: injected-fault behavior, byte-identical daemon output on clean run, induced-429 backs off, HALT/STRESS still active.
