# mc-kb-oracle — Oracle-side companion for the hive-mind bridge

Scripts that get deployed to the Oracle VPS (openclaw) so the trading agents (Boba + Jazzy) can:

1. **Read** identity + critical memories from the laptop's mc-kb RAG layer at each decision cycle
2. **Write** decision-cycle outcomes back to the daemon's `hive_mind` table so they show up in the **/hive** page
3. **Receive fresh signals** via a thin shim that converts Firebase RTDB output into Boba's expected sidecar format

The laptop is the hub; Oracle is failover. The reverse SSH tunnel (`mc-kb-tunnel.service`) forwards Oracle's `127.0.0.1:8091` to the laptop's local mc-kb HTTP server.

## Architecture

```
[laptop]                                       [Oracle / openclaw]
  ~/mc-kb/server.py (port 8091)  <─SSH tunnel─>  127.0.0.1:8091
  + LanceDB kb.vectors                           │
  + daemon SQLite (memories, hive_mind)          ▼
                                          mc_kb_client.recall()   ──┐
                                          mc_kb_client.log_event() ─┤── used by patches in
                                                                    │   boba_decision_cycle.py
                                                                    │   jazzy_decision_cycle.py
                                          firebase_to_scored.py ────┘
                                          (cron every 2 min, refreshes
                                           scored_signals_recent.json
                                           from firebase_trade_signals.json)
```

## File map

| File | Type | Purpose |
|---|---|---|
| `mc_kb_client.py` | helper module | `recall(query, tiers, top, timeout)` → Markdown block of mc-kb hits; `log_event(agent_id, action, summary, artifacts)` → POST to `/hive/log`; never raises |
| `firebase_to_scored.py` | shim | Convert Firebase trade-signal feed to Boba's scored-signal schema; designed to replace the dead `signal-receiver/flow_scorer` pipeline |
| `patch_boba_jazzy.py` | one-shot | Adds `_mc_kb_recall()` helper + wires into prompt assembly for boba_decision_cycle.py (v1) |
| `patch_jazzy.py` | one-shot | Same as above but for jazzy_decision_cycle.py's inline HTTP API pattern |
| `patch_log_event.py` | one-shot | Inserts `_mc_kb_recall.log_event()` call at the end of each cycle's `main()` (post-Claude) |
| `patch_recall_v2.py` | one-shot | Upgrades `_mc_kb_recall()` to ticker-aware: pulls top-5 flow tickers from SQL + uses them in the RAG query |
| `patch_recall_sql_fix.py` | one-shot hotfix | Corrects SQL column names (`flow_value`/`captured_at` not `premium`/`created_at`) in the v2 helper |

## Deploy from scratch

```bash
# 1. Sync the helpers to Oracle
scp scripts/mc-kb-oracle/mc_kb_client.py openclaw:/home/ubuntu/scripts/
scp scripts/mc-kb-oracle/firebase_to_scored.py openclaw:/home/ubuntu/scripts/

# 2. Apply patches (idempotent — re-runs are safe; "already patched" message returned)
scp scripts/mc-kb-oracle/patch_*.py openclaw:/tmp/
ssh openclaw '
  python3 /tmp/patch_boba_jazzy.py   # v1: wire _mc_kb_recall into prompt
  python3 /tmp/patch_jazzy.py        # Jazzy uses inline HTTP API, needs separate patch
  python3 /tmp/patch_log_event.py    # log to /hive after each cycle
  python3 /tmp/patch_recall_v2.py    # ticker-aware + top-flow injection
  python3 /tmp/patch_recall_sql_fix.py  # SQL column name fix on top of v2
'

# 3. Add the shim cron (every 2 min, refreshes Boba's input feed)
ssh openclaw '(crontab -l 2>/dev/null | grep -v firebase_to_scored.py; \
  echo "*/2 * * * * /usr/bin/python3 /home/ubuntu/scripts/firebase_to_scored.py >/dev/null 2>&1") | crontab -'

# 4. The next decision cycle (PM2 cron-restart) picks up the patches automatically.
#    Force-restart if you want immediate:
ssh openclaw '/home/ubuntu/.npm-global/bin/pm2 restart boba-decision-cycle jazzy-decision-cycle'
```

## Smoke test

```bash
# Verify mc-kb tunnel reachable from Oracle
ssh openclaw 'curl -s http://127.0.0.1:8091/health'
#   → {"status":"ok","chunks":392,...}

# Verify recall returns ticker-aware output
ssh openclaw 'python3 -c "
import sys; sys.path.insert(0, \"/home/ubuntu/scripts\")
from boba_decision_cycle import _mc_kb_recall
print(_mc_kb_recall()[:1500])
"'
#   → "## Top flow tickers (last 24h, by flow value)
#       - **SPX**: 11 alerts, $91,704,173 flow ..."

# Verify shim produces fresh signals
ssh openclaw 'python3 /home/ubuntu/scripts/firebase_to_scored.py'
#   → {"converted": N, "by_day": {"YYYY-MM-DD": N}}
```

## Failure modes + rollback

Every patch creates a timestamped backup before editing — restore from the most recent:

```bash
ssh openclaw '
  cd /home/ubuntu/scripts
  ls -t boba_decision_cycle.py.mc-kb-*  | head -1 | xargs -I{} cp {} boba_decision_cycle.py
  ls -t jazzy_decision_cycle.py.mc-kb-* | head -1 | xargs -I{} cp {} jazzy_decision_cycle.py
  /home/ubuntu/.npm-global/bin/pm2 restart boba-decision-cycle jazzy-decision-cycle
'
# Remove the shim cron:
ssh openclaw '(crontab -l | grep -v firebase_to_scored.py) | crontab -'
```

Naming convention for backups:
- `*.mc-kb-pre.<ts>` — from patch_boba_jazzy / patch_jazzy (v1 wire-in)
- `*.mc-kb-log.<ts>` — from patch_log_event (adds log_event)
- `*.mc-kb-recall-v2.<ts>` — from patch_recall_v2 (ticker-aware upgrade)
- `*.mc-kb-sql-fix.<ts>` — from patch_recall_sql_fix (column name hotfix)

## Why these scripts live in claudeclaw-os

The Oracle-side patches read from + write to the daemon's databases (memories + hive_mind tables). They're functionally part of the laptop's `/mckb` and `/hive` integration, even though they execute on Oracle. Keeping them in this repo means a fresh hive-mind setup is one PR-clone away.

## Out of scope (don't expect this to handle)

- **Multi-tenant support** — paths are hard-coded to `/home/ubuntu/...` and the Oracle hostname `openclaw` is assumed in places
- **Discovering boba/jazzy module structure** — the patch scripts use regex anchors that match the current decision-cycle layout; major refactors of `call_boba`/`call_jazzy` will break them and need updated anchors
- **Scoring quality** — `firebase_to_scored.py` uses heuristic scores (SWING=80, SCALP=70, modulated by risk). For richer scoring, restart the real `signal-receiver` PM2 process when it's ready, or fold the logic from `flow_scorer.py` into the shim
