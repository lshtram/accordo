#!/usr/bin/env python3
"""
accordo-run.py — Universal Accordo walkthrough runner
======================================================
Reads a JSON steps file and executes each step against the live Accordo Hub.

Usage:
    python3 accordo-run.py <steps.json>
    python3 accordo-run.py <steps.json> --dry-run   # print steps, no execution
    python3 accordo-run.py <steps.json> --from 4    # start from step index 4 (0-based)

Stop at any time with Ctrl+C.

Steps file format: see skills/script-authoring/skill.md §Steps Reference
"""

import json
import os
import sys
import time
import argparse

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)


# ── Hub connection ────────────────────────────────────────────────────────────


def get_hub(project_fragment: str) -> tuple[str, str]:
    """Return (base_url, token) for the hub serving a project."""
    hubs_path = os.path.expanduser("~/.accordo/hubs.json")
    with open(hubs_path) as f:
        hubs = json.load(f)
    for key, entry in hubs.items():
        if project_fragment in key:
            port = entry["port"]
            pid = entry["pid"]
            with open(f"/proc/{pid}/environ", "rb") as ef:
                env = dict(
                    item.split(b"=", 1)
                    for item in ef.read().split(b"\0")
                    if b"=" in item
                )
            token = env.get(b"ACCORDO_TOKEN", b"").decode()
            if not token:
                raise RuntimeError(
                    f"ACCORDO_TOKEN not found in environment of PID {pid}"
                )
            return f"http://localhost:{port}", token
    raise RuntimeError(
        f"No hub found for project fragment '{project_fragment}'.\n"
        f"Available keys: {list(hubs.keys())}"
    )


def call_tool(base_url: str, token: str, tool: str, args: dict) -> dict:
    """Invoke a single Accordo MCP tool and return the full JSON-RPC response."""
    resp = requests.post(
        f"{base_url}/mcp",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": args},
        },
        timeout=90,
    )
    resp.raise_for_status()
    return resp.json()


# ── Step executor ─────────────────────────────────────────────────────────────


def execute_step(step: dict, base_url: str, token: str, index: int) -> None:
    """Execute one step from the steps array."""
    kind = step.get("type")
    label = step.get("_label", "")
    prefix = f"  [{index}] {kind}" + (f" — {label}" if label else "")

    if kind == "speak":
        text = step["text"]
        voice = step.get("voice", "af_heart")
        block = step.get("block", True)
        print(f"{prefix}: {text[:70]}{'…' if len(text) > 70 else ''}")
        call_tool(
            base_url,
            token,
            "accordo_voice_readAloud",
            {"text": text, "voice": voice, "block": block},
        )

    elif kind == "open":
        path = step["path"]
        line = step.get("line", 1)
        print(f"{prefix}: {path}:{line}")
        call_tool(base_url, token, "accordo_editor_open", {"path": path, "line": line})
        time.sleep(step.get("after_ms", 600) / 1000)

    elif kind == "close":
        path = step.get("path")
        print(f"{prefix}: {path or '(active)'}")
        call_tool(
            base_url, token, "accordo_editor_close", {"path": path} if path else {}
        )

    elif kind == "highlight":
        path = step["path"]
        start = step["start"]
        end = step["end"]
        color = step.get("color", "rgba(255,255,0,0.3)")
        print(f"{prefix}: {path} lines {start}–{end}")
        call_tool(
            base_url,
            token,
            "accordo_editor_highlight",
            {"path": path, "startLine": start, "endLine": end, "color": color},
        )

    elif kind == "clear_highlights":
        print(f"{prefix}")
        call_tool(base_url, token, "accordo_editor_clearHighlights", {})

    elif kind == "slide_open":
        deck_uri = step["deckUri"]
        print(f"{prefix}: {deck_uri}")
        call_tool(base_url, token, "accordo_presentation_open", {"deckUri": deck_uri})
        time.sleep(step.get("after_ms", 400) / 1000)

    elif kind == "slide_goto":
        index_slide = step["index"]
        print(f"{prefix}: slide {index_slide}")
        call_tool(base_url, token, "accordo_presentation_goto", {"index": index_slide})
        time.sleep(step.get("after_ms", 500) / 1000)

    elif kind == "slide_next":
        print(f"{prefix}")
        call_tool(base_url, token, "accordo_presentation_next", {})
        time.sleep(step.get("after_ms", 600) / 1000)

    elif kind == "slide_prev":
        print(f"{prefix}")
        call_tool(base_url, token, "accordo_presentation_prev", {})
        time.sleep(step.get("after_ms", 600) / 1000)

    elif kind == "layout":
        area = step["area"]  # "sidebar" | "panel" | "rightBar"
        action = step["action"]  # "open" | "close"
        view = step.get("view")
        print(f"{prefix}: {area} → {action}")
        args = {"area": area, "action": action}
        if view:
            args["view"] = view
        call_tool(base_url, token, "accordo_layout_panel", args)
        time.sleep(step.get("after_ms", 300) / 1000)

    elif kind == "delay":
        ms = step["ms"]
        print(f"{prefix}: {ms}ms")
        time.sleep(ms / 1000)

    elif kind == "call":
        # Raw escape hatch: any Accordo tool, any args
        tool = step["tool"]
        args = step.get("args", {})
        print(f"{prefix}: {tool}({json.dumps(args)[:60]})")
        call_tool(base_url, token, tool, args)
        after = step.get("after_ms")
        if after:
            time.sleep(after / 1000)

    else:
        print(f"  [{index}] WARNING: unknown step type '{kind}' — skipping")


def dry_run_step(step: dict, index: int) -> None:
    """Print a step without executing it."""
    kind = step.get("type", "?")
    label = step.get("_label", "")
    print(f"  [{index}] {kind}" + (f" — {label}" if label else ""))
    for k, v in step.items():
        if k not in ("type", "_label"):
            print(f"       {k}: {v}")


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Accordo walkthrough runner")
    parser.add_argument("steps_file", help="Path to the JSON steps file")
    parser.add_argument(
        "--dry-run", action="store_true", help="Print steps without executing"
    )
    parser.add_argument(
        "--from",
        dest="from_step",
        type=int,
        default=0,
        metavar="N",
        help="Start from step index N (0-based)",
    )
    args = parser.parse_args()

    # Load steps file
    with open(args.steps_file) as f:
        doc = json.load(f)

    # Support top-level object { "project": "...", "label": "...", "steps": [...] }
    # or bare array [...]
    if isinstance(doc, list):
        steps = doc
        project_fragment = "accordo"
        label = args.steps_file
    else:
        steps = doc.get("steps", [])
        project_fragment = doc.get("project", "accordo")
        label = doc.get("label", args.steps_file)

    print(f"\n{'DRY RUN — ' if args.dry_run else ''}Script: {label}")
    print(f"Steps: {len(steps)}  |  Starting from: {args.from_step}")
    if not args.dry_run:
        print("Press Ctrl+C at any time to stop.\n")

    if args.dry_run:
        for i, step in enumerate(steps):
            if i >= args.from_step:
                dry_run_step(step, i)
        return

    # Connect to hub
    try:
        base_url, token = get_hub(project_fragment)
        print(f"Hub: {base_url}  (project fragment: '{project_fragment}')\n")
    except Exception as e:
        print(f"ERROR connecting to hub: {e}")
        sys.exit(1)

    # Execute
    current_step = args.from_step
    try:
        for i, step in enumerate(steps):
            if i < args.from_step:
                continue
            current_step = i
            execute_step(step, base_url, token, i)
        print("\nDone.")
    except KeyboardInterrupt:
        print("\n\nStopped by user (Ctrl+C).")
    except requests.RequestException as e:
        print(f"\nHTTP error on step {current_step}: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nError on step {current_step}: {e}")
        raise


if __name__ == "__main__":
    main()
