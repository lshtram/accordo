#!/usr/bin/env bash
set -euo pipefail

# Allow sourcing this file for its functions without running the main logic
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0 2>/dev/null || exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_DIR=""
DO_BUILD=1
NEW_WINDOW=1
PKG_DIRS=()

usage() {
  cat <<'EOF'
Usage: scripts/dev-open.sh [options] [project-path]

Opens a VS Code window with extensions in extension-development mode.

Arguments:
  project-path     Directory of the project to open.
                   Defaults to the directory containing this script.

Options:
  -p, --pkg <dir>  Add a package directory to load (can be used multiple times).
                   Auto-detected if not specified: packages/, extensions/, ext/
  --no-build       Skip 'pnpm build' before launch
  --reuse-window   Use current VS Code window instead of --new-window
  -h, --help       Show this help

Examples:
  # Open default project (accordo) with auto-detected packages
  scripts/dev-open.sh

  # Open a different project
  scripts/dev-open.sh /path/to/my-extension-project

  # Open with explicit package directories
  scripts/dev-open.sh /path/to/project --pkg src/extensions/alpha --pkg src/extensions/beta

  # Faster iteration (skip build)
  scripts/dev-open.sh --no-build
EOF
}

discover_packages() {
  local dir="$1"
  local found=()

  for pkg_dir in packages extensions ext; do
    if [[ -d "$dir/$pkg_dir" ]]; then
      while IFS= read -r pkg; do
        # Must be a directory with a package.json AND have engines.vscode
        # (i.e. is a VS Code extension, not a plain library package)
        if [[ -d "$pkg" && -f "$pkg/package.json" ]]; then
          if python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if 'vscode' in d.get('engines', {}) else 1)
" "$pkg/package.json" 2>/dev/null; then
            found+=("$pkg")
          fi
        fi
      done < <(find "$dir/$pkg_dir" -maxdepth 1 -mindepth 1 -type d 2>/dev/null)
    fi
  done

  printf '%s\n' "${found[@]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--pkg)
      PKG_DIRS+=("$2")
      shift 2
      ;;
    --no-build)
      DO_BUILD=0
      shift
      ;;
    --reuse-window)
      NEW_WINDOW=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -z "$PROJECT_DIR" ]]; then
        PROJECT_DIR="$1"
      else
        echo "Unknown argument: $1" >&2
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

# Default to default project if no path given
PROJECT_DIR="${PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"

# Resolve to absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

if ! command -v code >/dev/null 2>&1; then
  echo "Error: 'code' CLI not found. Install VS Code shell command first." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: 'pnpm' not found in PATH." >&2
  exit 1
fi

# Build from accordo root, open target project as workspace
ACCORDO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ACCORDO_PKG_DIR="$ACCORDO_DIR/packages"

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "[dev-open] Building all accordo VS Code extensions..."
  (cd "$ACCORDO_DIR" && pnpm -r --filter="./packages/*" run build)
else
  echo "[dev-open] Skipping build (--no-build)"
fi

# Each project gets its own VS Code user-data-dir so the second `code` invocation
# is NOT swallowed by an already-running instance (which would drop all
# --extensionDevelopmentPath flags).  We derive a stable dir name from the
# project folder basename so it's deterministic across relaunches.
PROJECT_SLUG="$(basename "$PROJECT_DIR")"
PROJECT_DATA_DIR="${XDG_RUNTIME_DIR:-$HOME/.local/share}/accordo-vscode-$PROJECT_SLUG"
mkdir -p "$PROJECT_DATA_DIR"

CODE_ARGS=(--user-data-dir "$PROJECT_DATA_DIR")
if [[ "$NEW_WINDOW" -eq 1 ]]; then
  CODE_ARGS+=(--new-window)
fi

# Use explicitly specified packages, or auto-discover
if [[ ${#PKG_DIRS[@]} -eq 0 ]]; then
  echo "[dev-open] Auto-discovering VS Code extensions from: $ACCORDO_PKG_DIR"
  mapfile -t PKG_DIRS < <(discover_packages "$ACCORDO_DIR")
fi

if [[ ${#PKG_DIRS[@]} -eq 0 ]]; then
  echo "Error: No packages found in $ACCORDO_PKG_DIR." >&2
  exit 1
fi

# Workspace must come FIRST, then extension development paths
CODE_ARGS+=("$PROJECT_DIR")

for pkg in "${PKG_DIRS[@]}"; do
  CODE_ARGS+=("--extensionDevelopmentPath=$pkg")
done

echo "[dev-open] Launching VS Code with extension dev stack..."
echo "[dev-open] Project: $PROJECT_DIR"
echo "[dev-open] Packages: ${PKG_DIRS[*]}"
code "${CODE_ARGS[@]}"

cat <<'EOF'

[dev-open] Started.

Next checks:
  1) In VS Code: run "Accordo: Show Connection Status"
  2) In terminal: scripts/dev-health.sh

Tip: use --no-build for faster iteration when dist artifacts are already fresh.
EOF
