#!/usr/bin/env bash
set -euo pipefail

# Discover the actual Hub port from ~/.accordo/hub.port (written by Hub on
# startup). Falls back to 3000 when the file does not exist yet.
PORT_FILE="$HOME/.accordo/hub.port"
DEFAULT_PORT=3000

if [[ -f "$PORT_FILE" ]]; then
  HUB_PORT="$(cat "$PORT_FILE")"
else
  HUB_PORT="$DEFAULT_PORT"
fi

HUB_URL="${ACCORDO_HUB_URL:-http://localhost:${HUB_PORT}/health}"

echo "[dev-health] Checking $HUB_URL"

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl not found in PATH" >&2
  exit 1
fi

if curl --fail --silent --show-error "$HUB_URL"; then
  echo
  echo "[dev-health] Hub is reachable."
else
  echo
  echo "[dev-health] Hub is not reachable yet."
  echo "If VS Code just opened, wait a few seconds for bridge auto-start."
  exit 1
fi
