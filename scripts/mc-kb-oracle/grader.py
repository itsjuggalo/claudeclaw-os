#!/usr/bin/env python3
"""grader — Claude-driven A–F performance review of the trading day or week.

Two modes:

  --mode daily   Reads today's journal + closing P&L + open positions + decisions
                 → writes ~/mc-kb/notes/grades/YYYY-MM-DD.md
                 → posts summary to discord-webhook-performance-daily

  --mode weekly  Aggregates the week's daily grade files + weekly P&L vs SPY/QQQ
                 → writes ~/mc-kb/notes/grades/YYYY-WW.md
                 → posts to discord-webhook-performance-weekly

Cron schedule:
  30 20 * * 1-5    daily   (4:30 PM ET / 20:30 UTC)
  35 20 * * 5      weekly  (Friday 4:35 PM ET)

The grade file gets POSTed to laptop's mc-kb /journal/write endpoint as
date "YYYY-MM-DD-grade" so it lands in mc-kb/notes/agent-journal/ and
becomes RAG-searchable within an hour.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

SECRETS = Path("/home/ubuntu/.openclaw/secrets")
BOBA_LOG = Path("/home/ubuntu/.openclaw/workspace/skill_outputs/boba_decisions_validated.json")
JAZZY_LOG = Path("/home/ubuntu/.openclaw/workspace/skill_outputs/jazzy_decisions_validated.json")
DB_PATH = Path("/home/ubuntu/mission-control-restored/data/options_flow.sqlite")
GRADES_DIR = Path("/home/ubuntu/.openclaw/data/grades")
GRADES_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = Path("/home/ubuntu/.openclaw/data/logs/grader.jsonl")
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

CLAUDE_BIN = "/home/ubuntu/.npm-global/bin/claude"
MC_KB_ENDPOINT = "http://127.0.0.1:8091/journal/write"
ALPACA_BASE = "https://paper-api.alpaca.markets/v2"
DATA_BASE = "https://data.alpaca.markets"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_et() -> str:
    return (now_utc() + timedelta(hours=-4)).strftime("%Y-%m-%d")


def _read(path: Path, default=""):
    try:
        return path.read_text().strip()
    except Exception:
        return default


def _read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _alpaca_headers(account: str) -> dict:
    if account == "boba":
        key_file, sec_file = "alpaca-key-id", "alpaca-secret"
    else:
        key_file, sec_file = f"alpaca-{account}-key-id", f"alpaca-{account}-secret"
    return {
        "APCA-API-KEY-ID": _read(SECRETS / key_file),
        "APCA-API-SECRET-KEY": _read(SECRETS / sec_file),
    }


def _http_get(url: str, headers: dict, timeout: float = 8) -> Any:
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def fetch_account(account: str) -> dict:
    return _http_get(f"{ALPACA_BASE}/account", _alpaca_headers(account)) or {}


def fetch_positions(account: str) -> list[dict]:
    return _http_get(f"{ALPACA_BASE}/positions", _alpaca_headers(account)) or []


def fetch_today_activities(account: str, day: str) -> list[dict]:
    # FILL activities so we can see what closed today
    return _http_get(
        f"{ALPACA_BASE}/account/activities?activity_types=FILL&date={day}",
        _alpaca_headers(account),
    ) or []


def fetch_benchmark_change(symbol: str, days: int) -> float | None:
    """Returns percent change of `symbol` over last `days` calendar days."""
    end = now_utc().date()
    start = end - timedelta(days=days + 5)  # buffer for weekend
    url = (f"{DATA_BASE}/v2/stocks/{symbol}/bars?timeframe=1Day"
           f"&start={start.isoformat()}&end={end.isoformat()}&limit=20")
    headers = _alpaca_headers("boba")  # any valid key works for data API
    data = _http_get(url, headers, timeout=6)
    if not data or "bars" not in data or len(data["bars"]) < 2:
        return None
    first = float(data["bars"][0].get("c", 0))
    last = float(data["bars"][-1].get("c", 0))
    if first == 0:
        return None
    return round(((last - first) / first) * 100, 2)


def today_decisions(log_path: Path, day: str) -> list[dict]:
    entries = _read_json(log_path, [])
    if not isinstance(entries, list):
        return []
    return [e for e in entries if isinstance(e, dict) and e.get("cycle_time", "")[:10] == day]


def today_stock_trades(day: str) -> list[dict]:
    if not DB_PATH.exists():
        return []
    try:
        con = sqlite3.connect(str(DB_PATH))
        cur = con.cursor()
        cols = {r[1] for r in cur.execute("PRAGMA table_info(auto_trader_orders)").fetchall()}
        rationale_col = ", rationale" if "rationale" in cols else ", '' AS rationale"
        rows = cur.execute(
            f"SELECT placed_at, account, ticker, action, qty, status{rationale_col} "
            f"FROM auto_trader_orders WHERE substr(placed_at, 1, 10) = ? "
            f"ORDER BY placed_at",
            (day,),
        ).fetchall()
        con.close()
        return [
            {"placed_at": r[0], "account": r[1], "ticker": r[2],
             "action": r[3], "qty": r[4], "status": r[5], "rationale": r[6] if len(r) > 6 else ""}
            for r in rows
        ]
    except Exception:
        return []


# ──────────────────────────────────────────────────────────────────────────────
# Daily mode
# ──────────────────────────────────────────────────────────────────────────────

DAILY_RUBRIC = """You are an independent auditor reviewing today's trading day for Mission Control.
Mike runs Boba (claude-sonnet) + Jazzy (claude via HTTP) on Alpaca paper, plus a stock-auto-trader
that follows signal apps mechanically, plus a crypto-executor for top pumpers.

Grade today on A–F. Be a tough but fair auditor. Anchor every claim in specific data below.

OUTPUT STRICTLY this Markdown structure:

## Today's Grade: <letter>

**One-line verdict:** <single sentence>

### Numbers
- Boba R2: equity $X (+$Y vs open), N trades, win rate Z%
- Jazzy: equity $X (+$Y vs open), N trades, win rate Z%
- Stock auto-trader: N buys / N sells
- Best trade: <ticker, P&L>
- Worst trade: <ticker, P&L>
- vs SPY: <±X% relative>

### Strengths (1-3 bullets — what to keep doing)
- ...

### Weaknesses (1-3 bullets — concrete, with data)
- ...

### Tomorrow (3-5 actionable bullets)
- ...

Be specific. "Tighten stops" is bad; "Boba's $190P TSLA hit -25% by 2pm while V/OI dropped 60% — set stop at -15% on volatility-collapsing positions" is good.
"""

WEEKLY_RUBRIC = """You are an independent auditor reviewing the trading WEEK for Mission Control.
Below: 5 daily grades + weekly Alpaca P&L + SPY/QQQ benchmark over same period.

This is the strategic review (NOT tactical). Look for patterns ACROSS days. Output:

## Week of <YYYY-WW>: Grade <letter>

**One-line verdict:** <single sentence>

### Aggregate numbers
- Combined P&L (Boba+Jazzy): $X (Y%)
- vs SPY: ±Z%
- vs QQQ: ±Z%
- Win rate: X%
- Days graded: A: N | B: N | C: N | D: N | F: N

### Pattern recognition (2-4 bullets across the week)
- ...

### Strategic edits (3-5 bullets — system/rule changes, not single-trade tactics)
- Examples: "Disable Protocol B until 30d backtest passes",
            "Move stop from -25% to -15% for IV>60 entries",
            "Skip Friday afternoon cycles — 4/5 worst trades fell after 14:00 ET",
            "Add macro filter — no new picks on FOMC days"

Be willing to recommend halting trading entirely if the week's data warrants.
"""


def call_claude(prompt: str, timeout: int = 120) -> str:
    if not os.path.exists(CLAUDE_BIN):
        return ""
    try:
        r = subprocess.run(
            [CLAUDE_BIN, "-p", "--model", "sonnet", "--output-format", "text",
             "--no-session-persistence", "--tools", ""],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if r.returncode != 0:
            return ""
        return r.stdout.strip()
    except Exception:
        return ""


def post_discord(webhook_file: str, content: str) -> bool:
    url = _read(SECRETS / webhook_file)
    if not url:
        return False
    try:
        body = json.dumps({"content": content[:1900]}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def post_to_mc_kb(date_key: str, content: str) -> None:
    """Mirror the grade markdown to the laptop's mc-kb so it gets RAG-indexed."""
    try:
        body = json.dumps({"date": date_key, "content": content}).encode("utf-8")
        req = urllib.request.Request(MC_KB_ENDPOINT, data=body,
                                     headers={"Content-Type": "application/json"},
                                     method="POST")
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def _log(entry: dict) -> None:
    try:
        entry["ts"] = now_utc().isoformat(timespec="seconds")
        with LOG_FILE.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def render_daily(day: str) -> str:
    boba_acct = fetch_account("boba")
    jazzy_acct = fetch_account("jazzy")
    boba_pos = fetch_positions("boba")
    jazzy_pos = fetch_positions("jazzy")
    boba_decisions = today_decisions(BOBA_LOG, day)
    jazzy_decisions = today_decisions(JAZZY_LOG, day)
    stock_trades = today_stock_trades(day)
    spy_pct = fetch_benchmark_change("SPY", 1)
    qqq_pct = fetch_benchmark_change("QQQ", 1)

    # Compose context for the Claude prompt (compact — fits in context easily)
    context = f"""# Trading day: {day}

## Account snapshots (end of day)
- Boba R2: equity ${boba_acct.get('equity','?')}  cash ${boba_acct.get('cash','?')}  long_market_value ${boba_acct.get('long_market_value','?')}
- Jazzy:   equity ${jazzy_acct.get('equity','?')}  cash ${jazzy_acct.get('cash','?')}  long_market_value ${jazzy_acct.get('long_market_value','?')}

## Open positions
Boba ({len(boba_pos)}):
""" + "\n".join(
        f"  - {p.get('symbol','?')} qty={p.get('qty','?')} avg=${p.get('avg_entry_price','?')} curr=${p.get('current_price','?')} unrealized=${p.get('unrealized_pl','?')} ({p.get('unrealized_plpc','?')})"
        for p in boba_pos
    ) + f"\n\nJazzy ({len(jazzy_pos)}):\n" + "\n".join(
        f"  - {p.get('symbol','?')} qty={p.get('qty','?')} avg=${p.get('avg_entry_price','?')} curr=${p.get('current_price','?')} unrealized=${p.get('unrealized_pl','?')} ({p.get('unrealized_plpc','?')})"
        for p in jazzy_pos
    ) + f"""

## Benchmarks (1-day change)
- SPY: {spy_pct}%   QQQ: {qqq_pct}%

## Boba decision cycles today: {len(boba_decisions)}
""" + "\n\n".join(
        f"### Cycle at {(e.get('cycle_time') or '')[:19]}\n"
        f"Summary: {(e.get('cycle_summary') or '')[:400]}\n"
        f"Picks executed: " + ", ".join(
            f"{p.get('ticker','?')} ${p.get('strike','?')}{(p.get('option_type','?'))[:1]} {p.get('expiry','?')}"
            for p in (e.get('picks_executed') or [])
        )
        for e in boba_decisions[-3:]
    ) + f"\n\n## Jazzy decision cycles today: {len(jazzy_decisions)}\n" + "\n\n".join(
        f"### Cycle at {(e.get('cycle_time') or '')[:19]}\n"
        f"Summary: {(e.get('cycle_summary') or '')[:400]}\n"
        for e in jazzy_decisions[-3:]
    ) + f"\n\n## Stock auto-trader: {len(stock_trades)} trades\n" + "\n".join(
        f"  {t['placed_at'][:19]} {t['account']:6} {t['ticker']:5} {t['action']:4} qty={t['qty']} | {(t.get('rationale','') or '')[:100]}"
        for t in stock_trades[:15]
    )

    prompt = DAILY_RUBRIC + "\n\n" + "=" * 60 + "\n\n" + context
    graded = call_claude(prompt, timeout=120)
    if not graded:
        graded = "## Today's Grade: ?\n\n**One-line verdict:** auditor LLM unavailable; raw data preserved below."

    out = (f"# Daily Grade — {day}\n\n"
           f"_Auto-generated by Oracle's grader.py · model=claude-sonnet · "
           f"completed {now_utc().isoformat(timespec='seconds')}_\n\n"
           f"{graded}\n\n"
           f"---\n\n## Raw context (for audit / replay)\n\n<details>\n<summary>open</summary>\n\n```\n{context}\n```\n</details>\n")
    return out


def render_weekly() -> str:
    today = now_utc().date()
    # Friday's week-of-year (ISO)
    iso_year, iso_week, _ = today.isocalendar()
    week_key = f"{iso_year}-W{iso_week:02d}"
    # Gather last 5 weekday grades
    daily_files = []
    for offset in range(0, 7):
        d = (today - timedelta(days=offset)).strftime("%Y-%m-%d")
        path = GRADES_DIR / f"{d}.md"
        if path.exists():
            daily_files.append((d, path.read_text(encoding="utf-8")[:4000]))
    daily_files.sort()

    spy_pct = fetch_benchmark_change("SPY", 7)
    qqq_pct = fetch_benchmark_change("QQQ", 7)
    boba_acct = fetch_account("boba")
    jazzy_acct = fetch_account("jazzy")

    context = (f"# Trading week: {week_key}\n\n"
               f"## Account snapshots (end of week)\n"
               f"- Boba R2: equity ${boba_acct.get('equity','?')}\n"
               f"- Jazzy:   equity ${jazzy_acct.get('equity','?')}\n\n"
               f"## Benchmarks (7-day change)\n- SPY: {spy_pct}%   QQQ: {qqq_pct}%\n\n"
               f"## Daily grades (this week):\n\n")
    for d, content in daily_files:
        context += f"### {d}\n\n{content}\n\n---\n\n"

    prompt = WEEKLY_RUBRIC + "\n\n" + "=" * 60 + "\n\n" + context
    graded = call_claude(prompt, timeout=180)
    if not graded:
        graded = "## Weekly Grade: ?\n\n**One-line verdict:** auditor LLM unavailable; raw data preserved below."

    out = (f"# Weekly Grade — {week_key}\n\n"
           f"_Auto-generated by Oracle's grader.py · {now_utc().isoformat(timespec='seconds')}_\n\n"
           f"{graded}\n\n"
           f"---\n\n## Raw context\n\n<details>\n<summary>open</summary>\n\n```\n{context[:8000]}\n```\n</details>\n")
    return out, week_key


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["daily", "weekly"], default="daily")
    args = ap.parse_args()

    if args.mode == "daily":
        day = today_et()
        out = render_daily(day)
        # Write local + mirror to mc-kb (RAG-indexed within an hour)
        (GRADES_DIR / f"{day}.md").write_text(out, encoding="utf-8")
        post_to_mc_kb(f"{day}-grade", out)
        # Short Discord notification — first 1500 chars of the grade section
        snippet = out.split("---")[0][:1500]
        post_discord("discord-webhook-performance-daily.txt", snippet)
        _log({"mode": "daily", "day": day, "bytes": len(out)})
        print(json.dumps({"mode": "daily", "day": day, "wrote": str(GRADES_DIR / f"{day}.md")}))
    else:
        out, week_key = render_weekly()
        (GRADES_DIR / f"{week_key}.md").write_text(out, encoding="utf-8")
        post_to_mc_kb(f"{week_key}-grade".replace("W", "weekly-W"), out)
        snippet = out.split("---")[0][:1500]
        post_discord("discord-webhook-performance-weekly.txt", snippet)
        _log({"mode": "weekly", "week": week_key, "bytes": len(out)})
        print(json.dumps({"mode": "weekly", "week": week_key, "wrote": str(GRADES_DIR / f"{week_key}.md")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
