"""boba_flow_enhancements — supplementary signal-quality helpers for Boba/Jazzy.

All functions return a Markdown block (or "" if their data is unavailable). The
decision cycle imports this module and injects the blocks into the prompt before
the existing best_options_text. Designed to NEVER raise — every helper wraps its
work in try/except and returns "" on any failure so the trading cycle continues.

Helpers:
  - platinum_mandate_banner()  → HARD RULE banner when Platinum tier hits exist
  - confluence_block()         → multi-source agreement scoring per ticker (4h window)
  - fresh_flow_5min_block()    → 🔥 LAST 5 MIN whale prints (institutional opens)
  - strike_cluster_block()     → 📊 tickers with 3+ distinct T1+T2 strikes today
  - sector_mix_warning()       → ⚠️ when 3+ picks fall in same sector

Tier-ladder + tiebreaker tweaks (IV-adjusted stops, Kronos confidence) are
applied via prompt-text edits in the patch script, not via this module.
"""
from __future__ import annotations

import collections
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

DIRECTIVES = Path("/home/ubuntu/.openclaw/workspace/directives")
BEST_OPTIONS_DIR = Path.home() / ".openclaw" / "data" / "best-options"
SCORED_PATH = Path("/home/ubuntu/mission-control/signal-receiver/data/scored_signals_recent.json")

# Coarse sector map — extend as needed. Tickers not in map fall under "OTHER".
SECTOR_MAP = {
    # AI / Semis
    "NVDA": "AI-semi", "AMD": "AI-semi", "MU": "AI-semi", "TSM": "AI-semi",
    "AVGO": "AI-semi", "INTC": "AI-semi", "SMCI": "AI-semi", "MRVL": "AI-semi",
    "ARM": "AI-semi", "QCOM": "AI-semi", "ASML": "AI-semi",
    # Mega-cap tech
    "AAPL": "mega-tech", "MSFT": "mega-tech", "GOOGL": "mega-tech",
    "GOOG": "mega-tech", "META": "mega-tech", "AMZN": "mega-tech",
    # Index ETFs / vol products
    "SPY": "index", "QQQ": "index", "IWM": "index", "DIA": "index",
    "SPX": "index", "NDX": "index", "VIX": "index", "UVXY": "index",
    # Crypto-proxy
    "MSTR": "crypto-proxy", "COIN": "crypto-proxy", "MARA": "crypto-proxy",
    "RIOT": "crypto-proxy",
    # Energy
    "XOM": "energy", "CVX": "energy", "OXY": "energy", "COP": "energy",
    "SLB": "energy", "USO": "energy", "XLE": "energy",
    # Financials
    "JPM": "financial", "BAC": "financial", "GS": "financial", "MS": "financial",
    "WFC": "financial", "C": "financial", "XLF": "financial",
    # Healthcare / pharma
    "LLY": "pharma", "UNH": "pharma", "JNJ": "pharma", "PFE": "pharma",
    "MRK": "pharma", "ABBV": "pharma", "XLV": "pharma",
    # EV / auto
    "TSLA": "ev-auto", "RIVN": "ev-auto", "LCID": "ev-auto", "F": "ev-auto",
    "GM": "ev-auto", "NIO": "ev-auto",
    # Consumer
    "WMT": "consumer", "HD": "consumer", "TGT": "consumer", "COST": "consumer",
    "NKE": "consumer", "SBUX": "consumer", "MCD": "consumer",
}


def _safe_read_json(path: Path, default):
    try:
        if not path.exists():
            return default
        return json.loads(path.read_text())
    except Exception:
        return default


def _today_et_str() -> str:
    """Best-options snapshots are keyed by ET date (UTC-4 standard)."""
    return (datetime.now(timezone.utc) + timedelta(hours=-4)).strftime("%Y-%m-%d")


def _read_best_options_today() -> list[dict]:
    fp = BEST_OPTIONS_DIR / f"{_today_et_str()}.json"
    snap = _safe_read_json(fp, {})
    return (snap.get("sorted_by_premium") or []) if isinstance(snap, dict) else []


# ──────────────────────────────────────────────────────────────────────────────
# 1) PLATINUM MANDATE banner — hard gate on the unique 4-condition tier
# ──────────────────────────────────────────────────────────────────────────────

def platinum_mandate_banner(has_platinum: bool) -> str:
    if not has_platinum:
        return ""
    return (
        "\n🚨 **PLATINUM MANDATE ACTIVE THIS CYCLE**\n"
        "\n"
        "The Platinum tier (1–3% of all whale flow — premium ≥$10M + Vol≥5×OI + Sweep≥80% + DTE extreme) "
        "has at least one candidate below.\n"
        "\n"
        "**Hard rule (Bible 18.8):** Every NEW pick this cycle MUST come from the Platinum list, OR you must "
        "cite in `reasoning` the *specific* reason a non-Platinum candidate is superior (e.g. better R:R, "
        "better Kronos alignment, multi-source confluence). Picking a non-Platinum without explicit "
        "justification is treated as a violation of the unusual-flow priority rule.\n"
        "\n"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 2) Multi-source confluence — same-ticker same-direction across N feeds in 4h
# ──────────────────────────────────────────────────────────────────────────────

def confluence_block(shortlist_tickers: list[str], window_hours: int = 4) -> str:
    if not shortlist_tickers:
        return ""

    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    cutoff_iso = cutoff.isoformat()

    def _is_bull(item) -> bool | None:
        """Return True/False direction, or None if unknown."""
        if not isinstance(item, dict):
            return None
        if "is_bullish" in item:
            return bool(item["is_bullish"])
        if "is_put" in item:
            return not bool(item["is_put"])
        # Heuristic from text fields
        for fld in ("action", "category", "direction"):
            v = (item.get(fld) or "").upper()
            if "BUY" in v or "BULL" in v or "CALL" in v:
                return True
            if "SELL" in v or "BEAR" in v or "PUT" in v:
                return False
        return None

    def _item_ts(item) -> str:
        return item.get("captured_at") or item.get("timestamp") or item.get("created_at") or ""

    feeds: dict[str, list[dict]] = {
        "trade_signals": _safe_read_json(DIRECTIVES / "firebase_trade_signals.json", []),
        "flow_alerts": _safe_read_json(DIRECTIVES / "firebase_flow_alerts.json", []),
        "notifications": _safe_read_json(DIRECTIVES / "firebase_signal_notifications.json", []),
        "best_options": _read_best_options_today(),
    }

    rows = []
    for ticker in shortlist_tickers:
        bull_sources = {}
        bear_sources = {}
        for src_name, items in feeds.items():
            if not isinstance(items, list):
                continue
            bull = 0
            bear = 0
            for it in items:
                if not isinstance(it, dict):
                    continue
                if (it.get("ticker") or "").upper() != ticker.upper():
                    continue
                ts = _item_ts(it)
                if ts and ts < cutoff_iso:
                    continue
                d = _is_bull(it)
                if d is True:
                    bull += 1
                elif d is False:
                    bear += 1
            if bull >= 1:
                bull_sources[src_name] = bull
            if bear >= 1:
                bear_sources[src_name] = bear

        # Tally — biased side counts as "agreement" only if ≥2× the opposite
        bull_total = sum(bull_sources.values())
        bear_total = sum(bear_sources.values())
        # Skip rows where the ticker has no data in any feed — they clutter the prompt
        if bull_total == 0 and bear_total == 0:
            continue
        if bull_total >= max(2 * bear_total, 1) and bull_total >= 2:
            direction = "BULL"
            src_count = len(bull_sources)
            details = ", ".join(f"{s}×{n}" for s, n in bull_sources.items())
        elif bear_total >= max(2 * bull_total, 1) and bear_total >= 2:
            direction = "BEAR"
            src_count = len(bear_sources)
            details = ", ".join(f"{s}×{n}" for s, n in bear_sources.items())
        else:
            direction = "MIXED"
            src_count = len(set(list(bull_sources) + list(bear_sources)))
            details = (
                f"BULL: {', '.join(bull_sources) or 'none'} | "
                f"BEAR: {', '.join(bear_sources) or 'none'}"
            )
        rows.append((ticker, direction, src_count, details))

    if not rows:
        return ""

    # Sort: more sources first; BULL/BEAR before MIXED
    rows.sort(key=lambda r: (-r[2], 0 if r[1] != "MIXED" else 1))

    lines = [
        f"\n# 🎯 MULTI-SOURCE CONFLUENCE ({window_hours}h window — ≥3 sources agreeing = strong)",
        "# Sources scanned: trade_signals (provider buy/sell), flow_alerts (algo unusual), notifications (push), best_options (whale archive).",
        "# A ticker with 3+ independent sources agreeing direction = act as if upgraded one tier (T2 → T1, etc).",
    ]
    for ticker, direction, n, details in rows[:8]:
        emoji = "🟢" if direction == "BULL" else ("🔴" if direction == "BEAR" else "⚪")
        lines.append(f"  {emoji} **{ticker}** — {direction} ({n} sources) | {details}")
    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────────────
# 3) Fresh 5-min whale prints
# ──────────────────────────────────────────────────────────────────────────────

def fresh_flow_5min_block(window_minutes: int = 5) -> str:
    contracts = _read_best_options_today()
    if not contracts:
        return ""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=window_minutes)).isoformat()
    fresh = [c for c in contracts if isinstance(c, dict) and (c.get("captured_at") or "") > cutoff]
    # Floor at T2 ($1M+)
    fresh = [c for c in fresh if (c.get("premium") or 0) >= 1_000_000]
    if not fresh:
        return ""
    fresh.sort(key=lambda c: -(c.get("premium") or 0))
    lines = [
        f"\n# 🔥 LAST {window_minutes} MINUTES — fresh institutional prints (T1/T2 only)",
        "# Recency in flow matters: morning institutional opens > 3:55 PM retail muppet flow.",
        "# Bias toward these if the broader confluence agrees direction.",
    ]
    for c in fresh[:8]:
        side = "C" if (c.get("option_type") or "?").upper().startswith("C") else "P"
        bull = "BULL" if c.get("is_bullish") else "BEAR"
        lines.append(
            f"  🔥 ${(c.get('premium') or 0)/1_000_000:>5.1f}M  {c.get('ticker','?'):5s} "
            f"${c.get('strike',0):.0f}{side} {c.get('expiry','?')} ({c.get('dte',0)}d) {bull} "
            f"| V:{c.get('volume',0):,} OI:{c.get('oi',0):,} Sw:{c.get('sweeps',0)}"
        )
    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────────────
# 4) Strike-range clusters — smart money playing a strike RANGE on one ticker
# ──────────────────────────────────────────────────────────────────────────────

def strike_cluster_block(min_strikes: int = 3) -> str:
    contracts = _read_best_options_today()
    if not contracts:
        return ""
    # T1+T2 only
    whale = [c for c in contracts
             if isinstance(c, dict) and c.get("tier") in ("T1_HUGE", "T2_UNUSUAL_HUGE")]
    by_ticker: dict[str, dict] = {}
    for c in whale:
        t = c.get("ticker") or "?"
        b = by_ticker.setdefault(t, {"strikes": set(), "total_prem": 0, "calls": 0, "puts": 0})
        b["strikes"].add((c.get("strike", 0), c.get("option_type", "?")))
        b["total_prem"] += c.get("premium") or 0
        if (c.get("option_type") or "").upper().startswith("C"):
            b["calls"] += 1
        else:
            b["puts"] += 1

    clusters = [(t, b) for t, b in by_ticker.items() if len(b["strikes"]) >= min_strikes]
    if not clusters:
        return ""
    clusters.sort(key=lambda x: -x[1]["total_prem"])

    lines = [
        f"\n# 📊 STRIKE-RANGE CLUSTERS (T1+T2, ≥{min_strikes} distinct strikes same ticker today)",
        "# Smart money playing a strike RANGE on one ticker = high-conviction directional/positioning thesis,",
        "# stronger than a single repeated contract. Bias toward these for new picks.",
    ]
    for t, b in clusters[:6]:
        strikes_str = ", ".join(
            f"${s:.0f}{ot[0].upper()}" for s, ot in sorted(b["strikes"])
        )[:120]
        bias = "BULL" if b["calls"] > b["puts"] else ("BEAR" if b["puts"] > b["calls"] else "MIXED")
        lines.append(
            f"  **{t}** — {len(b['strikes'])} strikes, ${b['total_prem']/1_000_000:.1f}M total, {bias} "
            f"({b['calls']}C/{b['puts']}P) | {strikes_str}"
        )
    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────────────
# 5) Sector mix warning — when 3+ picks fall in same sector
# ──────────────────────────────────────────────────────────────────────────────

def sector_mix_warning(shortlist_tickers: list[str], threshold: int = 3) -> str:
    if not shortlist_tickers:
        return ""
    counter = collections.Counter(SECTOR_MAP.get(t.upper(), "OTHER") for t in shortlist_tickers)
    if not counter:
        return ""
    top_sector, top_count = counter.most_common(1)[0]
    if top_sector == "OTHER" or top_count < threshold:
        return ""
    by_sector = ", ".join(f"{n}× {s}" for s, n in counter.most_common())
    return (
        f"\n# ⚠️ SECTOR CONCENTRATION — {top_count}/{len(shortlist_tickers)} shortlist in **{top_sector}**\n"
        f"# Mix: {by_sector}\n"
        f"# If you pick all from this sector you carry single-factor risk. "
        f"# Either justify the concentration (e.g. specific sector catalyst) "
        f"or rebalance one pick to a different sector ticker on the shortlist.\n"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Convenience: assemble all blocks given shortlist + platinum existence
# ──────────────────────────────────────────────────────────────────────────────

def assemble_enhancements(shortlist_tickers: list[str], platinum_count: int = 0) -> str:
    """One-liner for the patch — concatenates all enhancement blocks."""
    parts = [
        platinum_mandate_banner(platinum_count > 0),
        confluence_block(shortlist_tickers),
        fresh_flow_5min_block(),
        strike_cluster_block(),
        sector_mix_warning(shortlist_tickers),
    ]
    return "".join(p for p in parts if p)


if __name__ == "__main__":
    # Self-test
    import sys
    tickers = sys.argv[1:] or ["NVDA", "SPY", "TSLA", "MU", "QQQ"]
    out = assemble_enhancements(tickers, platinum_count=1)
    print(out or "(no enhancement output — feeds may be empty)")
