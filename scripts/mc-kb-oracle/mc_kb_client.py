"""mc_kb_client — Oracle-side helper to recall memories from the laptop's mc-kb RAG.

Talks to the laptop via the reverse SSH tunnel (`127.0.0.1:8091` on Oracle, forwarded
to laptop's local server). Designed to fail gracefully — never raise, never block —
so trading scripts continue even when the laptop is offline.

Usage (in boba_decision_cycle.py / jazzy_decision_cycle.py):

    import mc_kb_client
    memory_block = mc_kb_client.recall(
        "Boba decision rules + recent NVDA flow patterns",
        top=5,
        tiers=["identity", "critical"],
        timeout=10,
    )
    # Inject memory_block at the start of your Claude prompt. If empty, proceed without it.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = os.environ.get("MC_KB_ENDPOINT", "http://127.0.0.1:8091")
DEFAULT_TIMEOUT = 8


def recall(
    query: str,
    top: int = 5,
    tiers: list[str] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> str:
    """Query mc-kb and return a formatted Markdown block, or "" on any failure.

    Never raises. Trading code can call this safely.
    """
    if not query or not query.strip():
        return ""
    params = {"q": query.strip()[:600], "top": str(max(1, min(top, 20)))}
    if tiers:
        params["tier"] = ",".join(t.strip().lower() for t in tiers if t.strip())
    url = f"{ENDPOINT}/query?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ConnectionError, json.JSONDecodeError):
        return ""
    except Exception:
        # Defensive — never let a network glitch break the trading cycle.
        return ""

    hits = data.get("hits") or []
    if not hits:
        return ""

    lines = ["## Recalled memories (mc-kb, via SSH tunnel from laptop)\n"]
    for i, h in enumerate(hits, 1):
        src = h.get("source", "?")
        tier = h.get("tier", "")
        tag = f"[{tier}]" if tier and tier != "untiered" else ""
        heading = (h.get("heading") or "").strip()
        preview = (h.get("preview") or "").strip().replace("\n", " ")
        if len(preview) > 400:
            preview = preview[:400] + "..."
        lines.append(f"### {i}. {tag} {src}")
        if heading and heading != "---":
            lines.append(f"**{heading}**")
        lines.append(preview)
        lines.append("")
    return "\n".join(lines)


def log_event(
    agent_id: str,
    action: str,
    summary: str,
    artifacts: dict | None = None,
    chat_id: str = "trading",
    timeout: float = 5,
) -> bool:
    """POST a hive_mind entry to the laptop. Returns True on success, False on any failure.

    Used by Boba/Jazzy decision cycles to surface activity in the daemon's /hive page.
    Silently no-ops if the tunnel is down — never blocks the trading cycle.
    """
    if not (agent_id and action and summary):
        return False
    payload = {
        "agent_id": agent_id[:64],
        "action": action[:64],
        "summary": summary[:2000],
        "chat_id": chat_id[:64],
    }
    if artifacts is not None:
        payload["artifacts"] = artifacts
    try:
        req = urllib.request.Request(
            f"{ENDPOINT}/hive/log",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def is_alive(timeout: float = 3) -> bool:
    """Quick health check — useful for logging before the cycle starts."""
    try:
        with urllib.request.urlopen(f"{ENDPOINT}/health", timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8")).get("status") == "ok"
    except Exception:
        return False


if __name__ == "__main__":
    # Self-test when run directly.
    import sys
    q = " ".join(sys.argv[1:]) or "Mission Control hub model architecture"
    print(f"[mc_kb_client] alive: {is_alive()}")
    print(f"[mc_kb_client] querying: {q!r}")
    print(recall(q, top=3))
