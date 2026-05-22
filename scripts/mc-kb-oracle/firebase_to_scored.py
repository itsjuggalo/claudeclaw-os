#!/usr/bin/env python3
"""Shim: convert firebase_trade_signals.json → scored_signals_recent.json.

Replaces the dead `signal-receiver/flow_scorer` pipeline that used to convert Firebase
RTDB signals into Boba's expected sidecar format. Idempotent — overwrites the output
on each run. Designed to run every 1-2 min via cron during market hours.

Schema mapping:
  Firebase signal                       Boba scored_signal
  ────────────────────────────────────  ──────────────────────────────────────────
  captured_at                           timestamp
  ticker                                ticker
  is_put: True → "PUT" / False → "CALL" option_type
  strike (str → float)                  strike
  expiry_ts (unix seconds)              expiry (MM/DD/YY), dte (days)
  category (SCALP / SWING / ...)        alert_type
  risk (VH/H/M/L)                       (modulates score)
  is_free                               (modulates score)
  buy_target / sell_target / stop_loss  reasons[]
  id                                    _firebase_id
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

FIREBASE_FEED = Path("/home/ubuntu/.openclaw/workspace/directives/firebase_trade_signals.json")
FIREBASE_FLOW = Path("/home/ubuntu/.openclaw/workspace/directives/firebase_flow_alerts.json")
OUT_PATH = Path("/home/ubuntu/mission-control/signal-receiver/data/scored_signals_recent.json")

# Base score by category (Boba's score sort order).
CATEGORY_SCORE = {
    "SWING": 80,
    "SCALP": 70,
    "MOMENTUM": 75,
    "BREAKOUT": 75,
    "LOTTO": 60,
}
# Risk modifier — high risk = high reward potential, but more variance.
RISK_MOD = {"VH": -5, "H": -2, "M": 0, "L": +3}
# Default flow value by risk — clears Boba's MIN_FLOW_VALUE threshold ($500K).
RISK_FLOW = {"VH": 1_500_000, "H": 1_000_000, "M": 750_000, "L": 500_000}


def grade_from_score(s: int) -> str:
    if s >= 85: return "A"
    if s >= 75: return "B"
    if s >= 65: return "C"
    return "D"


def fmt_expiry(ts_str: str) -> tuple[str, int]:
    """Parse expiry timestamp (unix seconds) → ('MM/DD/YY', dte_days)."""
    try:
        ts = int(float(ts_str))
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        dte = max(0, (dt - datetime.now(timezone.utc)).days)
        return dt.strftime("%m/%d/%y"), dte
    except (ValueError, TypeError):
        return "00/00/00", 0


def fmt_flow_raw(v: float) -> str:
    if v >= 1_000_000:
        return f"${v/1_000_000:.1f}M"
    if v >= 1_000:
        return f"${v/1_000:.0f}K"
    return f"${v:.0f}"


def convert(sig: dict) -> dict:
    """Map one firebase signal → one scored_signals entry."""
    cat = (sig.get("category") or "").upper()
    risk = (sig.get("risk") or "").upper()
    is_free = bool(sig.get("is_free", 0))

    base = CATEGORY_SCORE.get(cat, 65)
    score = base + RISK_MOD.get(risk, 0) + (-5 if is_free else 0)
    score = max(40, min(95, score))

    flow_value = RISK_FLOW.get(risk, 500_000)
    try:
        strike = float(sig.get("strike", 0))
    except (ValueError, TypeError):
        strike = 0.0

    expiry_str, dte = fmt_expiry(sig.get("expiry_ts", "0"))
    fb_id = (sig.get("id") or "").replace("sig:", "")

    reasons = [
        f"Firebase: {sig.get('source','?')}/{sig.get('path','?')}",
        f"Risk={risk} Cat={cat}",
    ]
    bt, st, sl = sig.get("buy_target"), sig.get("sell_target"), sig.get("stop_loss")
    if any([bt, st, sl]):
        reasons.append(f"BT={bt or '?'} ST={st or '?'} SL={sl or '?'}")
    if is_free:
        reasons.append("free-tier signal")

    return {
        "timestamp": sig.get("captured_at", datetime.now(timezone.utc).isoformat()),
        "ticker": sig.get("ticker", "?"),
        "option_type": "PUT" if sig.get("is_put") else "CALL",
        "strike": strike,
        "expiry": expiry_str,
        "dte": dte,
        "spot": strike,  # we don't have spot from Firebase; use strike as rough proxy
        "flow_value": float(flow_value),
        "flow_value_raw": fmt_flow_raw(flow_value),
        "tier": "WHALE-FIREBASE",
        "volume": 100,        # placeholder — Boba uses for tie-break, not gate
        "oi": 1000,
        "vol_oi_ratio": 0.1,
        "sweeps": 1,
        "blocks": 0,
        "alert_type": cat.lower() if cat else "swing",
        "score": score,
        "grade": grade_from_score(score),
        "reasons": reasons,
        "_source": "firebase_converter",
        "_firebase_id": fb_id,
    }


def convert_flow_alert(sig: dict) -> dict:
    """Map one FlowGreeks flow_alert → one scored_signals entry. Algorithmic
    unusual-flow detection — feeds Boba's Protocol A (T0-T4 premium ladder)."""
    fv = float(sig.get("flow_value") or 0)
    # Tier from premium → score → grade
    if fv >= 10_000_000:    score, tier = 95, "T0_MEGA"
    elif fv >= 5_000_000:   score, tier = 88, "T1_HUGE"
    elif fv >= 1_000_000:   score, tier = 78, "T2_UNUSUAL_HUGE"
    elif fv >= 500_000:     score, tier = 68, "T3_UNUSUAL"
    elif fv >= 100_000:     score, tier = 58, "T4_UNUSUAL"
    else:                   score, tier = 50, "T4_UNUSUAL"

    expiry_str, dte = fmt_expiry(str(sig.get("expiry_ts") or 0))
    try:
        strike = float(sig.get("strike") or 0)
    except (ValueError, TypeError):
        strike = 0.0
    spot = sig.get("spot") or strike or 0
    is_bull = bool(sig.get("is_bullish"))

    return {
        "timestamp": sig.get("captured_at") or datetime.now(timezone.utc).isoformat(),
        "ticker": sig.get("ticker", "?"),
        "option_type": (sig.get("option_type") or "C").upper(),
        "strike": strike,
        "expiry": expiry_str,
        "dte": dte,
        "spot": spot,
        "flow_value": fv,
        "flow_value_raw": fmt_flow_raw(fv),
        "tier": tier,
        "volume": sig.get("flow_count") or 100,
        "oi": 1000,
        "vol_oi_ratio": 0.1,
        "sweeps": 1,
        "blocks": 0,
        "alert_type": sig.get("alert_type") or "weekly_flow",
        "score": score,
        "grade": grade_from_score(score),
        "is_bullish": is_bull,
        "reasons": [
            f"FlowGreeks: {sig.get('source','FlowGreeks2')}/{sig.get('alert_type','flow')}",
            f"Premium {fmt_flow_raw(fv)} → tier {tier}",
            f"Direction: {'BULL' if is_bull else 'BEAR'}",
        ],
        "_source": "flowgreeks_converter",
        "_firebase_id": (sig.get("id") or "").replace("flow:", ""),
    }


def main() -> int:
    converted: list[dict] = []

    # Provider signals (Vivid2 / Name / Name2 — human-published "buy this contract")
    if FIREBASE_FEED.exists():
        try:
            feed = json.loads(FIREBASE_FEED.read_text())
            if isinstance(feed, list):
                trade_signals = [s for s in feed if isinstance(s, dict) and s.get("signal_kind") == "trade_signal"]
                converted.extend(convert(s) for s in trade_signals)
        except Exception as e:
            print(f"can't parse {FIREBASE_FEED}: {e}", file=sys.stderr)

    # Algo flow alerts (FlowGreeks / FlowGreeks2 — unusual options flow)
    if FIREBASE_FLOW.exists():
        try:
            flow = json.loads(FIREBASE_FLOW.read_text())
            if isinstance(flow, list):
                alerts = [s for s in flow if isinstance(s, dict) and s.get("signal_kind") == "flow_alert"]
                converted.extend(convert_flow_alert(s) for s in alerts)
        except Exception as e:
            print(f"can't parse {FIREBASE_FLOW}: {e}", file=sys.stderr)

    if not converted:
        print("no signals available in either feed", file=sys.stderr)
        return 1

    # Sort newest-first (Boba reads chronologically but doesn't care about order).
    converted.sort(key=lambda x: x.get("timestamp", ""), reverse=False)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(converted, indent=2))

    # Summary
    by_day: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for c in converted:
        d = c.get("timestamp", "")[:10] or "unknown"
        by_day[d] = by_day.get(d, 0) + 1
        s = c.get("_source", "?")
        by_source[s] = by_source.get(s, 0) + 1
    print(json.dumps({
        "wrote": str(OUT_PATH),
        "converted": len(converted),
        "by_source": by_source,
        "by_day": dict(sorted(by_day.items())[-5:]),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
