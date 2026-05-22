#!/usr/bin/env python3
"""Combined patch — wires boba_flow_enhancements into boba/jazzy + upgrades tier-ladder
+ tiebreaker text + Kronos confidence + IV-adjusted stops.

Idempotent. Validates syntax via ast.parse before writing. Backs up each target.
"""
import ast
import re
import shutil
from datetime import datetime
from pathlib import Path

TARGETS = [
    "/home/ubuntu/scripts/boba_decision_cycle.py",
    "/home/ubuntu/scripts/jazzy_decision_cycle.py",
]

# Block 1 — assembled into the prompt builder just AFTER platinum_flow_text is loaded.
# Counts platinum candidates from the loaded text + collects shortlist tickers.
BFE_BUILD_BLOCK = '''\

    # mc-kb tier enhancements (platinum mandate / confluence / fresh-5min / clusters / sector mix)
    bfe_enhancements = ""
    try:
        import boba_flow_enhancements as _bfe
        _tickers = []
        try:
            _tickers = [s.get("ticker", "") for _, s, _ in shortlist_with_kronos if s and s.get("ticker")]
        except Exception:
            _tickers = []
        _platinum_n = platinum_flow_text.count("\\n  💎 $") if platinum_flow_text else 0
        bfe_enhancements = _bfe.assemble_enhancements(_tickers, platinum_count=_platinum_n)
    except Exception as _bfe_e:
        print(f"[bfe] enhancements failed: {_bfe_e!r}", flush=True)
'''

# Where to insert BFE_BUILD_BLOCK — right after platinum_flow_text load.
BUILD_ANCHOR = re.compile(
    r'(platinum_flow_text\s*=\s*load_platinum_flow\([^\n]*\)\s*or\s*""[^\n]*\n)',
)

# Replace {platinum_flow_text} in the f-string with {platinum_flow_text}{bfe_enhancements}
TEMPLATE_OLD = "{platinum_flow_text}"
TEMPLATE_NEW = "{platinum_flow_text}{bfe_enhancements}"

# Tier-ladder updates: append IV-widening notes to each line.
TIER_LADDER_PATCHES = [
    ("T0 MEGA FLOW ($10M+ premium): profit_target_pct=80, stop_loss_pct=15 (highest conviction, tightest risk)",
     "T0 MEGA FLOW ($10M+ premium): profit_target_pct=80, stop_loss_pct=15 (highest conviction; if IV%>60 widen stop to 22)"),
    ("T1 HUGE FLOW ($5M+ premium): profit_target_pct=60, stop_loss_pct=20 (high conviction)",
     "T1 HUGE FLOW ($5M+ premium): profit_target_pct=60, stop_loss_pct=20 (high conviction; if IV%>60 widen stop to 30)"),
    ("T2 BIG FLOW ($1M+ premium): profit_target_pct=50, stop_loss_pct=25 (standard)",
     "T2 BIG FLOW ($1M+ premium): profit_target_pct=50, stop_loss_pct=25 (standard; if IV%>60 widen stop to 37)"),
    ("T3 STANDARD ($500K+ SWEEP + A/AA + Vol>OI): profit_target_pct=40, stop_loss_pct=30 (lower)",
     "T3 STANDARD ($500K+ SWEEP + A/AA + Vol>OI): profit_target_pct=40, stop_loss_pct=30 (lower; if IV%>60 widen stop to 45)"),
    ("T4 UNUSUAL (Vol>OI yellow): profit_target_pct=30, stop_loss_pct=35 (last resort)",
     "T4 UNUSUAL (Vol>OI yellow): profit_target_pct=30, stop_loss_pct=35 (last resort; if IV%>60 widen stop to 52)"),
]

# Tiebreaker upgrade — replace the WITHIN-TIER RANKING line with an expanded priority list.
TIEBREAKER_OLD = (
    "- WITHIN-TIER RANKING (co-primary tiebreakers): "
    "repeater_count (same contract appearing 3+ times today) AND DTE (shorter wins). "
    "Then sweep>block>split, then A/AA bid-ask, then Vol/OI ratio."
)
TIEBREAKER_NEW = (
    "- WITHIN-TIER RANKING (priority order; ties broken in order shown):\n"
    "  1. repeater_count (same contract 3+ times today)\n"
    "  2. ticker-strike cluster (3+ distinct strikes on same ticker today — see STRIKE CLUSTERS above)\n"
    "  3. multi-source confluence (≥3 sources agreeing direction — see MULTI-SOURCE CONFLUENCE above; ≥3 = treat as one tier upgraded)\n"
    "  4. fresh-5min flag (institutional opens beat 3:55 PM muppet flow)\n"
    "  5. DTE (shorter wins for flow)\n"
    "  6. Kronos confidence (HIGH AGREE > MED AGREE > LOW AGREE > NEUTRAL; CONFLICTS = veto)\n"
    "  7. sweep>block>split\n"
    "  8. A/AA bid-ask\n"
    "  9. Vol/OI ratio"
)


def patch(path_str: str) -> str:
    path = Path(path_str)
    if not path.exists():
        return f"[{path.name}] missing"
    text = path.read_text(encoding="utf-8")

    if "boba_flow_enhancements" in text and "bfe_enhancements" in text:
        return f"[{path.name}] already patched"

    changes: list[str] = []

    # 1) Insert BFE_BUILD_BLOCK after platinum_flow_text load.
    m = BUILD_ANCHOR.search(text)
    if not m:
        return f"[{path.name}] no platinum_flow_text anchor found — skipping (build_*_prompt structure differs)"
    text = text[:m.end()] + BFE_BUILD_BLOCK + text[m.end():]
    changes.append("build-block")

    # 2) Inject {bfe_enhancements} into the f-string template — replace first occurrence.
    if TEMPLATE_OLD not in text:
        return f"[{path.name}] template marker missing — bailing"
    text = text.replace(TEMPLATE_OLD, TEMPLATE_NEW, 1)
    changes.append("template")

    # 3) Tier-ladder IV widening notes.
    for old, new in TIER_LADDER_PATCHES:
        if old in text:
            text = text.replace(old, new, 1)
            changes.append("tier-iv")

    # 4) Tiebreaker expansion.
    if TIEBREAKER_OLD in text:
        text = text.replace(TIEBREAKER_OLD, TIEBREAKER_NEW, 1)
        changes.append("tiebreaker")

    # 5) Syntax check.
    try:
        ast.parse(text)
    except SyntaxError as e:
        return f"[{path.name}] ERR syntax: {e}"

    # 6) Backup + write.
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(path.suffix + f".bfe.{ts}")
    shutil.copy2(path, backup)
    path.write_text(text, encoding="utf-8")
    return f"[{path.name}] PATCHED ({', '.join(changes)}) — backup: {backup.name}"


def main():
    for p in TARGETS:
        print(patch(p))


if __name__ == "__main__":
    main()
