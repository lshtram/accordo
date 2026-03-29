#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="$ROOT_DIR/logs/session-diagnostics"

if [[ $# -lt 2 ]]; then
  echo "Usage: scripts/diag-track.sh <run_id> <pid> [label]"
  exit 1
fi

RUN_ID="$1"
PID="$2"
LABEL="${3:-manual}"

if [[ ! "$PID" =~ ^[0-9]+$ ]]; then
  echo "PID must be numeric"
  exit 1
fi

RUN_DIR="$LOG_ROOT/$RUN_ID"
ROOTS_FILE="$RUN_DIR/roots.txt"

if [[ ! -d "$RUN_DIR" ]]; then
  echo "Run directory not found: $RUN_DIR"
  exit 1
fi

mkdir -p "$RUN_DIR"
touch "$ROOTS_FILE"

if grep -q "^$PID " "$ROOTS_FILE" || grep -qx "$PID" "$ROOTS_FILE"; then
  echo "PID already tracked: $PID"
  exit 0
fi

printf "%s %s added_at=%s\n" "$PID" "$LABEL" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >>"$ROOTS_FILE"
echo "Tracking PID $PID as '$LABEL' in run $RUN_ID"
