# skool-mcp — ingest skool.com into the mc-kb knowledge base

Headless Playwright scrapers that pull skool.com community posts + classroom modules into `~/mc-kb/notes/skool/<group-slug>{,-classroom}/` as markdown. Picked up by the next `mc-kb` reindex (within 1h via the systemd timer) and queryable from the **/mckb** tab in the daemon UI.

## Setup

```bash
cd scripts/skool-mcp
npm install
npx playwright install chromium
# Ubuntu 26.04 (where the bundled Chromium binary fails to install):
#   sudo apt-get install -y libnss3 libnspr4 libasound2t64
#   npm install playwright@1.49      # 24.04-era pin still has Chromium binaries
```

## One-time login

```bash
node login.mjs
```

Opens a Chromium window via WSLg (or local X11). You log in to skool.com manually (handles 2FA, Google SSO, captcha). The script auto-detects login via cookie diff and saves `storageState.json` in this directory — **gitignored**, never commit it.

Session typically lasts weeks. Re-run if you start getting redirected back to /login.

## Scraping a community feed

```bash
node pull-channel.mjs <group-slug> --limit 500
# Writes ~/mc-kb/notes/skool/<group-slug>/<date>_<title>.md (one per post)
# Idempotent — same titles overwrite, new posts add
```

The scraper sweeps the main feed plus every category (`?c=<id>`) so it captures posts behind filters. Skool's "All" view typically only shows ~30 recent.

## Scraping a community classroom

```bash
node pull-classroom.mjs <group-slug> --limit 500
# Writes ~/mc-kb/notes/skool/<group-slug>-classroom/<NNN>_<title>.md
```

Enumerates module URLs from the course sidebar (`?md=<id>` pattern), then visits each module and extracts the lesson description from `div[class*="EditorContentWrapper"]`. Modules without written descriptions (video-only) get skipped with a notice.

The course-discovery step probes `/<group>/classroom` — currently falls back to the Claude Code Zero-to-Hero course id (`205bbe56`) for the `earlyaidopters` group if the landing scrape returns empty.

## After scraping

```bash
~/mc-kb/.venv/bin/python ~/mc-kb/sync.py --reindex
```

Or wait up to 1h for the `mc-kb-sync-reindex.timer` to auto-fire. Then search via the **/mckb** tab in the daemon (localhost:3141) or the `mc-recall` Claude Code skill.

## Files

| File | Purpose |
|---|---|
| `login.mjs` | One-time interactive login; saves `storageState.json` |
| `pull-channel.mjs` | Feed scraper (community posts + categories) |
| `pull-classroom.mjs` | Classroom scraper (course modules + lesson descriptions) |
| `package.json` | `playwright` dep (pin to 1.49 on Ubuntu 26.04 hosts) |

## What's NOT scraped

- **Video transcripts** — the "Transcript" link in modules is a lazy-load click. Currently unhandled (one of the modules in v1 lost content because of this — `Using Hooks For Memory Injection`'s deep teaching is video-only).
- **Comments threads on classroom modules** — only the lesson description is pulled. Feed-post comments ARE pulled (they're in the post body).
- **Other groups' content** — you must be a member with `storageState.json` cookies authorized.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Run \`node login.mjs\` first.` | `storageState.json` missing | Run login |
| `Found 0 post URLs` | Skool DOM changed OR you're not a member of the group | Inspect with `playwright open` headed mode |
| `Module body empty` (skipped) | Video-only module with no description text | Expected; not all modules have written content |
| `Discovered 0 categories` | Page didn't fully hydrate in 3s | Increase the `waitForTimeout` in the script |
