# Phase 3 — Manager-Ownership Registry  [SAFE / read-only audit + additive DB]

Master plan: `~/.claude/plans/something-happened-over-the-snappy-canyon.md` (Phase 3).
Built 2026-07-01. **Zero trading writes** — produced by reading source + `pm2 list` / `crontab -l`
+ Alpaca `/v2/account` (account-number confirmation only). No order was placed, cancelled, or modified.

## What this is
The Phase-3 deliverable that was missing: an enumeration of **every PM2/cron process that can submit,
protect, cancel, or close an Alpaca order**, classified by account, instrument, verb, and
position-selection — so *who owns each position's exit* is explicit and queryable before any
trade-changing (Phase 5) work.

Artifacts:
- `missionctrl/pipeline/db_schemas/manager_ownership_registry_schema.sql` — additive reference table.
- `missionctrl/pipeline/manager_registry_load.py` — holds the audited data; upserts by process_name; re-run to refresh.
- Table `manager_ownership_registry` in `pipeline/alpaca_decision_ledger.sqlite` (24 rows).

## Account facts (confirmed live 2026-07-01)
| Account | Number | Secrets | Note |
|---|---|---|---|
| Boba R2 | `PA3W2OF36UVX` | `alpaca-boba-key-id` **and** `alpaca-key-id` (symlink → boba) | "default" bare keys = Boba |
| Jazzy | `PA3V3XX47JLY` | `alpaca-jazzy-key-id` | |
| R1 | retired | `*.deleted-may3` | — |

Everything is **paper** (`paper-api.alpaca.markets`). ARIES bracket-guard is a separate domain (Coinbase/Robinhood).

## The exit-ownership overlap map (the headline)
Count = number of order-placing managers that can close a position in that zone.

| Zone | Exit claimants | Whole-account (can hit ANY position) | Self/tag-scoped |
|---|---|---|---|
| **Boba R2 options** | **7** | profit-lock-boba, trail-daemon, decipher_execute:manage, boba_decision_cycle (L2), auto-bracket | best3_executor (tag), spy_scalp (own SPY 0DTE) |
| **Jazzy options** | **6** | profit-lock-jazzy, trail-daemon-jazzy, decipher_execute:manage, jazzy_decision_cycle (L2), auto-bracket | best3_executor (tag) |
| **Boba crypto (BTC/USD)** | **3** | crypto-profit-lock-boba, regime-trader, auto-bracket | — |
| **Jazzy crypto** | 2 | crypto-profit-lock-jazzy, auto-bracket | — |
| **Jazzy equity** | 2 | equity-swing (watchlist), auto-bracket | — |
| **Boba equity grid (SOFI)** | 2 | grid-daemon (own lots), auto-bracket | — |

**Concrete collision risks:**
1. **Boba/Jazzy single-leg options are triple+-claimed.** decipher `--manage-only` (*/2 min), the PM2
   `trail-daemon*`, and `profit-lock-*` all trail/exit the SAME positions with the SAME secrets — **none
   pick-scoped** (decipher defaults 60/30 TP/SL for non-decipher symbols; trail builds pos_map from ALL
   positions; profit-lock iterates all options). Whoever's cadence fires first sells, at different giveback params.
2. **Cancel-then-sell races.** decipher `_close_qty`/`reconcile_orphans` cancel *any* resting sell (incl. the
   stop a daemon just armed) before market-selling; the daemon re-arms; decipher re-reads it as an orphan.
   Flapping orders + transient naked windows.
3. **Conflicting stop layers.** decipher arms a GTC `stop_limit` at entry; `trail-daemon` arms its own ratchet
   stop on the same qty → Alpaca reserves sell-side qty, the second is rejected or steals it; each sees the
   other's order as an orphan. `alpaca-fill-listener` is the intended orphan-canceller, but was designed before
   auto-bracket joined the mix.
4. **auto-bracket is the structural common denominator.** It acts on **every** open position on **both**
   accounts across **all** instruments, every **6s**, with **no account-number assert and no killswitch file**
   — it overlaps all 9 other exit-capable managers. A -8%/+16% market-close can fire before/against any resting
   stop the other managers armed.
5. **Boba BTC/USD has 3 independent `DELETE /v2/positions` triggers** (regime stop/TP, crypto trail-lock,
   auto-bracket ±8/16) racing on one position — first wins, the rest error on the now-gone position.

## The audit gap: exits are unlogged
The `alpaca_decision_ledger` (Phase 3 core, built 06-28) captures **entries only**, from 3 systems
(`decipher_select_and_size`, `spy_scalp_autotrader`, `best3_executor` alert_only). **15 of 15 order-placing
exit managers write nothing to the ledger** — every exit/protect/cancel above is ledger-blind. There is no
append-only record of *why* a position was closed or *which* of the 7 claimants closed it.

## Query it
```sql
-- who can close a Boba option right now?
SELECT process_name, cadence, guard FROM manager_ownership_registry
WHERE verb_exit=1 AND (','||overlap_group||',') LIKE '%,boba-option-exit,%';

-- which order-placing exit managers are ledger-blind?
SELECT process_name FROM manager_ownership_registry WHERE verb_exit=1 AND ledger_aware=0;
```

## Recommended next (Phase 3 finish → Phase 5 inputs)
All SAFE/additive except where noted GATED:
1. **Assign single exit owner per zone.** Decide who owns Boba/Jazzy option exits (recommend: decipher
   `--manage-only` OR the PM2 daemons, not both) and scope the others to their own picks. **GATED (Phase 5,
   trade-changing).**
2. **Add a killswitch + account-number assert to `auto-bracket`**, and consider narrowing it to positions not
   already managed by a scoped owner. **GATED.**
3. **Ledger the exits.** Wire `trail-daemon*`, `profit-lock-*`, decipher `--manage-only`, `auto-bracket` to
   append `intent=exit/protect/cancel` rows to `alpaca_decision_ledger` (logging-only → SAFE, Phase 3). Turns
   the overlap map from static audit into live "who actually closed it" evidence.
4. **Daily missed-gains / double-hit report** off the ledger once exits are logged (SAFE).

## Provenance
Enumerated via 3 read-only source-trace agents (2026-07-01):
`/tmp/.../scratchpad/trace_pm2.md`, `trace_cron.md` (inline), `trace_decipher.md`. Live cross-check:
`pm2 list` (74 online), `crontab -l`, Alpaca `/v2/account`. HALT/STRESS untouched throughout (06-26 16:00).
