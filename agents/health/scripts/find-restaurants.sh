#!/bin/bash
# Find highly-rated restaurants on TripAdvisor via Apify, BOUNDED and with live
# progress pings so the user is never left staring at a silent "Skill..." bubble.
#
# Usage: find-restaurants.sh "<location>" [maxItems]
#   find-restaurants.sh "Downtown, Toronto" 10
#
# Writes the raw results to /tmp/health/restaurants.json and prints that path on
# success. The agent then reads it and ranks the picks against the user's plan
# (e.g. low saturated fat, watch sodium, MUFA and veg-forward,
# enough protein). The actor takes 1-3 min, hence the pings and the hard cap.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOC="${1:?usage: find-restaurants.sh \"<location>\" [maxItems]}"
N="${2:-8}"
CAP_SECONDS=240
OUT=/tmp/health/restaurants.json
RUNNER="$HOME/.agents/skills/apify-ultimate-scraper/reference/scripts/run_actor.js"
mkdir -p /tmp/health
rm -f "$OUT"

ping() { "$DIR/ping.sh" "$1" >/dev/null 2>&1 || true; }

# macOS has no `timeout`. Run in background, kill if it overruns the cap.
run_bounded() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -0 "$pid" 2>/dev/null && kill -TERM "$pid" 2>/dev/null ) >/dev/null 2>&1 & local watcher=$!
  wait "$pid"; local rc=$?
  kill "$watcher" 2>/dev/null
  return $rc
}

ping "Searching TripAdvisor for top restaurants in ${LOC}. Takes a minute or two, I will come back with picks."

INPUT="{\"locationFullName\":\"${LOC}\",\"includeRestaurants\":true,\"includeHotels\":false,\"includeAttractions\":false,\"maxItemsPerQuery\":${N},\"language\":\"en\",\"currency\":\"USD\"}"

run_bounded "$CAP_SECONDS" node --env-file="$HOME/.env" "$RUNNER" \
  --actor "maxcopell/tripadvisor" --input "$INPUT" \
  --output "$OUT" --format json >/tmp/health/ta-run.log 2>&1
rc=$?

if [ "$rc" -ne 0 ] || [ ! -s "$OUT" ]; then
  ping "TripAdvisor lookup did not finish in time. I will use what I already know about ${LOC} instead, or you can ask me to retry."
  echo "FIND_RESTAURANTS_FAILED rc=$rc (see /tmp/health/ta-run.log)" >&2
  exit 1
fi

COUNT=$(python3 -c "import json;print(len(json.load(open('$OUT'))))" 2>/dev/null || echo "?")
ping "Pulled ${COUNT} spots. Ranking them against your plan now."
echo "$OUT"
