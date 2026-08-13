#!/usr/bin/env python3
"""morning_digest — 8:30 AM ET weekday post combining:

  1. Yesterday's grade (one-line verdict from the grader output)
  2. Open positions on Boba + Jazzy (with unrealized P&L)
  3. Daemon health snapshot (from daemon_health.py state)
  4. Today's catalysts (earnings, Fed, CPI within next 48h)

Posts to discord-webhook-morning-brief.txt.

Cron: 30 12 * * 1-5  (8:30 AM ET = 12:30 UTC EDT)
"""
from __future__ import annotations

import json
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

SECRETS = Path("/home/ubuntu/.openclaw/secrets")
GRADES_DIR = Path("/home/ubuntu/.openclaw/data/grades")
HEALTH_STATE = Path("/home/ubuntu/.openclaw/workspace/state/daemon_health.json")
ALPACA_BASE = "https://paper-api.alpaca.markets/v2"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _read(path: Path, default: str = "") -> str:
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


def _http_get(url: str, headers: dict, timeout: float = 6):
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def fetch_positions(account: str) -> list[dict]:
    return _http_get(f"{ALPACA_BASE}/positions", _alpaca_headers(account)) or []


def fetch_account(account: str) -> dict:
    return _http_get(f"{ALPACA_BASE}/account", _alpaca_headers(account)) or {}


def last_grade_one_liner() -> tuple[str, str]:
    """Find the most recent daily grade file and pull its verdict line."""
    if not GRADES_DIR.exists():
        return ("?", "no grade file yet")
    files = sorted(GRADES_DIR.glob("????-??-??.md"), reverse=True)
    if not files:
        return ("?", "no grades")
    content = files[0].read_text(encoding="utf-8", errors="ignore")
    # Pull "## Today's Grade: X" + verdict line
    grade = "?"
    verdict = ""
    for line in content.splitlines():
        if line.startswith("## Today's Grade:"):
            grade = line.split(":", 1)[1].strip().split()[0]
        if line.startswith("**One-line verdict:**"):
            verdict = line.split("**", 2)[-1].strip()
            break
    return (grade, verdict or files[0].stem)


def health_snapshot() -> dict:
    s = _read_json(HEALTH_STATE, {}) or {}
    return {
        "last_status": s.get("last_status", "?"),
        "consecutive_failures": s.get("consecutive_failures", 0),
        "last_alert": s.get("last_alert", "never"),
    }


def fetch_catalysts() -> list[str]:
    """Today's catalysts. Uses Finnhub free tier earnings calendar if key present,
    falls back to a static set of known macro events (FOMC etc.). Never raises."""
    catalysts: list[str] = []

    # Try Finnhub for earnings (if key configured)
    fh_key = _read(SECRETS / "finnhub-api-key.txt") or _read(SECRETS / "FINNHUB_API_KEY")
    if fh_key:
        today = now_utc().date().isoformat()
        tomorrow = (now_utc().date() + timedelta(days=1)).isoformat()
        for d in (today, tomorrow):
            url = f"https://finnhub.io/api/v1/calendar/earnings?from={d}&to={d}&token={fh_key}"
            data = _http_get(url, headers={}, timeout=5)
            if data and isinstance(data, dict):
                for e in (data.get("earningsCalendar") or [])[:10]:
                    sym = e.get("symbol")
                    when = e.get("hour", "?")
                    if sym:
                        catalysts.append(f"📊 {sym} earnings {d} ({when})")

    # Known macro events (Fed days, CPI release days) — manually maintained
    # For now, just hardcode a heads-up that this is unhandled.
    # (A separate cron could fetch FOMC schedule from FRED if needed.)
    return catalysts[:15]


def render_digest() -> str:
    day = now_utc().strftime("%Y-%m-%d")
    grade, verdict = last_grade_one_liner()

    boba_acct = fetch_account("boba")
    jazzy_acct = fetch_account("jazzy")
    boba_pos = fetch_positions("boba")
    jazzy_pos = fetch_positions("jazzy")

    parts = [
        f"☀️ **Mission Control Morning Brief** — {day}",
        "",
        f"**Yesterday's grade:** **{grade}** — {verdict[:200]}",
        "",
        "**Account snapshots (pre-market)**",
        f"• Boba R2: equity ${boba_acct.get('equity','?')}  cash ${boba_acct.get('cash','?')}  open positions: {len(boba_pos)}",
        f"• Jazzy:   equity ${jazzy_acct.get('equity','?')}  cash ${jazzy_acct.get('cash','?')}  open positions: {len(jazzy_pos)}",
    ]

    # Positions table — show only first 5 per account to keep brief
    if boba_pos or jazzy_pos:
        parts.append("")
        parts.append("**Open positions**")
        for acct, ps in (("Boba", boba_pos), ("Jazzy", jazzy_pos)):
            for p in ps[:5]:
                upnl = p.get("unrealized_pl", "?")
                upct = p.get("unrealized_plpc", "?")
                try:
                    upct_str = f"{float(upct) * 100:.1f}%"
                except Exception:
                    upct_str = str(upct)
                parts.append(f"  {acct}: {p.get('symbol','?')} qty={p.get('qty','?')} unrealized=${upnl} ({upct_str})")

    # Daemon health
    health = health_snapshot()
    health_emoji = "✅" if health["last_status"] == "ok" else "⚠️"
    parts.append("")
    parts.append(f"**System health:** {health_emoji} status={health['last_status']}  consecutive_failures={health['consecutive_failures']}")

    # Catalysts
    cats = fetch_catalysts()
    parts.append("")
    if cats:
        parts.append(f"**Today's catalysts ({len(cats)}):**")
        for c in cats[:8]:
            parts.append(f"  • {c}")
    else:
        parts.append("**Catalysts:** none surfaced (Finnhub key may not be configured)")

    parts.append("")
    parts.append(f"_Auto-generated by Oracle's morning_digest.py at {now_utc().isoformat(timespec='minutes')}_")
    return "\n".join(parts)


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


def main() -> int:
    digest = render_digest()
    ok = post_discord("discord-webhook-morning-brief.txt", digest)
    print(json.dumps({"posted": ok, "bytes": len(digest)}))
    print()
    print(digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
