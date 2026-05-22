#!/usr/bin/env python3
"""Patch v2: upgrade _mc_kb_recall() in boba/jazzy to be ticker-aware + add top-flow tickers.

Replaces the static query "decision cycle protocol identity critical..." with:
  1. Top-5 flow tickers from options_flow.sqlite (last 24h, sorted by premium)
  2. Today's signal tickers from scored_signals_recent.json
  3. mc-kb recall using those tickers as the query terms
"""
import ast
import re
import shutil
from datetime import datetime
from pathlib import Path

NEW_HELPER = '''\
def _mc_kb_recall():
    """Build a rich pre-prompt context block (ticker-aware).

    1) Top-5 flow tickers in last 24h from options_flow.sqlite
    2) Today's signal tickers from scored_signals_recent.json
    3) mc-kb RAG query using those tickers — returns per-ticker memory chunks

    Never raises; returns "" on any failure (so the cycle proceeds even when
    laptop is offline / sqlite locked / etc).
    """
    try:
        import json as _j
        import sqlite3 as _s
        from datetime import datetime as _dt, timezone as _tz
        from pathlib import Path as _P

        # 1) Top-5 flow tickers (premium-weighted, last 24h)
        flow_block = ""
        top_tickers = []
        try:
            con = _s.connect("/home/ubuntu/mission-control-restored/data/options_flow.sqlite")
            cur = con.cursor()
            rows = cur.execute(
                """SELECT ticker, COUNT(*), COALESCE(SUM(CAST(premium AS REAL)),0)
                   FROM flow_alerts
                   WHERE created_at > datetime('now','-24 hours') AND ticker IS NOT NULL
                   GROUP BY ticker
                   ORDER BY 3 DESC, 2 DESC
                   LIMIT 5"""
            ).fetchall()
            con.close()
            if rows:
                top_tickers = [r[0] for r in rows]
                flow_block = "## Top flow tickers (last 24h, premium-weighted)\\n\\n"
                for t, n, p in rows:
                    flow_block += f"- **{t}**: {n} alerts, ${int(p):,} premium\\n"
                flow_block += "\\n"
        except Exception as _e:
            flow_block = f"_(flow-tickers query failed: {_e})_\\n\\n"

        # 2) Today's signal tickers
        sig_tickers = []
        try:
            sig_path = _P("/home/ubuntu/mission-control/signal-receiver/data/scored_signals_recent.json")
            if sig_path.exists():
                today = _dt.now(_tz.utc).strftime("%Y-%m-%d")
                sigs = _j.loads(sig_path.read_text())
                sig_tickers = sorted({s.get("ticker","") for s in sigs
                                       if isinstance(s, dict) and s.get("timestamp","")[:10] == today and s.get("ticker")})
        except Exception:
            pass

        # 3) Ticker-aware mc-kb recall
        query_tickers = list(dict.fromkeys(top_tickers + sig_tickers))[:8]  # dedupe, keep order, cap at 8
        if query_tickers:
            query = f"trading decisions options flow patterns for {' '.join(query_tickers)} current rules"
        else:
            query = "trading decisions current rules identity critical context"

        kb_block = ""
        try:
            import mc_kb_client
            kb_block = mc_kb_client.recall(query, top=5, tiers=["identity", "critical"], timeout=8) or ""
        except Exception as _e:
            kb_block = f"_(mc-kb recall failed: {_e})_\\n\\n"

        result = flow_block + kb_block
        return (result + "\\n\\n---\\n\\n") if result.strip() else ""
    except Exception:
        return ""


'''

TARGETS = [
    "/home/ubuntu/scripts/boba_decision_cycle.py",
    "/home/ubuntu/scripts/jazzy_decision_cycle.py",
]


def patch(path_str: str) -> str:
    path = Path(path_str)
    if not path.exists():
        return f"[{path.name}] missing"
    text = path.read_text(encoding="utf-8")

    if "Top-5 flow tickers (premium-weighted" in text:
        return f"[{path.name}] already at v2"

    # Find existing _mc_kb_recall function definition + body (ends at next top-level def or blank+blank).
    pattern = re.compile(
        r'def _mc_kb_recall\(\):.*?(?=\ndef\s|\n@)',
        re.S,
    )
    m = pattern.search(text)
    if not m:
        return f"[{path.name}] no _mc_kb_recall() found — was it patched in v1?"

    new_text = text[:m.start()] + NEW_HELPER + text[m.end():]

    try:
        ast.parse(new_text)
    except SyntaxError as e:
        return f"[{path.name}] ERR syntax: {e}"

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(path.suffix + f".mc-kb-recall-v2.{ts}")
    shutil.copy2(path, backup)
    path.write_text(new_text, encoding="utf-8")
    return f"[{path.name}] PATCHED v2 (backup: {backup.name})"


for p in TARGETS:
    print(patch(p))
