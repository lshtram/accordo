# Browser MCP Comprehensive Evaluation — 2026-04-06 (v2)

## Summary

- **Verdict:** **FAIL**
- **Total score:** **27 / 45**
- **Date:** 2026-04-06
- **Threshold check:** Required ≥30/45 (not met)

Despite strong coverage in text extraction, interaction, and baseline page mapping, there are significant gaps in cross-page snapshot diffs, iframe/frame lineage reliability, artifact transport efficiency (inline base64 blobs), and robustness semantics.

---

## Starting conditions

- Initial health check call:
  - `accordo_browser_health({})`
  - Evidence: `connected: true`, `debuggerUrl: ws://localhost:9222`, `recentErrors: []`.
- Initial tab inventory:
  - `accordo_browser_list_pages({})`
  - Evidence: 12 tabs listed; active tab was `tabId: 918300491`, URL `https://www.google.com/`, title `Google`.
- Control status field:
  - `list_pages` response **does not expose explicit control/grant status**.
  - Practical evidence of active control: navigation/click/type/screenshot/map calls succeeded on active tab.
- Tool availability:
  - Accordo browser tools were available and used extensively.
  - `chrome-devtools_*` tools were not present in this runtime tool namespace, so evidence uses Accordo tools.

---

## Phase execution notes

1. **Google orientation completed**, but Google immediately resolved to `accounts.google.com/RotateCookiesPage` in map/text/semantic calls.
2. **Wikipedia coverage completed** (map/wait/inspect/dom excerpt/region capture/random-page navigation).
3. **HN coverage completed** (interactive map, text map, semantic graph, spatial relations, region capture, type+Enter, wait_for).
4. **Edge-case and privacy controls completed** (`found:false`, `no-target`, timeout behavior, redactPII, origin allow/deny).
5. **Multi-tab completed** via select/switch to GitHub tab and back.
6. **Iframe traversal test attempted** (W3Schools iframe page): result indicated frame-context confusion (details below).

---

## A) Session & page context

### A1 — Page metadata (URL/title/viewport/context)
- **Status:** ✅
- **Call:** `accordo_browser_get_page_map({tabId:918300491, includeBounds:true, maxDepth:6, maxNodes:500})`
- **Evidence:** Returned `pageUrl`, `title`, `viewport:{width,height,scrollX,scrollY,devicePixelRatio}`, `pageId`, `snapshotId`.

### A2 — Readiness / load state + wait support
- **Status:** 🟡
- **Calls:**
  - `accordo_browser_navigate({... url:'https://en.wikipedia.org/wiki/Main_Page', waitUntil:'load'})`
  - `accordo_browser_wait_for({texts:['Wikipedia','From today\'s featured article'], timeout:15000})`
- **Evidence:** `navigate` returned `readyState:'complete'`; same-page `wait_for` timed out once, then selector-based wait succeeded (`matchedCondition:'#mp-topbanner'`).

### A3 — Multi-tab handling
- **Status:** ✅
- **Calls:**
  - `accordo_browser_list_pages({})`
  - `accordo_browser_select_page({tabId:918300294})`
  - `accordo_browser_list_pages({})`
- **Evidence:** active tab changed from HN to GitHub settings and reflected correctly in subsequent `list_pages` output.

### A4 — iframe relationships
- **Status:** ❌
- **Call:** `accordo_browser_get_page_map({tabId:918300491, traverseFrames:true, includeBounds:true, maxNodes:300})` on W3Schools iframe tutorial.
- **Evidence:** response `pageUrl` became a sync endpoint (`sync.richaudience.com/...`) and `iframes: []` despite page containing iframes; no explicit parent/child frame lineage surfaced.

### A5 — shadow DOM handling
- **Status:** 🟡
- **Call:** `accordo_browser_get_page_map({tabId:918300491, piercesShadow:true, traverseFrames:true, maxNodes:120})`
- **Evidence:** Call succeeded but no explicit shadow-root annotations shown in sampled outputs; capability present but evidence of meaningful shadow traversal is weak.

---

## B) Text extraction quality

### B1 — Visible text extraction
- **Status:** ✅
- **Call:** `accordo_browser_get_text_map({tabId:918300491, maxSegments:120})`
- **Evidence:** Returned visible HN text segments (`Hacker News`, story titles, metadata), with `totalSegments:316`, `truncated:true`.

### B2 — Text-to-node mapping + bboxes
- **Status:** ✅
- **Call:** same as B1
- **Evidence:** each segment includes `nodeId`, `bbox`, and often `role`.

### B3 — Raw + normalized text
- **Status:** ✅
- **Call:** same as B1
- **Evidence:** both `textRaw` and `textNormalized` are returned per segment.

### B4 — Reading order
- **Status:** ✅
- **Call:** same as B1
- **Evidence:** sequential `readingOrderIndex` values included for each segment.

### B5 — Hidden/offscreen/visibility flags
- **Status:** ✅
- **Call:** same as B1
- **Evidence:** segments include `visibility` field (`visible` in sampled results).

---

## C) Structural + semantic understanding

### C1 — DOM snapshot with stable node IDs
- **Status:** ✅
- **Call:** `accordo_browser_get_page_map({...})`
- **Evidence:** returns `snapshotId`, `nodeId`, `persistentId`, parent/children structure.

### C2 — Accessibility tree
- **Status:** ✅
- **Call:** `accordo_browser_get_semantic_graph({tabId:918300491, maxDepth:10, visibleOnly:true})`
- **Evidence:** rich `a11yTree` with roles/names (e.g., links, form, textbox on HN).

### C3 — Cross-frame model lineage
- **Status:** ❌
- **Call:** `accordo_browser_get_page_map({traverseFrames:true,...})`
- **Evidence:** expected frame lineage not present; iframe test returned ad-sync page context unexpectedly.

### C4 — Shadow-root aware semantic model
- **Status:** 🟡
- **Call:** `accordo_browser_get_page_map({piercesShadow:true,...})`
- **Evidence:** no explicit shadow-root node lineage/metadata in outputs examined.

### C5 — Landmark extraction
- **Status:** 🟡
- **Call:** `accordo_browser_get_semantic_graph(...)`
- **Evidence:** HN output had `landmarks:[{role:'form',...}]`; Wikipedia/Google examples had sparse/empty landmarks.

### C6 — Heading outline extraction
- **Status:** 🟡
- **Call:** `accordo_browser_get_semantic_graph(...)`
- **Evidence:** `outline: []` on HN and sparse pages; works only where parser can infer heading hierarchy.

### C7 — Form model extraction
- **Status:** ✅
- **Call:** `accordo_browser_get_semantic_graph(...)`
- **Evidence:** HN returned `forms:[{nodeId, method:'GET', action:'//hn.algolia.com/', fields:[{name:'q',type:'text',value:''}]}]`.

---

## D) Spatial/layout intelligence

### D1 — Bounding boxes in CSS px
- **Status:** ✅
- **Call:** `accordo_browser_get_page_map({includeBounds:true,...})`
- **Evidence:** nodes include `bounds:{x,y,width,height}`.

### D2 — Relative geometry helpers
- **Status:** ✅
- **Call:** `accordo_browser_get_spatial_relations({nodeIds:[0..8]})`
- **Evidence:** returned per-pair relations: `leftOf`, `above`, `contains`, `containedBy`, `overlap`, `distance`; `pairCount:36`.

### D3 — Z-order / occlusion hints
- **Status:** ✅
- **Calls:**
  - `accordo_browser_get_page_map({includeBounds:true,...})`
  - `accordo_browser_inspect_element({selector:'a[href=\'/wiki/Main_Page\']'})`
- **Evidence:** fields `zIndex`, `isStacked`, `occluded`, `isObstructed` returned.

### D4 — Viewport intersection ratios
- **Status:** ✅
- **Call:** `accordo_browser_get_page_map({includeBounds:true,...})`
- **Evidence:** `viewportRatio` present on nodes.

### D5 — Container/section grouping
- **Status:** ✅
- **Call:** `accordo_browser_get_page_map(...)`
- **Evidence:** `containerId` references in nested structures (Wikipedia/GitHub outputs).

---

## E) Visual capture

### E1 — Viewport screenshot
- **Status:** ✅
- **Call:** `accordo_browser_capture_region({tabId:918300491, mode:'viewport', format:'png'})`
- **Evidence:** `success:true`, `mode:'viewport'`, `artifactMode:'inline'`, `snapshotId` + `relatedSnapshotId`.

### E2 — Full-page screenshot
- **Status:** ✅
- **Call:** `accordo_browser_capture_region({tabId:918300491, mode:'fullPage', format:'jpeg', quality:80})`
- **Evidence:** `success:true`, `mode:'fullPage'`, `artifactMode:'inline'`, includes linkable snapshot metadata.

### E3 — Element/region capture
- **Status:** ✅
- **Calls:**
  - `accordo_browser_capture_region({anchorKey:'id:firstHeading', padding:10, format:'png'})`
  - `accordo_browser_capture_region({rect:{x:0,y:0,width:800,height:400}, format:'png'})`
- **Evidence:** both calls succeeded; anchor capture returned tiny 40x40 crop for hidden heading target.

### E4 — Configurable format/quality
- **Status:** ✅
- **Call:** fullPage call above
- **Evidence:** accepts `format:'png'|'jpeg'` and `quality` for JPEG.

### E5 — Visual-to-structure linkage
- **Status:** ✅
- **Call:** screenshot responses
- **Evidence:** responses include `pageId`, `snapshotId`, `relatedSnapshotId`, `capturedAt`.

---

## F) Interaction discoverability

### F1 — Interactive inventory
- **Status:** ✅
- **Call:** `accordo_browser_get_page_map({interactiveOnly:true, maxNodes:60, includeBounds:true})`
- **Evidence:** focused output of links/actions with `filterSummary` (`totalAfterFilter:60`, reduction ratio ~0.697).

### F2 — Actionability state
- **Status:** ✅
- **Call:** `accordo_browser_inspect_element({selector:'a[href=\'/wiki/Main_Page\']'})`
- **Evidence:** `visible`, `hasPointerEvents`, `isObstructed`, `clickTargetSize` returned.

### F3 — Selector + semantic handles
- **Status:** ✅
- **Calls:**
  - `accordo_browser_inspect_element({selector:'nav.vector-main-menu-landmark'})`
- **Evidence:** returns `anchorKey`, `anchorStrategy` (`aria`, `id`, `viewport-pct`) and context chain.

### F4 — Eventability hints
- **Status:** ✅
- **Call:** inspect calls
- **Evidence:** clickability cues (`hasPointerEvents`, target dimensions, obstruction signal).

---

## G) Change tracking / efficiency

### G1 — Snapshot versioning
- **Status:** ✅
- **Calls:**
  - `accordo_browser_manage_snapshots({action:'list'})`
  - multiple map/text/semantic/screenshot calls
- **Evidence:** monotonic snapshot IDs per page (e.g., `...:0` → `...:14`) and source labels (`dom`, `visual`).

### G2 — Delta APIs
- **Status:** 🟡
- **Calls:**
  - `accordo_browser_diff_snapshots({fromSnapshotId:'wiki:0', toSnapshotId:'random:0'})`
  - `accordo_browser_diff_snapshots({tabId:918300491})`
- **Evidence:** cross-page diff failed with `error:'snapshot-stale'`; same-page diff worked (example removedCount:48, another no-op diff).

### G3 — Incremental retrieval / chunking
- **Status:** 🟡
- **Call:** `accordo_browser_get_page_map({maxNodes:...})`, `get_text_map({maxSegments:...})`
- **Evidence:** supports capped fetch (`maxNodes`, `maxSegments`) but no cursor pagination contract visible.

### G4 — Server-side filtering
- **Status:** ✅
- **Calls:**
  - `get_page_map({interactiveOnly:true})`
  - `get_page_map({visibleOnly:true})`
  - `get_page_map({allowedOrigins:[...]})`
  - `get_page_map({deniedOrigins:[...]})`
- **Evidence:** filterSummary provided; origin-deny blocked retrieval.

### G5 — Deterministic ordering
- **Status:** 🟡
- **Call:** repeated map/text calls
- **Evidence:** generally stable ordering observed, but no explicit deterministic-order guarantee field.

### G6 — Artifact indirection vs inline blobs
- **Status:** ❌
- **Call:** screenshot calls
- **Evidence:** returns very large inline `dataUrl` blobs (`artifactMode:'inline'`), not file/reference by default.

---

## H) Robustness

### H1 — Wait primitives
- **Status:** ✅
- **Call:** `accordo_browser_wait_for({texts:[...]} / {selector:...} / {stableLayoutMs:...})`
- **Evidence:** supports text, selector, and stable-layout waits.

### H2 — Timeout controls + semantics
- **Status:** ✅
- **Call:** `wait_for({... timeout:2000})`
- **Evidence:** explicit timeout behavior returned (`timeout`).

### H3 — Retry/backoff hints
- **Status:** ❌
- **Call:** observed across timeout/interruption errors
- **Evidence:** errors do not include retry policy/backoff guidance.

### H4 — Error taxonomy quality
- **Status:** 🟡
- **Calls:**
  - `capture_region({format:'png'})` → `error:'no-target'`
  - `inspect_element({selector:'#element-that-does-not-exist'})` → `found:false`
  - `diff_snapshots(...)` → `snapshot-stale`
  - `wait_for(...)` → `timeout`, `navigation-interrupted`
- **Evidence:** useful but incomplete against desired taxonomy (`element-off-screen`, `image-too-large`, `capture-failed` not observed).

---

## I) Security/privacy

### I1 — Redaction hooks (text + screenshots)
- **Status:** 🟡
- **Calls:**
  - `get_text_map({redactPII:true})`
  - screenshot calls
- **Evidence:** text redaction worked (`redactionApplied:true`, numeric values replaced with `[REDACTED]`); screenshots explicitly state `redactionWarning:'screenshots-not-subject-to-redaction-policy'`.

### I2 — Origin allow/deny
- **Status:** ✅
- **Calls:**
  - `get_page_map({allowedOrigins:['https://news.ycombinator.com']})`
  - `get_page_map({deniedOrigins:['https://news.ycombinator.com']})`
- **Evidence:** allowed call succeeded; denied call failed with `error:'origin-blocked'`.

### I3 — Session/storage isolation controls
- **Status:** ❌
- **Evidence:** no explicit tool contract surfaced for fresh vs persistent browser profile/session isolation.

### I4 — Telemetry disclosure / opt-out
- **Status:** ❌
- **Evidence:** no explicit telemetry disclosure/opt-out fields in tool APIs/results.

### I5 — Audit trail of tool calls/artifacts
- **Status:** ✅
- **Evidence:** responses include `auditId`, timestamps, and snapshot linkage.

### I6 — Data-retention controls for snapshots/images
- **Status:** ✅
- **Call:** `accordo_browser_manage_snapshots({action:'list'})`
- **Evidence:** snapshot inventory and management endpoint available.

---

## Scorecard (9 categories)

| Category | Score (0–5) | Notes |
|---|---:|---|
| Session & Context (A) | 2 | Good metadata/multi-tab; iframe/frame continuity weak; some wait instability |
| Text Extraction (B) | 4 | Strong visible text + mapping + order + visibility |
| Semantic Structure (C) | 3 | Good a11y/forms; weak cross-frame and shadow evidence |
| Layout/Geometry (D) | 4 | Bboxes, occlusion, viewport ratio, spatial relations present |
| Visual Capture (E) | 3 | Supports viewport/full/region well; inline payload strategy hurts efficiency |
| Interaction Model (F) | 4 | Interactive filtering and actionability are strong |
| Deltas/Efficiency (G) | 2 | Snapshot stale across pages; no artifact indirection; limited pagination semantics |
| Robustness (H) | 2 | Useful errors, but retries/backoff and richer taxonomy missing |
| Security/Privacy (I) | 3 | Origin controls + text redaction + audits; screenshot redaction/session controls lacking |

**Total: 27 / 45**

---

## Evidence table (A1–I6)

| Item | Status | Tool | Evidence summary |
|---|---|---|---|
| A1 | ✅ | get_page_map | URL/title/viewport/pageId/snapshotId returned |
| A2 | 🟡 | navigate + wait_for | readyState provided; text wait inconsistent on loaded pages |
| A3 | ✅ | list_pages/select_page | active tab switched and reflected correctly |
| A4 | ❌ | get_page_map(traverseFrames) | iframe lineage absent; context drift to sync endpoint |
| A5 | 🟡 | get_page_map(piercesShadow) | flag accepted; no explicit shadow lineage evidence |
| B1 | ✅ | get_text_map | visible textual content extracted at scale |
| B2 | ✅ | get_text_map | per-segment nodeId + bbox mapping |
| B3 | ✅ | get_text_map | textRaw + textNormalized present |
| B4 | ✅ | get_text_map | readingOrderIndex present |
| B5 | ✅ | get_text_map | visibility flag present |
| C1 | ✅ | get_page_map | stable in-snapshot nodeId + persistentId + snapshotId |
| C2 | ✅ | get_semantic_graph | rich a11y tree with roles and names |
| C3 | ❌ | get_page_map(traverseFrames) | no reliable cross-frame lineage surfaced |
| C4 | 🟡 | get_page_map(piercesShadow) | partial capability, limited demonstrated value |
| C5 | 🟡 | get_semantic_graph | landmarks sparse/inconsistent by page |
| C6 | 🟡 | get_semantic_graph | outline often empty |
| C7 | ✅ | get_semantic_graph | form model with fields/action/method returned |
| D1 | ✅ | get_page_map(includeBounds) | bounding boxes available |
| D2 | ✅ | get_spatial_relations | geometric relations + overlap/distance |
| D3 | ✅ | get_page_map/inspect_element | zIndex/isStacked/occluded/isObstructed |
| D4 | ✅ | get_page_map | viewportRatio per node |
| D5 | ✅ | get_page_map | containerId/grouping information |
| E1 | ✅ | capture_region(mode:'viewport') | success + linked snapshot metadata |
| E2 | ✅ | capture_region(mode:'fullPage') | success + linked snapshot metadata |
| E3 | ✅ | capture_region(anchorKey/rect) | element and rect capture both succeeded |
| E4 | ✅ | capture_region | configurable png/jpeg + quality |
| E5 | ✅ | capture_region | pageId/snapshotId/relatedSnapshotId included |
| F1 | ✅ | get_page_map(interactiveOnly) | focused interactive inventory with filterSummary |
| F2 | ✅ | inspect_element | actionability visibility/pointer/obstruction fields |
| F3 | ✅ | inspect_element | selector + anchorKey + strategy + context chain |
| F4 | ✅ | inspect_element | click target size + obstruction hints |
| G1 | ✅ | manage_snapshots(list) | per-page snapshot sequences listed |
| G2 | 🟡 | diff_snapshots | works same-page; cross-page stale error |
| G3 | 🟡 | get_page_map/get_text_map | maxNodes/maxSegments caps, but no paging cursors |
| G4 | ✅ | get_page_map filters | interactive/visible/origin allow/deny working |
| G5 | 🟡 | repeated map/text calls | appears stable but no explicit determinism contract |
| G6 | ❌ | capture_region | large inline base64 by default |
| H1 | ✅ | wait_for | text/selector/stableLayout supported |
| H2 | ✅ | wait_for(timeout) | clear timeout event returned |
| H3 | ❌ | wait_for/diff errors | no retry/backoff guidance emitted |
| H4 | 🟡 | inspect/capture/wait/diff | useful errors; taxonomy incomplete vs target |
| I1 | 🟡 | get_text_map(redactPII), capture_region | text redacts; screenshots not redacted |
| I2 | ✅ | get_page_map(allowed/deniedOrigins) | allow succeeds; deny origin-blocked |
| I3 | ❌ | N/A | no explicit isolation control contract observed |
| I4 | ❌ | N/A | no telemetry disclosure/opt-out surfaced |
| I5 | ✅ | most read/visual calls | auditId and traceable metadata included |
| I6 | ✅ | manage_snapshots | explicit snapshot retention management endpoint |

---

## Must-have §6 checklist

- [x] Visible text extraction + element mapping (B1/B2 evidence strong)
- [x] Semantic structure via DOM + accessibility surfaces (C1/C2/C7)
- [x] Spatial context includes bboxes for inspected targets (D1 + inspect)
- [x] Screenshot capture supports viewport + full-page + region (E1/E2/E3)
- [x] Stable `nodeId` within snapshot (C1)

**Note:** Must-haves are met, but total score still fails threshold due broader operability/efficiency issues.

---

## Top 5 issues (ranked)

### P0 — Cross-frame/iframe context instability
- **Observed:** iframe test page produced sync endpoint page context and no frame lineage.
- **Risk:** agents can reason about wrong document/frame.
- **Fix:** enforce explicit `topPageUrl`, `frameTree`, `parentFrameId`, and node-to-frame mapping in `get_page_map` and semantic APIs.

### P1 — Delta API reliability across navigations/pages
- **Observed:** `diff_snapshots(from=wiki,to=random)` => `snapshot-stale`.
- **Risk:** weak “what changed” reasoning during real workflows.
- **Fix:** support cross-page diff contract or return structured `incompatible-snapshots` with remediation fields.

### P2 — Artifact transport inefficiency (inline base64 default)
- **Observed:** screenshot payloads returned as huge inlined `dataUrl`.
- **Risk:** token/context bloat and brittle downstream handling.
- **Fix:** default to `artifactMode:'file-ref'` with optional inline mode.

### P3 — Screenshot privacy gap
- **Observed:** screenshot responses explicitly not under redaction policy.
- **Risk:** sensitive data leaks in visual artifacts.
- **Fix:** optional screenshot redaction pipeline + per-call policy flags.

### P4 — Robustness semantics incomplete
- **Observed:** useful but sparse error taxonomy; no retry/backoff hints.
- **Risk:** agents cannot implement deterministic recovery paths.
- **Fix:** publish canonical error schema (`code`, `retryable`, `suggestedRetryMs`, `recoveryHints`).

---

## Final verdict (§8 acceptance question)

> Can the agent understand what the user sees, where it is, what it means, and what changed, without over-fetching data?

**Answer:** **Not consistently yet.**

It can usually understand visible content and interact effectively on straightforward pages, but reliability drops for frame-heavy contexts, cross-navigation change tracking, and efficient artifact handling. This is close to production usefulness for simple pages, but not yet robust enough for consistently reliable agent workflows at scale.
