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

## The audit gap: exits are unlogged  → ✅ CLOSED (2026-07-01)
The `alpaca_decision_ledger` (Phase 3 core, built 06-28) originally captured **entries only**, from 3 systems.
**Exit-logging is now wired** across every Alpaca exit manager via a crash-proof shim
(`pipeline/ledger_log.py` — `log_ledger()` NEVER raises into an order path, logs only after the action).

Instrumented (14 processes, all append intent=exit/protect/cancel now):
`profit-lock-boba/jazzy`, `trail-daemon/jazzy`, `crypto-profit-lock-boba/jazzy`, `auto-bracket`,
`equity-swing`, `regime-trader`, `grid-daemon`, `alpaca-fill-listener`, `decipher_execute --manage-only`,
`boba/jazzy_decision_cycle` (Layer-2 TRIM/EXIT). Commits: daemons `a3c1116`, missionctrl `bce9a0877`,
decision cycles `6061e1257`/`c9a74df63`. Verified: all compile + import clean, order POSTs byte-identical,
12 PM2 daemons restarted clean (looping, positions read), e2e write path confirmed, HALT/STRESS untouched.

Remaining ledger-blind (**by design** — non-Alpaca, separate ledgers): `aries:bracket-guard`
(Coinbase/Robinhood) and `jesse_live_trader` (localpaper/Coinbase). The overlap map is now backed by live
"who actually closed it" evidence as exits fire.

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
3. ~~**Ledger the exits.**~~ ✅ DONE (see "audit gap CLOSED" above) — all 14 Alpaca exit managers now log.
4. **Daily missed-gains / double-hit report** off the ledger now that exits are logged (SAFE, next). With
   both entries and exits recorded, a report can flag when ≥2 managers closed the same position within N
   seconds (the overlap risk, now measurable) and which system saw a mover first.

## Provenance
Enumerated via 3 read-only source-trace agents (2026-07-01):
`/tmp/.../scratchpad/trace_pm2.md`, `trace_cron.md` (inline), `trace_decipher.md`. Live cross-check:
`pm2 list` (74 online), `crontab -l`, Alpaca `/v2/account`. HALT/STRESS untouched throughout (06-26 16:00).

## Addendum — 2026-07-01 evening adversarial verify (post-ship)
An independent read-only verifier audited this registry against live code. Corrections applied:
- **`cron:exit_monitor` was MISSING** — the ±50% auto-closer for `cron:alpaca_straddle` legs
  (`/AIWorkWSL/labs/quantum/src/exit_monitor.py`, cron `*/5 9-16 ET`, armed via QUANTUM_EXIT_ARM).
  Added as row 25; it raises **boba-option-exit to 8 exit claimants** (was 7).
- **`cron:alpaca_straddle` + `cron:exit_monitor` are now ledger-instrumented** (enter/exit
  submitted|rejected via ledger_log, same post-order crash-proof pattern) and flagged ledger_aware=1.
- **`cron:jesse_live_trader` caveat**: has a dormant optional `broker:'alpaca'` long-only leg
  (armed=[] today). Note added — instrument before ever arming that leg.
- **Write-path proof**: `pipeline/ledger_smoke.py` writes one environment='dry_run' row per
  (manager, intent) — 29/29 pairs land. The ledger had ZERO real exit rows at verify time because
  the global HALT (06-26) means no positions exist; production proof requires HALT clear + positions.
  Re-check after: `SELECT source_system,intent,COUNT(*) FROM alpaca_decision_ledger WHERE intent IN
  ('exit','protect','cancel') AND environment='paper' GROUP BY 1,2;`
