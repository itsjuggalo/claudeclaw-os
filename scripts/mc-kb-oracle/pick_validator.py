"""pick_validator — 2-minute research-and-confirm pass between Boba's pick and execution.

For each pick Claude returns, this module:
  1. Captures a t=0 snapshot (live quote, IV, recent flow, market regime)
  2. Sleeps 120s — gives the market time to move + new flow to land
  3. Captures a t=120 snapshot
  4. Calls Claude briefly with the deltas + asks PROCEED or ABORT per pick
  5. Returns only the PROCEED picks back to the execution loop

If anything fails (network, Claude unreachable, missing keys), defaults to
PROCEED with the original picks — never breaks the trading cycle, but the
journal logs which picks went unvalidated.

Used by boba_decision_cycle.py + jazzy_decision_cycle.py via:
    from pick_validator import validate_picks
    picks_to_execute = validate_picks(picks, account="boba", sleep_sec=120)
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

SECRETS = Path("/home/ubuntu/.openclaw/secrets")
ALPACA_BASE = "https://paper-api.alpaca.markets/v2"
ALPACA_DATA_BASE = "https://data.alpaca.markets"
DB_PATH = Path("/home/ubuntu/mission-control-restored/data/options_flow.sqlite")
MC_KB_BASE = "http://127.0.0.1:8091"
CLAUDE_BIN = "/home/ubuntu/.npm-global/bin/claude"
JOURNAL_LOG = Path("/home/ubuntu/.openclaw/data/logs/pick_validator.jsonl")
JOURNAL_LOG.parent.mkdir(parents=True, exist_ok=True)


def _alpaca_headers(account: str) -> dict:
    """Resolve API keys for boba/jazzy from secret files."""
    if account == "boba":
        key_file, sec_file = "alpaca-key-id", "alpaca-secret"
    else:
        key_file, sec_file = f"alpaca-{account}-key-id", f"alpaca-{account}-secret"
    try:
        key = (SECRETS / key_file).read_text().strip()
        sec = (SECRETS / sec_file).read_text().strip()
    except Exception:
        return {}
    return {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec, "Content-Type": "application/json"}


def _http_get_json(url: str, headers: dict | None = None, timeout: float = 8) -> dict | None:
    """Defensive HTTP GET — never raises."""
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def _option_symbol(pick: dict) -> str:
    """Compose an Alpaca options symbol from a Boba pick."""
    t = (pick.get("ticker") or "").upper()
    strike = pick.get("strike")
    ot = (pick.get("option_type") or "C")[:1].upper()
    expiry = pick.get("expiry", "")
    # Boba's expiry is typically "MM/DD/YY" — convert to OCC YYMMDD
    try:
        dt = datetime.strptime(expiry, "%m/%d/%y")
        yymmdd = dt.strftime("%y%m%d")
    except Exception:
        return ""
    try:
        strike_int = int(round(float(strike) * 1000))
    except Exception:
        return ""
    return f"{t}{yymmdd}{ot}{strike_int:08d}"


def _snapshot_pick(pick: dict, account: str) -> dict:
    """Gather a t=N snapshot of context for one pick. Best-effort; missing data is fine."""
    snap: dict[str, Any] = {
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ticker": pick.get("ticker"),
    }
    headers = _alpaca_headers(account)
    if not headers:
        snap["error"] = "no_alpaca_keys"
        return snap

    # Live equity quote for the underlying
    ticker = (pick.get("ticker") or "").upper()
    if ticker:
        spot_url = f"{ALPACA_DATA_BASE}/v2/stocks/{ticker}/snapshot"
        spot = _http_get_json(spot_url, headers=headers, timeout=5) or {}
        latest_trade = (spot.get("latestTrade") or {})
        latest_quote = (spot.get("latestQuote") or {})
        snap["spot_price"] = latest_trade.get("p")
        snap["bid"] = latest_quote.get("bp")
        snap["ask"] = latest_quote.get("ap")

    # Option contract quote
    osym = _option_symbol(pick)
    if osym:
        snap["option_symbol"] = osym
        opt = _http_get_json(
            f"{ALPACA_DATA_BASE}/v1beta1/options/snapshots/{ticker}?symbols={osym}",
            headers=headers,
            timeout=5,
        ) or {}
        node = (opt.get("snapshots") or {}).get(osym, {})
        lq = node.get("latestQuote") or {}
        lt = node.get("latestTrade") or {}
        snap["opt_bid"] = lq.get("bp")
        snap["opt_ask"] = lq.get("ap")
        snap["opt_last"] = lt.get("p")
        greeks = node.get("greeks") or {}
        snap["delta"] = greeks.get("delta")
        snap["iv"] = node.get("impliedVolatility") or greeks.get("iv")

    # Recent flow on this ticker (last 30 min)
    if ticker and DB_PATH.exists():
        try:
            con = sqlite3.connect(str(DB_PATH))
            cur = con.cursor()
            rows = cur.execute(
                """SELECT COUNT(*), COALESCE(SUM(flow_value), 0)
                   FROM flow_alerts
                   WHERE ticker = ? AND captured_at > datetime('now', '-30 minutes')""",
                (ticker,),
            ).fetchone()
            con.close()
            snap["flow_30min_count"] = rows[0] if rows else 0
            snap["flow_30min_value"] = float(rows[1]) if rows and rows[1] else 0.0
        except Exception:
            pass

    return snap


def _mc_kb_recall(ticker: str) -> str:
    """Ticker-specific recall from laptop's mc-kb. Returns Markdown block or ''. """
    if not ticker:
        return ""
    try:
        params = urllib.parse.urlencode({
            "q": f"recent decisions and patterns for {ticker} options flow",
            "top": "3",
            "tier": "identity,critical",
        })
        data = _http_get_json(f"{MC_KB_BASE}/query?{params}", timeout=6)
        if not data or not data.get("hits"):
            return ""
        lines = []
        for h in data["hits"][:3]:
            src = h.get("source", "?")
            preview = (h.get("preview") or "")[:250].replace("\n", " ")
            lines.append(f"- {src}: {preview}")
        return "\n".join(lines)
    except Exception:
        return ""


def _format_validation_prompt(picks: list[dict], t0_snaps: list[dict], t2_snaps: list[dict], recalls: list[str]) -> str:
    """Compose the brief Claude prompt asking PROCEED/ABORT per pick."""
    lines = [
        "You are validating trading picks 2 minutes after they were proposed.",
        "Below: each pick with its t=0 snapshot, current t=120s snapshot, and recalled patterns.",
        "For EACH pick, respond with PROCEED (good — execute) or ABORT (don't execute, reasoning changed).",
        "",
        "Default to PROCEED unless one of these red flags fired in 120s:",
        "- Underlying moved >2% AGAINST the thesis direction",
        "- Option bid-ask spread doubled (liquidity vanished)",
        "- Zero new flow on ticker in the 30-min window (institutional interest evaporated)",
        "- mc-kb recall shows a recent abort/loss pattern on this ticker setup",
        "",
        "Output STRICT JSON: { \"verdicts\": [ { \"pick_index\": 0, \"verdict\": \"PROCEED\" | \"ABORT\", \"reason\": \"<one sentence>\" }, ... ] }",
        "",
        "===",
    ]
    for i, (pick, t0, t2, recall) in enumerate(zip(picks, t0_snaps, t2_snaps, recalls)):
        side = "CALL" if (pick.get("option_type", "")[:1].upper() == "C") else "PUT"
        lines.append(f"\n## Pick {i}: {pick.get('ticker')} ${pick.get('strike')}{side[0]} {pick.get('expiry')}")
        lines.append(f"Thesis from original reasoning: {(pick.get('reasoning','') or '')[:200]}")
        lines.append(f"\nt=0 snapshot: spot={t0.get('spot_price')} opt_last={t0.get('opt_last')} bid/ask={t0.get('opt_bid')}/{t0.get('opt_ask')} IV={t0.get('iv')} flow_30m=${t0.get('flow_30min_value',0):.0f}")
        lines.append(f"t=120 snapshot: spot={t2.get('spot_price')} opt_last={t2.get('opt_last')} bid/ask={t2.get('opt_bid')}/{t2.get('opt_ask')} IV={t2.get('iv')} flow_30m=${t2.get('flow_30min_value',0):.0f}")
        if recall:
            lines.append(f"\nmc-kb recalled patterns:\n{recall}")
    return "\n".join(lines)


def _call_claude(prompt: str, timeout: int = 60) -> dict | None:
    """One-shot claude CLI call. Returns parsed JSON or None on failure."""
    if not os.path.exists(CLAUDE_BIN):
        return None
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
            return None
        text = r.stdout.strip()
        idx = text.find("{")
        if idx >= 0:
            text = text[idx:]
        return json.loads(text)
    except Exception:
        return None


def _call_gemini(prompt: str, timeout: int = 30) -> dict | None:
    """Second-opinion call to Gemini 2.5 Flash via REST. Returns parsed JSON or None.

    Matches the call pattern used by orion_telegram.py — no SDK dependency,
    just urllib + the API key from secrets/gemini.key.
    """
    key = ""
    for fname in ("gemini.key", "google-api-key.txt"):
        p = SECRETS / fname
        if p.exists():
            try:
                key = p.read_text().strip()
                if key:
                    break
            except Exception:
                pass
    if not key:
        return None

    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"gemini-2.5-flash:generateContent?key={key}")
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
        # Gemini returns: {"candidates": [{"content": {"parts": [{"text": "..."}]}}]}
        text = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        if not text:
            return None
        idx = text.find("{")
        if idx >= 0:
            text = text[idx:]
        return json.loads(text)
    except Exception:
        return None


def _merge_verdicts(claude_v: dict | None, gemini_v: dict | None, n_picks: int) -> dict:
    """Combine Claude + Gemini verdicts. Per-pick PROCEED only if BOTH agree
    (or if only one returned a verdict — single-LLM is better than no LLM).
    Disagreement → ABORT with combined reason."""
    out = {"verdicts": []}
    cv = (claude_v or {}).get("verdicts", []) if claude_v else []
    gv = (gemini_v or {}).get("verdicts", []) if gemini_v else []

    def _find(verdicts: list, i: int) -> dict | None:
        return next((v for v in verdicts if v.get("pick_index") == i), None)

    for i in range(n_picks):
        c = _find(cv, i)
        g = _find(gv, i)
        c_dec = (c or {}).get("verdict", "").upper() if c else ""
        g_dec = (g or {}).get("verdict", "").upper() if g else ""
        c_reason = (c or {}).get("reason", "") if c else ""
        g_reason = (g or {}).get("reason", "") if g else ""

        if c_dec and g_dec:
            if c_dec == g_dec:
                final = c_dec
                reason = f"Claude+Gemini agree: {c_reason or g_reason}"
            else:
                final = "ABORT"  # disagreement → conservative abort
                reason = f"Disagreement (Claude={c_dec}: {c_reason}) (Gemini={g_dec}: {g_reason})"
        elif c_dec:
            final = c_dec
            reason = f"Claude only (Gemini unavailable): {c_reason}"
        elif g_dec:
            final = g_dec
            reason = f"Gemini only (Claude unavailable): {g_reason}"
        else:
            final = "PROCEED"  # fail-open if neither LLM responded
            reason = "no LLM verdicts available — default proceed"
        out["verdicts"].append({"pick_index": i, "verdict": final, "reason": reason})
    return out


def _log(payload: dict) -> None:
    try:
        with JOURNAL_LOG.open("a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


def validate_picks(picks: list[dict], account: str = "boba", sleep_sec: int = 120) -> list[dict]:
    """Run the 2-minute research-and-confirm pass.

    Returns the subset of picks that should be executed. Picks that fail validation
    are dropped (logged in pick_validator.jsonl + journal). On any failure of the
    validation pipeline itself, returns the original list unchanged (fail-open so
    the trading cycle isn't broken by a network blip).
    """
    if not picks or not isinstance(picks, list):
        return picks or []

    cycle_id = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"[pick-validator] starting 2-min validation on {len(picks)} pick(s) for {account}", flush=True)

    # 1) t=0 snapshots
    t0 = [_snapshot_pick(p, account) for p in picks]

    # 2) sleep
    time.sleep(max(10, int(sleep_sec)))  # min 10s for tests, default 120

    # 3) t=120 snapshots
    t2 = [_snapshot_pick(p, account) for p in picks]

    # 4) ticker-specific recalls (in parallel-ish — sequential but small)
    recalls = [_mc_kb_recall((p.get("ticker") or "")) for p in picks]

    # 5) Multi-LLM verdict — Claude + Gemini in parallel, merge results
    prompt = _format_validation_prompt(picks, t0, t2, recalls)
    claude_v = _call_claude(prompt, timeout=45)
    gemini_v = _call_gemini(prompt, timeout=30)
    verdict = _merge_verdicts(claude_v, gemini_v, len(picks))

    # If BOTH LLMs failed entirely, fail-open with all picks proceeding.
    if not (claude_v or gemini_v):
        _log({"cycle_id": cycle_id, "account": account, "status": "fail_open",
              "picks_count": len(picks), "reason": "both_llms_failed"})
        print(f"[pick-validator] both LLMs unavailable — fail-open, proceeding with all {len(picks)} picks", flush=True)
        return picks

    verdicts = verdict.get("verdicts", [])
    keep = []
    log_entries = []
    for i, pick in enumerate(picks):
        v = next((x for x in verdicts if x.get("pick_index") == i), None)
        decision = (v or {}).get("verdict", "PROCEED").upper()
        reason = (v or {}).get("reason", "default proceed (no verdict returned)")
        log_entries.append({
            "pick_index": i,
            "ticker": pick.get("ticker"),
            "decision": decision,
            "reason": reason,
            "t0_spot": t0[i].get("spot_price"),
            "t2_spot": t2[i].get("spot_price"),
            "claude_responded": bool(claude_v),
            "gemini_responded": bool(gemini_v),
        })
        if decision == "PROCEED":
            # Annotate the pick with validation metadata for the journal
            pick["validation"] = {
                "verdict": "PROCEED",
                "reason": reason,
                "t0_spot": t0[i].get("spot_price"),
                "t2_spot": t2[i].get("spot_price"),
                "validators": [n for n, ok in (("claude", bool(claude_v)), ("gemini", bool(gemini_v))) if ok],
            }
            keep.append(pick)

    _log({"cycle_id": cycle_id, "account": account, "status": "ok",
          "picks_in": len(picks), "picks_kept": len(keep),
          "claude_used": bool(claude_v), "gemini_used": bool(gemini_v),
          "decisions": log_entries})

    if len(keep) < len(picks):
        print(f"[pick-validator] aborted {len(picks)-len(keep)} of {len(picks)} picks after 2-min research", flush=True)
    else:
        print(f"[pick-validator] all {len(picks)} picks confirmed", flush=True)

    return keep


if __name__ == "__main__":
    # Smoke test with a synthetic pick
    fake = [{"ticker": "SPY", "strike": 580, "option_type": "C", "expiry": "06/20/26",
             "reasoning": "bullish on broad market following Fed dovish pivot"}]
    out = validate_picks(fake, account="boba", sleep_sec=10)
    print(f"\nResult: {len(out)} pick(s) approved")
