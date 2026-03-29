#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_ROOT="$ROOT_DIR/logs/session-diagnostics"
CODE_LOG_ROOT="${CODE_LOG_ROOT:-$HOME/.config/Code/logs}"
INTERVAL_SECONDS="${1:-5}"

mkdir -p "$LOG_ROOT"

RUN_ID="$(date -u +"%Y%m%dT%H%M%SZ")"
RUN_DIR="$LOG_ROOT/$RUN_ID"
TAIL_DIR="$RUN_DIR/vscode-tails"
mkdir -p "$RUN_DIR" "$TAIL_DIR"

WATCHDOG_SCRIPT="$ROOT_DIR/scripts/diagnostics/watchdog.sh"
nohup "$WATCHDOG_SCRIPT" "$RUN_DIR" "$INTERVAL_SECONDS" >/dev/null 2>&1 &
WATCHDOG_PID="$!"
echo "$WATCHDOG_PID" >"$RUN_DIR/watchdog.pid"

echo "run_id=$RUN_ID" >"$RUN_DIR/manifest.txt"
echo "started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >>"$RUN_DIR/manifest.txt"
echo "interval_seconds=$INTERVAL_SECONDS" >>"$RUN_DIR/manifest.txt"
echo "watchdog_pid=$WATCHDOG_PID" >>"$RUN_DIR/manifest.txt"

LATEST_CODE_LOG_DIR=""
if [[ -d "$CODE_LOG_ROOT" ]]; then
  for d in "$CODE_LOG_ROOT"/*; do
    [[ -d "$d" ]] || continue
    if [[ -z "$LATEST_CODE_LOG_DIR" || "$d" -nt "$LATEST_CODE_LOG_DIR" ]]; then
      LATEST_CODE_LOG_DIR="$d"
    fi
  done
fi

echo "code_log_root=$CODE_LOG_ROOT" >>"$RUN_DIR/manifest.txt"
echo "latest_code_log_dir=${LATEST_CODE_LOG_DIR:-none}" >>"$RUN_DIR/manifest.txt"

TAIL_PIDS_FILE="$RUN_DIR/tail-pids.txt"
touch "$TAIL_PIDS_FILE"

start_tail() {
  local src="$1"
  local name="$2"
  [[ -f "$src" ]] || return 0
  nohup tail -F "$src" >>"$TAIL_DIR/$name.log" 2>&1 &
  local pid="$!"
  echo "$pid $src" >>"$TAIL_PIDS_FILE"
}

if [[ -n "$LATEST_CODE_LOG_DIR" ]]; then
  start_tail "$LATEST_CODE_LOG_DIR/main.log" "main"

  for f in "$LATEST_CODE_LOG_DIR"/window*/renderer.log; do
    [[ -f "$f" ]] || continue
    base="$(basename "$(dirname "$f")")-renderer"
    start_tail "$f" "$base"
  done

  for f in "$LATEST_CODE_LOG_DIR"/window*/exthost/exthost.log; do
    [[ -f "$f" ]] || continue
    base="$(basename "$(dirname "$(dirname "$f")")")-exthost"
    start_tail "$f" "$base"
  done

  for f in "$LATEST_CODE_LOG_DIR"/window*/exthost/output_logging_*/2-Accordo\ Hub.log; do
    [[ -f "$f" ]] || continue
    base="$(basename "$(dirname "$(dirname "$(dirname "$f")")")")-accordo-hub"
    start_tail "$f" "$base"
  done
fi

echo "Started diagnostics logging"
echo "Run dir: $RUN_DIR"
echo "Watchdog PID: $WATCHDOG_PID"
echo "To stop: $ROOT_DIR/scripts/diag-stop.sh $RUN_ID"
