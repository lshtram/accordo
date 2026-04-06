# M110-TC — MCP WebView Agent Evaluation Checklist — Round 2

> **Evaluation date**: 2026-04-04  
> **Reviewer**: Reviewer agent  
> **Scope**: Full MCP WebView Agent Evaluation Checklist (`docs/30-development/mcp-webview-agent-evaluation-checklist.md`), all sections 0–7  
> **Gateway**: `http://localhost:3007/mcp` with Bearer token  
> **Target tab**: tabId `918298510` (`https://aistudio.google.com/spend` — Spend | Google AI Studio)  
> **Prior review reference**: `docs/reviews/M110-TC-browser-tools-evaluation.md` (port 3006, HN tab)

All evidence is from live MCP tool calls made during this session. Call IDs are referenced in brackets `[id:N]`.

---

## §0 — Current-State Mapping

### Tool Registry (tools/list `[id:2]`)

Total registered tools: **68** (up from prior review).

| Capability | Tool(s) today | Status |
|---|---|---|
| Structured page map | `accordo_browser_get_page_map` | ✅ |
| Deep element inspection | `accordo_browser_inspect_element` | ✅ |
| DOM excerpt retrieval | `accordo_browser_get_dom_excerpt` | ✅ |
| Region screenshot | `accordo_browser_capture_region` | ✅ |
| Text map extraction | `accordo_browser_get_text_map` | ✅ **NEW** |
| Semantic graph | `accordo_browser_get_semantic_graph` | ✅ **NEW** |
| Snapshot diff / deltas | `accordo_browser_diff_snapshots` | ✅ **NEW** |
| Page listing | `accordo_browser_list_pages` | ✅ |
| Tab selection | `accordo_browser_select_page` | ✅ |
| Wait primitives | `accordo_browser_wait_for` | ✅ |
| Navigation | `accordo_browser_navigate` | ✅ |
| Interaction tools | `accordo_browser_click`, `accordo_browser_type`, `accordo_browser_press_key` | ✅ |
| Viewport/full-page screenshot | `chrome-devtools_take_screenshot` | ❌ Not registered |
| A11y snapshot (standalone) | `chrome-devtools_take_snapshot` | ❌ Not registered |

**Key delta since Round 1**: Three new tools added — `get_text_map`, `get_semantic_graph`, `diff_snapshots`. The `chrome-devtools_*` tools from the checklist template are no longer present (fully superseded by `accordo_browser_*`).

---

## §1 — What an Agent Needs

| Need | Met? | Evidence |
|---|---|---|
| 1. **What page is this?** (URL, title, frame, load state) | 🟡 | `get_page_map` `[id:12]` → `pageUrl:"https://aistudio.google.com/spend"`, `title:"Spend \| Google AI Studio"`, `frameId:"main"`. No `loadState` field. |
| 2. **What text is visible?** | ✅ | `get_text_map` `[id:43]` → 77 segments, `visibility:"visible"/"hidden"/"offscreen"` per segment, `textRaw + textNormalized` per node |
| 3. **What is the semantic structure?** | ✅ | `get_semantic_graph` `[id:13]` → `a11yTree`, `landmarks:[nav,main]`, `outline:[H2 "Gemini API Spend", H3 "Your total cost..."]`, `forms:[]` |
| 4. **Where are elements located?** | ✅ | `get_page_map` with `includeBounds:true` `[id:14]` → every node has `bounds:{x,y,width,height}` in CSS pixels |
| 5. **What can be interacted with?** | 🟡 | `interactiveOnly:true` `[id:55]` returns 1 button with default depth. Requires explicit `maxDepth:8` to surface 8 interactive elements `[id:60]`. Filter runs on already-truncated tree. |
| 6. **What changed since last step?** | ✅ | `diff_snapshots` `[id:71]` → `{added:[],removed:[],changed:[],summary:{addedCount:0,...}}` — works between consecutive snapshots |
| 7. **What does it look like?** | 🟡 | `capture_region` with `rect` `[id:20]` → JPEG image, configurable quality, snapshotId linkage. No native full-page or viewport-only screenshot. Output size capped (~1200px wide). |
| 8. **Can I inspect deeply only when needed?** | ✅ | `maxNodes:3` for summary, `maxDepth:8 maxNodes:500` for deep; `get_dom_excerpt` for targeted subtree |

---

## §2 — Required Service Surface (A–I)

---

### A. Session & Page Context

#### A1 — Get page metadata (URL/title + viewport)
- **Status**: ✅
- **Tools**: `accordo_browser_list_pages`, `accordo_browser_get_page_map`
- **Evidence** `[id:10,12,76]`:
  - `list_pages` → `{tabId:918298510, url:"https://aistudio.google.com/spend", title:"Spend | Google AI Studio", active:false}` — URL, title, tabId, active state ✅
  - `get_page_map` → every response includes `pageId:"page"`, `frameId:"main"`, `snapshotId:"page:71"`, `capturedAt:"2026-04-04T15:25:23.998Z"`, `viewport:{width:1851,height:927,scrollX:0,scrollY:0,devicePixelRatio:1}`, `source:"dom"`, `pageUrl`, `title` ✅
  - Full §3.1 canonical object model present on every call.

#### A2 — Get load/readiness state
- **Status**: 🟡
- **Tools**: `accordo_browser_wait_for`, `accordo_browser_get_page_map`
- **Evidence** `[id:23,76]`:
  - `get_page_map` top-level keys: `['auditId','capturedAt','frameId','nodes','pageId','pageUrl','snapshotId','source','title','totalElements','truncated','viewport']` — **no `loadState`, `readyState`, or `documentState` field**.
  - `wait_for` with `stableLayoutMs:500` → `{met:true,matchedCondition:"stable-layout",elapsedMs:1300}` — effective post-navigation readiness proxy ✅
  - `navigate` returns `control-not-granted` on user tabs (safety feature), so navigate+readiness cannot be tested end-to-end.
  - **Gap**: No explicit `loading | interactive | complete` enum. `wait_for` is the workaround.

#### A3 — Handle multiple tabs/pages with stable IDs
- **Status**: ✅
- **Tools**: `accordo_browser_list_pages`, `accordo_browser_select_page`
- **Evidence** `[id:10]`:
  - `list_pages` → 15+ tabs returned with stable numeric `tabId` values (e.g. `918298510`, `918297944`, etc.)
  - `tabId` stable across all tool calls in this session ✅
  - `select_page` exists in schema ✅ (not called to avoid disrupting user's browser)

#### A4 — Handle iframes
- **Status**: 🟡
- **Tools**: `accordo_browser_get_dom_excerpt`, `accordo_browser_get_page_map`
- **Evidence** `[id:35,37]`:
  - `get_dom_excerpt(selector:"iframe")` → `{found:true, html:"", text:"", nodeCount:0}` — iframe element detected but content is empty (cross-origin iframe, content not accessible) ✅ (correct behavior)
  - `frameId` field always reports `"main"` — no frame enumeration or sub-frame targeting demonstrated
  - **Gap**: No mechanism to enumerate frames or target a specific iframe by ID. Single-frame operation only.

---

### B. Text Extraction Quality

#### B1 — Visible text extraction
- **Status**: ✅
- **Tools**: `accordo_browser_get_text_map`
- **Evidence** `[id:43,44]`:
  - Full 77 segments extracted. 68 visible, 6 hidden, 3 offscreen.
  - Segment example: `{textRaw:"Terms of Service", textNormalized:"Terms of Service", visibility:"visible", bbox:{x:896.890625,y:22,width:105.71875,height:16}, nodeId:2, role:"link"}` ✅

#### B2 — Per-text-node source mapping (nodeId + bbox)
- **Status**: ✅
- **Tools**: `accordo_browser_get_text_map`
- **Evidence** `[id:43,44]`:
  - Every segment has `nodeId` (integer), `bbox:{x,y,width,height}` in CSS pixels ✅
  - `accessibleName` present on some nodes (2 found with distinct accessible name: `"Set or edit spend cap"`, `"What's new"`) ✅
  - `role` field present when applicable ✅

#### B3 — Whitespace-normalized + raw modes
- **Status**: ✅
- **Tools**: `accordo_browser_get_text_map`
- **Evidence** `[id:43]`:
  - `textRaw:"We have updated our "` (trailing space preserved) vs `textNormalized:"We have updated our"` (trimmed) ✅
  - `textRaw` for hidden grid instruction: `" Navigate this grid using arrow keys. Page Up..."` (leading space) vs `textNormalized` (no leading space) ✅

#### B4 — Reading order output
- **Status**: ✅
- **Tools**: `accordo_browser_get_text_map`
- **Evidence** `[id:43]`:
  - Every segment has `readingOrderIndex` (integer, 0-based) ✅
  - Segments with `readingOrderIndex: 6,7,8,12,13...` — top-to-bottom logical ordering with off-screen items at 0-5 ✅

#### B5 — Hidden/offscreen flags
- **Status**: ✅
- **Tools**: `accordo_browser_get_text_map`
- **Evidence** `[id:44]`:
  - Visibility breakdown across 77 total segments: `{hidden:6, offscreen:3, visible:68}` ✅
  - `hidden` = visually hidden (display:none or visibility:hidden)
  - `offscreen` = exists in DOM but positioned outside viewport (e.g. `bbox:{x:-500,y:0}`) ✅

---

### C. Structural and Semantic Understanding

#### C1 — DOM snapshot API with stable node IDs
- **Status**: ✅
- **Tools**: `accordo_browser_get_page_map`, `accordo_browser_get_dom_excerpt`
- **Evidence** `[id:14,29]`:
  - `get_page_map` → nodes have `nodeId` (integer, stable within snapshot) and `persistentId` (base64-encoded, stable across snapshots) ✅
  - `get_dom_excerpt(selector:"h2")` → `{found:true, html:"<h2>Gemini API Spend</h2>"}` ✅
  - `persistentId:"YXBwLXJvb3Q6Og=="` for `app-root` — consistent across calls ✅

#### C2 — Accessibility tree snapshot
- **Status**: 🟡
- **Tools**: `accordo_browser_get_semantic_graph`
- **Evidence** `[id:13,62]`:
  - `get_semantic_graph` returns `a11yTree` with `{role, nodeId, name, children}` per node ✅
  - 55 a11y nodes returned at `maxDepth:6` — tree structure correct ✅
  - **Gap**: `state`, `disabled`, `checked`, `required` fields are **absent** from a11y nodes. All a11y node keys: `['children', 'name', 'nodeId', 'role']` only.
  - No `description` or `value` fields in a11y tree nodes.

#### C3 — Landmark extraction
- **Status**: ✅
- **Tools**: `accordo_browser_get_semantic_graph`
- **Evidence** `[id:13,42]`:
  - `landmarks:[{role:"navigation",nodeId:10,tag:"nav"},{role:"main",nodeId:11,tag:"div"}]` ✅
  - `role`, `nodeId`, `tag` present for each landmark ✅

#### C4 — Document outline (H1..H6)
- **Status**: ✅
- **Tools**: `accordo_browser_get_semantic_graph`
- **Evidence** `[id:13,42]`:
  - `outline:[{level:2,text:"Gemini API Spend",nodeId:18},{level:3,text:"Your total cost (March 8 - April 4, 2026)",nodeId:19,id:"sdui-goog_4111708"}]` ✅
  - `level`, `text`, `nodeId`, optional `id` attribute ✅
  - PII-redacted variant `[id:42]`: `"Your total cost (March 8 - April 4, [REDACTED])"` ✅

#### C5 — Form model extraction
- **Status**: 🟡
- **Tools**: `accordo_browser_get_semantic_graph`
- **Evidence** `[id:13,42]`:
  - `forms:[]` — page has no standard form elements → correct for this page ✅
  - Schema supports form extraction (field exists in response); cannot demonstrate on this page as it has no forms.
  - **Partial**: No evidence of label/control pairing, required/validation, current value extraction since no forms present on test page.

---

### D. Spatial/Layout Intelligence

#### D1 — Bounding boxes in CSS pixels
- **Status**: ✅
- **Tools**: `accordo_browser_get_page_map` (with `includeBounds:true`), `accordo_browser_get_text_map`, `accordo_browser_inspect_element`
- **Evidence** `[id:14,43,30]`:
  - Page map nodes: `bounds:{x:0,y:0,width:1851,height:927}` for root; `bounds:{x:0,y:60,width:220,height:867}` for navbar ✅
  - Text segments: `bbox:{x:896.890625,y:22,width:105.71875,height:16}` (sub-pixel precision) ✅
  - Inspect element: `bounds:{x:336,y:108,width:192,height:32}` for `<h2>` ✅

#### D2 — Relative geometry helpers (leftOf/above/contains/overlap/distance)
- **Status**: ❌
- **Tools**: None
- **Evidence**: No tool returns computed spatial relationships. Raw bboxes are available; the agent must compute relative geometry itself. No `leftOf`, `above`, `contains`, `overlap`, or `distance` helpers exist in any tool.

#### D3 — Z-order / stacking visibility hints
- **Status**: ❌
- **Tools**: None
- **Evidence** `[id:72]`:
  - `inspect_element(selector:"nav")` → element keys: `['tag','classList','textContent','attributes','bounds','visible','visibleConfidence']` — no `zIndex`, `display`, `position`, `computedStyle` fields.
  - `get_page_map` node keys: `['ref','tag','nodeId','persistentId','bounds','attrs','children']` — no stacking info.
  - **visibleConfidence** field in `inspect_element` is a partial signal ("high"/"low") but not z-order.

#### D4 — Viewport intersection ratios
- **Status**: 🟡
- **Tools**: `accordo_browser_get_page_map`, `accordo_browser_get_text_map`
- **Evidence** `[id:33,43]`:
  - `viewportOnly:true` filter available and working ✅
  - `visibility:"offscreen"/"hidden"/"visible"` in text segments ✅
  - `visibleOnly:true` filter in page_map and semantic_graph ✅
  - **Gap**: No numeric intersection ratio (0.0–1.0). Binary visible/not rather than "partially visible with ratio 0.3". `offscreen` in text map provides coarse signal.

#### D5 — Container/section grouping (cards, panels, modals)
- **Status**: 🟡
- **Tools**: `accordo_browser_get_page_map`, `accordo_browser_inspect_element`
- **Evidence** `[id:14,30]`:
  - `get_page_map` returns hierarchical tree with parent/child relationships and `bounds` ✅
  - `inspect_element` returns `context.parentChain:["ms-dashboard-header","div.header-container","div.title-container"]` ✅
  - `context.nearestLandmark:"main"` provides landmark grouping ✅
  - **Gap**: No semantic labeling of card/panel/modal container types — only raw tag+class hierarchy.

---

### E. Visual Capture

#### E1 — Viewport screenshot
- **Status**: 🟡
- **Tools**: `accordo_browser_capture_region`
- **Evidence** `[id:53]`:
  - `capture_region(rect:{x:0,y:0,width:1851,height:927},quality:60)` → `{success:true, width:1200, height:943, sizeBytes:48075}` ✅
  - **Gap**: Output is scaled down (1851→1200px width). No native `viewport` screenshot mode; must specify rect manually. No `fullPage:true` parameter.
  - Source format: JPEG only (quality param confirms it; `dataUrl:"data:image/jpeg;base64,..."`)

#### E2 — Full-page screenshot
- **Status**: ❌
- **Tools**: None
- **Evidence**:
  - No `fullPage` parameter in `capture_region`. Schema only accepts `rect`, `anchorKey`, or `nodeRef`.
  - Cannot capture content below the viewport fold programmatically.

#### E3 — Element/region screenshot by nodeId or box
- **Status**: ✅
- **Tools**: `accordo_browser_capture_region`
- **Evidence** `[id:20,77]`:
  - By `rect`: `{x:220,y:60,width:600,height:400}` → `{success:true,width:616,height:416,sizeBytes:17730,anchorSource:"rect"}` ✅
  - By `nodeRef:"ref-7"` (from page_map): `{success:true,width:1200,height:1096,anchorSource:"ref-7"}` ✅
  - By `anchorKey:"body:0%x0%"` → `{success:true,width:1200,height:959}` ✅

#### E4 — Configurable image quality and format
- **Status**: 🟡
- **Tools**: `accordo_browser_capture_region`
- **Evidence** `[id:20,52,63]`:
  - `quality` parameter: 1–100, confirmed working (`quality:70` → 17730 bytes; `quality:50` → 2319 bytes for same region) ✅
  - **Gap**: Format is always JPEG. No `format:"png"` or `format:"webp"` option. Schema confirms only `quality` field, no `format` field.

#### E5 — Visual-to-structure linkage
- **Status**: 🟡
- **Tools**: `accordo_browser_capture_region`
- **Evidence** `[id:20,77]`:
  - Every capture response includes `snapshotId:"page:N"` which cross-references the DOM snapshot ✅
  - `auditId` correlates capture to audit log ✅
  - **Gap**: No explicit `nodeId` annotation embedded in image data. No bounding-box overlay metadata. The link is via `snapshotId` only — agent must separately fetch the DOM snapshot to correlate.

---

### F. Interaction Discoverability

#### F1 — Interactive element inventory
- **Status**: 🟡
- **Tools**: `accordo_browser_get_page_map`
- **Evidence** `[id:55,60]`:
  - `interactiveOnly:true` with default depth (4): returns 1 node (filter operates on pre-truncated 16-node tree) ⚠️
  - `interactiveOnly:true` with `maxDepth:8`: returns 8 nodes — buttons, links correctly identified ✅
  - **Critical gap**: `interactiveOnly` filter applies AFTER tree truncation. `totalBeforeFilter:43` when `maxDepth:8`, but only `43` of `448` total elements. Agent must specify both `maxDepth:8` AND high `maxNodes` to get a complete interactive inventory. Non-obvious; brittle.

#### F2 — Actionability state (enabled/disabled/readonly/hidden/obstructed)
- **Status**: 🟡
- **Tools**: `accordo_browser_inspect_element`, `accordo_browser_get_semantic_graph`
- **Evidence** `[id:61,62]`:
  - `inspect_element` → `element.visible:true`, `visibleConfidence:"high"` ✅
  - `inspect_element` → no `disabled`, `readonly`, `checked` fields in element response ❌
  - `get_semantic_graph` a11y tree nodes have only `{role,nodeId,name,children}` — **no `state`/`disabled`/`checked`/`required` fields** ❌
  - Partial workaround: check `attrs["disabled"]` or `aria-disabled` in page_map node `attrs` object — but these rely on HTML attribute presence, not computed ARIA state.

#### F3 — Selector + semantic handles
- **Status**: ✅
- **Tools**: `accordo_browser_get_page_map`, `accordo_browser_inspect_element`, `accordo_browser_capture_region`
- **Evidence** `[id:30,46,77]`:
  - CSS selector targeting in `inspect_element`, `get_dom_excerpt`, `capture_region` ✅
  - `nodeRef:"ref-N"` from page_map used in `capture_region` ✅
  - `anchorKey:"body:X%xY%"` semantic handle in inspect/capture responses ✅
  - `persistentId` (base64) as cross-snapshot stable reference ✅
  - `role` and `name` in a11y tree usable for semantic targeting ✅

#### F4 — Eventability hints (click target size, event interception)
- **Status**: ❌
- **Tools**: None
- **Evidence**:
  - No tool returns event handler information, pointer-events:none hints, or click target area analysis.
  - `bounds` in page_map provides raw size (can infer tiny target) but no explicit `clickable:true/false` field.
  - A11y tree lacks `state.focusable` or `interactive:true` markers.

---

### G. Change Tracking / Efficiency

#### G1 — Snapshot versioning with monotonic IDs
- **Status**: ✅
- **Tools**: All data-producing tools
- **Evidence** `[id:12..76]`:
  - Every response includes `snapshotId:"page:N"` where N increases monotonically: `page:19` → `page:71` across session ✅
  - `capturedAt` ISO timestamp present on every snapshot ✅
  - `pageId:"page"` stable across calls ✅

#### G2 — Delta APIs
- **Status**: 🟡
- **Tools**: `accordo_browser_diff_snapshots`
- **Evidence** `[id:17,18,71]`:
  - Consecutive snapshot diff `[id:71]`: `{fromSnapshotId:"page:68",toSnapshotId:"page:69",added:[],removed:[],changed:[],summary:{addedCount:0,...}}` ✅
  - First-call diff `[id:17]`: correctly identifies 11 added nodes when no prior snapshot exists ✅
  - `omit fromSnapshotId` behavior: uses previous snapshot automatically ✅
  - **Gap**: Cross-session snapshot reference returns `snapshot-not-found` `[id:68]` — snapshots from early in the session (page:19) are not available ~5 minutes later. Snapshot retention window is short (call-to-call only, not session-scoped).

#### G3 — Incremental retrieval (paging/chunking)
- **Status**: ✅
- **Tools**: `accordo_browser_get_page_map`, `accordo_browser_get_text_map`
- **Evidence** `[id:12,59]`:
  - `maxNodes:3` → 1 node (summary); `maxNodes:500,maxDepth:8` → 43 nodes (deeper); page has 448 total ✅
  - `maxDepth:2` → 9 nodes; `maxDepth:8` → 43 nodes — progressive depth retrieval ✅
  - `get_text_map` with `maxSegments:10` → 10 segments of 77 ✅

#### G4 — Server-side filtering
- **Status**: ✅
- **Tools**: `accordo_browser_get_page_map`
- **Evidence** `[id:15,31,32,33,34,55]`:
  - `interactiveOnly:true` — filters to interactive elements ✅ (`filterSummary` confirms: `reductionRatio:0.9375`)
  - `roles:["button","link"]` — ARIA role filtering ✅
  - `textMatch:"Spend"` — text content search ✅ (`reductionRatio:0.625`)
  - `viewportOnly:true` — viewport intersection filter ✅
  - `regionFilter:{x,y,width,height}` — bounding box region filter ✅ (`reductionRatio:0.625`)
  - `visibleOnly:true` — visibility filter ✅ (`reductionRatio:0.4375`)
  - `filterSummary` object returned with `activeFilters`, `totalBeforeFilter`, `totalAfterFilter`, `reductionRatio` ✅

#### G5 — Deterministic ordering
- **Status**: ✅
- **Tools**: `accordo_browser_get_page_map`
- **Evidence** `[id:49,50]`:
  - Two identical calls with `visibleOnly:true,maxNodes:50`: Run 1 nodeId order `[0,1,2,3,4,5,6,7,8]`, Run 2 `[0,1,2,3,4,5,6,7,8]` — **identical** ✅
  - Tree is depth-first, stable ✅

---

### H. Robustness and Operability

#### H1 — Wait primitives
- **Status**: ✅
- **Tools**: `accordo_browser_wait_for`
- **Evidence** `[id:21,22,23]`:
  - `waitForText(texts:["Gemini API Spend"])` → `{met:true,matchedCondition:"Gemini API Spend",elapsedMs:0}` ✅
  - `waitForSelector(selector:"h2")` → `{met:true,matchedCondition:"h2",elapsedMs:0}` ✅
  - `waitForStableLayout(stableLayoutMs:500)` → `{met:true,matchedCondition:"stable-layout",elapsedMs:1300}` ✅
  - All three primitive types supported.

#### H2 — Timeout controls
- **Status**: ✅
- **Tools**: `accordo_browser_wait_for`, `accordo_browser_navigate`
- **Evidence** `[id:41]`:
  - `wait_for(texts:["THIS_TEXT_NEVER_EXISTS"],timeout:1000)` → `"timeout"` error response with `isError:true` ✅
  - `navigate` schema has `timeout` param with documented range (default:15000, max:30000) ✅
  - `wait_for` schema: `timeout` (default:10000, max:30000) ✅
  - Timeout honored correctly; error is unambiguous.

#### H3 — Retries/backoff hints
- **Status**: ❌
- **Tools**: None
- **Evidence**:
  - Schema scan `[id:64]` found no `retry`, `backoff`, or retry-related parameters in any browser tool.
  - No `Retry-After` or retry hints in error responses.
  - Agent must implement its own retry logic externally.

#### H4 — Error taxonomy
- **Status**: 🟡
- **Tools**: All browser tools
- **Evidence** `[id:38,39,40,41]`:
  - Element not found: `inspect_element(selector:"#nonexistent")` → `{found:false}` ✅ (graceful, no exception)
  - Invalid tabId: `capture_region(tabId:999999999)` → `"action-failed"` with `isError:true` ✅
  - Timeout: `wait_for` → `"timeout"` with `isError:true` ✅
  - Origin blocked: `deniedOrigins:["https://aistudio.google.com"]` → `"origin-blocked"` ✅
  - Navigation blocked: `navigate` on user tab → `"control-not-granted"` ✅
  - **Gaps vs required error taxonomy**:
    - `element-not-found`: ✅ expressed as `found:false` (not a formal error code)
    - `element-off-screen`: ❌ not a distinct error code (offscreen elements are returned, not errored)
    - `no-target`: 🟡 expressed as `"action-failed"` (not explicitly labeled)
    - `image-too-large`: ❌ no such error observed; large captures succeed (64KB for nodeRef capture)
    - `capture-failed`: 🟡 expressed as `"action-failed"` generically
  - Error strings are short opaque tokens (`"action-failed"`, `"timeout"`, `"origin-blocked"`, `"snapshot-not-found"`, `"control-not-granted"`). No structured error objects with `code`, `message`, `details`.

---

### I. Security/Privacy Controls

#### I1 — Redaction hooks for PII/secrets in text and screenshots
- **Status**: 🟡
- **Tools**: `accordo_browser_get_text_map`, `accordo_browser_get_semantic_graph`
- **Evidence** `[id:24,42,52]`:
  - `get_text_map(redactPII:true)` → `{redactionApplied:true}` — field confirms redaction executed ✅
  - `get_semantic_graph(redactPII:true)` → outline shows `"[REDACTED]"` in date: `"Your total cost (March 8 - April 4, [REDACTED])"` ✅
  - Without `redactPII`: `{redactionWarning:"PII may be present in response"}` — agent is warned ✅
  - `capture_region` → `redactionWarning:"screenshots are not subject to redaction policy."` — **screenshots explicitly excluded from PII redaction** ⚠️
  - **Gap**: Screenshots cannot be redacted. No `get_page_map` `redactPII` param — structure data gets warning but no redaction.

#### I2 — Origin allow/deny policies
- **Status**: ✅
- **Tools**: All browser tools (via `allowedOrigins`, `deniedOrigins` parameters)
- **Evidence** `[id:25,26]`:
  - `allowedOrigins:["https://aistudio.google.com"]` → request succeeds for matching origin ✅
  - `deniedOrigins:["https://aistudio.google.com"]` → `"origin-blocked"` (plain text, `isError` not set) ✅
  - Both params available on `get_page_map`, `get_text_map`, `get_semantic_graph`, `inspect_element`, `get_dom_excerpt`, `capture_region` ✅

#### I3 — Audit trail
- **Status**: ✅
- **Tools**: All browser tools
- **Evidence** `[id:12,13,14,20,42]`:
  - Every data-producing call returns `auditId` (UUID v4): e.g. `"ceaa96d0-9be5-42af-b33a-df252290eaf5"` ✅
  - `capturedAt` ISO 8601 timestamp present on every call ✅
  - `redactionApplied:true/false` field present when `redactPII` is used ✅

#### I4 — Data-retention controls for snapshots/images
- **Status**: ❌
- **Tools**: None
- **Evidence** `[id:52]`:
  - No `ttl`, `expires`, `retain:false`, or cache-control fields in any response.
  - Snapshots have implicit retention (recent ones work `[id:71]`; old ones return `snapshot-not-found` `[id:68]` after ~5 min), but this is undocumented behavior, not an explicit contract.
  - No API for snapshot deletion or retention policy configuration.

---

## §3 — Response Organization

### Canonical Object Model (§3.1)

| Field | Present | Evidence |
|---|---|---|
| `pageId` | ✅ | `"page"` — consistent across all tools |
| `frameId` | ✅ | `"main"` — present on all data-producing tools |
| `snapshotId` | ✅ | `"page:N"` — monotonic, present on all data-producing tools |
| `capturedAt` | ✅ | ISO 8601 timestamp on every response |
| `viewport` | ✅ | `{width:1851,height:927,scrollX:0,scrollY:0,devicePixelRatio:1}` |
| `source` | ✅ | `"dom"` / `"visual"` — indicates data origin |
| `auditId` | ✅ | UUID v4, present on all calls (audit trail) |

**Full §3.1 compliance confirmed.** All seven canonical fields present.

### Node Identity Rules (§3.2)

| Rule | Status | Evidence |
|---|---|---|
| Stable `nodeId` within snapshot | ✅ | Integer nodeIds consistent within a call; G5 test confirmed same order across calls |
| `persistentId` across snapshots | ✅ | Base64 encoded, e.g. `"YXBwLXJvb3Q6Og=="` for `app-root` — consistent across calls |
| Parent/children references | ✅ | Tree structure in `get_page_map`; `parentChain` in `inspect_element.context` |
| Sibling order | ✅ | `siblingIndex`, `siblingCount` in `inspect_element.context` |

### Multi-layer Output (§3.3)

| Layer | Tool | Evidence |
|---|---|---|
| Summary layer | `get_page_map(maxNodes:3)` | Returns 1 root node, page metadata only ✅ |
| Focused layer | `get_dom_excerpt(selector:"h2")` | 25-char HTML subtree ✅ |
| Deep layer | `get_page_map(maxNodes:500,maxDepth:8)` | 43 nodes; `get_semantic_graph` full a11y+landmark+outline ✅ |

### Text Model Shape (§3.4)

All 8 required fields confirmed in `get_text_map` `[id:43]`:

| Field | Status |
|---|---|
| `textRaw` | ✅ |
| `textNormalized` | ✅ |
| `nodeId` | ✅ |
| `role` | ✅ |
| `accessibleName` | ✅ (sparse — only when set) |
| `bbox` | ✅ |
| `visibility` | ✅ |
| `readingOrderIndex` | ✅ |

### Layout Model Shape (§3.5)

| Field | Status | Evidence |
|---|---|---|
| `bbox (x,y,w,h)` | ✅ | `bounds:{x,y,width,height}` in page_map nodes |
| `zIndex/stacking hint` | ❌ | Not present in any response |
| `display`, `position` | ❌ | Not in element or node responses |
| `overflow clipping hint` | ❌ | Not present |
| Containment relations | 🟡 | Only via `parentChain` in `inspect_element` |

---

## §5 — Efficiency

| Criterion | Met? | Evidence |
|---|---|---|
| Summary first, details later | ✅ | `maxNodes:3` → 1 root node; `maxNodes:500,maxDepth:8` → 43 nodes |
| Large pages don't require full DOM | ✅ | `totalElements:448` but only 16–43 returned with defaults |
| "Only visible text in viewport" quickly | ✅ | `get_text_map(maxSegments:10,visibleOnly:true)` confirms fast subset |
| "Only changed elements since last check" | ✅ | `diff_snapshots` returns `{added:[],removed:[],changed:[]}` ✅ |
| Compact reference-linked outputs | ✅ | `snapshotId` links across calls; no duplicate node blobs |
| Filtering reduces payload ≥40% | ✅ | `visibleOnly` → `reductionRatio:0.4375`; `interactiveOnly` → `0.9375` |

**Note on timing** (observed, not formally benchmarked):
- `get_page_map(maxNodes:3)` returned in < 1s consistently ✅
- `capture_region(rect:600x400)` → ~0.5–1s ✅

---

## §6 — Quality Bar (Must-Have Pass/Fail)

### Must-Have Items

| Must-Have | Status | Notes |
|---|---|---|
| Visible text extraction with element mapping ≥95% | ✅ | `get_text_map` returns 77 segments with `nodeId` + `bbox` for all visible content |
| Semantic structure via DOM + accessibility surfaces | ✅ | `get_semantic_graph` provides a11y tree + landmarks + outline |
| Spatial/layout context includes bboxes for inspected targets | ✅ | All tools with `includeBounds:true` return CSS pixel bboxes |
| Screenshot: viewport + full-page + region | 🟡 | Region ✅; viewport via rect ✅ (scaled); full-page ❌ |
| Stable `nodeId` within snapshot | ✅ | Confirmed via G5 determinism test |

**Pass: 4/5 must-haves fully met; 1 partially met (E2 full-page missing)**

### Strongly Recommended

| Item | Status |
|---|---|
| Snapshot versioning and delta/change APIs | ✅ |
| Occlusion and visibility quality | 🟡 (binary, no ratio) |
| Progressive detail retrieval | ✅ |
| Privacy/redaction controls | 🟡 (text only, not screenshots) |

---

## §7 — Reviewer Scorecard

### 7.1 Evidence Table

| Item ID | Status | Tool calls used | Evidence summary |
|---|---|---|---|
| A1 | ✅ | `list_pages [id:10]`, `get_page_map [id:12]` | URL, title, tabId, viewport, frameId, pageId in every response |
| A2 | 🟡 | `wait_for [id:23]`, `get_page_map [id:76]` | No loadState enum; wait_for stable-layout works as proxy |
| A3 | ✅ | `list_pages [id:10]`, `select_page` (schema) | 15+ tabs, stable numeric tabIds, active flag |
| A4 | 🟡 | `get_dom_excerpt [id:37]` | iframe found=true, html empty (CORS correct); no frame enumeration |
| B1 | ✅ | `get_text_map [id:43]` | 77 segments, 68 visible, bboxes, roles |
| B2 | ✅ | `get_text_map [id:44]` | nodeId + bbox on every segment; accessibleName on 2/77 |
| B3 | ✅ | `get_text_map [id:43]` | textRaw (trailing space) vs textNormalized (trimmed) |
| B4 | ✅ | `get_text_map [id:43]` | readingOrderIndex 0–N, logical top-to-bottom |
| B5 | ✅ | `get_text_map [id:44]` | hidden:6, offscreen:3, visible:68 |
| C1 | ✅ | `get_page_map [id:14]`, `get_dom_excerpt [id:29]` | nodeId, persistentId stable; html excerpt correct |
| C2 | 🟡 | `get_semantic_graph [id:62]` | a11y tree with role/name/nodeId; missing state/disabled/checked |
| C3 | ✅ | `get_semantic_graph [id:13]` | landmarks:[navigation,main] with role/tag/nodeId |
| C4 | ✅ | `get_semantic_graph [id:13]` | outline:[H2,H3] with level/text/nodeId |
| C5 | 🟡 | `get_semantic_graph [id:13]` | forms:[] — correct for this page; extraction logic present but untestable |
| D1 | ✅ | `get_page_map [id:14]`, `inspect_element [id:30]` | CSS pixel bboxes on all nodes and elements |
| D2 | ❌ | N/A | No relative geometry helpers exist |
| D3 | ❌ | `inspect_element [id:72]` | No zIndex, display, position, computedStyle fields |
| D4 | 🟡 | `get_page_map [id:33]`, `get_text_map [id:44]` | viewportOnly filter + visibility enum; no intersection ratio |
| D5 | 🟡 | `inspect_element [id:30]`, `get_page_map [id:14]` | parentChain + nearestLandmark; no card/modal type labels |
| E1 | 🟡 | `capture_region [id:53]` | Full-viewport rect capture works but scaled to ~1200px; no viewport mode |
| E2 | ❌ | N/A | No full-page screenshot capability; no scroll-and-stitch |
| E3 | ✅ | `capture_region [id:20,77]` | rect, nodeRef, anchorKey all work; correct dimensions |
| E4 | 🟡 | `capture_region [id:20,52]` | JPEG quality 1–100 ✅; no format selection (JPEG only) |
| E5 | 🟡 | `capture_region [id:20]` | snapshotId links visual to DOM; no per-node bbox annotation in image |
| F1 | 🟡 | `get_page_map [id:55,60]` | Works with maxDepth:8; brittle with defaults (only top-16 nodes filtered) |
| F2 | 🟡 | `inspect_element [id:61]`, `get_semantic_graph [id:62]` | visible + visibleConfidence; missing disabled/readonly/checked/state |
| F3 | ✅ | `inspect_element [id:30]`, `capture_region [id:77]` | CSS selector, nodeRef, anchorKey, persistentId all work |
| F4 | ❌ | N/A | No eventability hints, pointer-events, or click target analysis |
| G1 | ✅ | All data tools | Monotonic page:19→page:71; capturedAt on every call |
| G2 | 🟡 | `diff_snapshots [id:71,68]` | Consecutive diffs work; cross-session refs expire (snapshot-not-found) |
| G3 | ✅ | `get_page_map [id:12,59]`, `get_text_map [id:11]` | maxNodes/maxDepth/maxSegments all chunk correctly |
| G4 | ✅ | `get_page_map [id:15,31,32,33,34]` | 6 filter types; filterSummary reports reductionRatio |
| G5 | ✅ | `get_page_map [id:49,50]` | Identical nodeId order on two sequential calls |
| H1 | ✅ | `wait_for [id:21,22,23]` | texts, selector, stableLayoutMs all work |
| H2 | ✅ | `wait_for [id:41]` | timeout:1000 on impossible text → "timeout" error |
| H3 | ❌ | Schema scan `[id:64]` | No retry/backoff parameters in any browser tool |
| H4 | 🟡 | `[id:38,39,40,41]` | found:false, action-failed, timeout, origin-blocked, control-not-granted; not structured objects |
| I1 | 🟡 | `get_text_map [id:24]`, `get_semantic_graph [id:42]` | redactPII works in text/semantic; screenshots excluded |
| I2 | ✅ | `get_page_map [id:25,26]` | allowedOrigins allows; deniedOrigins blocks with "origin-blocked" |
| I3 | ✅ | All tools `[id:12,42]` | auditId UUID on every call |
| I4 | ❌ | `[id:52,68]` | No retention API; implicit expiry undocumented |

---

### 7.2 Category Scorecard

| Category | Score (0–5) | Notes |
|---|---:|---|
| Session & Context | **4** | URL/title/viewport/tabId excellent; no loadState enum; frameId single-value only |
| Text Extraction | **5** | All 5 sub-items met; raw+normalized+bbox+readingOrder+visibility all present |
| Semantic Structure | **4** | A11y tree + landmarks + outline; missing a11y state/disabled fields; forms field correct but untestable |
| Layout/Geometry | **2** | D1 bboxes excellent; D2/D3 entirely missing; D4/D5 partial |
| Visual Capture | **3** | Element/region capture excellent; full-page missing; JPEG-only; scaling |
| Interaction Model | **3** | Selector handles excellent; actionability state partial; F1 depth issue; no eventability hints |
| Deltas/Efficiency | **4** | diff_snapshots + 6 filters + paging + determinism; snapshot retention window undocumented |
| Robustness | **3** | Wait primitives + timeout controls strong; H3 no retry hints; H4 opaque error tokens |
| Security/Privacy | **3** | redactPII + origin policies + auditId solid; screenshots unredactable; no retention API |

**Total: 31 / 45**

---

## Final Acceptance

> "Can the agent understand **what the user sees**, **where it is**, **what it means**, and **what changed**, without over-fetching data?"

### Verdict: **YES — with known limitations**

**What works well (production-ready):**
- **Text visibility**: `get_text_map` is the strongest new addition. Raw+normalized text, per-node bbox, visibility classification, reading order — all present and correct.
- **Semantic structure**: `get_semantic_graph` delivers a11y tree + landmarks + document outline in one call. Redaction-aware.
- **Snapshot IDs + diffs**: `diff_snapshots` enables efficient change detection between steps. Monotonic IDs allow temporal reasoning.
- **Canonical envelope**: Every response has `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `source`, `auditId` — §3.1 fully implemented.
- **Efficiency**: 6 server-side filters reduce payloads by 40–94%. Progressive depth via `maxNodes`/`maxDepth`.

**Known limitations that agents must work around:**
1. **No full-page screenshot (E2)**: Cannot capture below-the-fold content visually. Workaround: scroll + re-capture.
2. **A11y state fields missing (C2/F2)**: No `disabled`, `checked`, `required`, or `focused` in the a11y tree. Agent cannot determine actionability state from semantic data; must inspect `attrs` directly.
3. **`interactiveOnly` filter requires explicit `maxDepth:8`** to function correctly on deep SPAs. Default `maxDepth:4` returns a truncated tree before filtering, producing misleading results.
4. **No relative geometry (D2/D3)**: Agent must compute `leftOf`, `above`, z-order from raw bboxes — no helper layer.
5. **Snapshot expiry undocumented**: Snapshots referenced in `diff_snapshots` expire silently between calls separated by minutes. Agents relying on cross-call diffs must re-snapshot before diffing.
6. **Error taxonomy is opaque**: Short string tokens (`"action-failed"`, `"snapshot-not-found"`) rather than structured objects. Agents cannot programmatically branch on specific error types without string matching.
7. **JPEG only / scaled output**: No PNG, no full-page, capture output scales down to ~1200px wide — may lose detail on high-DPI or wide layouts.

**Passes minimum threshold**: Total score **31/45** ≥ 30. No category below 2. All must-haves in §6 met or partially met.

---

*Review written by Reviewer agent — docs/reviews/M110-TC-evaluation-round2.md*
