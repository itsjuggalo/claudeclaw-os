#!/usr/bin/env python3
"""WHOOP -> Health OS sync.

Pulls the latest SCORED recovery and its matching sleep from the WHOOP v2 API
and writes them into the health-os `vitals` table as recovery_pct, hrv_ms,
resting_hr and sleep_hours, one row per metric per local day. The dashboard's
Sleep & recovery card reads exactly these.

WHOOP rotates the refresh token on every refresh and invalidates the old one,
so we persist the new one back to ~/.env each run. Idempotent: re-running a day
replaces that day's rows (delete-then-insert within the local-day window)
rather than duplicating them. Safe to run several times a morning until WHOOP
has scored the night.

Usage:
  python3 whoop-sync.py            # sync the latest night, verbose
  python3 whoop-sync.py --quiet    # only print on change/error (cron mode)
"""
import json
import os
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # py<3.9
    ZoneInfo = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import whoop_common as wc  # noqa: E402
import db  # noqa: E402  (health-os Supabase helper: req, rest)

QUIET = "--quiet" in sys.argv


def log(*a):
    if not QUIET:
        print(*a, flush=True)


def get_tz():
    try:
        st, txt = db.req("GET", db.rest("context", "select=timezone&order=effective_from.desc&limit=1"))
        rows = json.loads(txt) if txt else []
        return (rows[0].get("timezone") if rows else None) or "UTC"
    except Exception:
        return "UTC"


def to_dt(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def zone(tz):
    return ZoneInfo(tz) if (ZoneInfo and tz) else timezone.utc


def local_date(iso, tz):
    return to_dt(iso).astimezone(zone(tz)).date().isoformat()


def day_bounds_utc(day_iso, tz):
    start = datetime.fromisoformat(day_iso + "T00:00:00").replace(tzinfo=zone(tz))
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()


def upsert_vital(metric, value, measured_at, tz):
    """One row per metric per LOCAL day: clear that day's window, insert fresh."""
    if value is None:
        log("  skip %s (no value)" % metric)
        return
    day = local_date(measured_at, tz)
    lo, hi = day_bounds_utc(day, tz)
    flt = "metric=eq.%s&measured_at=gte.%s&measured_at=lt.%s" % (
        metric, urllib.parse.quote(lo), urllib.parse.quote(hi))
    db.req("DELETE", db.rest("vitals", flt))
    st, txt = db.req("POST", db.rest("vitals"),
                     {"metric": metric, "value": value, "measured_at": measured_at},
                     {"Prefer": "return=minimal"})
    if not (200 <= st < 300):
        log("  WARN %s write failed (%s): %s" % (metric, st, txt))


def main():
    env = wc.read_env()
    cid, sec, rt = env.get("WHOOP_CLIENT_ID"), env.get("WHOOP_CLIENT_SECRET"), env.get("WHOOP_REFRESH_TOKEN")
    if not (cid and sec):
        sys.exit("ERROR: WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET missing in ~/.env")
    if not rt:
        log("Not authorized yet. Run whoop-auth.py once. Skipping.")
        return  # exit 0 so cron does not flag a failure

    st, tok = wc.refresh_token(cid, sec, rt)
    if st != 200 or "access_token" not in tok:
        sys.exit("ERROR: token refresh failed (%s): %s. Re-run whoop-auth.py if invalid_grant." % (st, tok))
    if tok.get("refresh_token"):
        wc.set_env("WHOOP_REFRESH_TOKEN", tok["refresh_token"])  # rotation, persist immediately
    token = tok["access_token"]

    st, rec = wc.api_get(token, "/v2/recovery", {"limit": 5})
    if st != 200:
        sys.exit("ERROR: recovery fetch %s: %s" % (st, rec))
    recs = [r for r in (rec.get("records") or []) if r.get("score_state") == "SCORED" and r.get("score")]
    if not recs:
        log("No scored recovery yet (WHOOP may still be scoring the night).")
        return

    r0 = recs[0]
    sc = r0["score"]
    recovery_pct = sc.get("recovery_score")
    hrv = sc.get("hrv_rmssd_milli")
    rhr = sc.get("resting_heart_rate")
    sleep_id = r0.get("sleep_id")
    measured_at = r0.get("created_at")

    sleep_hours = None
    if sleep_id:
        st2, sl = wc.api_get(token, "/v2/activity/sleep/%s" % sleep_id)
        if st2 == 200 and isinstance(sl, dict) and sl.get("score"):
            ss = sl["score"].get("stage_summary", {}) or {}
            asleep = ((ss.get("total_light_sleep_time_milli") or 0)
                      + (ss.get("total_slow_wave_sleep_time_milli") or 0)
                      + (ss.get("total_rem_sleep_time_milli") or 0))
            if asleep:
                sleep_hours = round(asleep / 3.6e6, 2)
            measured_at = sl.get("end") or measured_at

    tz = get_tz()
    upsert_vital("recovery_pct", recovery_pct, measured_at, tz)
    upsert_vital("hrv_ms", round(hrv, 1) if isinstance(hrv, (int, float)) else None, measured_at, tz)
    upsert_vital("resting_hr", rhr, measured_at, tz)
    upsert_vital("sleep_hours", sleep_hours, measured_at, tz)
    log("Synced %s -> recovery %s%%, HRV %sms, RHR %s, sleep %sh"
        % (local_date(measured_at, tz), recovery_pct, hrv, rhr, sleep_hours))


if __name__ == "__main__":
    main()
