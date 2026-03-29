#!/usr/bin/env bash
# diag-opencode.sh — launch opencode in foreground with durable lifecycle logging
# and automatic watchdog root tracking for an existing diagnostics run.
#
# Usage:
#   scripts/diag-opencode.sh <run_id> [label] [-- <opencode args...>]
#
# Arguments:
#   run_id   — an existing diagnostics run directory under logs/session-diagnostics/
#   label    — optional human-readable name (default: opencode-shell)
#   --       — separator; everything after is forwarded verbatim to opencode
#
# Example:
#   scripts/diag-opencode.sh 20260329T064458Z opencode-main -- --model gpt-4o

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_ROOT="$ROOT_DIR/logs/session-diagnostics"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/diag-opencode.sh <run_id> [label] [-- <opencode args...>]" >&2
  exit 1
fi

RUN_ID="$1"
shift

# Second positional arg is optional label (not starting with --)
LABEL="opencode-shell"
if [[ $# -gt 0 && "$1" != "--" ]]; then
  LABEL="$1"
  shift
fi

# Consume optional -- separator
OC_ARGS=()
if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--" ]]; then
    shift
  fi
  OC_ARGS=("$@")
fi

# ---------------------------------------------------------------------------
# Validate run directory
# ---------------------------------------------------------------------------
RUN_DIR="$LOG_ROOT/$RUN_ID"
if [[ ! -d "$RUN_DIR" ]]; then
  echo "error: diagnostics run directory not found: $RUN_DIR" >&2
  echo "       Start a run first with: scripts/diag-start.sh" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Validate opencode is available
# ---------------------------------------------------------------------------
if ! command -v opencode >/dev/null 2>&1; then
  echo "error: 'opencode' command not found in PATH" >&2
  exit 127
fi

# ---------------------------------------------------------------------------
# Register wrapper PID in roots.txt (same format as diag-track.sh)
# Avoid duplicate entries for the same PID.
# ---------------------------------------------------------------------------
ROOTS_FILE="$RUN_DIR/roots.txt"
touch "$ROOTS_FILE"

WRAPPER_PID="$$"
if ! grep -q "^${WRAPPER_PID} " "$ROOTS_FILE" 2>/dev/null && \
   ! grep -qx "${WRAPPER_PID}" "$ROOTS_FILE" 2>/dev/null; then
  printf "%s %s added_at=%s\n" \
    "$WRAPPER_PID" \
    "$LABEL" \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    >>"$ROOTS_FILE"
fi

# ---------------------------------------------------------------------------
# Create lifecycle log file
# ---------------------------------------------------------------------------
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
SESSION_LOG="$RUN_DIR/opencode-session-${TIMESTAMP}-${WRAPPER_PID}.log"

# Build a printable representation of opencode args (may be empty)
OC_ARGS_STR="${OC_ARGS[*]+"${OC_ARGS[*]}"}"

{
  echo "started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "wrapper_pid=$WRAPPER_PID"
  echo "label=$LABEL"
  echo "cwd=$(pwd)"
  echo "command=opencode"
  echo "args=${OC_ARGS_STR:-<none>}"
  echo "run_id=$RUN_ID"
} >"$SESSION_LOG"

echo "diag-opencode: lifecycle log → $SESSION_LOG"
echo "diag-opencode: registered PID $WRAPPER_PID as '$LABEL' in run $RUN_ID"

# ---------------------------------------------------------------------------
# Launch opencode in foreground (preserves interactive TTY)
# ---------------------------------------------------------------------------
OC_EXIT=0
if [[ ${#OC_ARGS[@]} -gt 0 ]]; then
  opencode "${OC_ARGS[@]}" || OC_EXIT=$?
else
  opencode || OC_EXIT=$?
fi

# ---------------------------------------------------------------------------
# Append exit metadata
# ---------------------------------------------------------------------------
{
  echo "ended_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "exit_code=$OC_EXIT"
  # POSIX: exit codes >= 128 indicate termination by signal N = code - 128
  if [[ $OC_EXIT -ge 128 ]]; then
    echo "signal=$((OC_EXIT - 128))"
  fi
} >>"$SESSION_LOG"

exit "$OC_EXIT"
