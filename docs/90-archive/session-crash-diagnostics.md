# Session Crash Diagnostics

Use this when long-running dev sessions (terminal/opencode/VS Code/hub) disappear unexpectedly.

## 1) Start background diagnostics (before reproducing)

```bash
cd /data/projects/accordo-browser2.0
chmod +x scripts/diag-start.sh scripts/diag-stop.sh scripts/diag-opencode.sh scripts/run-logged.sh scripts/diagnostics/watchdog.sh
scripts/diag-start.sh 5
```

This creates a run folder under:

`logs/session-diagnostics/<run_id>/`

It records:
- process snapshots (pid/ppid/memory/cpu)
- pid appear/disappear events
- tracked root-process disappearance events (if you add tracked roots)
- pressure snapshots (`/proc/pressure/{cpu,memory,io}`)
- tails of latest VS Code logs (`main.log`, renderer, exthost, Accordo Hub log if present)

## 2) (Optional) Run critical commands with dedicated logging

For OpenCode session:

```bash
scripts/run-logged.sh --label opencode -- opencode
```

For a script launch:

```bash
scripts/run-logged.sh --label dev-open -- /data/projects/accordo/scripts/dev-open.sh --no-build
```

This captures signal/exit metadata in addition to command output.

## 2b) Launch opencode with automatic root tracking and lifecycle logging

`diag-opencode.sh` is a thin wrapper that:

- Validates the existing diagnostics run directory.
- Registers its own PID in `roots.txt` (same format as `diag-track.sh`) so the watchdog immediately monitors the session.
- Writes a lifecycle log file (`opencode-session-<timestamp>-<pid>.log`) containing `started_at`, `wrapper_pid`, `label`, `cwd`, `command`, and `args`.
- Launches `opencode` in the **foreground** so the interactive TTY works normally.
- Appends `ended_at`, `exit_code`, and (when ≥ 128) `signal` when opencode exits.
- Exits with the same code as opencode.

```bash
# Minimal — uses default label "opencode-shell"
scripts/diag-opencode.sh <run_id>

# With a custom label
scripts/diag-opencode.sh <run_id> opencode-main

# Pass extra arguments to opencode after --
scripts/diag-opencode.sh <run_id> opencode-main -- --model gpt-4o
```

Full example from a running session:

```bash
# 1. Note the run_id from diag-start.sh output (or ls logs/session-diagnostics/)
RUN_ID=20260329T064458Z

# 2. Launch — opencode starts interactively; diagnostics run in the background
scripts/diag-opencode.sh "$RUN_ID" opencode-main

# 3. After the session ends, check the lifecycle log
cat logs/session-diagnostics/"$RUN_ID"/opencode-session-*.log
```

The lifecycle log will look like:

```
started_at=2026-03-29T06:45:00Z
wrapper_pid=98765
label=opencode-main
cwd=/data/projects/accordo-browser2.0
command=opencode
args=<none>
run_id=20260329T064458Z
ended_at=2026-03-29T07:12:34Z
exit_code=0
```

If opencode was killed by a signal (e.g. SIGKILL = 9), exit_code will be 137 and a `signal=9` line is appended.

## 2c) Track a specific external terminal/session PID (recommended)

If a terminal process outside VS Code disappears, explicitly track it by PID so all descendants are monitored:

```bash
# find run id from scripts/diag-start.sh output
scripts/diag-track.sh <run_id> <pid> <label>
```

Example:

```bash
scripts/diag-track.sh 20260328T173322Z 123456 opencode-main
```

This makes the watchdog emit `tracked-root-missing` when that PID vanishes and tracks descendants even if command names change.

## 3) Stop diagnostics after reproduction

```bash
scripts/diag-stop.sh <run_id>
```

## 4) What to inspect first

In the run folder:
- `watchdog.log` → pid-disappeared events with timestamps
- `watchdog.log` → also `tracked-root-missing` for explicitly tracked terminal/session roots
- `process-snapshot-*.txt` around disappearance times
- `pressure-*.txt` for CPU/memory/io pressure spikes
- `vscode-tails/*.log` for extension host/fileWatcher crashes and hub errors
- `meta.log` from `run-logged.sh` for signal/exit code evidence

## Notes

- Kernel `dmesg` may be restricted for non-root users; this setup avoids relying on it.
- If you can reproduce twice, compare timestamps between `watchdog.log` and VS Code tail logs to identify the first process that died.
