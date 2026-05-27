#!/bin/bash
set -e

# Fix ownership of mounted/named volumes (they mount as root) then drop privileges.
if [ "$(id -u)" = "0" ]; then
  chown -R claude:claude /app/output
  chown -R claude:claude /home/claude/.claude 2>/dev/null || true

  # continia-banking is mounted READ-ONLY — verify it's actually there before starting.
  BANKING="${CONTINIA_BANKING_PATH:-/repos/continia-banking}"
  if [ ! -d "$BANKING/.git" ]; then
    echo "ERROR: continia-banking not found at $BANKING"
    echo "Mount it read-only from the host, e.g.: ~/repos/continia-banking:$BANKING:ro"
    exit 1
  fi

  # The continia CLI must resolve on PATH (skills call it as a bare `continia`).
  if ! command -v continia >/dev/null 2>&1; then
    echo "ERROR: continia CLI not found on PATH (expected /opt/continia/continia)"
    echo "Mount the linux build: ~/tools/continia-linux:/opt/continia/continia:ro (and chmod +x on the host)"
    exit 1
  fi

  exec su claude -c "export HOME=/home/claude && cd /app && bun run start"
fi

exec bun run start
