# Phase 1 — Dashboard Truth-in-UI — STATUS (paused 2026-07-01 ~12:30 ET)

## Where we are
- Plan LOCKED (Codex 3-round plan review, highs 2→1→0): `/AIWorkWSL/agents/claudeclaw/PLAN.md`
- All 6 Phase-1 items IMPLEMENTED in `/AIWorkWSL/web/missionctrl/src/`
- `npm run build` PASSED (exit 0). `tsc --noEmit` clean. My 5 edited files lint-clean (CommandCenterPage's `any` errors are PRE-EXISTING, not mine, and don't gate the build).
- **NOT DEPLOYED** — no `pm2 restart missionctrl` yet. Live `:3000` still serves the old build. Zero live risk.
- HALT + STRESS still active (untouched). No trade/cron/PM2 changes made.

## Files changed (working tree + partially in autocommit 85d7f1755)
- `src/app/api/btc-bias/route.ts` — proxy-first; read from `process.cwd()/btc-bias/btc-bias.json` (was a nonexistent path → widget was stuck loading); `jsonWithAsOf` on success+fallback.
- `src/app/api/boba-journal/route.ts` — per-source missing-vs-error status; `asOf`=max mtime of OK sources only; enveloped.
- `src/lib/freshness.ts` — DATA_SOURCES += `spy-scalp` (120s, marketHoursOnly) + `btc-bias` (retired, writer unscheduled since May-17); documented the excluded live aggregators.
- `src/components/widgets/BestOptionsWidget.tsx` — `useFreshData`; payload-error thrown in transform (retains last-good); 3 empty states.
- `src/components/pages/dashboard/Signal8Bands.tsx` — MarketRibbon badge + partial-quotes count (no market-hours idle, has 24/7 BTC); AlertFeed `options-flow` badge.
- `src/components/pages/CommandCenterPage.tsx` — watchlist verdict tooltip: per-source provenance; math unchanged.

## Codex diff review (2026-07-01, read-only) — NO HIGH. Fix next session BEFORE deploy:
**Medium**
1. btc-bias: proxied path still returns upstream bytes unchanged → old upstream could emit bare body. Normalize missing asOf/servedAt after `proxyToServeftp`. (Low real risk — laptop is only live origin.)
2. boba-journal: valid JSON with WRONG shape (e.g. `{}`) still reads `status:ok` → fresh-empty. Add a shape check (expect array) → treat non-array as `error`.
3. MarketRibbon: `/api/market` can return per-quote `stale:true` (cache fallback); ribbon ignores it. Add a cached/stale indicator per quote or a ribbon-level "cached" chip.
4. BestOptionsWidget HEADER variant: shows retained picks with NO stale marker on error/stale (sidebar has `staleChip`, header doesn't). Add a small marker to header variant.
**Low**
5. CommandCenterPage provenance is source-OBJECT based, not FIELD-presence based: if `analyst` exists w/o `buyPct` (or `insider` w/o `direction`) tooltip shows `undefined` not `n/a`. Guard each field.
6. Plan deviation: `src/components/ui/BTCBiasWidget.tsx` was NOT converted to useFreshData (F8's widget half). Route is done; widget still hand-rolls polling + shows no asOf/stale. Finish it.

## Next-session order
1. Apply the 6 review fixes above (all small, all in files already touched).
2. `npm run build` → dry-run `curl -s localhost:3000/api/data-health | jq` (confirm spy-scalp not false-red, btc-bias shows retired, execution-log ABSENT).
3. `pm2 restart missionctrl` (seconds-long blip; fine mid-session), then smoke-check `:3000`.
4. ONE focused commit: "Phase 1: dashboard truth-in-UI freshness (data-health coverage, badges, envelopes)".
5. Move to Phase 2 (trading pipeline reliability) per master plan `~/.claude/plans/something-happened-over-the-snappy-canyon.md`.

## Notes
- Master plan / all 8 phases: `~/.claude/plans/something-happened-over-the-snappy-canyon.md`
- Codex source folder: `~/restructure/CODEX-Trading Ops GPT Improvements/` (start `claude-ready-plans/CLAUDE-START-HERE.md`)
- claudex plan loop id (done): 20260701-153159-b7daf5
- Don't revert missionctrl dirty files `public/alerts.html`, `pinescript-agents` (in-progress, other work).
- The 30-min auto-snapshot cron WILL commit in-progress edits — expected, not a problem.
