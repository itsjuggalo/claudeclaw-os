#!/usr/bin/env python3
"""Patch profit-lock + trail daemons to use the CURRENT Alpaca account IDs.

The migration to new Alpaca paper accounts (Boba R2 → PA34WLDYTCMV,
Jazzy → PA3ST95DAKQ4) left the old hardcoded EXPECTED_ACCOUNT constants in
place. The daemons refuse to run on account-mismatch, so they've been silently
unable to start since migration. This patch fixes the constants.

Idempotent — validates syntax + skips if already patched. Backups: *.acct-fix.<ts>
"""
import ast
import re
import shutil
from datetime import datetime
from pathlib import Path

# (file, old_id, new_id, description)
PATCHES = [
    ("/home/ubuntu/scripts/profit_lock_daemon.py",
     "PA3OVUKWYHVC", "PA34WLDYTCMV", "Boba R2 (profit_lock_daemon)"),
    ("/home/ubuntu/scripts/profit_lock_daemon_jazzy.py",
     "PA3AZU6NZNLZ", "PA3ST95DAKQ4", "Jazzy (profit_lock_daemon_jazzy)"),
    ("/home/ubuntu/scripts/trail_daemon.py",
     "PA3OVUKWYHVC", "PA34WLDYTCMV", "Boba R2 (trail_daemon — constant, no enforcement)"),
]


def patch_one(path_str: str, old_id: str, new_id: str, label: str) -> str:
    path = Path(path_str)
    if not path.exists():
        return f"[{path.name}] missing"
    text = path.read_text(encoding="utf-8")
    if new_id in text and old_id not in text:
        return f"[{path.name}] already updated to {new_id}"
    if old_id not in text:
        return f"[{path.name}] old id {old_id} not found — bailing"
    # Replace ONLY the constant + docstring mentions, not random matches.
    new_text = text.replace(old_id, new_id)
    try:
        ast.parse(new_text)
    except SyntaxError as e:
        return f"[{path.name}] ERR syntax: {e}"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(path.suffix + f".acct-fix.{ts}")
    shutil.copy2(path, backup)
    path.write_text(new_text, encoding="utf-8")
    return f"[{path.name}] PATCHED {label} — backup: {backup.name}"


for path, old, new, label in PATCHES:
    print(patch_one(path, old, new, label))
