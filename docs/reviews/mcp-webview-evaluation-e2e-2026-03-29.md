# MCP Webview Evaluation — **E2E Runtime Evidence** (2026-03-29)

Reference: `docs/mcp-webview-agent-evaluation-checklist.md`  
Method: **live JSON-RPC calls to Hub `/mcp`**, exercising `browser_*` tools against real public pages (not code-reading based).

## E2E Journeys Executed

### J1 — Wikipedia article page (active tab)
- Page used: `https://en.wikipedia.org/wiki/Nick_Jonas`
- Tools exercised: `browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt`, `browser_wait_for`, `browser_get_text_map`, `browser_get_semantic_graph`, `browser_capture_region`, `browser_diff_snapshots`
- Key evidence:
  - `browser_get_page_map` returned `snapshotId=page:1`, `totalElements=8269`
  - `browser_get_text_map` returned segments with `textRaw/textNormalized/nodeId/bbox/visibility/readingOrderIndex`
  - `browser_get_semantic_graph` returned all subtrees (`a11yTree`, `landmarks`, `outline`, `forms`)

### J2 — MDN `<form>` reference page (active tab)
- Page used: `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/form`
- Tools exercised: same as J1 + filter-focused page map calls
- Key evidence:
  - `browser_get_page_map` returned `snapshotId=page:0`, `totalElements=1738`
  - `browser_get_text_map` returned `600/644` segments (`truncated=true`)
  - `browser_wait_for` for selector `form` timed out (evidence of selector exactness/content variance)

### J3 — W3Schools Tryit (iframe-centric page)
- Page used: `https://www.w3schools.com/tags/tryit.asp?filename=tryhtml_iframe`
- Tools exercised: page map, semantic graph, text map, inspect/dom excerpt, region capture
- Key evidence:
  - Page map succeeded on outer page (`totalElements=223`)
  - Semantic graph with `visibleOnly:false` produced `forms=1` on this page context
  - Demonstrates active-tab scoped operation, not cross-tab/frame-selection API

### J4 — Error-path probes
- Invalid refs/selectors + timeout probes executed live
- Key evidence:
  - `inspect` invalid ref returns structured `{found:false}` envelope
  - `dom_excerpt` missing selector returns `{found:false}`
  - `wait_for` missing text returns tool error `timeout`
  - `capture_region` invalid/tiny targets often fallback to successful full capture (taxonomy gap)

---

## Scorecard (0–5)

| Category | Score | Notes (runtime evidence) |
|---|---:|---|
| Session & Context | 3 | URL/title/viewport/snapshot envelope present; no non-active tab selection API in `browser_*`. |
| Text Extraction | 4 | `text_map` provides normalized/raw text, nodeId+bbox+visibility+reading order; truncation controls exist. |
| Semantic Structure | 4 | DOM + semantic graph (a11y/landmarks/outline/forms) works live; forms depend on page content. |
| Layout/Geometry | 3 | Bounding boxes present; no explicit relative geometry helpers / z-order / intersection ratios API. |
| Visual Capture | 4 | Region/rect capture works with quality; returns data URL + snapshot envelope. |
| Interaction Model | 3 | Inspect + interactive filters usable; no full actionability/obstruction contract. |
| Deltas/Efficiency | 3 | Snapshot IDs + diff tool available and working on visual snapshots; weak implicit diff behavior from DOM snapshots in some runs. |
| Robustness | 3 | Wait primitive + timeouts + structured `found:false` patterns; error taxonomy is inconsistent in capture fallbacks. |
| Security/Privacy | 1 | No explicit runtime redaction/origin policy/audit-retention controls exposed on browser tool surface. |

**Total: 28 / 45**

---

## Required Evidence Table (Checklist §7.1)

| Item ID | Status | Tool calls used | Evidence summary |
|---|---|---|---|
| A1 | ✅ | `browser_get_page_map` | Returned `pageUrl`, `title`, `viewport`, `snapshotId`, `capturedAt` on all 3 pages. |
| A2 | 🟡 | `browser_wait_for` | Text waits and selector waits supported; timeout surfaced as error string `timeout`. |
| A3 | ❌ | (none in `browser_*`) | No `list_pages/select_page`; only active-tab routing available. |
| A4 | 🟡 | `browser_get_page_map`, `browser_get_semantic_graph` on Tryit page | Outer-page inspection works; no explicit frame selection/relationship API exposed. |
| B1 | ✅ | `browser_get_text_map` | Returned visible/offscreen/hidden classified segments from real pages. |
| B2 | ✅ | `browser_get_text_map` | Segment includes `nodeId` + `bbox` mapping. |
| B3 | ✅ | `browser_get_text_map` | Both `textRaw` and `textNormalized` present. |
| B4 | ✅ | `browser_get_text_map` | `readingOrderIndex` present and monotonic in returned segments. |
| B5 | ✅ | `browser_get_text_map` | `visibility` includes `visible`, `hidden`, `offscreen`. |
| C1 | ✅ | `browser_get_page_map` | Stable per-snapshot `nodeId` values present. |
| C2 | ✅ | `browser_get_semantic_graph` | Accessibility tree payload returned (`a11yTree`). |
| C3 | ✅ | `browser_get_semantic_graph` | Landmark roles returned (`banner`, `navigation`, `search`, `main`, etc.). |
| C4 | ✅ | `browser_get_semantic_graph` | Outline entries include heading levels/text/id. |
| C5 | ✅ | `browser_get_semantic_graph` | Form model and fields observed on Tryit page (`forms=1`). |
| D1 | ✅ | `browser_get_page_map`, `browser_inspect_element` | CSS-pixel bounds provided in live outputs. |
| D2 | ❌ | (none) | No explicit helper API (`leftOf`, `contains`, overlap, distance). |
| D3 | ❌ | (none) | No explicit z-order/occlusion hint fields. |
| D4 | ❌ | (none) | No explicit intersection ratio field/API. |
| D5 | 🟡 | `browser_get_page_map` | Hierarchical grouping exists via DOM tree, but no explicit card/panel/modal classifier. |
| E1 | ❌ | (none in `browser_*`) | No dedicated viewport screenshot API on browser surface (only region capture). |
| E2 | ❌ | (none in `browser_*`) | No full-page screenshot API on browser surface. |
| E3 | ✅ | `browser_capture_region` | Region/rect captures succeeded with image payload. |
| E4 | 🟡 | `browser_capture_region` | JPEG quality configurable; format is not exposed as caller choice. |
| E5 | 🟡 | `browser_capture_region` | Snapshot envelope present; linkage to specific node semantics is partial. |
| F1 | 🟡 | `browser_get_page_map` (`interactiveOnly`) | Interactive inventory exists but is heuristic/filter-based. |
| F2 | 🟡 | `browser_inspect_element` | Some visibility/attachment signals; no full actionable/obstructed state model. |
| F3 | 🟡 | `browser_inspect_element`, `browser_get_page_map` | Selector/ref/nodeId handles available; no XPath surface exposed. |
| F4 | ❌ | (none) | No explicit eventability hint contract (target size/interception risk). |
| G1 | ✅ | all data-producing calls | Monotonic `snapshotId` observed (`page:0`, `page:1`, …). |
| G2 | 🟡 | `browser_diff_snapshots` | Works for explicit visual snapshot IDs; some implicit/DOM diff flows returned `action-failed`. |
| G3 | 🟡 | `browser_get_text_map(maxSegments)` | Incremental/chunk-like control exists for text map; not generic paging across all tools. |
| G4 | ✅ | `browser_get_page_map` filters | `interactiveOnly`, `roles`, `textMatch`, `regionFilter` worked live. |
| G5 | ✅ | `browser_get_text_map`/page map | Deterministic ordering fields present (`readingOrderIndex`; stable traversal in snapshot). |
| H1 | ✅ | `browser_wait_for` | Supports text, selector, stable-layout options in schema; text/selector tested live. |
| H2 | ✅ | `browser_wait_for(timeout)` | Timeout parameter works and returns timeout error. |
| H3 | ❌ | (none) | No explicit retry/backoff hints in responses. |
| H4 | 🟡 | invalid-ref/selector/capture probes | Some structured errors (`found:false`, `timeout`), but minimum capture error taxonomy not consistently enforced. |
| I1 | ❌ | (none) | No explicit redaction hook controls in runtime API. |
| I2 | ❌ | (none) | No origin allow/deny policy controls exposed by browser tools. |
| I3 | ❌ | (none) | No explicit audit-trail API for tool calls/artifacts. |
| I4 | ❌ | (none) | No explicit retention-control API knobs on browser surface. |

---

## Checklist §6 (Must-have) status

- Visible text extraction + mapping: ✅ (`browser_get_text_map`)
- Semantic structure via DOM + a11y surfaces: ✅ (`page_map` + `semantic_graph`)
- Spatial context with bboxes: ✅ (`page_map` + `inspect_element`)
- Screenshot support viewport + full-page + region: ❌ on `browser_*` only (region only)
- Stable nodeId within snapshot: ✅

Must-have set is **not fully satisfied** due to missing viewport/full-page screenshot APIs on the `browser_*` surface.

---

## Final acceptance question (§8)

“Can the agent understand what the user sees, where it is, what it means, and what changed, without over-fetching data?”

**Answer (current runtime): Mostly, but not consistently enough for full pass.**

Strengths: structured text + semantic graph + region capture + filtering + diff capability.  
Gaps: tab/frame targeting, full visual capture modes, explicit layout helpers, and privacy/audit controls.
