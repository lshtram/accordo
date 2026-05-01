#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_DIR="$ROOT_DIR/demo/browser-mcp-5-fixture"
CROSS_DIR="$ROOT_DIR/demo/browser-mcp-5-fixture-cross-origin"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to serve the Browser MCP 5 fixture" >&2
  exit 1
fi

cleanup() {
  jobs -p | xargs -r kill
}
trap cleanup EXIT INT TERM

python3 -m http.server 4175 --bind 127.0.0.1 --directory "$MAIN_DIR" &
python3 -m http.server 4176 --bind 127.0.0.1 --directory "$CROSS_DIR" &

echo "Browser MCP 5 fixture main:  http://127.0.0.1:4175/index.html"
echo "Browser MCP 5 fixture cross: http://127.0.0.1:4176/cross-origin.html"
wait
