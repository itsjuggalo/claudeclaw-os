#!/usr/bin/env python3
"""Patch boba_decision_cycle.py + jazzy_decision_cycle.py on Oracle to recall mc-kb memories.

Idempotent — safe to re-run. Validates syntax before saving; restores from backup on failure.
"""
import ast
import shutil
import sys
from pathlib import Path
from datetime import datetime

HELPER = '''\
def _mc_kb_recall():
    """Inject identity + critical memories from laptop mc-kb via SSH tunnel.

    Returns a Markdown prefix block on success, "" on any failure.
    The tunnel may be down (laptop sleeping, network blip) — never raises.
    """
    try:
        import mc_kb_client
        block = mc_kb_client.recall(
            "decision cycle protocol identity critical trading rules current context",
            top=4,
            tiers=["identity", "critical"],
            timeout=8,
        )
        if block:
            return block + "\\n\\n---\\n\\n"
        return ""
    except Exception:
        return ""


'''

TARGETS = [
    Path("/home/ubuntu/scripts/boba_decision_cycle.py"),
    Path("/home/ubuntu/scripts/jazzy_decision_cycle.py"),
]


def patch(path: Path) -> str:
    text = path.read_text(encoding="utf-8")

    if "_mc_kb_recall()" in text:
        return f"[{path.name}] already patched — skipping"

    # 1. Insert helper before the first `def call_(boba|jazzy)\(prompt`.
    marker = None
    for name in ("def call_boba(prompt):", "def call_jazzy(prompt):"):
        if name in text:
            marker = name
            break
    if not marker:
        return f"[{path.name}] no call_(boba|jazzy) function found — cannot patch"

    text = text.replace(marker, HELPER + marker, 1)

    # 2. Insert _mc_kb_recall() into the full_prompt assembly line.
    old = "    full_prompt = _load_lessons() + prompt"
    new = "    full_prompt = _load_lessons() + _mc_kb_recall() + prompt"
    if old not in text:
        return f"[{path.name}] expected 'full_prompt' line not found — bailing"
    text = text.replace(old, new, 1)

    # 3. Validate syntax.
    try:
        ast.parse(text)
    except SyntaxError as e:
        return f"[{path.name}] ERR: syntax check failed: {e}"

    # 4. Backup + write.
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(path.suffix + f".mc-kb-pre.{ts}")
    shutil.copy2(path, backup)
    path.write_text(text, encoding="utf-8")
    return f"[{path.name}] PATCHED (backup: {backup.name})"


def main():
    for p in TARGETS:
        if not p.exists():
            print(f"[{p.name}] missing — skipping")
            continue
        print(patch(p))


if __name__ == "__main__":
    main()
