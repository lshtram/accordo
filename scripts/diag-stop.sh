#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="$ROOT_DIR/logs/session-diagnostics"

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/diag-stop.sh <run_id>"
  echo "Available runs:"
  if [[ -d "$LOG_ROOT" ]]; then
    ls -1 "$LOG_ROOT"
  fi
  exit 1
fi

RUN_ID="$1"
RUN_DIR="$LOG_ROOT/$RUN_ID"

if [[ ! -d "$RUN_DIR" ]]; then
  echo "Run directory not found: $RUN_DIR"
  exit 1
fi

if [[ -f "$RUN_DIR/watchdog.pid" ]]; then
  WATCHDOG_PID="$(<"$RUN_DIR/watchdog.pid")"
  if kill -0 "$WATCHDOG_PID" 2>/dev/null; then
    kill "$WATCHDOG_PID" || true
  fi
fi

if [[ -f "$RUN_DIR/tail-pids.txt" ]]; then
  while IFS=' ' read -r pid _src; do
    [[ -n "$pid" ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
    fi
  done <"$RUN_DIR/tail-pids.txt"
fi

echo "stopped_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >>"$RUN_DIR/manifest.txt"

echo "Stopped diagnostics run: $RUN_ID"
echo "Logs available in: $RUN_DIR"
