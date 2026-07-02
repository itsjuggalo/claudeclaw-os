#!/usr/bin/env python3
"""Health OS conversation memory — log messages with embeddings and recall semantically.

Zero external deps (stdlib urllib). Reads ~/.env for HEALTH_SUPABASE_URL,
HEALTH_SUPABASE_SERVICE_ROLE_KEY, and GOOGLE_API_KEY. Embeddings use Google
gemini-embedding-2 at 1536 dims (matches the messages.embedding column).
gemini-embedding-2 returns unit vectors at all dims; we re-normalize anyway as
a harmless safety net.

Usage:
  mem.py log <role> "<content>" [--chat-id ID] [--command CMD] [--tags a,b,c]
       role is 'user' or 'assistant'. Embeds content and inserts a messages row.

  mem.py recall "<query>" [--k 8] [--role user|assistant]
       Embeds the query, runs vector search via the match_messages RPC, prints hits.

  mem.py timeline [--hours N] [--since ISO] [--until ISO] [--role user|assistant]
       Chronological dump of the conversation in a time window (no embeddings,
       time-ordered). This is what the morning check-in reads to reconcile what
       the user said in chat against what actually got written into the structured
       tables, so the recap stops missing things he only mentioned in passing.
       Default window is the last 24h. Use --hours 30 in the morning to capture
       all of yesterday plus the overnight.

Examples:
  mem.py log user "what did we decide about coffee" --chat-id 123 --tags caffeine
  mem.py recall "coffee timing and theanine" --k 6
  mem.py timeline --hours 30
"""
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

EMBED_MODEL = "gemini-embedding-2"
EMBED_DIMS = 1536  # matches the messages.embedding vector(1536) column


def load_env():
    keys = ("HEALTH_SUPABASE_URL", "HEALTH_SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_API_KEY")
    vals = {k: os.environ.get(k, "") for k in keys}
    if not all(vals.values()):
        path = os.path.expanduser("~/.env")
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    if k in keys and not vals.get(k):
                        vals[k] = v.strip().strip('"').strip("'")
    for k in keys:
        if not vals[k]:
            sys.exit(f"ERROR: {k} not found in env or ~/.env")
    return vals["HEALTH_SUPABASE_URL"].rstrip("/"), vals["HEALTH_SUPABASE_SERVICE_ROLE_KEY"], vals["GOOGLE_API_KEY"]


URL, KEY, GOOGLE_KEY = load_env()


def http(method, full_url, data=None, headers=None):
    h = headers or {}
    body = json.dumps(data).encode() if data is not None else None
    if body is not None:
        h.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(full_url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def embed(text):
    status, body = http(
        "POST",
        f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:embedContent",
        {
            "model": f"models/{EMBED_MODEL}",
            "content": {"parts": [{"text": text}]},
            "taskType": "SEMANTIC_SIMILARITY",
            "outputDimensionality": EMBED_DIMS,
        },
        {"x-goog-api-key": GOOGLE_KEY},
    )
    if not (200 <= status < 300):
        sys.exit(f"Gemini embeddings HTTP {status}: {body}")
    vals = json.loads(body)["embedding"]["values"]
    # gemini-embedding-001 is not unit-length below 3072 dims; normalize for cosine consistency
    norm = math.sqrt(sum(v * v for v in vals)) or 1.0
    return [v / norm for v in vals]


def vec_literal(emb):
    # pgvector accepts the bracketed string form for both inserts and function args.
    return "[" + ",".join(repr(float(x)) for x in emb) + "]"


def sb(method, path, data=None, prefer=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    if prefer:
        h["Prefer"] = prefer
    return http(method, URL + path, data, h)


def parse_flags(args):
    pos, flags = [], {}
    i = 0
    while i < len(args):
        if args[i].startswith("--"):
            flags[args[i][2:]] = args[i + 1] if i + 1 < len(args) else ""
            i += 2
        else:
            pos.append(args[i])
            i += 1
    return pos, flags


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    pos, flags = parse_flags(sys.argv[2:])

    if cmd == "log":
        role, content = pos[0], pos[1]
        row = {"role": role, "content": content, "embedding": vec_literal(embed(content))}
        if flags.get("chat-id"):
            row["chat_id"] = flags["chat-id"]
        if flags.get("command"):
            row["command"] = flags["command"]
        if flags.get("tags"):
            row["tags"] = [t.strip() for t in flags["tags"].split(",") if t.strip()]
        status, body = sb("POST", "/rest/v1/messages", row, "return=representation")
        if not (200 <= status < 300):
            sys.exit(f"insert HTTP {status}: {body}")
        print(json.dumps(json.loads(body)[0].get("id"), default=str))

    elif cmd == "recall":
        query = pos[0]
        payload = {
            "query_embedding": vec_literal(embed(query)),
            "match_count": int(flags.get("k", 8)),
            "filter_role": flags.get("role"),
        }
        status, body = sb("POST", "/rest/v1/rpc/match_messages", payload)
        if not (200 <= status < 300):
            sys.exit(f"recall HTTP {status}: {body}")
        hits = json.loads(body)
        if not hits:
            print("(no matches)")
            return
        for h in hits:
            print(f"[{h['similarity']:.3f}] {h['created_at'][:16]} {h['role']}: {h['content'][:240]}")

    elif cmd == "timeline":
        from datetime import datetime, timedelta, timezone

        since = flags.get("since")
        until = flags.get("until")
        if not since:
            hours = float(flags.get("hours", 24))
            since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        q = "select=role,content,created_at,command"
        q += f"&created_at=gte.{urllib.parse.quote(since)}"
        if until:
            q += f"&created_at=lte.{urllib.parse.quote(until)}"
        if flags.get("role"):
            q += f"&role=eq.{flags['role']}"
        q += "&order=created_at.asc"
        limit = flags.get("k") or flags.get("limit")
        if limit:
            q += f"&limit={int(limit)}"
        status, body = sb("GET", "/rest/v1/messages?" + q)
        if not (200 <= status < 300):
            sys.exit(f"timeline HTTP {status}: {body}")
        rows = json.loads(body)
        if not rows:
            print("(no messages in window)")
            return
        for r in rows:
            ts = (r.get("created_at") or "")[:16].replace("T", " ")
            ctag = f" /{r['command']}" if r.get("command") else ""
            print(f"{ts} {r['role']}{ctag}: {r.get('content', '')}")

    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
