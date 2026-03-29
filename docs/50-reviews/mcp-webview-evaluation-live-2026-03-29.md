# MCP Webview Evaluation Checklist — Live Run (2026-03-29)

Reference checklist: `docs/30-development/mcp-webview-agent-evaluation-checklist.md`

## Method

- Executed live JSON-RPC calls directly against Hub `/mcp` from terminal.
- Used only `browser_*` tools for evidence collection (per session instruction).

## Live browser tool surface observed

`tools/list` (filtered `browser_*`) returned 4 tools:

1. `browser_get_page_map`
2. `browser_inspect_element`
3. `browser_get_dom_excerpt`
4. `browser_capture_region`

Not registered in this live session:

- `browser_get_text_map`
- `browser_get_semantic_graph`
- `browser_wait_for`
- `browser_diff_snapshots`

## Scorecard (0–5)

| Category | Score | Notes |
|---|---:|---|
| Session & Context | 3 | URL/title/viewport from page map are good; no dedicated readiness/wait/tab API in `browser_*` surface. |
| Text Extraction | 1 | `browser_get_dom_excerpt` provides coarse text but no per-segment map, bbox mapping, reading order, or visibility states. |
| Semantic Structure | 2 | Basic DOM structure available; no live semantic graph/a11y/landmarks/forms tool registered. |
| Layout/Geometry | 2 | Bounds available from page map/inspect; no geometry helper relations, z-order, or intersection ratios. |
| Visual Capture | 3 | Region capture works and returns image payload; no viewport/full-page capture via `browser_*` tool family. |
| Interaction Model | 2 | Element-level inspection exists, but no full interactive inventory/actionability model. |
| Deltas/Efficiency | 2 | Snapshot IDs are present (`page:0`, `page:1`, `page:2`) and filters exist in page map; no diff/version contract API. |
| Robustness | 2 | Some graceful not-found responses (`{found:false}`), but no explicit wait primitive/error taxonomy coverage in `browser_*`. |
| Security/Privacy | 1 | No explicit redaction/origin/audit/retention controls exposed on this browser tool surface. |

**Total: 18 / 45**

## Evidence table (selected)

| Item ID | Status | Tool calls used | Evidence summary |
|---|---|---|---|
| A1 page metadata | ✅ | `browser_get_page_map` | Returned `pageUrl`, `title`, `viewport`, `snapshotId`. |
| A2 readiness/wait | ❌ | (none live) | `browser_wait_for` not registered in live tool list. |
| B1 visible text extraction | 🟡 | `browser_get_dom_excerpt` | Text available but not visibility-accurate segment model. |
| B2 text→bbox mapping | ❌ | (none live) | No per-text-node map with node/bbox linkage. |
| C1 DOM snapshot | ✅ | `browser_get_page_map` | Structured node tree with refs and bounds. |
| C2 accessibility tree | ❌ | (none live) | `browser_get_semantic_graph` absent from live registry. |
| C3 landmarks | ❌ | (none live) | Same blocker as C2. |
| C4 outline | ❌ | (none live) | Same blocker as C2. |
| C5 forms | ❌ | (none live) | Same blocker as C2. |
| D1 bbox support | ✅ | `browser_get_page_map`, `browser_inspect_element` | Bounding boxes returned for nodes/elements. |
| E3 region screenshot | ✅ | `browser_capture_region` | Successful result included image `dataUrl`. |
| F2 actionability state | 🟡 | `browser_inspect_element` | Basic visible flag and attributes; no complete actionability contract. |
| G2 delta APIs | ❌ | (none live) | No snapshot diff API in current browser_* set. |
| H4 error taxonomy | ❌ | negative probes | Invalid inspect/dom excerpt returned `{found:false}` but not checklist taxonomy codes. |
| I1 redaction hooks | ❌ | (none live) | No explicit privacy redaction controls surfaced. |

## Acceptance question (§8)

Current answer: **No (not yet consistently)** — the live browser surface still lacks visible-text map + semantic graph + change/delta + wait primitives required for reliable, efficient agent workflows.

## Immediate blocker to resolve before re-scoring

Live runtime registration does not yet expose `browser_get_text_map` and `browser_get_semantic_graph` despite code/test completion in repo. Re-run this checklist after Bridge/extension/Hub registration refresh.
