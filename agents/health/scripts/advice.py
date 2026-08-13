#!/usr/bin/env python3
"""Influencer KB recall — semantic search over the health influencer tip blocks.

Backs the /advice slash command. The influencer_tips table (Health OS Supabase)
holds one row per distilled tip block (influencer, topic, title, tip, verbatim
source_quote, and an Instagram url to cite). Each block was embedded with OpenAI
text-embedding-3-small at 1536 dims over "Topic/Tip/Quote" (tip-primary, the
reel's hook/transcript line is deliberately excluded, see the Health OS
ingest_compendium_to_supabase.mjs). So this script MUST embed the
query with the SAME model, or cosine similarity is near-random. Gemini
embeddings do NOT work against this table.

Zero external deps (stdlib urllib). Reads ~/.env for HEALTH_SUPABASE_URL,
HEALTH_SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY.

Usage:
  advice.py "<question>" [--k 6] [--min 0.40] [--influencer <name>] [--topic "Fat Loss & Calories"] [--json]
      Embeds the question, runs the match_influencer_tips RPC (pgvector cosine),
      prints the top matches with their citations so the coach can synthesize a
      grounded, cited answer. --min drops weak matches below that cosine
      similarity (default 0.40) so narrow questions return a few clean hits
      instead of padding with off-topic noise; pass --min 0 to disable.

Examples:
  advice.py "how much protein on a cut" --k 6
  advice.py "are seed oils bad" --topic "Health, Hormones & Inflammation"
  advice.py "best cardio for fat loss" --json
"""
import json
import os
import sys
import urllib.error
import urllib.request

EMBED_MODEL = "text-embedding-3-small"  # 1536 dims, matches influencer_tips.embedding


def load_env():
    keys = ("HEALTH_SUPABASE_URL", "HEALTH_SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY")
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
    return vals["HEALTH_SUPABASE_URL"].rstrip("/"), vals["HEALTH_SUPABASE_SERVICE_ROLE_KEY"], vals["OPENAI_API_KEY"]


URL, KEY, OPENAI_KEY = load_env()


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
    # OpenAI text-embedding-3-small, no `dimensions` override -> native 1536,
    # exactly how the influencer_tips rows were embedded at ingest time.
    status, body = http(
        "POST",
        "https://api.openai.com/v1/embeddings",
        {"model": EMBED_MODEL, "input": text},
        {"Authorization": f"Bearer {OPENAI_KEY}"},
    )
    if not (200 <= status < 300):
        sys.exit(f"OpenAI embeddings HTTP {status}: {body}")
    return json.loads(body)["data"][0]["embedding"]


def vec_literal(emb):
    return "[" + ",".join(repr(float(x)) for x in emb) + "]"


def sb(method, path, data=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    return http(method, URL + path, data, h)


def parse_flags(args):
    pos, flags = [], {}
    i = 0
    while i < len(args):
        if args[i].startswith("--"):
            flags[args[i][2:]] = args[i + 1] if (i + 1 < len(args) and not args[i + 1].startswith("--")) else "true"
            i += 2 if (i + 1 < len(args) and not args[i + 1].startswith("--")) else 1
        else:
            pos.append(args[i])
            i += 1
    return pos, flags


def main():
    pos, flags = parse_flags(sys.argv[1:])
    if not pos:
        sys.exit(__doc__)
    query = pos[0]

    k = int(flags.get("k", 6))
    floor = float(flags.get("min", 0.40))

    # Over-fetch so the floor and dedup still leave up to k DISTINCT on-topic
    # tips. an influencer's KB cross-files the same distilled tip under several posts
    # and topics, so one piece of advice can occupy several top rows (the
    # intermittent-fasting tip appears 6x and was flooding unrelated queries).
    fetch_count = min(max(k * 3, k + 12), 40)
    payload = {
        "query_embedding": vec_literal(embed(query)),
        "match_count": fetch_count,
    }
    if flags.get("influencer"):
        payload["filter_influencer"] = flags["influencer"]
    if flags.get("topic"):
        payload["filter_topic"] = flags["topic"]

    status, body = sb("POST", "/rest/v1/rpc/match_influencer_tips", payload)
    if not (200 <= status < 300):
        sys.exit(f"match_influencer_tips HTTP {status}: {body}")
    raw = json.loads(body)

    # Similarity floor: rows come back ordered by similarity, so the tail of a
    # narrow query is off-topic noise. Drop anything below --min (default 0.40,
    # where matches stopped being on-topic in testing). --min 0 disables it.
    floored = [h for h in raw if (h.get("similarity") or 0) >= floor]
    n_below = len(raw) - len(floored)

    # Dedup: collapse rows that carry the same advice (normalized tip text),
    # keeping the highest-similarity one. Rows are pre-sorted, so first seen
    # wins. This stops one cross-filed tip from eating several of the k slots.
    def norm(t):
        return " ".join((t or "").lower().split()).strip(" .!?\"'")

    seen, deduped = set(), []
    for h in floored:
        key = norm(h.get("tip"))
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(h)
    n_dup = len(floored) - len(deduped)

    hits = deduped[:k]

    if flags.get("json") == "true":
        print(json.dumps({
            "query": query, "min_similarity": floor,
            "dropped_below_floor": n_below, "dropped_duplicates": n_dup,
            "hits": hits,
        }, default=str, indent=2))
        return

    if not hits:
        print(f"(no influencer tips above similarity {floor:.2f} for: {query!r} — the KB may have nothing solid on this)")
        return

    note = f" ({n_dup} duplicate tip(s) collapsed)" if n_dup else ""
    print(f"QUERY: {query}")
    print(f"{len(hits)} distinct tip(s) from the influencer KB, best match first{note}:\n")
    for i, h in enumerate(hits, 1):
        date = (h.get("published_at") or "")[:10]
        print(f"[{i}] similarity {h.get('similarity', 0):.3f} | {h.get('influencer', '?')} | {h.get('topic') or 'n/a'}")
        # We intentionally do NOT surface `title`: it is the reel's raw opening
        # line (a hook/CTA), not advice. The tip and quote carry the substance.
        print(f"    tip: {h.get('tip', '')}")
        if h.get("source_quote") and h.get("source_quote") != h.get("tip"):
            print(f"    quote: \"{h['source_quote']}\"")
        cite = h.get("url") or h.get("source_file") or "(no link)"
        print(f"    cite: {cite}{(' (' + date + ')') if date else ''}")
        print()


if __name__ == "__main__":
    main()
