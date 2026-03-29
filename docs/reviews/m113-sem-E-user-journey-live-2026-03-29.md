# M113-SEM Phase E — Live User Journey Validation (2026-03-29)

## Scope

Requested: run real user-journey checks for `browser_get_semantic_graph` via live MCP (terminal-based calls to Hub at `localhost:$PORT`).

## Live environment status

- Hub reachable and healthy (`/health` returned `bridge:"connected"`, `toolCount:57`).
- Browser-connected page was available (successful `browser_get_page_map` against a live OpenCode workspace page).

## Blocking finding

The semantic graph and text map tools are **not present in the live Hub tool registry** yet.

Evidence:

1. `tools/list` (filtered to `browser_*`) returned only:
   - `browser_get_page_map`
   - `browser_inspect_element`
   - `browser_get_dom_excerpt`
   - `browser_capture_region`

2. Direct live calls failed with unknown-tool:
   - `tools/call` `browser_get_text_map` → `-32601 Unknown tool`
   - `tools/call` `browser_get_semantic_graph` → `-32601 Unknown tool`

## Journey-test outcome

Status: **BLOCKED (runtime registration gap)**

Because `browser_get_semantic_graph` is not registered in the currently running Hub/Bridge session, none of the M113 end-user journeys can be executed live in this session yet.

## What was still validated live

Even with the blocker, existing browser tools were validated successfully:

- `browser_get_page_map` returned URL/title/viewport/nodes/snapshotId.
- `browser_inspect_element` (valid ref) returned semantic context, bounds, and anchor metadata.
- `browser_get_dom_excerpt` returned structured excerpt with truncation metadata.
- `browser_capture_region` returned image `dataUrl` payload.

## Required action before rerun

Reload/restart the runtime that registers browser tools (Bridge/extension host/Hub registration cycle), then re-run this Phase E journey pack once `browser_get_semantic_graph` appears in `tools/list`.
