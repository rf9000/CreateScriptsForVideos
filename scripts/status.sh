#!/bin/sh
# One look at an item's run on the VM: environment status, log head, and the video's step summary.
# Usage, from anywhere on the VM host: CreateScriptsForVideos/scripts/status.sh <work item id>
set -u
ID="$1"
cd "$(dirname "$0")/../.."
OUT="output/$ID"
ENV_ID=$(jq -r '.envId // empty' "$OUT/pipeline-state.json" 2>/dev/null)
if [ -n "$ENV_ID" ]; then
  echo "== environment $ENV_ID"
  docker compose exec -T -u claude create-scripts-for-videos continia env get "$ENV_ID" | grep -i "status"
fi
echo "== log ($OUT/resume.log)"
grep -v "^\s*$" "$OUT/resume.log" 2>/dev/null | head -12
if [ -f "$OUT/video/steps.json" ]; then
  echo "== steps ($OUT/video/steps.json)"
  jq -r '.steps[] | "\(.index) \(.type) \(.ms)ms wait=\(.waitMs // 0) \(if .valueAfter != null then "value=\(.valueAfter)\(if .valueMismatch then " MISMATCH" else "" end)" else "" end) \(.staging | join("; ")) \(.error // "")"' "$OUT/video/steps.json"
fi
