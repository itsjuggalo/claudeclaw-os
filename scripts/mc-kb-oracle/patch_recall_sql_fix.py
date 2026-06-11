#!/usr/bin/env python3
"""Hotfix for patch_recall_v2: correct the SQL column names in _mc_kb_recall().

The v2 patch assumed columns `premium` and `created_at` — actual schema uses
`flow_value` and `captured_at`. This targeted edit replaces ONLY those strings
inside both decision-cycle files.
"""
import ast
import shutil
from datetime import datetime
from pathlib import Path

REPLACEMENTS = [
    ("CAST(premium AS REAL)",                                  "flow_value"),
    ("WHERE created_at > datetime('now','-24 hours')",         "WHERE captured_at > datetime('now','-24 hours')"),
    # Update the heading + version marker so the v2 idempotency check skips this rewrite
    ("Top-5 flow tickers (premium-weighted",                   "Top-5 flow tickers (by flow value"),
    ('flow-tickers query failed',                              'flow_value query failed'),
]

TARGETS = [
    "/home/ubuntu/scripts/boba_decision_cycle.py",
    "/home/ubuntu/scripts/jazzy_decision_cycle.py",
]


def patch(path_str: str) -> str:
    path = Path(path_str)
    if not path.exists():
        return f"[{path.name}] missing"
    text = path.read_text(encoding="utf-8")
    orig = text

    if "Top-5 flow tickers (by flow value" in text:
        return f"[{path.name}] already SQL-fixed"
    if "Top-5 flow tickers (premium-weighted" not in text:
        return f"[{path.name}] no v2 marker found — apply patch_recall_v2 first"

    for old, new in REPLACEMENTS:
        if old not in text:
            return f"[{path.name}] expected string not found: {old[:50]!r}"
        text = text.replace(old, new, 1)

    try:
        ast.parse(text)
    except SyntaxError as e:
        return f"[{path.name}] ERR syntax: {e}"

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(path.suffix + f".mc-kb-sql-fix.{ts}")
    shutil.copy2(path, backup)
    path.write_text(text, encoding="utf-8")
    return f"[{path.name}] SQL FIXED (backup: {backup.name})"


for p in TARGETS:
    print(patch(p))
