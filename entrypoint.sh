#!/bin/bash
set -e

# Fix ownership of mounted/named volumes (they mount as root) then drop privileges.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/.state/continia
  # continia's Azure AD session (~/.continia/auth.json, from `continia auth login`) lives on the
  # state volume, so a rebuilt container keeps it.
  if [ ! -L /home/claude/.continia ]; then
    rm -rf /home/claude/.continia
    ln -s /app/.state/continia /home/claude/.continia
  fi
  chown -R claude:claude /app/output /app/.state
  chown -h claude:claude /home/claude/.continia
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
