#!/usr/bin/env python3
"""One-time WHOOP OAuth: mint the first refresh token for whoop-sync.py.

Opens the WHOOP consent page, catches the redirect on a local listener, swaps
the authorization code for tokens, and writes WHOOP_REFRESH_TOKEN into ~/.env.
Run this once; after that whoop-sync.py keeps itself authorized by rotating the
refresh token.

PREREQUISITE: the WHOOP app's Redirect URIs (developer-dashboard.whoop.com)
must include exactly:
  http://localhost:8675/whoop/callback

Usage:
  python3 whoop-auth.py
"""
import os
import secrets
import sys
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import whoop_common as wc  # noqa: E402

PORT = 8675
REDIRECT_URI = "http://localhost:%d/whoop/callback" % PORT
# Least-privilege for the dashboard: recovery + sleep, cycles for future strain,
# offline to get the refresh token.
SCOPES = "read:recovery read:sleep read:cycles offline"

result = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/whoop/callback":
            self.send_response(404)
            self.end_headers()
            return
        q = urllib.parse.parse_qs(u.query)
        result["code"] = (q.get("code") or [None])[0]
        result["state"] = (q.get("state") or [None])[0]
        result["error"] = (q.get("error") or [None])[0]
        ok = bool(result.get("code"))
        msg = "WHOOP connected. You can close this tab." if ok else ("WHOOP auth failed: " + str(result.get("error")))
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write((
            "<html><body style='font-family:system-ui,sans-serif;background:#07080a;"
            "color:#e7e9ee;display:flex;height:100vh;margin:0;align-items:center;"
            "justify-content:center'><h2>" + msg + "</h2></body></html>"
        ).encode())


def main():
    env = wc.read_env()
    cid, sec = env.get("WHOOP_CLIENT_ID"), env.get("WHOOP_CLIENT_SECRET")
    if not (cid and sec):
        sys.exit("ERROR: WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET missing in ~/.env")

    state = secrets.token_urlsafe(16)
    params = {
        "response_type": "code",
        "client_id": cid,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
    }
    auth = wc.AUTH_URL + "?" + urllib.parse.urlencode(params)
    print("\nOpen this URL, log into WHOOP, and approve access:\n\n" + auth + "\n", flush=True)
    try:
        webbrowser.open(auth)
    except Exception:
        pass

    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    print("Listening on %s for the redirect (Ctrl-C to abort)..." % REDIRECT_URI, flush=True)
    while "code" not in result and "error" not in result:
        srv.handle_request()

    if result.get("error") or not result.get("code"):
        sys.exit("Auth failed: " + str(result.get("error")))
    if result.get("state") != state:
        sys.exit("State mismatch, aborting (possible CSRF).")

    st, tok = wc.exchange_code(cid, sec, result["code"], REDIRECT_URI)
    if st != 200 or "refresh_token" not in tok:
        sys.exit("Token exchange failed (%s): %s" % (st, tok))
    wc.set_env("WHOOP_REFRESH_TOKEN", tok["refresh_token"])
    print("\n✓ Saved WHOOP_REFRESH_TOKEN to ~/.env. WHOOP is connected.")
    print("  Run a first sync:  python3 %s/whoop-sync.py" % os.path.dirname(os.path.abspath(__file__)))


if __name__ == "__main__":
    main()
