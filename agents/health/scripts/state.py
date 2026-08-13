#!/usr/bin/env python3
"""Health OS session snapshot — the rich-memory digest read at the start of
every session, the morning check-in, and /newday.

Pulls the current state from the health-os Supabase project and prints a
compact, phone-readable digest. "Today" boundaries are computed in the owner's
current local timezone (from the context table). Zero external deps; reuses
db.py for the authenticated REST calls.

Usage:
  state.py            # full snapshot
  state.py --today    # just today's running totals (used by /today)
"""
import sys
import urllib.parse
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

import db  # same dir; gives db.req(), db.URL, db.KEY


def get(table, query=""):
    status, text = db.req("GET", db.rest(table, query))
    if not (200 <= status < 300):
        return []
    import json
    try:
        return json.loads(text)
    except ValueError:
        return []


def rpc_or_none():
    pass


def num(x):
    return x if isinstance(x, (int, float)) else None


def fnum(x, d=0):
    v = num(x)
    return round(v, 1) if v is not None else d


TARGET_WEIGHT_KG = 80.0      # EXAMPLE goal weight in kg, set yours
BASELINE_FALLBACK_KG = 100.0  # EXAMPLE baseline fallback if no baseline row


def main():
    only_today = "--today" in sys.argv
    only_sofar = "--sofar" in sys.argv

    # --- where the owner is + the local clock -----------------------------------
    ctx = get("context", "select=*&order=effective_from.desc&limit=1")
    ctx = ctx[0] if ctx else {}
    tzname = ctx.get("timezone") or "UTC"
    tz = ZoneInfo(tzname) if (ZoneInfo and tzname) else None
    now = datetime.now(tz) if tz else datetime.now()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    q_mid = urllib.parse.quote(midnight.isoformat())
    q_week = urllib.parse.quote(week_ago.isoformat())

    lines = []

    # --- weight vs baseline + target ---------------------------------------
    base = get("weigh_ins", "select=weight_kg,measured_at&is_baseline=eq.true&limit=1")
    base = base[0] if base else {}
    base_w = fnum(base.get("weight_kg"), BASELINE_FALLBACK_KG)
    base_date = (base.get("measured_at") or "2026-05-11")[:10]
    recent = get("weigh_ins", "select=weight_kg,measured_at&order=measured_at.desc&limit=30")
    latest = recent[0] if recent else base
    latest_w = fnum(latest.get("weight_kg"), base_w)
    day_n = None
    try:
        bd = datetime.fromisoformat(base_date).date()
        day_n = (now.date() - bd).days + 1
    except ValueError:
        pass

    header = f"HEALTH STATE  {now.date()}"
    if day_n:
        header += f"  (day {day_n} since baseline)"
    lines.append(header)
    if ctx:
        chef = ", private chef" if ctx.get("private_chef") else ""
        lines.append(f"Location: {ctx.get('city','?')}, {ctx.get('environment','?')}{chef} ({tzname})")
    lines.append("")

    lost = round(base_w - latest_w, 1)
    to_go = round(latest_w - TARGET_WEIGHT_KG, 1)
    wline = f"Weight: {latest_w} kg  (baseline {base_w}, target {TARGET_WEIGHT_KG}, lost {lost}, {to_go} to go)"
    # 7-day trend
    wk = [r for r in recent if (r.get("measured_at") or "") >= week_ago.isoformat()]
    if len(recent) >= 2 and wk:
        oldest_wk = fnum(wk[-1].get("weight_kg"))
        if oldest_wk is not None:
            d7 = round(latest_w - oldest_wk, 1)
            wline += f"  | 7d {'+' if d7 >= 0 else ''}{d7}"
    if len(recent) <= 1:
        wline += "  | only baseline logged, prompt for a weigh-in"
    lines.append(wline)

    # --- today's intake ----------------------------------------------------
    food = get("food_log", f"select=est_calories,protein_g,carbs_g,fat_g,sat_fat_flag,sodium_flag,sugar_flag&eaten_at=gte.{q_mid}")
    cal = round(sum(num(f.get("est_calories")) or 0 for f in food))
    pro = round(sum(num(f.get("protein_g")) or 0 for f in food))
    carb = round(sum(num(f.get("carbs_g")) or 0 for f in food))
    fat = round(sum(num(f.get("fat_g")) or 0 for f in food))
    satf = sum(1 for f in food if f.get("sat_fat_flag"))
    sodf = sum(1 for f in food if f.get("sodium_flag"))
    sugf = sum(1 for f in food if f.get("sugar_flag"))
    lines.append("Today so far:")
    lines.append(f"  {cal} kcal | protein {pro}/150-190 g | carbs {carb} | fat {fat} ({len(food)} meals)")
    flags = []
    if satf: flags.append(f"sat-fat x{satf}")
    if sodf: flags.append(f"sodium x{sodf}")
    if sugf: flags.append(f"sugar x{sugf}")
    if flags:
        lines.append("  flags: " + ", ".join(flags))

    # caffeine today
    caf = get("caffeine_log", f"select=caffeine_mg,consumed_at&order=consumed_at.desc&consumed_at=gte.{q_mid}")
    caf_mg = round(sum(num(c.get("caffeine_mg")) or 0 for c in caf))
    cline = f"  caffeine {caf_mg} mg / ~300 ceiling"
    if caf:
        last = caf[0].get("consumed_at", "")[11:16]
        cline += f" (last {last})"
    lines.append(cline)

    # supplements today
    # Standing default: the owner takes their AM + PM stack every day. Assume
    # adherence and do NOT nag about an empty log. Only surface supplements when
    # there is a real exception: a row he explicitly logged as skipped, or a
    # time-sensitive action (the weekly Vit D day, the zinc pulse, the creatine
    # pause before a panel). An empty log means "on protocol", not "missed".
    sup = get("supplements_log", f"select=supplement,taken&taken_at=gte.{q_mid}")
    if sup:
        taken = ", ".join(s["supplement"] for s in sup if s.get("taken"))
        missed = ", ".join(s["supplement"] for s in sup if not s.get("taken"))
        base = f"  supplements: {taken or 'on protocol (assumed)'}"
        lines.append(base + (f" | SKIPPED {missed}" if missed else ""))
    else:
        lines.append("  supplements: on protocol (assumed, AM + PM boxes)")

    # --- sleep & recovery (WHOOP, auto-synced every morning) ---------------
    # Latest scored night from the WHOOP sync. Gives the coach today's physical
    # readiness while it assesses food, caffeine and training as the owner logs.
    # Anchor on the latest recovery row (WHOOP-only metric), then read HRV, RHR
    # and sleep AT THAT SAME timestamp so the line is one consistent night and a
    # later manual spot reading (e.g. a midday RHR) can't pollute it.
    rec = get("vitals", "select=value,measured_at&metric=eq.recovery_pct&order=measured_at.desc&limit=1")
    rec_v = hrv_v = rhr_v = slp_v = None
    night = None
    if rec:
        rec_v = fnum(rec[0].get("value"))
        anchor = rec[0].get("measured_at") or ""
        night = anchor[:10]
        qa = urllib.parse.quote(anchor)
        hrvr = get("vitals", f"select=value&metric=eq.hrv_ms&measured_at=eq.{qa}&limit=1")
        rhrr = get("vitals", f"select=value&metric=eq.resting_hr&measured_at=eq.{qa}&limit=1")
        slpr = get("vitals", f"select=value&metric=eq.sleep_hours&measured_at=eq.{qa}&limit=1")
        hrv_v = fnum(hrvr[0].get("value")) if hrvr else None
        rhr_v = fnum(rhrr[0].get("value")) if rhrr else None
        slp_v = fnum(slpr[0].get("value")) if slpr else None

    def _slept(h):
        hh = int(h); mm = round((h - hh) * 60)
        if mm == 60: hh += 1; mm = 0
        return f"{hh}h{mm:02d}m"

    if rec_v is not None:
        parts = []
        band = "green" if rec_v >= 67 else ("yellow" if rec_v >= 34 else "RED, go easy")
        parts.append(f"recovery {rec_v}% ({band})")
        if slp_v is not None:
            parts.append(f"slept {_slept(slp_v)}")
        if hrv_v is not None:
            parts.append(f"HRV {hrv_v}ms")
        if rhr_v is not None:
            parts.append(f"RHR {rhr_v}")
        suffix = f"  [night of {night}]" if night else ""
        lines.append("Sleep/recovery (WHOOP): " + " | ".join(parts) + suffix)
    else:
        lines.append("Sleep/recovery (WHOOP): no night synced yet")

    if only_sofar:
        # Deterministic rich Telegram HTML for /sofar, relayed verbatim by the
        # coach. Telegram HTML only supports <b>/<pre>/etc, and a <pre> block
        # with space-aligned columns is the one way to get an aligned table.
        # Avoid '<' in text (Telegram would read it as a tag), so targets are
        # plain numbers.
        bps = get("vitals", "select=value&metric=eq.bp_systolic&order=measured_at.desc&limit=1")
        bpd = get("vitals", "select=value&metric=eq.bp_diastolic&order=measured_at.desc&limit=1")
        bp_sys = fnum(bps[0].get("value")) if bps else None
        bp_dia = fnum(bpd[0].get("value")) if bpd else None
        taken_n = sum(1 for s in sup if s.get("taken"))
        total_n = len(sup)

        out = []
        hd = f"Day {day_n}" if day_n else str(now.date())
        out.append(f"## \U0001F4CA Today so far · {hd}")
        out.append("")
        out.append("| Metric | Today | Target |")
        out.append("|---|---|---|")
        out.append(f"| Calories | {cal} |  |")
        out.append(f"| Protein | {pro} g | 150-190 |")
        out.append(f"| Carbs | {carb} g |  |")
        out.append(f"| Fat | {fat} g |  |")
        out.append(f"| Caffeine | {caf_mg} mg | 300 |")
        out.append("")
        bp_txt = f"{bp_sys}/{bp_dia} (target 120)" if bp_sys is not None else "not logged yet"
        out.append(f"\U0001FA78 BP {bp_txt}   \U0001F37D {len(food)} meals today")
        if rec_v is not None or slp_v is not None:
            rtxt = []
            if rec_v is not None: rtxt.append(f"recovery {rec_v}%")
            if slp_v is not None: rtxt.append(f"sleep {_slept(slp_v)}")
            out.append("\U0001F634 " + " · ".join(rtxt))
        fl = []
        if satf: fl.append(f"sat-fat x{satf}")
        if sodf: fl.append(f"sodium x{sodf}")
        if sugf: fl.append(f"sugar x{sugf}")
        if fl:
            out.append("⚠️ flags: " + ", ".join(fl))
        out.append(f"\U0001F48A supplements {taken_n}/{total_n}" if total_n else "\U0001F48A supplements: on protocol")
        print("\n".join(out))
        return

    if only_today:
        print("\n".join(lines))
        return

    # --- training this week ------------------------------------------------
    wo = get("workouts", f"select=type,performed_at&order=performed_at.desc&performed_at=gte.{q_week}")
    if wo:
        last = wo[0]
        lines.append(f"Workouts (7d): {len(wo)} | last {last.get('type','?')} on {last.get('performed_at','')[:10]}")
    else:
        lines.append("Workouts (7d): 0 logged")

    # --- sleep & recovery, 7-day pattern (WHOOP) ---------------------------
    # Lets the morning review speak to streaks, not just last night. recovery_pct
    # is WHOOP-only; sleep is matched to those night timestamps so a manual spot
    # row can't leak into the average.
    rec7 = get("vitals", f"select=value,measured_at&metric=eq.recovery_pct&measured_at=gte.{q_week}&order=measured_at.asc")
    rvals = [fnum(r.get("value")) for r in rec7 if fnum(r.get("value")) is not None]
    if rvals:
        night_ts = {r.get("measured_at") for r in rec7}
        slp7 = get("vitals", f"select=value,measured_at&metric=eq.sleep_hours&measured_at=gte.{q_week}&order=measured_at.asc")
        svals = [fnum(s.get("value")) for s in slp7 if s.get("measured_at") in night_ts and fnum(s.get("value")) is not None]
        avg_r = round(sum(rvals) / len(rvals))
        direction = "flat"
        if len(rvals) >= 3:
            h = len(rvals) // 2
            first = sum(rvals[:h]) / h
            last_h = sum(rvals[h:]) / (len(rvals) - h)
            if last_h - first >= 5: direction = "trending up"
            elif first - last_h >= 5: direction = "trending down"
        seg = f"Sleep/recovery 7d: avg recovery {avg_r}% ({direction}, {len(rvals)} night{'s' if len(rvals) != 1 else ''})"
        if svals:
            short = sum(1 for v in svals if v < 6.5)
            seg += f", avg sleep {_slept(sum(svals) / len(svals))}"
            if short:
                seg += f", {short} short night{'s' if short != 1 else ''} (<6.5h)"
        lines.append(seg)

    # --- BP, the urgent gap ------------------------------------------------
    bp = get("vitals", "select=value,unit,measured_at&metric=eq.bp_systolic&order=measured_at.desc&limit=1")
    if bp:
        lines.append(f"BP: last systolic {fnum(bp[0].get('value'))} on {bp[0].get('measured_at','')[:10]}")
    else:
        lines.append("BP: STILL UNMEASURED  (log a reading soon)")

    # --- goals -------------------------------------------------------------
    goals = get("goals", "select=metric,current_value,target_value&order=id")
    if goals:
        lines.append("Goals:")
        for g in goals:
            cv = g.get("current_value")
            cv = fnum(cv) if cv is not None else "?"
            lines.append(f"  {g['metric']}: {cv} -> {fnum(g.get('target_value'))}")

    # --- open action items (static reminders until done) -------------------
    lines.append("Open items: log a BP reading, schedule any pending labs or scans, next retest")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
