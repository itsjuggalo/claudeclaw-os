#!/usr/bin/env bash
# claudeclaw-os — Pack 12: SQLite point-in-time backup (WAL-safe)
# Uses sqlite3 .backup which produces a consistent snapshot even while
# the database is being written.

set -euo pipefail

PROJECT_DIR="${CLAUDECLAW_PROJECT_DIR:-$HOME/claudeclaw-os}"
DB_PATH="${CLAUDECLAW_DB_PATH:-$PROJECT_DIR/store/claudeclaw.db}"
BACKUP_DIR="${CLAUDECLAW_BACKUP_DIR:-$HOME/.claudeclaw-backups}"
RETAIN_DAYS="${CLAUDECLAW_BACKUP_RETAIN_DAYS:-30}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "[backup] ERROR: DB not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/claudeclaw_${STAMP}.db"

sqlite3 "$DB_PATH" ".backup '$OUT'"
chmod 600 "$OUT"

SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
echo "[backup] $(date -Iseconds) wrote $OUT (${SIZE} bytes)"

find "$BACKUP_DIR" -name 'claudeclaw_*.db' -type f -mtime "+${RETAIN_DAYS}" -delete -print | \
  sed 's/^/[backup] pruned: /'

echo "[backup] retention: ${RETAIN_DAYS} days; backups in $BACKUP_DIR:"
ls -1t "$BACKUP_DIR"/claudeclaw_*.db 2>/dev/null | head -5
