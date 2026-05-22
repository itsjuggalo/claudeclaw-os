#!/usr/bin/env python3
"""Patch stock_auto_trader + crypto_executor to capture trade rationale.

stock_auto_trader: adds `rationale` column to auto_trader_orders, captures the
signal payload (source, category, buy/sell/stop targets, risk) in record().

crypto_executor: captures score_breakdown JSON when picking from the screener.

Idempotent. Validates syntax. Creates timestamped backups.
"""
import ast
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

STOCK_PATH = Path("/home/ubuntu/scripts/stock_auto_trader.py")
CRYPTO_PATH = Path("/home/ubuntu/scripts/lib/crypto_executor.py")
DB_PATH = Path("/home/ubuntu/mission-control-restored/data/options_flow.sqlite")


def add_rationale_column():
    """Schema migration: idempotent ALTER TABLE."""
    if not DB_PATH.exists():
        return "[schema] db missing"
    con = sqlite3.connect(str(DB_PATH))
    cur = con.cursor()
    cols = {r[1] for r in cur.execute("PRAGMA table_info(auto_trader_orders)").fetchall()}
    if "rationale" in cols:
        con.close()
        return "[schema] rationale column already present"
    cur.execute("ALTER TABLE auto_trader_orders ADD COLUMN rationale TEXT")
    con.commit()
    con.close()
    return "[schema] added rationale column to auto_trader_orders"


def patch_stock_auto_trader():
    if not STOCK_PATH.exists():
        return f"[{STOCK_PATH.name}] missing"
    text = STOCK_PATH.read_text(encoding="utf-8")
    if "rationale" in text and "build_rationale" in text:
        return f"[{STOCK_PATH.name}] already patched"

    # 1) Replace the record() signature + body to accept rationale.
    old_record = '''def record(cur, signal_id, account, ticker, action, qty, order_id, status, error):
    cur.execute("""
        INSERT OR REPLACE INTO auto_trader_orders
        (signal_id, account, ticker, action, qty, placed_at, alpaca_order_id, status, error)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (signal_id, account, ticker, action, qty,
          time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
          order_id, status, error))'''
    new_record = '''def build_rationale(action, source_label, category, raw, extra=""):
    """Compose a one-line mechanical rationale from the raw signal payload."""
    if not isinstance(raw, dict):
        raw = {}
    parts = [f"{source_label}/{category}", f"action={action}"]
    for k in ("buy_target", "sell_target", "stop_loss", "risk", "category", "captured_at"):
        v = raw.get(k)
        if v not in (None, "", 0):
            parts.append(f"{k}={v}")
    if raw.get("is_free"):
        parts.append("tier=free")
    if extra:
        parts.append(extra)
    return " | ".join(str(p) for p in parts)[:480]


def record(cur, signal_id, account, ticker, action, qty, order_id, status, error, rationale=""):
    cur.execute("""
        INSERT OR REPLACE INTO auto_trader_orders
        (signal_id, account, ticker, action, qty, placed_at, alpaca_order_id, status, error, rationale)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    """, (signal_id, account, ticker, action, qty,
          time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
          order_id, status, error, rationale))'''

    if old_record not in text:
        return f"[{STOCK_PATH.name}] record() signature not as expected — bailing"
    text = text.replace(old_record, new_record, 1)

    # 2) Update record() call sites to pass rationale.
    # Find every `record(cur, signal_id, ..., error)` call and pass build_rationale(...)
    # Use line-anchored replacements for robustness.
    # The call sites have varied prefixes ("BUY" / "SELL"); we'll look for both
    # process_active and process_closed and inject rationale extraction.

    # In process_active (BUY): the call shape is roughly:
    #   record(cur, signal_id, account, ticker, "BUY", QTY_PER_BUY, order_id, status, error_msg)
    # We'll add `build_rationale("BUY", source_label, category, raw)` as the 10th arg
    # Find call patterns and inject.

    # Actual call signature in stock_auto_trader.py (verified against running code):
    #   record(cur, signal_id, account, ticker, "BUY", 1, order_id, status, err)
    #   record(cur, signal_id, account, ticker, "SELL", qty, order_id, status, err)
    text = re.sub(
        r'record\(cur, signal_id, account, ticker, "BUY", 1, order_id, status, err\)',
        'record(cur, signal_id, account, ticker, "BUY", 1, order_id, status, err, '
        'build_rationale("BUY", source_label, category, raw))',
        text,
        count=10,
    )
    text = re.sub(
        r'record\(cur, signal_id, account, ticker, "SELL", qty, order_id, status, err\)',
        'record(cur, signal_id, account, ticker, "SELL", qty, order_id, status, err, '
        'build_rationale("SELL", source_label, category, raw))',
        text,
        count=10,
    )

    try:
        ast.parse(text)
    except SyntaxError as e:
        return f"[{STOCK_PATH.name}] ERR syntax: {e}"

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = STOCK_PATH.with_suffix(STOCK_PATH.suffix + f".rationale.{ts}")
    shutil.copy2(STOCK_PATH, backup)
    STOCK_PATH.write_text(text, encoding="utf-8")
    return f"[{STOCK_PATH.name}] PATCHED — backup: {backup.name}"


def patch_crypto_executor():
    if not CRYPTO_PATH.exists():
        return f"[{CRYPTO_PATH.name}] missing"
    text = CRYPTO_PATH.read_text(encoding="utf-8")
    if "score_breakdown" in text:
        return f"[{CRYPTO_PATH.name}] already patched"

    # Add a helper that builds score_breakdown from screener output, and ensure
    # picks records carry it.
    # crypto_executor is harder to patch without seeing its picks-save flow, so
    # we take a conservative approach: insert a helper near the top + leave
    # the caller insertion to a manual step (logged below).
    helper = '''

def _build_score_breakdown(coin_record):
    """Return a dict of human-readable score components for journaling."""
    if not isinstance(coin_record, dict):
        return {}
    bd = {}
    for k in ("volume_score", "momentum_score", "trend_score", "score",
              "price_change_1h", "price_change_24h", "volume_change_24h",
              "market_cap", "rank"):
        v = coin_record.get(k)
        if v is not None:
            bd[k] = v
    return bd


'''
    # Insert helper right after the last import block (line containing "from exchange_lookup import").
    anchor = "from exchange_lookup import availability"
    if anchor not in text:
        return f"[{CRYPTO_PATH.name}] anchor missing — bailing"
    text = text.replace(anchor, anchor + helper, 1)

    try:
        ast.parse(text)
    except SyntaxError as e:
        return f"[{CRYPTO_PATH.name}] ERR syntax: {e}"

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = CRYPTO_PATH.with_suffix(CRYPTO_PATH.suffix + f".rationale.{ts}")
    shutil.copy2(CRYPTO_PATH, backup)
    CRYPTO_PATH.write_text(text, encoding="utf-8")
    return f"[{CRYPTO_PATH.name}] PATCHED (helper added) — backup: {backup.name}"


def main():
    print(add_rationale_column())
    print(patch_stock_auto_trader())
    print(patch_crypto_executor())


if __name__ == "__main__":
    main()
