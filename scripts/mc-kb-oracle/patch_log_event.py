#!/usr/bin/env python3
"""Patch boba_decision_cycle.py + jazzy_decision_cycle.py to log to /hive after each cycle.

Inserts a `_log_hive_event()` call right before the `return 0` in main(),
passing tickers and cycle outcome. Idempotent — safe to re-run.
"""
import ast
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

# The block we'll insert right before the final `return 0` in main().
LOG_BLOCK = '''\

    # mc-kb: log this cycle to the daemon's /hive page (graceful-fail if tunnel down)
    try:
        import mc_kb_client
        _tickers = [pk.get("ticker", "?") for pk in cycle_result.get("picks", [])][:8]
        _passed_tickers = [pk.get("ticker", "?") for pk in cycle_result.get("passed_on", [])][:8]
        _cycle_summary = (cycle_result.get("cycle_summary") or "").strip()[:300]
        _hive_summary = (
            f"{n_picks} pick(s) committed, {n_passed} passed. "
            + (f"Tickers: {', '.join(_tickers)}. " if _tickers else "")
            + _cycle_summary
        )
        mc_kb_client.log_event(
            agent_id=__AGENT__,
            action="decision_cycle",
            summary=_hive_summary,
            artifacts={"picks": _tickers, "passed_on": _passed_tickers},
            chat_id="trading",
        )
    except Exception as _e:
        print(f"[mc-kb] log_event failed: {_e!r}", flush=True)

'''

TARGETS = [
    ("/home/ubuntu/scripts/boba_decision_cycle.py",  "boba"),
    ("/home/ubuntu/scripts/jazzy_decision_cycle.py", "jazzy"),
]


def patch(path_str: str, agent_id: str) -> str:
    path = Path(path_str)
    if not path.exists():
        return f"[{path.name}] missing — skipping"
    text = path.read_text(encoding="utf-8")
    if "mc_kb_client.log_event" in text:
        return f"[{path.name}] already patched"

    # Find the LAST `return 0` line inside main() — should be near EOF.
    # Pattern: the final cycle exit. We look for `    return 0` (indented) preceded by
    # the `print(f"Cycle done` line that both files end main() with.
    pattern = re.compile(
        r'(\n    print\(f"Cycle done:[^\n]*\n)(    return 0\n)',
        re.M,
    )
    m = pattern.search(text)
    if not m:
        return f"[{path.name}] couldn't find Cycle-done/return-0 anchor — bailing"

    # Substitute __AGENT__ placeholder.
    block = LOG_BLOCK.replace("__AGENT__", f'"{agent_id}"')
    new_text = text[:m.end(1)] + block + text[m.start(2):]

    # Syntax check.
    try:
        ast.parse(new_text)
    except SyntaxError as e:
        return f"[{path.name}] ERR syntax: {e}"

    # Backup + write.
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(path.suffix + f".mc-kb-log.{ts}")
    shutil.copy2(path, backup)
    path.write_text(new_text, encoding="utf-8")
    return f"[{path.name}] PATCHED (backup: {backup.name})"


def main():
    for path_str, agent_id in TARGETS:
        print(patch(path_str, agent_id))


if __name__ == "__main__":
    main()
