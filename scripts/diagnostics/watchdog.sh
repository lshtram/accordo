#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${1:?run directory required}"
INTERVAL_SECONDS="${2:-5}"

mkdir -p "$RUN_DIR"

LOG_FILE="$RUN_DIR/watchdog.log"
PIDS_FILE="$RUN_DIR/last-pids.txt"
ROOTS_FILE="$RUN_DIR/roots.txt"
MISSING_ROOTS_FILE="$RUN_DIR/missing-roots.txt"

touch "$PIDS_FILE"
touch "$ROOTS_FILE"
touch "$MISSING_ROOTS_FILE"

log() {
  printf "%s %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >>"$LOG_FILE"
}

collect_proc_snapshot() {
  local out="$RUN_DIR/process-snapshot-$(date -u +"%Y%m%dT%H%M%SZ").txt"
  ps -eo pid,ppid,pgid,sid,stat,etime,%mem,%cpu,rss,vsz,comm,args --sort=-%mem >"$out" || true
  log "snapshot file=$out"
}

collect_pressure() {
  local out="$RUN_DIR/pressure-$(date -u +"%Y%m%dT%H%M%SZ").txt"
  {
    printf "# /proc/pressure/cpu\n"
    if [[ -r /proc/pressure/cpu ]]; then cat /proc/pressure/cpu; else printf "unavailable\n"; fi
    printf "\n# /proc/pressure/memory\n"
    if [[ -r /proc/pressure/memory ]]; then cat /proc/pressure/memory; else printf "unavailable\n"; fi
    printf "\n# /proc/pressure/io\n"
    if [[ -r /proc/pressure/io ]]; then cat /proc/pressure/io; else printf "unavailable\n"; fi
  } >"$out"
  log "pressure file=$out"
}

collect_matching_pids() {
  local auto_pids
  local rooted_pids

  auto_pids="$RUN_DIR/auto-pids.txt"
  rooted_pids="$RUN_DIR/rooted-pids.txt"

  ps -eo pid,args \
    | awk '
      /opencode-ai|\.opencode|Code|code|accordo-hub|packages\/hub|relay-standalone|browser-extension|pnpm|vitest|google-chrome|chrome/ {
        if ($0 !~ /awk/) print $1
      }
    ' \
    | sort -u >"$auto_pids"

  collect_root_descendants >"$rooted_pids"

  cat "$auto_pids" "$rooted_pids" | awk 'NF{print $1}' | sort -u
}

collect_root_descendants() {
  if [[ ! -s "$ROOTS_FILE" ]]; then
    return 0
  fi

  declare -A tracked=()
  declare -A parent=()
  local psmap="$RUN_DIR/psmap.txt"

  while IFS=' ' read -r root _rest; do
    [[ -n "$root" ]] || continue
    if [[ "$root" =~ ^[0-9]+$ ]]; then
      tracked["$root"]=1
    fi
  done <"$ROOTS_FILE"

  ps -eo pid=,ppid= >"$psmap"
  while IFS=' ' read -r pid ppid; do
    [[ -n "$pid" && -n "$ppid" ]] || continue
    parent["$pid"]="$ppid"
  done <"$psmap"

  local changed=1
  while [[ "$changed" -eq 1 ]]; do
    changed=0
    while IFS=' ' read -r pid ppid; do
      [[ -n "$pid" && -n "$ppid" ]] || continue
      if [[ -n "${tracked[$ppid]:-}" && -z "${tracked[$pid]:-}" ]]; then
        tracked["$pid"]=1
        changed=1
      fi
    done <"$psmap"
  done

  for pid in "${!tracked[@]}"; do
    echo "$pid"
  done | sort -u
}

collect_pid_details() {
  local pid="$1"
  local out="$RUN_DIR/pid-$pid-$(date -u +"%Y%m%dT%H%M%SZ").txt"
  {
    printf "# pid=%s\n" "$pid"
    if [[ -r "/proc/$pid/status" ]]; then
      cat "/proc/$pid/status"
    else
      printf "status: unavailable (process may have exited)\n"
    fi
    printf "\n# cmdline\n"
    if [[ -r "/proc/$pid/cmdline" ]]; then
      tr '\0' ' ' <"/proc/$pid/cmdline"; printf "\n"
    else
      printf "cmdline unavailable\n"
    fi
  } >"$out"
  log "pid-detail file=$out"
}

log "watchdog-start interval=${INTERVAL_SECONDS}s run_dir=$RUN_DIR"
collect_proc_snapshot
collect_pressure

while true; do
  if [[ -s "$ROOTS_FILE" ]]; then
    while IFS=' ' read -r root label _rest; do
      [[ -n "$root" ]] || continue
      if [[ "$root" =~ ^[0-9]+$ ]]; then
        if [[ ! -d "/proc/$root" ]]; then
          if ! grep -q "^$root " "$MISSING_ROOTS_FILE" 2>/dev/null; then
            printf "%s %s\n" "$root" "${label:-n/a}" >>"$MISSING_ROOTS_FILE"
            log "tracked-root-missing pid=$root label=${label:-n/a}"
          fi
        else
          if grep -q "^$root " "$MISSING_ROOTS_FILE" 2>/dev/null; then
            grep -v "^$root " "$MISSING_ROOTS_FILE" >"$MISSING_ROOTS_FILE.tmp" || true
            mv "$MISSING_ROOTS_FILE.tmp" "$MISSING_ROOTS_FILE"
            log "tracked-root-reappeared pid=$root label=${label:-n/a}"
          fi
        fi
      fi
    done <"$ROOTS_FILE"
  fi

  now_pids="$RUN_DIR/current-pids.txt"
  collect_matching_pids >"$now_pids"

  while IFS= read -r pid; do
    if [[ -n "$pid" ]] && ! grep -qx "$pid" "$PIDS_FILE"; then
      log "pid-seen pid=$pid"
      collect_pid_details "$pid"
    fi
  done <"$now_pids"

  while IFS= read -r pid; do
    if [[ -n "$pid" ]] && ! grep -qx "$pid" "$now_pids"; then
      log "pid-disappeared pid=$pid"
      collect_proc_snapshot
      collect_pressure
    fi
  done <"$PIDS_FILE"

  mv "$now_pids" "$PIDS_FILE"
  sleep "$INTERVAL_SECONDS"
done
