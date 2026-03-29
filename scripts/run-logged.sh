#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="$ROOT_DIR/logs/session-diagnostics"

if [[ $# -lt 3 || "$1" != "--label" ]]; then
  echo "Usage: scripts/run-logged.sh --label <name> -- <command...>"
  echo "Example: scripts/run-logged.sh --label opencode -- opencode"
  exit 1
fi

LABEL="$2"
shift 2

if [[ "$1" != "--" ]]; then
  echo "Expected '--' before command"
  exit 1
fi
shift

if [[ $# -eq 0 ]]; then
  echo "Missing command"
  exit 1
fi

mkdir -p "$LOG_ROOT"
RUN_ID="$(date -u +"%Y%m%dT%H%M%SZ")"
RUN_DIR="$LOG_ROOT/$RUN_ID-$LABEL"
mkdir -p "$RUN_DIR"

META="$RUN_DIR/meta.log"
OUT="$RUN_DIR/stdout-stderr.log"

log_meta() {
  printf "%s %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >>"$META"
}

on_exit() {
  local code="$?"
  log_meta "exit code=$code"
}

on_signal() {
  local sig="$1"
  log_meta "signal=$sig"
}

trap on_exit EXIT
trap 'on_signal HUP' HUP
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

log_meta "label=$LABEL"
log_meta "pwd=$(pwd)"
log_meta "command=$*"
log_meta "pid=$$ ppid=$PPID"

echo "Logging run to: $RUN_DIR"
"$@" >>"$OUT" 2>&1
