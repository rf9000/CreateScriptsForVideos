#!/bin/sh
# Re-record an item's video in the background on the VM (dry run, resumes from saved state).
# Usage, from anywhere on the VM host: CreateScriptsForVideos/scripts/rerecord.sh <work item id>
# The log goes to output/<id>/resume.log; steps.json and shots/ to output/<id>/video/.
set -eu
ID="$1"
cd "$(dirname "$0")/../.."
docker compose exec -d -u claude create-scripts-for-videos sh -c \
  "bun src/cli/index.ts test-item $ID --resume --video > /app/output/$ID/resume.log 2>&1"
echo "re-recording $ID; log: output/$ID/resume.log"
