# Release Smoke Test Runbook

Run before declaring a war-room change shipped. Covers the failure modes a static-only audit can't catch: real subprocess lifecycle, real launchd restart, real migrations against a populated DB.

Each step has a clear pass/fail. If any fails, the release is blocked.

## Prerequisites

- Clean git checkout (no uncommitted changes you don't want clobbered)
- `node --version` ≥ 20
- `npm --version` ≥ 10
- A copy of production `store/claudeclaw.db` for upgrade-in-place test (optional but strongly recommended)

## 1. Clean install

```bash
rm -rf dist node_modules
npm ci
npm run build
```

**Pass:** zero TS errors, `dist/` populated.

## 2. Unit tests

```bash
npm test
```

**Pass:** all suites green. No `.only` skipped tests.

## 3. Boot from clean state

```bash
# Fresh DB, fresh .env (use the setup wizard or copy .env.example)
rm -rf store/* && cp .env.example .env
# Edit .env to set DASHBOARD_TOKEN etc. — see setup wizard
node dist/index.js &
DASHBOARD_PID=$!
sleep 3
```

Verify each route returns 200 (or 401 if no token):
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8989/?token=$DASHBOARD_TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8989/warroom?token=$DASHBOARD_TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8989/api/health?token=$DASHBOARD_TOKEN"
```

**Pass:** all 200. `/api/health` JSON includes `killSwitches` map.

```bash
kill $DASHBOARD_PID
```

## 4. Kill-switch hot reload

```bash
node dist/index.js &
DASHBOARD_PID=$!
sleep 3
# Flip the LLM spawn switch in .env without restarting
echo 'LLM_SPAWN_ENABLED=false' >> .env
sleep 2
# Verify health reports the flag flipped
curl -s "http://localhost:8989/api/health?token=$DASHBOARD_TOKEN" | jq '.killSwitches.LLM_SPAWN_ENABLED'
```

**Pass:** returns `false`. Dashboard mutations / war-room sends start returning 503.

```bash
# Restore
sed -i.bak '/^LLM_SPAWN_ENABLED=false$/d' .env
kill $DASHBOARD_PID
```

## 5. CSRF gate

```bash
node dist/index.js &
DASHBOARD_PID=$!
sleep 3
# Cross-origin POST should be rejected
curl -s -X POST -H 'Origin: http://attacker.example' \
  -H 'Content-Type: application/json' \
  "http://localhost:8989/api/warroom/text/send?token=$DASHBOARD_TOKEN" \
  -d '{"meetingId":"x","text":"hi"}' \
  -o /dev/null -w "%{http_code}\n"
# Same-origin POST (no Origin header) should reach the validation layer
curl -s -X POST \
  -H 'Content-Type: application/json' \
  "http://localhost:8989/api/warroom/text/send?token=$DASHBOARD_TOKEN" \
  -d '{"meetingId":"x","text":"hi"}' \
  -o /dev/null -w "%{http_code}\n"
kill $DASHBOARD_PID
```

**Pass:** first returns 403, second returns 400 (validation, not CSRF).

## 6. launchd restart

```bash
# macOS: install service
./scripts/install-launchd.sh
launchctl kickstart -k gui/$(id -u)/com.claudeclaw.main
sleep 5
# Service should be running again
launchctl list | grep com.claudeclaw.main
```

**Pass:** service comes back up, `launchctl print` shows `state = running`, last exit code 0.

## 7. Voice Daily round-trip (manual)

1. Open the dashboard → Start Meeting (voice)
2. Speak: "what time is it" → Gemini should respond verbally
3. Click an agent card to switch (auto-respawn ~6s)
4. Trigger a hand-raise (auto mode) — verify hand-up animation
5. End meeting

**Pass:** no stuck hand-up, no orphan Pipecat subprocess (`ps -ef | grep server.py` returns nothing).

## 8. Persistence after restart

1. Open `/warroom/text`, create meeting, send 2 turns
2. Note `meetingId` and visible transcript
3. `pkill -f 'node.*dist/index.js' && node dist/index.js &`
4. Reload `/warroom/text?meetingId=<id>` (with token + chatId)

**Pass:** transcript intact, send works, SSE reconnects cleanly.

## 9. Upgrade-in-place

```bash
# Save the production DB and .env
cp store/claudeclaw.db /tmp/prod-db-backup.db
cp .env /tmp/prod-env-backup
# Pretend a fresh build happened
npm run build
# Boot — migrations should run forward without error
node dist/index.js &
sleep 4
curl -s "http://localhost:8989/api/health?token=$DASHBOARD_TOKEN"
kill %1
```

**Pass:** boot completes, health returns 200, `store/claudeclaw.db.pre-*.bak` exists with `0600` permissions, no data loss.

## 10. Bundled asset integrity

```bash
ls -la warroom/client.bundle.js
file warroom/client.bundle.js
```

**Pass:** mtime is recent (rebuilt this release), file is valid JS.

---

## What this runbook does NOT replace

- Red-team / prompt-injection tests (run those under `scripts/audit-profile.sh`, never against live state)
- SSE soak test under load (Phase 4 `npm test` covers the unit-level edges, but real soak needs a separate harness)
- Provider-live tests (anything that hits Anthropic/Daily/Gemini/Telegram for real)
