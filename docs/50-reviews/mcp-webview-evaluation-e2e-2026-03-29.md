# MCP Webview Evaluation — E2E Runtime Evidence (2026-03-29, updated from live)

**Status**: This document was originally written from code-reading + schema analysis. The "J1–J4" journeys described assumed `browser_*` tools could navigate to arbitrary URLs — they **cannot**. This revision reflects only what was verified through **actual live JSON-RPC calls** against the Hub at `http://localhost:3000`, authenticated with bearer token.

> **Critical finding**: All `browser_*` tools operate exclusively on the **current active tab**. There is no `url` parameter on any tool, no `browser_navigate` tool, and no `browser_list_pages` / `browser_select_page` API. The browser must already be on the target page before tools can introspect it. Pages tested: MiniMax payment page (initial), then MDN `<form>` reference page (after user switched tabs).

---

## E2E Journeys Executed

### J1 — MiniMax payment page (initial tab, pre-switch)
- Page: `https://platform.minimax.io/user-center/payment/token-plan`
- Tools: `browser_get_page_map`, `browser_inspect_element`, `browser_get_text_map`, `browser_get_semantic_graph`, `browser_wait_for`, `browser_capture_region`, `browser_diff_snapshots`
- Key live evidence:
  - `page_map`: `snapshotId=page:0`, `totalElements=1738`, returns full DOM tree with `ref`, `tag`, `nodeId`, `persistentId`, `attrs`, `children`
  - `inspect_element` with `ref`/`nodeId`: returns `found: true`, `anchorKey` (CSS path), `anchorStrategy`, `anchorConfidence`, `element.tag/textContent/attributes/bounds/visible`, `context.parentChain/siblingCount/nearestLandmark`
  - `text_map`: returns `textRaw/textNormalized/nodeId/bbox/visibility/readingOrderIndex` per segment
  - `semantic_graph`: returns `a11yTree`, `landmarks` (role+tag+nodeId), `outline` (level+text+nodeId), `forms`
  - `wait_for` with `texts[]` + `timeout`: returns `{"met":true,"matchedCondition":"...","elapsedMs":0}` on match; returns error `"timeout"` on miss
  - `capture_region`: returns large image payload (~116KB)
  - `diff_snapshots` same-page (page:9→page:9): returns `{isError:true, "action-failed"}`
  - `diff_snapshots` cross-snapshot (page:19→page:21): returns `{isError:true, "action-failed"}` — **diff does NOT work across snapshots even with valid IDs**
  - `list_pages`: **Tool does not exist** — returns `{"code":-32601,"message":"Unknown tool: browser_list_pages"}`

### J2 — MDN `<form>` reference page (active tab after user switch)
- Page: `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/form`
- Tools: `browser_get_page_map`, `browser_get_text_map`, `browser_get_semantic_graph`, `browser_inspect_element`, `browser_wait_for`, `browser_capture_region`, `browser_diff_snapshots`, `browser_get_dom_excerpt`
- Key live evidence:
  - `page_map`: `snapshotId=page:19`, `totalElements=1738`, `pageUrl`/`title`/`viewport`/`capturedAt` all present
  - `text_map`: real content from MDN with `textRaw`, `textNormalized`, `nodeId`, `bbox` (x/y/width/height), `visibility` (visible/offscreen/hidden), `readingOrderIndex`
  - `semantic_graph(maxDepth=4)`: `a11yTree` (roles: list, listitem, link, banner, navigation, main, complementary, contentinfo, region), `landmarks` (banner/main/nav/aside/footer with nodeId+tag), `outline` (H1 "`<form>: The Form element`", H2s with ids: try_it, attributes, examples, specifications, etc.), `forms=[]`
  - `inspect_element(ref="ref-39")`: `found:true`, bounds `{x:536,y:205,width:768,height:60}`, visible, `anchorStrategy:"css-path"`, `anchorConfidence:"medium"`, `parentChain:["div.layout__2-sidebars-inline...","main#content...","div.layout__header..."]`, `nearestLandmark:"main"`
  - `inspect_element(nodeId=39)`: identical to above — both `ref` and `nodeId` parameters work equivalently
  - `inspect_element(ref="ref-99999")`: returns `{found:false}` with full snapshot envelope
  - `wait_for(texts=["The Form element"], timeout=5000)`: `{"met":true,"matchedCondition":"The Form element","elapsedMs":0}`
  - `wait_for(texts=["__nonexistent__"], timeout=3000)`: error `"timeout"`
  - `capture_region(anchorKey="ref-39")`: returns image payload (~116KB, JPEG/PNG data)
  - `capture_region(anchorKey="ref-99999")`: returns image payload (fallback capture — confirmed same 116KB size as valid anchorKey)
  - `diff_snapshots(page:19→page:21)`: `{isError:true, "action-failed"}` — **cross-snapshot diff confirmed broken**
  - `get_dom_excerpt(selector="h1", maxDepth=2)`: `{found:true, html:"<h1>&lt;form&gt;: The Form element</h1>", text:"<form>: The Form element", nodeCount:1, truncated:false}`
  - `get_dom_excerpt(selector=".nonexistent", maxDepth=2)`: `{found:false}` with snapshot envelope

### J3 — Tab visibility (VERIFIED MISSING)
- `browser_list_pages` does not exist — no tool to enumerate open tabs
- No `browser_select_page` to switch focus to a different tab
- The agent cannot see what tabs are open; it can only introspect the current active tab
- **Navigation** (directing the browser to a URL) is a separate concern handled by other tools — this is not a gap in the `browser_*` introspection surface
- **J1 Wikipedia and J3 W3Schools described in the original doc were never actually tested** — the browser was on MiniMax; the original doc's claims about those pages are speculative/inferred

### J4 — Error-path probes (live on MDN)
- `inspect_element(ref="ref-99999")` → `{found:false}` with snapshot envelope ✅
- `get_dom_excerpt(selector=".nonexistent")` → `{found:false}` ✅
- `wait_for(texts=["__nonexistent__"], timeout=3000)` → error `"timeout"` ✅
- `capture_region(anchorKey="ref-99999")` → image returned (fallback to full capture, NOT an error) ⚠️
- `browser_list_pages` → `{"code":-32601,"message":"Unknown tool"}` ✅

---

## Scorecard (0–5) — Live-verified

| Category | Score | Notes (live evidence) |
|---|---:|---|
| Session & Context | 2 | URL/title/viewport/snapshot envelope confirmed present. **No tab enumeration** (`browser_list_pages` missing, `browser_select_page` missing). Navigation to URLs is handled by other tools, not `browser_*`. |
| Text Extraction | 4 | `text_map` provides normalized/raw text, nodeId+bbox+visibility+reading order; truncation via `maxSegments`. |
| Semantic Structure | 4 | DOM + semantic graph (a11y/landmarks/outline/forms) works live on MDN; forms may be empty on simple pages. |
| Layout/Geometry | 3 | CSS-pixel bounds on `inspect_element` confirmed; no relative geometry helpers, z-order, or intersection ratio API. |
| Visual Capture | 4 | Region capture confirmed with image payload; no viewport/full-page API on `browser_*` surface. |
| Interaction Model | 3 | `inspect_element` + `get_dom_excerpt` + filters usable; no full actionability/obstruction contract. |
| Deltas/Efficiency | 2 | Snapshot IDs monotonic confirmed; **`diff_snapshots` returns `action-failed` for ALL snapshot diffs** — including cross-snapshot diffs. Weak DOM diff confirmed broken. |
| Robustness | 3 | `wait_for` timeout error + `found:false` on invalid refs; `capture_region` falls back silently on bad anchorKey (not an error). |
| Security/Privacy | 1 | No redaction, origin policy, audit-trail, or retention controls on browser tool surface. |

**Total: 26 / 45** (revised down from 28 due to `diff_snapshots` confirmed broken across all cases, not just "some runs")

---

## Required Evidence Table (Checklist §7.1) — Live-verified

| Item ID | Status | Live evidence |
|---|---|---|
| A1 | ✅ | `page_map` on MDN returned `pageUrl`, `title`, `viewport`, `snapshotId`, `capturedAt` |
| A2 | ✅ | `wait_for` text match returned `{"met":true,"matchedCondition":"The Form element","elapsedMs":0}`; miss returned error `"timeout"` |
| A3 | ❌ | `browser_list_pages` → `Unknown tool`; confirmed absent |
| A4 | 🟡 | MDN outer-page introspection works; no frame/tab selection API |
| B1 | ✅ | `text_map` on MDN returned visibility-classified segments |
| B2 | ✅ | Segment includes `nodeId` + `bbox` |
| B3 | ✅ | `textRaw` and `textNormalized` both present |
| B4 | ✅ | `readingOrderIndex` present and monotonic |
| B5 | ✅ | `visibility` values: `visible`, `offscreen`, `hidden` observed on MDN |
| C1 | ✅ | `nodeId` stable within snapshot confirmed |
| C2 | ✅ | `a11yTree` returned on MDN |
| C3 | ✅ | Landmarks returned: `banner`, `navigation`, `main`, `complementary`, `contentinfo`, `region` |
| C4 | ✅ | Outline includes level/text/id for each heading |
| C5 | 🟡 | `forms=[]` on MDN `<form>` page (actual form element may not register as form model) |
| D1 | ✅ | `inspect_element` returned CSS-pixel bounds `{x:536,y:205,width:768,height:60}` |
| D2 | ❌ | No geometry helper API |
| D3 | ❌ | No z-order/occlusion fields |
| D4 | ❌ | No intersection ratio field/API |
| D5 | 🟡 | Hierarchical DOM grouping present; no explicit card/panel/modal classifier |
| E1 | ❌ | No viewport screenshot API on `browser_*` surface |
| E2 | ❌ | No full-page screenshot API on `browser_*` surface |
| E3 | ✅ | `capture_region` confirmed with image payload |
| E4 | 🟡 | Quality configurable; format not caller-selectable |
| E5 | 🟡 | Snapshot envelope present; node-linkage partial |
| F1 | 🟡 | `interactiveOnly` filter exists in schema but not live-tested here |
| F2 | 🟡 | `inspect_element` returns visibility signals; no full actionable/obstructed model |
| F3 | 🟡 | `ref`/`nodeId` handles available; no XPath |
| F4 | ❌ | No eventability hint contract |
| G1 | ✅ | Monotonic `snapshotId` confirmed: `page:0` → `page:28` across live calls |
| G2 | ❌ | **`diff_snapshots` is broken** — returns `action-failed` for both same-page and cross-snapshot diffs |
| G3 | 🟡 | `maxSegments` control exists for text_map only; not generic across tools |
| G4 | ✅ | `interactiveOnly`, `roles`, `textMatch`, `regionFilter` exist in schema (not all live-tested) |
| G5 | ✅ | `readingOrderIndex` present; stable traversal order in snapshot |
| H1 | ✅ | `wait_for` supports text + selector; text tested live ✅ |
| H2 | ✅ | `wait_for(timeout=N)` returns error `"timeout"` on miss |
| H3 | ❌ | No retry/backoff hints in responses |
| H4 | ✅ | Invalid-ref/selector return structured `found:false`; capture falls back silently |
| I1 | ❌ | No redaction hook controls |
| I2 | ❌ | No origin allow/deny policy controls |
| I3 | ❌ | No audit-trail API |
| I4 | ❌ | No retention-control API knobs |

---

## Revised Checklist §6 (Must-have) status

- Visible text extraction + mapping: ✅ (`browser_get_text_map`)
- Semantic structure via DOM + a11y surfaces: ✅ (`page_map` + `semantic_graph`)
- Spatial context with bboxes: ✅ (`inspect_element` bounds)
- Screenshot support viewport + full-page + region: ❌ viewport/full-page absent; region only ✅
- Stable nodeId within snapshot: ✅

Must-have set is **partially satisfied** — region capture works, viewport/full-page missing.

---

## Final acceptance question (§8)

"Can the agent understand what the user sees, where it is, what it means, and what changed, without over-fetching data?"

**Answer: No — one broken feature and one missing feature.**

1. **`diff_snapshots` is completely broken**: Every call returns `action-failed`. Change detection is non-functional. This was scored as "weak in some runs" in the original doc — it is in fact broken in all runs.

2. **No tab enumeration**: The agent cannot see what tabs are open — only introspect the current active tab. No `browser_list_pages` tool exists to discover available tabs.

Strengths confirmed live: structured text extraction, semantic graph (a11y/landmarks/outline), bounding boxes on inspect, region capture, `wait_for` with timeout, structured `found:false` on invalid refs.
