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

### G2. select_and_size → http_retry  [decision/sizing engine]
- **File:** `/AIWorkWSL/web/missionctrl/pipeline/decipher/select_and_size.py`, decipher cron `--live`.
- **Change:** swap `_get` body (line 108) to `http_retry.get_json(url, headers=h, timeout=8, retries=3)`.
  Zero sizing-logic change — pure reliability on the clock/account/quote reads.
- **Why gated:** it's the file that writes `decipher_picks` the executor consumes.

### G3. DELETE + order-POST daemons  [tier 2/3, per-daemon go]
- DELETE/cancel (retry-safe): `profit_lock_daemon` cancels, `alpaca_fill_listener`, `jazzy_decision_cycle` deletes.
- Order-POST (wrap for error structure, **retries=0, never retry**): `auto_trader`, `position_sell_daemon`,
  `profit_lock_daemon.place_stop_limit`, `trail_daemon{,_jazzy}`. One daemon at a time, paper dry-run diff first.

### Safe follow-on (not gated, just deferred — ~0 logged 429s, low ROI now)
Read-only reporters `brief_data_fetcher`, `journal_sync`, `grader`, `kronos_forecast_v2` → swap `_get`
to `http_retry.get_json`. Pure standardization, deployable after dry-run whenever. Say the word.

---

## D. Cadence proposal (PROPOSE-ONLY — no cadence changed)
Data (today): shock_guard **38** 429s, exit_watcher **3**. shock_guard is the entire problem.
Cron contention on `data.alpaca.markets`: decision cycles (5 each boba/jazzy), 7× skill_to_discord, flow_* posters, etc.

Proposals, in ROI order (each needs Mike's go — all are cadence/behavior changes):
1. **shock_guard `/news` poll 2 → 5 min** (news is slow-moving; VIX/SPY-z stay at 2 min for shock latency). ~40% fewer shock_guard data calls. *(pairs with G1)*
2. **G1 backoff-skip on 429** — ships the moment G1 is approved; kills the 38/day log spam immediately, no cadence change.
3. **Shared 15–30s quote cache** for the many cron scripts hitting the same snapshots within a minute — bigger project, better fit for Phase 4 (API/proxy hardening). Noted, not proposed for now.

---

## Next session picks up
1. Get Mike's go on G1 (+ cadence #1) → G2 → G3 per-daemon. Stage, paper dry-run, review, commit, verify.
2. Optionally wire the 4 safe reporters.
3. Verification per item: injected-fault behavior, byte-identical daemon output on clean run, induced-429 backs off, HALT/STRESS still active.
