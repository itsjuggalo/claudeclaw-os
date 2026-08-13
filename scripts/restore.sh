#!/usr/bin/env bash
# claudeclaw-os — Pack 12: SQLite restore from a backup file
# REFUSES to run while the orchestrator is live. You must stop it first.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup_file>"
  echo ""
  echo "Available backups:"
  ls -1t "${CLAUDECLAW_BACKUP_DIR:-$HOME/.claudeclaw-backups}"/claudeclaw_*.db 2>/dev/null | head -10
  exit 64
fi

BACKUP_FILE="$1"
PROJECT_DIR="${CLAUDECLAW_PROJECT_DIR:-$HOME/claudeclaw-os}"
DB_PATH="${CLAUDECLAW_DB_PATH:-$PROJECT_DIR/store/claudeclaw.db}"
PID_FILE="$(dirname "$DB_PATH")/claudeclaw.pid"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[restore] ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

# Liveness check — refuse if the orchestrator is running
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "[restore] REFUSED: claudeclaw appears to be running (pid=$PID)." >&2
    echo "[restore] Stop it first:  npm run uninstall  (or kill -TERM $PID)" >&2
    exit 1
  fi
fi

# Pre-flight: snapshot the current DB before overwriting
SAFETY_STAMP=$(date +%Y%m%d_%H%M%S)
SAFETY_DIR="${CLAUDECLAW_BACKUP_DIR:-$HOME/.claudeclaw-backups}/pre-restore"
mkdir -p "$SAFETY_DIR" && chmod 700 "$SAFETY_DIR"
if [[ -f "$DB_PATH" ]]; then
  cp -p "$DB_PATH" "$SAFETY_DIR/claudeclaw_pre_restore_${SAFETY_STAMP}.db"
  [[ -f "${DB_PATH}-wal" ]] && cp -p "${DB_PATH}-wal" "$SAFETY_DIR/" || true
  [[ -f "${DB_PATH}-shm" ]] && cp -p "${DB_PATH}-shm" "$SAFETY_DIR/" || true
  echo "[restore] safety snapshot: $SAFETY_DIR/claudeclaw_pre_restore_${SAFETY_STAMP}.db"
fi

# Clear stale WAL/SHM files so SQLite reopens cleanly
rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"

# Atomic replace
TMP="${DB_PATH}.restore.tmp.$$"
cp "$BACKUP_FILE" "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$DB_PATH"

echo "[restore] OK: restored from $BACKUP_FILE → $DB_PATH"
echo "[restore] Restart claudeclaw now."
