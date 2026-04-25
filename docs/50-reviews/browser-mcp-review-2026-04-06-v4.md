# Browser MCP Comprehensive Evaluation — 2026-04-06 (v4)

## Summary

- **Verdict:** **PASS**
- **Total score:** **37.0 / 45**
- **Date:** 2026-04-06
- **Threshold check:** Required ≥30/45 (**met**)

This is a full live rerun of checklist items **A1–I6** using tab **918300491** and the requested pages:
- `https://news.ycombinator.com`
- `https://en.wikipedia.org/wiki/JavaScript`
- `https://github.com`

I also ran an iframe-lineage probe on W3Schools TryIt to satisfy the explicit A4/C3 iframe check. Observations are evidence-based only.

---

## Key regression-focus outcomes (requested retests)

### I3 — session isolation disclosure
- **Status:** ✅
- **Call:** `accordo_browser_health({})`
- **Observed:** response now includes `sessionIsolation` with model + description.

### I4 — telemetry disclosure
- **Status:** ✅
- **Call:** `accordo_browser_health({})`
- **Observed:** response now includes `telemetryPolicy` including `enabled` and opt-out/disclosure text.

### H3 — retry/backoff hints
- **Status:** 🟡
- **Calls:**
  - `accordo_browser_diff_snapshots({fromSnapshotId:'snapshot-does-not-exist:999'})`
  - `accordo_browser_capture_region({format:'png'})` (no target)
  - `accordo_browser_get_page_map({allowedOrigins:['https://github.com']})` on HN
- **Observed:**
  - `retryable` is present on errors.
  - `recoveryHints` appears on `snapshot-not-found` (improved vs v3).
  - `retryAfterMs` was **not** observed on tested error paths.
  - `recoveryHints` not consistently present on non-snapshot errors.

### G2 — cross-page diff + recovery hints
- **Status:** ✅
- **Call:** `accordo_browser_diff_snapshots({fromSnapshotId:'pg_4980...:0', toSnapshotId:'pg_a070...:14'})`
- **Observed:** returned `snapshot-not-found` with `details.recoveryHints` present (freshly verified).

---

## Evidence table (A1–I6)

| Item | Status | Tool call(s) | Evidence summary |
|---|---|---|---|
| A1 | ✅ | `get_page_map(includeBounds:true)` on HN/Wikipedia/GitHub | Returned `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `pageUrl`, `title`. |
| A2 | ✅ | `navigate(...waitUntil:'domcontentloaded'/'load')`, `wait_for(text/selector/stableLayout)` | Saw `readyState:'interactive'` and `'complete'`; waits succeeded. |
| A3 | ✅ | `list_pages`, `select_page(918300294)`, `select_page(918300491)` | Stable tab IDs and controlled tab switching. |
| A4 | ❌ | `navigate(w3schools iframe tryit)`, `get_page_map(traverseFrames:true)` | Landed in ad frame (`rtb.gumgum.com`), `iframes:[]`, no usable frame lineage. |
| A5 | 🟡 | `get_page_map(piercesShadow:false/true)` on Wikipedia | Feature exists; no convincing shadow-content delta on tested pages. |
| B1 | ✅ | `get_text_map` on HN/GitHub | Visible user text extracted (headlines, nav, metadata). |
| B2 | ✅ | `get_text_map` | Segments include `nodeId` + `bbox`. |
| B3 | ✅ | `get_text_map` | Both `textRaw` and `textNormalized` present. |
| B4 | ✅ | `get_text_map` | `readingOrderIndex` present per segment. |
| B5 | ✅ | `get_text_map` | `visibility` flags include `visible`/`hidden`/`offscreen`. |
| C1 | ✅ | `get_page_map` | Stable in-snapshot `nodeId` + `snapshotId` contract observed. |
| C2 | ✅ | `get_semantic_graph` (GitHub/Wikipedia) | Rich `a11yTree` with roles/names/states. |
| C3 | ❌ | `get_page_map(traverseFrames:true)` | Cross-frame lineage still not reliable in iframe test. |
| C4 | 🟡 | `get_page_map(piercesShadow:true)`, `get_semantic_graph` | Shadow-aware switch exists; semantic lineage parity not demonstrated in this run. |
| C5 | ✅ | `get_semantic_graph` (GitHub) | `landmarks` returned (banner, nav, main, complementary, forms). |
| C6 | ✅ | `get_semantic_graph` (GitHub/Wikipedia) | `outline` returned with heading structure. |
| C7 | ✅ | `get_semantic_graph` (GitHub) | `forms` model returned with fields/metadata. |
| D1 | ✅ | `get_page_map(includeBounds:true)` | Node bounding boxes returned in CSS px. |
| D2 | ✅ | `get_spatial_relations(nodeIds:[...])` | Returned `leftOf`, `above`, `contains`, overlap, distance. |
| D3 | ✅ | `get_page_map`, `inspect_element` | `zIndex`, `isStacked`, `occluded`, `isObstructed` observed. |
| D4 | ✅ | `get_page_map(includeBounds:true)` | `viewportRatio` present. |
| D5 | ✅ | `get_page_map` | `containerId` grouping present in nested sections. |
| E1 | ✅ | `capture_region({mode:'viewport',format:'png'})` | Viewport capture succeeded. |
| E2 | ✅ | `capture_region({mode:'fullPage',format:'jpeg',quality:80})` | Full-page capture succeeded. |
| E3 | ✅ | `capture_region({rect:{...},format:'png'})` | Region capture succeeded with expected bounds. |
| E4 | 🟡 | `capture_region(format:'png')`, `capture_region(format:'jpeg',quality:80)` | PNG/JPEG + quality supported; no WebP seen. |
| E5 | ✅ | `capture_region` responses | Includes `pageId/snapshotId/relatedSnapshotId/capturedAt`. |
| F1 | ✅ | `get_page_map({interactiveOnly:true,maxNodes:120})` on GitHub | Returned large interactive inventory (buttons/links/inputs). |
| F2 | 🟡 | `inspect_element({selector:'button'})` | Good visibility/pointer/obstruction info; disabled/readonly taxonomy incomplete. |
| F3 | ✅ | `inspect_element` | CSS selector + `anchorKey`/`anchorStrategy` returned. |
| F4 | ✅ | `inspect_element` | Click target sizing + obstruction hints present. |
| G1 | ✅ | `manage_snapshots({action:'list'})` | Monotonic per-page snapshot IDs visible. |
| G2 | ✅ | same-page diff + cross-page/error diff | Delta works; cross-page stale snapshot returns `details.recoveryHints`. |
| G3 | 🟡 | `get_page_map(maxNodes)`, `get_text_map(maxSegments)` | Truncation/limits present; no cursor pagination. |
| G4 | ✅ | `get_page_map(visibleOnly/roles/textMatch/allowedOrigins/deniedOrigins)` | Server-side filtering works with `filterSummary` and policy enforcement. |
| G5 | 🟡 | repeated `get_text_map` and map calls | Ordering observed stable; no explicit determinism guarantee surfaced. |
| G6 | ❌ | `capture_region` | Default returns large inline `dataUrl` (`artifactMode:'inline'`). |
| H1 | ✅ | `wait_for(texts)`, `wait_for(selector)`, `wait_for(stableLayoutMs)` | All wait primitives work. |
| H2 | 🟡 | `wait_for({texts:['THIS_TEXT...'],timeout:1500})` | Timeout control exists; error returned as bare `"timeout"` string. |
| H3 | 🟡 | failing diff/capture/origin calls | `retryable` + snapshot `recoveryHints` present; `retryAfterMs` absent. |
| H4 | 🟡 | `capture_region(no-target)`, `diff_snapshots(snapshot-not-found)`, timeout, inspect not-found | Partial taxonomy present; contract not uniformly structured across all errors. |
| I1 | 🟡 | `get_text_map({redactPII:true})`, screenshot calls | Text redaction actively applied (`[REDACTED]` + `redactionApplied:true`); screenshots excluded by policy warning. |
| I2 | ✅ | `get_page_map(allowedOrigins/deniedOrigins)` | `origin-blocked` enforced correctly. |
| I3 | ✅ | `browser_health({})` | `sessionIsolation` field present. |
| I4 | ✅ | `browser_health({})` | `telemetryPolicy` field present. |
| I5 | ✅ | broad responses (`get_page_map`, `get_text_map`, `capture_region`, etc.) | `auditId` consistently included. |
| I6 | ✅ | `manage_snapshots({action:'list'})` | Retention inventory visible and actionable. |

---

## Category scorecard (0–5 each)

| Category | Score | Notes |
|---|---:|---|
| Session & Context | 3.5 | strong context/readiness; iframe lineage still weak |
| Text Extraction | 5.0 | strong visible text + mapping model |
| Semantic Structure | 4.0 | strong a11y/landmark/form; frame lineage gap remains |
| Layout/Geometry | 5.0 | robust bbox + spatial + visibility data |
| Visual Capture | 4.5 | viewport/full/region strong; format breadth limited |
| Interaction Model | 4.0 | inventory and inspect strong; actionability schema partial |
| Deltas/Efficiency | 3.5 | diff works + recoveryHints improved; pagination + artifact indirection gaps |
| Robustness | 3.0 | wait primitives good; timeout/error shape consistency still mixed |
| Security/Privacy | 4.5 | major improvement via I3/I4; screenshot redaction gap persists |

**Total: 37.0 / 45**

---

## Must-have §6 check

- [x] Visible text extraction with element mapping coverage (observed strong on HN/GitHub)
- [x] Semantic structure via DOM + accessibility surfaces
- [x] Spatial/layout context includes bboxes
- [x] Screenshot capture supports viewport + full-page + region
- [x] Stable `nodeId` within snapshot

All §6 must-have items are **✅** in this run.

---

## Final acceptance question (§8)

> Can the agent understand what the user sees, where it is, what it means, and what changed, without over-fetching data?

**Answer:** Mostly yes for single-page workflows, now with materially improved policy/health disclosure and diff recovery guidance. Remaining production gaps are primarily iframe lineage reliability and default inline artifact transport.
