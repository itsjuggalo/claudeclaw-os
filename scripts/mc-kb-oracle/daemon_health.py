#!/usr/bin/env python3
"""daemon_health — every 5 min, verify the trading stack is alive end-to-end.

Checks (in order, fail-fast on first error to keep alerts focused):
  1. PM2 process list — required daemons all `online`
  2. Cron entries present (firebase_to_scored, journal_writer)
  3. scored_signals_recent.json freshness (last write < 10 min ago during market hours)
  4. mc-kb tunnel reachable (curl http://127.0.0.1:8091/health from Oracle)
  5. firebase relay state — last_poll_at < 5 min ago
  6. Alpaca API reachable for Boba + Jazzy account keys

On any failure, posts a Discord alert (rate-limited to once per failure per
60 min via state file). On full recovery, posts a "✅ all healthy again" message.

State: /home/ubuntu/.openclaw/workspace/state/daemon_health.json
Log:   /home/ubuntu/.openclaw/data/logs/daemon_health.jsonl
Discord webhook: /home/ubuntu/.openclaw/secrets/discord-webhook-ops.txt
                 (falls back to /home/ubuntu/.openclaw/secrets/discord-webhook-best-options-log.txt)
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

SECRETS = Path("/home/ubuntu/.openclaw/secrets")
STATE_DIR = Path("/home/ubuntu/.openclaw/workspace/state")
STATE_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = Path("/home/ubuntu/.openclaw/data/logs/daemon_health.jsonl")
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
STATE_FILE = STATE_DIR / "daemon_health.json"

PM2 = "/home/ubuntu/.npm-global/bin/pm2"

REQUIRED_DAEMONS = [
    "firebase-signal-relay",
    "notification-bridge",
    "option-signals-scraper",
    "stock-auto-trader",
    "profit-lock-boba",
    "profit-lock-jazzy",
    "trail-daemon",
    "crypto-profit-lock-boba",
    "crypto-profit-lock-jazzy",
]
# Boba/Jazzy decision cycles are cron-restart processes — they're "stopped" most of
# the time between scheduled firings. We don't require them to be `online`.

REQUIRED_CRONS = ["firebase_to_scored.py", "journal_writer.py"]
SCORED_PATH = Path("/home/ubuntu/mission-control/signal-receiver/data/scored_signals_recent.json")
RELAY_STATUS = Path("/home/ubuntu/.openclaw/workspace/directives/firebase_signal_relay_status.json")
MC_KB_HEALTH = "http://127.0.0.1:8091/health"

# Discord rate-limit: don't re-fire the same alert within this window
ALERT_COOLDOWN_MIN = 60


def now() -> datetime:
    return datetime.now(timezone.utc)


def now_et_hhmm() -> tuple[int, int]:
    et = now() + timedelta(hours=-4)  # rough EDT; DST not handled, fine for hour-level
    return et.hour, et.minute


def is_market_hours() -> bool:
    """Roughly 9:30 ET (pre-open through 16:00 ET). Weekdays only."""
    wd = (now() + timedelta(hours=-4)).weekday()  # 0=Mon
    if wd >= 5:
        return False
    h, m = now_et_hhmm()
    open_mins = h * 60 + m
    return 9 * 60 + 30 <= open_mins <= 16 * 60


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


def discord_webhook_url() -> str:
    # Tries in order: dedicated ops → risk-alerts → portfolio-status → first match.
    for name in (
        "discord-webhook-ops.txt",
        "discord-webhook-risk-alerts.txt",
        "discord-webhook-portfolio-status.txt",
    ):
        url = _read(SECRETS / name)
        if url:
            return url
    return ""


def post_discord(content: str) -> bool:
    url = discord_webhook_url()
    if not url:
        return False
    try:
        body = json.dumps({"content": content[:1900]}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def check_pm2() -> dict:
    """Returns {missing: [...], offline: [...]} based on PM2 jlist output."""
    try:
        out = subprocess.run([PM2, "jlist"], capture_output=True, text=True, timeout=8)
        procs = json.loads(out.stdout) if out.stdout else []
    except Exception as e:
        return {"error": f"pm2 jlist failed: {e!r}"}
    by_name = {p.get("name"): p for p in procs if isinstance(p, dict)}
    missing = []
    offline = []
    for d in REQUIRED_DAEMONS:
        if d not in by_name:
            missing.append(d)
        else:
            status = (by_name[d].get("pm2_env", {}).get("status") or "").lower()
            if status != "online":
                offline.append(f"{d}({status})")
    return {"missing": missing, "offline": offline}


def check_crons() -> dict:
    try:
        out = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=5)
        text = out.stdout or ""
    except Exception as e:
        return {"error": f"crontab -l failed: {e!r}"}
    missing = [c for c in REQUIRED_CRONS if c not in text]
    return {"missing": missing}


def check_scored_freshness(max_age_min: int = 10) -> dict:
    if not SCORED_PATH.exists():
        return {"stale": True, "age_min": None, "reason": "file missing"}
    age = (time.time() - SCORED_PATH.stat().st_mtime) / 60
    if is_market_hours() and age > max_age_min:
        return {"stale": True, "age_min": round(age, 1)}
    return {"stale": False, "age_min": round(age, 1)}


def check_relay() -> dict:
    s = _read_json(RELAY_STATUS, {})
    if not isinstance(s, dict):
        return {"healthy": False, "reason": "status file unparseable"}
    if not s.get("last_poll_ok"):
        return {"healthy": False, "reason": "last_poll_ok=false"}
    try:
        last = datetime.fromisoformat(s["last_poll_at"])
        age_min = (now() - last).total_seconds() / 60
        if age_min > 5:
            return {"healthy": False, "reason": f"last poll {round(age_min,1)} min ago"}
    except Exception:
        return {"healthy": False, "reason": "can't parse last_poll_at"}
    cf = int(s.get("consecutive_failures") or 0)
    if cf > 3:
        return {"healthy": False, "reason": f"{cf} consecutive_failures"}
    return {"healthy": True, "age_min": round(age_min, 1)}


def check_tunnel() -> dict:
    try:
        with urllib.request.urlopen(MC_KB_HEALTH, timeout=5) as r:
            d = json.loads(r.read().decode())
            if d.get("status") == "ok":
                return {"healthy": True, "chunks": d.get("chunks")}
            return {"healthy": False, "reason": f"status={d.get('status')}"}
    except Exception as e:
        return {"healthy": False, "reason": f"unreachable: {str(e)[:80]}"}


def check_alpaca() -> dict:
    """Spot check both accounts return 200."""
    results = {}
    for label, key_file, sec_file in (
        ("boba", "alpaca-key-id", "alpaca-secret"),
        ("jazzy", "alpaca-jazzy-key-id", "alpaca-jazzy-secret"),
    ):
        key = _read(SECRETS / key_file)
        sec = _read(SECRETS / sec_file)
        if not (key and sec):
            results[label] = {"healthy": False, "reason": "missing keys"}
            continue
        try:
            req = urllib.request.Request(
                "https://paper-api.alpaca.markets/v2/account",
                headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec},
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                if r.status == 200:
                    results[label] = {"healthy": True}
                else:
                    results[label] = {"healthy": False, "reason": f"status {r.status}"}
        except Exception as e:
            results[label] = {"healthy": False, "reason": str(e)[:80]}
    return results


def compose_alert(checks: dict) -> str | None:
    """Returns Discord alert text if any check failed; None if all healthy."""
    problems = []
    pm = checks.get("pm2") or {}
    if pm.get("error"):
        problems.append(f"❌ PM2: {pm['error']}")
    if pm.get("missing"):
        problems.append(f"❌ PM2 missing: {', '.join(pm['missing'])}")
    if pm.get("offline"):
        problems.append(f"⚠️ PM2 offline: {', '.join(pm['offline'])}")

    cr = checks.get("cron") or {}
    if cr.get("missing"):
        problems.append(f"❌ Cron missing: {', '.join(cr['missing'])}")

    sf = checks.get("scored") or {}
    if sf.get("stale"):
        problems.append(f"⚠️ scored_signals_recent stale ({sf.get('age_min','?')} min, market hours)")

    rl = checks.get("relay") or {}
    if not rl.get("healthy"):
        problems.append(f"❌ Relay: {rl.get('reason','?')}")

    tun = checks.get("tunnel") or {}
    if not tun.get("healthy"):
        problems.append(f"⚠️ mc-kb tunnel: {tun.get('reason','?')}")

    al = checks.get("alpaca") or {}
    for acct, st in al.items():
        if not st.get("healthy"):
            problems.append(f"❌ Alpaca {acct}: {st.get('reason','?')}")

    if not problems:
        return None
    return "🚨 **Mission Control health check**\n\n" + "\n".join(f"- {p}" for p in problems)


def _state() -> dict:
    return _read_json(STATE_FILE, {"last_alert": "", "last_status": "ok", "consecutive_failures": 0}) or {}


def _save_state(s: dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(s))
    except Exception:
        pass


def _log(entry: dict) -> None:
    try:
        entry["ts"] = now().isoformat(timespec="seconds")
        with LOG_FILE.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def main() -> int:
    checks = {
        "pm2": check_pm2(),
        "cron": check_crons(),
        "scored": check_scored_freshness(),
        "relay": check_relay(),
        "tunnel": check_tunnel(),
        "alpaca": check_alpaca(),
    }
    alert = compose_alert(checks)
    state = _state()
    last_alert_at = state.get("last_alert", "")
    cooldown_ok = True
    if last_alert_at:
        try:
            cooldown_ok = (now() - datetime.fromisoformat(last_alert_at)).total_seconds() / 60 > ALERT_COOLDOWN_MIN
        except Exception:
            cooldown_ok = True

    if alert:
        state["consecutive_failures"] = int(state.get("consecutive_failures", 0)) + 1
        if cooldown_ok:
            posted = post_discord(alert)
            if posted:
                state["last_alert"] = now().isoformat(timespec="seconds")
                state["last_status"] = "alert"
            _log({"status": "alert", "posted": posted, "alert": alert[:400], "checks": checks})
        else:
            _log({"status": "alert_suppressed_cooldown", "checks": checks})
    else:
        # Recovery: if we were in alert state, post the "back to healthy" once.
        if state.get("last_status") == "alert":
            post_discord("✅ Mission Control: all checks healthy again")
            state["last_status"] = "ok"
            state["consecutive_failures"] = 0
            _log({"status": "recovered"})
        else:
            state["consecutive_failures"] = 0
            _log({"status": "ok", "checks_summary": {
                "pm2_missing": len((checks.get("pm2") or {}).get("missing") or []),
                "pm2_offline": len((checks.get("pm2") or {}).get("offline") or []),
                "scored_age_min": (checks.get("scored") or {}).get("age_min"),
                "tunnel_ok": (checks.get("tunnel") or {}).get("healthy"),
            }})

    _save_state(state)
    print(json.dumps({"alert": bool(alert), "consecutive_failures": state.get("consecutive_failures", 0)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
