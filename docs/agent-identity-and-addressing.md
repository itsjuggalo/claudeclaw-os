# Agent identity and addressing

_Living guide. Last reviewed against v1.8.2 on 2026-08-01._

ClaudeClaw uses canonical ids, display names, and aliases to keep agent routing
stable while allowing operators to change the names people see.

Every ClaudeClaw agent has three kinds of name:

| Kind | Example | Mutable? | Role |
| --- | --- | --- | --- |
| **Canonical id** | `main`, `naomi` | No — permanent | The primary key. Every task row, poller, and history record keys off this. |
| **Display name** | `Holden`, `Nova` | Yes (dashboard) | What people and agents see. Set by `name:` in `agent.yaml`. |
| **Alias** | a former display name | Append-only | Kept automatically on rename so old references never break. |

## `--agent` accepts any of the three

The mission and schedule CLIs resolve whatever you pass — canonical id, current
display name, or a historical alias — to the canonical id before storing it.
Matching is case- and whitespace-insensitive.

```bash
# All three route to the same agent whose canonical id is "main":
node dist/mission-cli.js create --agent main   --title "..." "..."
node dist/mission-cli.js create --agent Holden --title "..." "..."   # display name
node dist/mission-cli.js create --agent holden --title "..." "..."   # case-insensitive

node dist/schedule-cli.js create "prompt" "0 9 * * *" --agent Holden
```

Only the **canonical id** is ever written to the database, so a poller's
`WHERE assigned_agent = 'main'` always matches. This closes the old dead-letter
class where dispatching by the display name an agent sees (`--agent holden` when
the id is `main`) wrote a row no poller ever claimed — it failed silently.

## Unknown agents fail loudly (no more dead letters)

If the value doesn't resolve to a known agent, the CLI **exits non-zero, writes
nothing, and names the alternatives**:

```
$ node dist/mission-cli.js create --agent bogus --title "x" "do a thing"
unknown agent 'bogus' — known: main, amos, naomi, drummer, alex
```

The dashboard equivalents (assign, reassign, auto-assign) return a `4xx` with the
same known-list instead of silently accepting a bad value.

## Renames preserve history

When you change an agent's display name (dashboard → agent → Config), the
outgoing name is appended to that agent's `aliases:` list in `agent.yaml`. Because
the canonical id never changes and only the id is stored, **every past reference
keeps resolving forever** — `--agent Naomi` still routes correctly even after
Naomi is renamed to Nova.

Ids, display names, and aliases share one namespace: a create, rename, or
alias-append that would collide with any existing agent's id, display name, or
alias is rejected up front (the error names the collision and the owning agent).
