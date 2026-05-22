#!/usr/bin/env python3
"""journal_writer — composes a daily Markdown journal of all agent decisions and POSTs it
to the laptop's mc-kb-server, where it lands in ~/mc-kb/notes/agent-journal/YYYY-MM-DD.md
(symlink-resolves into ~/second-brain/agent-journal/, then gets RAG-indexed within an hour).

Sources combined into one file per ET day:
  1. Boba decisions (workspace/skill_outputs/boba_decisions_validated.json)
  2. Jazzy decisions (workspace/skill_outputs/jazzy_decisions_validated.json)
  3. stock_auto_trader orders (options_flow.sqlite, auto_trader_orders table)
  4. crypto_executor picks (workspace/state/crypto_<account>_daily.json)

POSTs to http://127.0.0.1:8091/journal/write (reverse SSH tunnel → laptop).
Runs every 5 min via cron during market hours. Idempotent — full file
overwrite each run, no append-and-grow problem.
"""
from __future__ import annotations

import json
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

BOBA_LOG = Path("/home/ubuntu/.openclaw/workspace/skill_outputs/boba_decisions_validated.json")
JAZZY_LOG = Path("/home/ubuntu/.openclaw/workspace/skill_outputs/jazzy_decisions_validated.json")
STATE_DIR = Path("/home/ubuntu/.openclaw/workspace/state")
DB_PATH = Path("/home/ubuntu/mission-control-restored/data/options_flow.sqlite")
ENDPOINT = "http://127.0.0.1:8091/journal/write"

# PM2 stdout/stderr log paths — used to capture "cycle ran but didn't decide" attempts
# so the journal shows EVERY cycle invocation, not just ones that reached Claude.
PM2_LOG_DIR = Path("/home/ubuntu/.pm2/logs")


def today_et() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=-4)).strftime("%Y-%m-%d")


def _safe_json(path: Path, default: Any):
    try:
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    return default


def fmt_money(n: float | int | None) -> str:
    if n is None:
        return "—"
    n = float(n)
    if abs(n) >= 1_000_000:
        return f"${n/1_000_000:.1f}M"
    if abs(n) >= 1_000:
        return f"${n/1_000:.0f}K"
    return f"${n:.0f}"


def render_agent_decisions(agent: str, log_path: Path, day: str) -> str:
    """Render every cycle from today for a Boba/Jazzy log file."""
    entries = _safe_json(log_path, [])
    if not isinstance(entries, list) or not entries:
        return ""
    todays = [e for e in entries if isinstance(e, dict) and e.get("cycle_time", "")[:10] == day]
    if not todays:
        return f"\n## {agent.title()} — no cycles today yet\n"

    parts = [f"\n## {agent.title()} — {len(todays)} cycle(s) today\n"]
    for e in todays:
        ct = e.get("cycle_time", "")[:19].replace("T", " ")
        summary = (e.get("cycle_summary") or "").strip()[:300]
        picks = e.get("picks_executed") or []
        passed = e.get("passed_on") or []
        actions = e.get("position_actions") or []
        parts.append(f"\n### {ct} UTC — cycle summary\n")
        if summary:
            parts.append(f"> {summary}\n")
        parts.append(f"\n**Picks executed:** {len(picks)} · **Passed on:** {len(passed)} · **Position actions:** {len(actions)}\n")

        # Each pick with its full reasoning
        for i, p in enumerate(picks, 1):
            if not isinstance(p, dict):
                continue
            ticker = p.get("ticker", "?")
            strike = p.get("strike", "?")
            ot = (p.get("option_type") or "?")[:1].upper()
            expiry = p.get("expiry", "?")
            contracts = p.get("contracts", "?")
            tp = p.get("profit_target_pct", "?")
            sl = p.get("stop_loss_pct", "?")
            protocol = p.get("protocol", "?")
            criteria = ", ".join(p.get("entry_criteria") or [])
            brief = ", ".join(p.get("brief_context") or [])
            kronos = p.get("kronos_verdict", "?")
            conf = p.get("confidence", "?")
            reasoning = (p.get("reasoning") or "").strip()

            parts.append(f"\n#### Pick {i}: {ticker} ${strike}{ot} {expiry} × {contracts}\n")
            parts.append(f"- **Protocol:** {protocol}  ·  **TP/SL:** +{tp}%/-{sl}%  ·  **Confidence:** {conf}  ·  **Kronos:** {kronos}\n")
            if criteria:
                parts.append(f"- **Entry criteria:** {criteria}\n")
            if brief:
                parts.append(f"- **Brief context:** {brief}\n")
            if reasoning:
                # Indent reasoning block as a quote
                quoted = "\n".join(f"> {ln}" for ln in reasoning.splitlines() if ln.strip())
                parts.append(f"\n**Reasoning:**\n\n{quoted}\n")

        # Brief notes on passes (just the ticker + 1-line why)
        if passed:
            parts.append(f"\n**Passed on this cycle:**\n")
            for p in passed[:10]:
                if isinstance(p, dict):
                    t = p.get("ticker", "?")
                    why = (p.get("reason") or p.get("reasoning") or "")[:160].replace("\n", " ")
                    parts.append(f"- **{t}** — {why}\n")

        # Position actions
        if actions:
            parts.append(f"\n**Position actions:**\n")
            for a in actions[:10]:
                if isinstance(a, dict):
                    t = a.get("ticker", "?")
                    act = a.get("action", "?")
                    why = (a.get("reason") or "")[:160].replace("\n", " ")
                    parts.append(f"- **{t}** {act} — {why}\n")
    return "".join(parts)


def render_stock_trader(day: str) -> str:
    """Render today's stock_auto_trader activity from the SQLite table."""
    if not DB_PATH.exists():
        return ""
    try:
        con = sqlite3.connect(str(DB_PATH))
        cur = con.cursor()
        # Check if `rationale` column exists (Phase 2 adds it)
        cols = {row[1] for row in cur.execute("PRAGMA table_info(auto_trader_orders)").fetchall()}
        has_rationale = "rationale" in cols
        rationale_col = ", rationale" if has_rationale else ", '' AS rationale"
        rows = cur.execute(
            f"""SELECT placed_at, account, ticker, action, qty, status, error{', rationale' if has_rationale else ''}
                FROM auto_trader_orders
                WHERE substr(placed_at, 1, 10) = ?
                ORDER BY placed_at DESC""",
            (day,),
        ).fetchall()
        con.close()
    except Exception as e:
        return f"\n## stock_auto_trader — query error: {e!r}\n"

    if not rows:
        return f"\n## stock_auto_trader — no trades today\n"

    parts = [f"\n## stock_auto_trader — {len(rows)} order(s) today\n"]
    parts.append("\n| time (UTC) | account | ticker | action | qty | status | rationale |\n")
    parts.append("|---|---|---|---|---|---|---|\n")
    for row in rows[:200]:
        if has_rationale:
            ts, acct, tk, act, qty, status, err, rationale = row
        else:
            ts, acct, tk, act, qty, status, err = row
            rationale = ""
        ts_short = (ts or "")[:19]
        rat_short = (rationale or err or "").replace("\n", " ")[:120] or "—"
        parts.append(f"| {ts_short} | {acct} | {tk} | {act} | {qty} | {status or '—'} | {rat_short} |\n")
    return "".join(parts)


def render_crypto(day: str) -> str:
    """Render today's crypto_executor picks from per-account state files."""
    out = []
    for account in ("boba", "jazzy"):
        fp = STATE_DIR / f"crypto_{account}_daily.json"
        d = _safe_json(fp, {})
        if d.get("date") != day:
            continue
        picks = d.get("picks") or []
        if not picks:
            continue
        out.append(f"\n### {account} crypto picks — {len(picks)}\n")
        for p in picks:
            if not isinstance(p, dict):
                continue
            sym = p.get("symbol") or p.get("ticker") or "?"
            score = p.get("score", "?")
            qty = p.get("qty") or p.get("notional") or "?"
            entry = p.get("entry") or p.get("price") or "?"
            rationale = (p.get("rationale") or p.get("reason") or "").strip()
            scoreparts = p.get("score_breakdown") or {}
            out.append(f"- **{sym}** — score {score}, qty {qty} @ ~{entry}")
            if scoreparts:
                bp = ", ".join(f"{k}={v}" for k, v in scoreparts.items())
                out.append(f"  · breakdown: {bp}")
            if rationale:
                out.append(f"  · rationale: {rationale[:200]}")
            out.append("")
    if not out:
        return f"\n## crypto_executor — no picks today\n"
    return "\n## crypto_executor\n" + "\n".join(out)


def render_cycle_attempts(agent: str, day: str) -> str:
    """Parse PM2 stdout log for cycle invocations on `day` — captures EVERY fire,
    including 'No fresh signals' early-exits, killswitch aborts, and successful
    cycle completions. Lets the journal show attempts even without picks."""
    log_path = PM2_LOG_DIR / f"{agent}-decision-cycle-out.log"
    err_path = PM2_LOG_DIR / f"{agent}-decision-cycle-error.log"

    def _scan(path: Path) -> list[tuple[str, str]]:
        """Returns list of (time_hint, line) tuples — line classified by content."""
        if not path.exists():
            return []
        try:
            # Read tail (last ~30KB is plenty for today's events)
            with path.open("rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - 60_000))
                blob = f.read().decode("utf-8", errors="ignore")
        except Exception:
            return []
        out = []
        # PM2 timestamps lines like: "2026-05-22T13:30:01: <text>" if you have the
        # --time flag set. Without it, just look for our own markers in script.
        for line in blob.splitlines():
            line = line.strip()
            if not line:
                continue
            # Match patterns we care about
            if any(m in line for m in (
                "No fresh signals",
                "Cycle done:",
                "Killswitch active",
                "[bfe] enhancements failed",
                "[mc-kb] log_event failed",
                "[mc-kb] recall failed",
                "[multiagent] debate post failed",
                "fatal_account",
            )):
                out.append(line)
        return out

    out_lines = _scan(log_path)
    err_lines = _scan(err_path)

    if not (out_lines or err_lines):
        return ""

    # Count outcomes
    counts: dict[str, int] = {
        "no_signals": 0,
        "completed": 0,
        "killswitch": 0,
        "errors": 0,
    }
    recent = []  # latest 8 events
    for ln in (out_lines + err_lines):
        if "No fresh signals" in ln:
            counts["no_signals"] += 1
        elif "Cycle done:" in ln:
            counts["completed"] += 1
        elif "Killswitch active" in ln:
            counts["killswitch"] += 1
        elif any(m in ln for m in ("failed", "fatal_account")):
            counts["errors"] += 1
        recent.append(ln)

    # Keep last 8 events (most recent first)
    recent = recent[-8:][::-1]

    parts = [
        f"\n## {agent.title()} — cycle attempts today\n",
        f"\n- **{counts['completed']}** completed cycles (reached Claude)  ·  "
        f"**{counts['no_signals']}** no-signal exits  ·  "
        f"**{counts['killswitch']}** killswitch aborts  ·  "
        f"**{counts['errors']}** errors\n",
    ]
    if recent:
        parts.append("\n<details>\n<summary>Last 8 log lines (newest first)</summary>\n\n```\n")
        for ln in recent:
            parts.append(f"{ln[:280]}\n")
        parts.append("```\n</details>\n")
    return "".join(parts)


def compose_journal(day: str) -> str:
    """Assemble the full day's journal markdown."""
    header = (
        f"# Agent Journal — {day}\n\n"
        f"Auto-generated by Oracle's journal_writer.py every 5 min during market hours. "
        f"POSTed to laptop's mc-kb via the reverse SSH tunnel and RAG-indexed within an hour.\n"
    )
    parts = [header]
    # Reasoning sections (cycles that reached Claude + executed picks)
    parts.append(render_agent_decisions("boba", BOBA_LOG, day))
    parts.append(render_agent_decisions("jazzy", JAZZY_LOG, day))
    # Cycle attempts (every PM2 fire, including no-signal exits)
    parts.append(render_cycle_attempts("boba", day))
    parts.append(render_cycle_attempts("jazzy", day))
    # Trade execution layers
    parts.append(render_stock_trader(day))
    parts.append(render_crypto(day))
    parts.append(f"\n---\n_Last update: {datetime.now(timezone.utc).isoformat(timespec='seconds')}_\n")
    return "".join(p for p in parts if p)


def post_to_laptop(day: str, content: str) -> bool:
    payload = json.dumps({"date": day, "content": content}).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            ok = r.status == 200
            print(json.dumps({"posted": ok, "bytes": len(content), "endpoint": ENDPOINT}))
            return ok
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        print(json.dumps({"posted": False, "reason": str(e)[:200], "endpoint": ENDPOINT}))
        return False


def main() -> int:
    day = today_et()
    md = compose_journal(day)
    post_to_laptop(day, md)
    return 0


if __name__ == "__main__":
    main()
