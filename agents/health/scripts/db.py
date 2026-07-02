#!/usr/bin/env python3
"""Health OS Supabase helper — zero external dependencies (stdlib urllib only).

Talks to the health-os Supabase project with the SERVICE ROLE key (bypasses RLS).
Reads credentials from ~/.env (HEALTH_SUPABASE_URL, HEALTH_SUPABASE_SERVICE_ROLE_KEY),
falling back to the process environment.

Usage:
  db.py insert  <table> '<json>'                 # object or array; prints inserted rows
  db.py upsert  <table> <conflict_col> '<json>'  # insert or merge on conflict (e.g. daily_checkins checkin_date)
  db.py select  <table> ['<postgrest-query>']    # e.g. 'select=*&order=eaten_at.desc&limit=10'
  db.py update  <table> '<filter>' '<json>'      # filter e.g. 'id=eq.5'  (PostgREST querystring)
  db.py delete  <table> '<filter>'
  db.py rpc     <fn> '<json>'                     # call a Postgres function
  db.py upload  <local_path> <storage_path> [content_type]   # -> health-assets bucket
  db.py signurl <storage_path> [expires_seconds]             # default 3600
  db.py mkbucket [bucket]                          # ensure private bucket exists (default health-assets)

Examples:
  db.py insert food_log '{"meal":"breakfast","items":"egg-white omelette, beets","protein_g":35,"sat_fat_flag":false}'
  db.py select weigh_ins 'select=measured_at,weight_kg&order=measured_at.desc&limit=14'
  db.py upload /abs/photo.jpg food/2026/06/$(uuidgen).jpg image/jpeg
"""
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "health-assets"


def load_env():
    """Process env wins; otherwise parse ~/.env."""
    url = os.environ.get("HEALTH_SUPABASE_URL")
    key = os.environ.get("HEALTH_SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url.rstrip("/"), key
    path = os.path.expanduser("~/.env")
    vals = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    url = url or vals.get("HEALTH_SUPABASE_URL", "")
    key = key or vals.get("HEALTH_SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("ERROR: HEALTH_SUPABASE_URL / HEALTH_SUPABASE_SERVICE_ROLE_KEY not found in env or ~/.env")
    return url.rstrip("/"), key


URL, KEY = load_env()


def req(method, path, data=None, headers=None, raw=False):
    """raw=True sends bytes (for storage uploads); otherwise JSON-encodes data."""
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    if headers:
        h.update(headers)
    body = None
    if data is not None:
        if raw:
            body = data
        else:
            body = json.dumps(data).encode()
            h.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(URL + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def out(status, text):
    ok = 200 <= status < 300
    # Pretty-print JSON when we can; otherwise raw.
    try:
        parsed = json.loads(text) if text else None
        print(json.dumps(parsed, indent=2, default=str) if parsed is not None else "")
    except (ValueError, TypeError):
        print(text)
    if not ok:
        sys.exit(f"HTTP {status}")


def rest(table, query=""):
    return f"/rest/v1/{table}" + (("?" + query) if query else "")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    a = sys.argv[2:]

    if cmd == "insert":
        table, payload = a[0], json.loads(a[1])
        status, text = req("POST", rest(table), payload, {"Prefer": "return=representation"})
        out(status, text)

    elif cmd == "upsert":
        table, conflict, payload = a[0], a[1], json.loads(a[2])
        status, text = req("POST", rest(table, f"on_conflict={conflict}"), payload,
                           {"Prefer": "resolution=merge-duplicates,return=representation"})
        out(status, text)

    elif cmd == "select":
        table = a[0]
        query = a[1] if len(a) > 1 else "select=*&limit=50"
        status, text = req("GET", rest(table, query))
        out(status, text)

    elif cmd == "update":
        table, filt, payload = a[0], a[1], json.loads(a[2])
        status, text = req("PATCH", rest(table, filt), payload, {"Prefer": "return=representation"})
        out(status, text)

    elif cmd == "delete":
        table, filt = a[0], a[1]
        status, text = req("DELETE", rest(table, filt), None, {"Prefer": "return=representation"})
        out(status, text)

    elif cmd == "rpc":
        fn, payload = a[0], (json.loads(a[1]) if len(a) > 1 else {})
        status, text = req("POST", f"/rest/v1/rpc/{fn}", payload)
        out(status, text)

    elif cmd == "mkbucket":
        bucket = a[0] if a else BUCKET
        status, text = req("POST", "/storage/v1/bucket",
                           {"id": bucket, "name": bucket, "public": False})
        if status == 409 or (200 <= status < 300):
            print(f"bucket '{bucket}' ready")
            return
        out(status, text)

    elif cmd == "upload":
        local, storage_path = a[0], a[1]
        ctype = a[2] if len(a) > 2 else (mimetypes.guess_type(local)[0] or "application/octet-stream")
        with open(local, "rb") as f:
            blob = f.read()
        path = f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(storage_path)}"
        status, text = req("POST", path, blob, {"Content-Type": ctype, "x-upsert": "true"}, raw=True)
        if 200 <= status < 300:
            print(storage_path)  # echo the canonical storage_path for the assets row
        else:
            out(status, text)

    elif cmd == "signurl":
        storage_path = a[0]
        expires = int(a[1]) if len(a) > 1 else 3600
        path = f"/storage/v1/object/sign/{BUCKET}/{urllib.parse.quote(storage_path)}"
        status, text = req("POST", path, {"expiresIn": expires})
        if 200 <= status < 300:
            signed = json.loads(text).get("signedURL", "")
            print(URL + "/storage/v1" + signed)
        else:
            out(status, text)

    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
