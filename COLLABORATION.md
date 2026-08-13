<!--
  Shape source: ~/templates/context-quartet/ (Kashef Context Engineering).
  Third-party install (claudeclaw-os). Mike-overlay only — don't edit upstream code.
-->

# COLLABORATION — claudeclaw-os (local Claude Code → Telegram bridge)

Upstream daemon (earlyaidopters/claudeclaw-os, Mark Kashef). It bridges local Claude Code to
Telegram, providing Mission Control's multi-agent surface (Telegram chat, war room, scheduled
missions, Hive Mind) on `:3141`. We run it, we don't fork its core.

## Processes

```
Telegram / web UI (:3141)
        ↓
PM2 `claudeclaw`  ─┐   both run dist/index.js from this tree
PM2 `mastermc`    ─┘   (twin process, same :3141 surface)
        ↓
store/claudeclaw.db  +  ~/.claudeclaw/ (runtime config)  +  agents/<id>/ (customized upstream files = fork candidates)
```

## Ownership

| Domain | Owner | Don't touch unless |
|---|---|---|
| Daemon core (`src/`, `dist/`) | upstream | never — fork candidate only if forced |
| Customized agents | `agents/<id>/` | you accept the git-pull conflict cost |
| Web build | `npm run build:web` | that's the ONLY deploy step |
| Daemon restart | Mike | **never `pm2 restart claudeclaw`** — his call |
| Fork pages (`/wallets`, `/gallery`) | local overlay | see memory `reference-claudeclaw-dashboard-dev` |

## Notes

- The in-tree `PLAN.md` / `PHASE*-STATUS.md` / `PHASE3-OWNERSHIP-REGISTRY.md` are outputs of
  claudex loops **launched from this cwd**; their subject is `/AIWorkWSL/web/missionctrl`, NOT this daemon.
- Bot ownership: Oracle owns `orion`/`jazzy`/`deepsheet` bots; laptop agent services stay disabled to
  avoid the Telegram 409 dual-poller crash-loop (memory `reference-claudeclaw-bot-ownership`).

## Related

- `CLAUDE.md` — the Mike overlay (mastermc twin, deploy rule, phase-doc pointers). `MEMORY.md` — durable facts.
- `AGENTS.md` is the upstream 9-byte stub (just points to `CLAUDE.md`) — leave it; it's git-tracked and conflicts on pull.
- `~/.claude/projects/-home-itsju/memory/reference-kashef-tooling.md`.
