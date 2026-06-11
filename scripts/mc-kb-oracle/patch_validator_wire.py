#!/usr/bin/env python3
"""Wire pick_validator into boba/jazzy decision cycles + revert cron to */5.

Inserts a 2-min research-and-confirm pass BETWEEN Claude's pick response
and the order-execution loop. Fail-open: if validation fails for any reason,
the original picks proceed (never breaks the trading cycle).

Idempotent. Validates syntax. Backups: *.validator-wire.<ts>
Disable at runtime by setting env BOBA_VALIDATE_PICKS=0 (or JAZZY_VALIDATE_PICKS=0).
"""
import ast
import re
import shutil
from datetime import datetime
from pathlib import Path

VALIDATE_BLOCK = '''\

    # 2-min research-and-confirm before order execution (env BOBA_VALIDATE_PICKS=0 to skip).
    # Gathers live quote + recent flow + mc-kb recall, then asks Claude PROCEED/ABORT per pick.
    # Fail-open: any error returns the original picks unchanged.
    import os as _os
    if _os.environ.get(__ENV_VAR__, "1") != "0" and cycle_picks:
        try:
            from pick_validator import validate_picks as _validate_picks
            print(f"[pick-validator] validating {len(cycle_picks)} pick(s) with 2-min research pass", flush=True)
            cycle_picks = _validate_picks(cycle_picks, account=__ACCOUNT__, sleep_sec=120)
            cycle_result["picks"] = cycle_picks  # keep cycle_result in sync for journaling
        except Exception as _ve:
            print(f"[pick-validator] failed, fail-open: {_ve!r}", flush=True)

'''

TARGETS = [
    {
        "path": "/home/ubuntu/scripts/boba_decision_cycle.py",
        "anchor": '    cycle_picks = cycle_result.get("picks", [])\n',
        "env_var": '"BOBA_VALIDATE_PICKS"',
        "account": '"boba"',
    },
    {
        "path": "/home/ubuntu/scripts/jazzy_decision_cycle.py",
        "anchor": '    cycle_picks = cycle_result.get("picks", [])\n',
        "env_var": '"JAZZY_VALIDATE_PICKS"',
        "account": '"jazzy"',
    },
]


def patch(target: dict) -> str:
    path = Path(target["path"])
    if not path.exists():
        return f"[{path.name}] missing"
    text = path.read_text(encoding="utf-8")
    if "pick-validator" in text:
        return f"[{path.name}] already wired"
    if target["anchor"] not in text:
        return f"[{path.name}] anchor not found — bailing"
    block = (VALIDATE_BLOCK
             .replace("__ENV_VAR__", target["env_var"])
             .replace("__ACCOUNT__", target["account"]))
    new_text = text.replace(target["anchor"], target["anchor"] + block, 1)
    try:
        ast.parse(new_text)
    except SyntaxError as e:
        return f"[{path.name}] ERR syntax: {e}"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(path.suffix + f".validator-wire.{ts}")
    shutil.copy2(path, backup)
    path.write_text(new_text, encoding="utf-8")
    return f"[{path.name}] WIRED — backup: {backup.name}"


for t in TARGETS:
    print(patch(t))
