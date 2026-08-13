#!/usr/bin/env python3
"""Patch jazzy_decision_cycle.py — handles its inline HTTP-API prompt pattern."""
import ast
import shutil
from pathlib import Path
from datetime import datetime

HELPER = '''\
def _mc_kb_recall():
    """Inject identity + critical memories from laptop mc-kb. Returns "" on any failure."""
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

path = Path("/home/ubuntu/scripts/jazzy_decision_cycle.py")
text = path.read_text(encoding="utf-8")

if "_mc_kb_recall()" in text:
    print(f"[{path.name}] already patched — skipping")
    raise SystemExit(0)

# 1. Insert helper just before the first top-level `def ` we can find after _load_lessons.
# Anchor on `def _load_lessons():` and insert immediately AFTER the end of that function.
# Safer approach: insert at top of file, after imports and constants.
# Find a good insertion point — after the last `import` line in the first 80 lines.
lines = text.splitlines(keepends=True)
insert_idx = 0
for i, line in enumerate(lines[:80]):
    if line.startswith("import ") or line.startswith("from "):
        insert_idx = i + 1
if insert_idx == 0:
    print("[jazzy] couldn't find import block — bailing")
    raise SystemExit(1)
new_lines = lines[:insert_idx] + ["\n", HELPER] + lines[insert_idx:]
text = "".join(new_lines)

# 2. Replace the prompt assembly to include _mc_kb_recall().
old = '"content": (_load_lessons() + prompt)}'
new = '"content": (_load_lessons() + _mc_kb_recall() + prompt)}'
if old not in text:
    print(f"[jazzy] expected content line not found — bailing")
    raise SystemExit(1)
text = text.replace(old, new, 1)

# 3. Validate syntax.
try:
    ast.parse(text)
except SyntaxError as e:
    print(f"[jazzy] ERR syntax: {e}")
    raise SystemExit(1)

# 4. Backup + write.
ts = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = path.with_suffix(path.suffix + f".mc-kb-pre.{ts}")
shutil.copy2(path, backup)
path.write_text(text, encoding="utf-8")
print(f"[{path.name}] PATCHED (backup: {backup.name})")
