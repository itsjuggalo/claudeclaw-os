# Backups & Restore (Power Pack 12)

Automated point-in-time backups of `store/claudeclaw.db` via `sqlite3 .backup`. WAL-safe — runs while the orchestrator is live without corrupting the snapshot.

## What's installed

| File | Purpose |
|---|---|
| `scripts/backup.sh` | One-shot backup; called by the timer or manually. |
| `scripts/restore.sh` | Restore from a backup file. Refuses to run while the orchestrator is live. |
| `~/.config/systemd/user/claudeclaw-backup.service` | systemd-user oneshot wrapper around `scripts/backup.sh`. |
| `~/.config/systemd/user/claudeclaw-backup.timer` | Fires every 6 hours; `Persistent=true` so missed runs catch up after reboot. |

Backups land in `~/.claudeclaw-backups/` (mode 700, files 600). Pruned to **30 days** by default.

## Environment overrides

| Variable | Default |
|---|---|
| `CLAUDECLAW_PROJECT_DIR` | `$HOME/claudeclaw-os` |
| `CLAUDECLAW_DB_PATH` | `$CLAUDECLAW_PROJECT_DIR/store/claudeclaw.db` |
| `CLAUDECLAW_BACKUP_DIR` | `$HOME/.claudeclaw-backups` |
| `CLAUDECLAW_BACKUP_RETAIN_DAYS` | `30` |

Export these in `~/.bashrc` (or the service file's `Environment=`) if you want non-default paths/retention.

## Operations

### Trigger a backup now
```bash
systemctl --user start claudeclaw-backup.service
# OR directly:
~/claudeclaw-os/scripts/backup.sh
```

### Check the timer
```bash
systemctl --user list-timers claudeclaw-backup.timer
journalctl --user -u claudeclaw-backup.service -n 20
```

### List available backups
```bash
ls -lht ~/.claudeclaw-backups/claudeclaw_*.db | head
```

### Restore from a backup
```bash
# 1. Stop the orchestrator first (restore.sh refuses to run if PID is live)
npm run uninstall    # or: kill -TERM $(cat store/claudeclaw.pid)

# 2. Run restore (creates a pre-restore safety snapshot in ~/.claudeclaw-backups/pre-restore/)
~/claudeclaw-os/scripts/restore.sh ~/.claudeclaw-backups/claudeclaw_20260522_213049.db

# 3. Restart
npm run setup   # or your usual startup command
```

### Pause / disable the timer
```bash
systemctl --user stop claudeclaw-backup.timer       # pause until next reboot
systemctl --user disable --now claudeclaw-backup.timer  # disable permanently
```

## Verification

A backup is valid if `sqlite3 <file>.db "PRAGMA integrity_check;"` returns `ok` and `SELECT COUNT(*) FROM sqlite_master WHERE type='table'` returns the expected table count (currently 30 tables in V3).

## Failure modes & responses

| Symptom | Cause | Fix |
|---|---|---|
| `[backup] ERROR: DB not found` | Project moved or `CLAUDECLAW_DB_PATH` mis-set | Set env vars or symlink the DB |
| Timer shows `NEXT: -` after enable | Daemon not reloaded | `systemctl --user daemon-reload` |
| Backups not pruning | `mtime` updated by sync tools (rsync without `-a`) | Use `find -mtime` workaround or switch retention to filename-date parsing |
| Restore says "REFUSED: claudeclaw appears to be running" | PID file present and process alive | Stop the orchestrator first; remove stale `store/claudeclaw.pid` if process is dead |
| WAL file is huge (>100MB) and growing | Long-running write txn or checkpoint blocked | `sqlite3 store/claudeclaw.db "PRAGMA wal_checkpoint(TRUNCATE);"` |

## Future enhancements (not installed yet)

- **Off-site sync**: rsync `~/.claudeclaw-backups/` to `openclaw` (Oracle failover) on a slower cadence (daily). Add as a second systemd timer.
- **Encrypted backups**: pipe through `age` or `gpg` before writing to disk. Useful if backups sync to a shared location.
- **Integrity check in the backup pipeline**: run `PRAGMA integrity_check` post-backup and `mv` to `bad-backups/` if it fails.
