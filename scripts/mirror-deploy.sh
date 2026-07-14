#!/usr/bin/env bash
# Redeploy the claudeclaw web bundle to the Vercel mirror (claudeclaw-mirror.vercel.app).
# Runs automatically after `npm run build:web` (postbuild:web hook). Fail-open:
# a mirror hiccup must never break the laptop build/deploy chain.
#
# Why CLI upload instead of git: the only GitHub remote is the PUBLIC
# claudeclaw-os fork and the local tree carries Mike-private files (MEMORY.md,
# data/astrology/*) — nothing may be pushed there. This uploads ONLY dist/web.
set -u
cd "$(dirname "$0")/.." || exit 0
command -v vercel >/dev/null 2>&1 || { echo "mirror-deploy: vercel CLI missing, skipped"; exit 0; }
[ -d dist/web ] || { echo "mirror-deploy: dist/web missing, skipped"; exit 0; }

# vite wipes dist/web on every build — restore the project link + rewrites.
mkdir -p dist/web/.vercel
cp scripts/vercel-mirror-project.json dist/web/.vercel/project.json
cat > dist/web/vercel.json <<'JSON'
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://claudeclaw.serveftp.com/api/:path*" },
    { "source": "/:path((?!api/).*)", "destination": "/index.html" }
  ]
}
JSON

(cd dist/web && vercel deploy --prod --yes --scope itsjuggalos-projects >/dev/null 2>&1) \
  && echo "mirror-deploy: claudeclaw-mirror.vercel.app updated" \
  || echo "mirror-deploy: deploy failed (non-fatal)"
exit 0
