"""Shared helpers for the WHOOP scripts: ~/.env IO, HTTP, OAuth token calls,
and v2 API GETs. Zero external deps (stdlib only). Imported by whoop-auth.py
and whoop-sync.py.

Credentials live in ~/.env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, and the
rotating WHOOP_REFRESH_TOKEN (minted by whoop-auth.py, rewritten every sync).
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

ENV_PATH = os.path.expanduser("~/.env")
AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
API = "https://api.prod.whoop.com/developer"
KEYS = ("WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "WHOOP_REFRESH_TOKEN")


def read_env():
    """Parse ~/.env; process env wins for the WHOOP keys."""
    vals = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, v = s.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    for k in KEYS:
        if os.environ.get(k):
            vals[k] = os.environ[k]
    return vals


def set_env(key, value):
    """Replace or append KEY=value in ~/.env in place, preserving everything
    else. Used to persist the rotated refresh token after each refresh."""
    lines = []
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            lines = f.read().splitlines()
    found = False
    for i, ln in enumerate(lines):
        if ln.startswith(key + "="):
            lines[i] = key + "=" + value
            found = True
            break
    if not found:
        lines.append(key + "=" + value)
    tmp = ENV_PATH + ".tmp"
    with open(tmp, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, ENV_PATH)


# WHOOP's API is behind Cloudflare, which 1010-bans the default Python-urllib
# user-agent. Present a normal browser UA so the requests aren't blocked.
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _http(method, url, data=None, form=False, bearer=None):
    h = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if bearer:
        h["Authorization"] = "Bearer " + bearer
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        t = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(t)
        except ValueError:
            return e.code, {"error": t}


def exchange_code(client_id, client_secret, code, redirect_uri):
    """Authorization code -> tokens (one-time, from whoop-auth.py)."""
    return _http("POST", TOKEN_URL, {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    }, form=True)


def refresh_token(client_id, client_secret, rt):
    """Refresh token -> fresh access + refresh tokens. WHOOP rotates the refresh
    token here, so the caller MUST persist the returned one."""
    return _http("POST", TOKEN_URL, {
        "grant_type": "refresh_token",
        "refresh_token": rt,
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "offline",
    }, form=True)


def api_get(token, path, params=None):
    url = API + path + (("?" + urllib.parse.urlencode(params)) if params else "")
    return _http("GET", url, None, bearer=token)
