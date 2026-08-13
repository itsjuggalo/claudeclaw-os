<!--
  Shape source: ~/templates/context-quartet/ (Kashef Context Engineering).
  Durable facts about the claudeclaw-os install. Operator memory: ~/.claude/projects/-home-itsju/memory/.
-->

# MEMORY — claudeclaw-os (third-party install)

Long-lived facts about this tree. Not operator memory.

## Runtime (reality)

- **Upstream:** https://github.com/earlyaidopters/claudeclaw-os (Mark Kashef). Don't modify core code.
- **Location:** `/AIWorkWSL/agents/claudeclaw` (aliased `~/claudeclaw-os`).
- **PM2 (two processes):** `claudeclaw` AND twin `mastermc` — both run `dist/index.js` from this tree, both on the `:3141` surface.
- **Deploy:** `npm run build:web` (Vite web build) ONLY. **NEVER `pm2 restart claudeclaw`** — Mike's rule; the daemon restart is his call.
- **Build scripts:** `build:web` = `vite build`; `build:server` = `tsc`; `build` = both.

## Persistent state

- **DB:** `store/claudeclaw.db` (DAEMON_DB resolves via the `~/claudeclaw-os` symlink).
- **Runtime config:** `~/.claudeclaw/`.
- **Env:** `.env` (600) in this dir. Never paste secrets here.
- **Customized agents:** `agents/<id>/` are upstream files with local edits — fork candidates, conflict on `git pull`.

## In-tree docs (Jul-2026)

`PLAN.md`, `PHASE1-STATUS.md`, `PHASE2-STATUS.md`, `PHASE3-OWNERSHIP-REGISTRY.md` — outputs of claudex
loops launched from this cwd. Their subject is `/AIWorkWSL/web/missionctrl`, **not** this daemon.

## Don't break

- No `pm2 restart claudeclaw` (or `mastermc`) — Mike restarts the daemon himself.
- Laptop agent services stay disabled — Oracle owns the `orion`/`jazzy`/`deepsheet` bots; re-enabling causes a Telegram 409 dual-poller crash-loop.
- Fork pages `/wallets` + `/gallery` are local overlays (real-money balances) — see memory `reference-wallets-moved-to-claudeclaw` + `reference-claudeclaw-dashboard-dev`.
- **Don't edit `AGENTS.md`** — it's the upstream 9-byte stub (git-tracked, last touched by upstream PR #58), conflicts on `git pull`. All local overlay notes go in `CLAUDE.md` (which is gitignored = safe Mike overlay). `COLLABORATION.md`/`MEMORY.md` are new untracked Mike files.
