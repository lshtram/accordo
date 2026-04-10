# Accordo Browser MCP Live Evaluation — 2026-04-06

## 1) Method

- **Target page:** Hacker News (`https://news.ycombinator.com/`), **tabId `918300491`**.
- **Constraint followed:** used **only** `accordo_browser_*` tools.
- **Tools exercised live:**
  - `accordo_browser_health`
  - `accordo_browser_list_pages`, `accordo_browser_select_page`
  - `accordo_browser_navigate`, `accordo_browser_wait_for`
  - `accordo_browser_get_page_map`
  - `accordo_browser_get_text_map`
  - `accordo_browser_get_semantic_graph`
  - `accordo_browser_inspect_element`
  - `accordo_browser_get_dom_excerpt`
  - `accordo_browser_get_spatial_relations`
  - `accordo_browser_capture_region`
  - `accordo_browser_diff_snapshots`
  - `accordo_browser_manage_snapshots`

Scoring rubric used: checklist A–I, each 0–5.

---

## 2) Per-category scoring with evidence

| Cat | Score | Status | Evidence (tool + observed fields/results) |
|---|---:|---|---|
| **A. Session & page context** | **4/5** | 🟡 | ✅ `list_pages` returned multi-tab inventory with stable `tabId`, `url`, `title`, `active`. ✅ `select_page` on `918300491` succeeded. ✅ `get_page_map` returned `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `pageUrl`, `title`. ✅ `navigate` returned `readyState:"interactive"`. ✅ `wait_for` worked (`matchedCondition:"#hnmain"`). 🟡 `traverseFrames:true` returns `iframes: []` on this page (no positive iframe lineage demonstration on this target). |
| **B. Text extraction quality** | **4/5** | 🟡 | ✅ `get_text_map` returned per-segment `textRaw`, `textNormalized`, `nodeId`, `bbox`, `visibility`, `readingOrderIndex`; output had visible/offscreen segmentation. ✅ Reading order monotonic in sampled payload. ✅ Hidden/offscreen represented (`visibility:"offscreen"`). ✅ Redaction works (`redactPII:true` produced `[REDACTED]`). 🟡 `accessibleName` not present in sampled segments; role present only on subset. |
| **C. Structural & semantic understanding** | **3/5** | 🟡 | ✅ `get_page_map` exposes stable `nodeId` + `persistentId` (within snapshot identity contract). ✅ `get_semantic_graph` returns rich `a11yTree`, `landmarks`, `forms` (e.g., search input model). ✅ `get_dom_excerpt` gives focused subtree extraction. 🟡 `outline` was empty on this page (may be page-dependent), and no explicit cross-frame lineage proven here. 🟡 `piercesShadow:true` callable, but no returned shadow annotations demonstrated on this page. |
| **D. Spatial/layout intelligence** | **4/5** | 🟡 | ✅ `get_page_map(includeBounds:true)` returned `bounds`, `viewportRatio`, `occluded`, and stacked metadata (`zIndex`, `isStacked` seen on SDK layer). ✅ `get_spatial_relations` returned `leftOf`, `above`, `contains`, `overlap`, `distance` for node pairs. 🟡 Container grouping semantics (cards/panels/modals) are still implicit rather than explicit typed groups. |
| **E. Visual capture for multimodal agents** | **5/5** | ✅ | ✅ `capture_region(mode:"viewport", format:"png")` succeeded (inline). ✅ `capture_region(mode:"fullPage", format:"webp")` succeeded (inline). ✅ region capture via `rect` and via `nodeRef` succeeded. ✅ format/quality controls validated (`png`, `jpeg`, `webp`, `quality`). ✅ artifact indirection validated (`transport:"file-ref"` returned `fileUri`, `filePath`). ✅ visual↔structure linkage present (`pageId`, `snapshotId`, `relatedSnapshotId`, `auditId`). |
| **F. Interaction discoverability** | **3/5** | 🟡 | ✅ `get_page_map(interactiveOnly:true)` returned interactive inventory with links, hrefs, bounds. ✅ `inspect_element` returned actionability fields (`visible`, `disabled`, `readonly`, `invalid`, `hasPointerEvents`, `isObstructed`, `clickTargetSize`, `anchorKey`). ✅ Selector-based targeting works. 🟡 `roles:["link"]` filter call returned 0 nodes in this run (likely filtering mismatch/bug), reducing semantic discoverability confidence. |
| **G. Change tracking / efficiency** | **3/5** | 🟡 | ✅ `manage_snapshots(list)` exposes retained snapshot sets and IDs. ✅ `diff_snapshots` works when IDs/page lineage match (7→8 showed no changes with structured summary). ✅ server-side reduction controls: `maxNodes`, `maxSegments`, `interactiveOnly`, `visibleOnly`, `textMatch`, `regionFilter`. ✅ deterministic ordering demonstrated via `readingOrderIndex`. ✅ artifact mode supports `file-ref` (efficient transport). 🟡 Diff ergonomics fragile across pageId/snapshot mismatches; multiple `snapshot-not-found` failures before successful pairing. |
| **H. Robustness & operability** | **4/5** | 🟡 | ✅ wait primitives validated: selector hit, stable-layout hit, timeout behavior. ✅ clear errors observed: `timeout`, `no-target`, `origin-blocked`, `snapshot-not-found`, `navigation-interrupted`. ✅ structured error payload includes `retryable` and `recoveryHints` in several failures. 🟡 Retry/backoff guidance is minimal (basic hints, not strategy-level). |
| **I. Security/privacy controls** | **4/5** | 🟡 | ✅ origin policy enforcement works: `allowedOrigins`/`deniedOrigins` produced `origin-blocked`. ✅ text redaction works (`redactPII:true`). ✅ telemetry/session posture available from `health`: telemetry disabled, explicit shared-profile model. ✅ retention controls observable via `manage_snapshots` and explicit metadata/audit IDs. 🟡 screenshot responses explicitly warn `screenshots-not-subject-to-redaction-policy` (privacy gap for visual artifacts). |

---

## 3) Final scorecard

| Category | Score |
|---|---:|
| A | 4 |
| B | 4 |
| C | 3 |
| D | 4 |
| E | 5 |
| F | 3 |
| G | 3 |
| H | 4 |
| I | 4 |
| **Total** | **34 / 45** |

**Gate status:** ✅ **PASS (recommended threshold met)**

- Total is above 30/45.
- No category below 2.
- Must-have capabilities were demonstrated on this live run.

---

## 4) Recommendations (highest impact first)

1. **Fix role-based filtering behavior in `get_page_map` (`roles:["link"]`)**  
   - Impact: improves interaction discoverability and semantic querying reliability.  
   - **Estimated score delta:** **+1** (F), **+0.5** (G).

2. **Harden `diff_snapshots` usability and lineage handling** (better defaults and clearer page/snapshot pairing ergonomics).  
   - Impact: fewer false failures, stronger incremental-agent workflows.  
   - **Estimated score delta:** **+1** (G).

3. **Extend text map segments with consistent semantic fields** (`accessibleName` and role coverage on all segments where derivable).  
   - Impact: improves semantic grounding for agent planning without extra calls.  
   - **Estimated score delta:** **+1** (B), **+0.5** (C).

4. **Add screenshot redaction mode (PII-safe visual capture)** to align visual and text privacy controls.  
   - Impact: closes major privacy asymmetry.  
   - **Estimated score delta:** **+1** (I).

5. **Expose explicit frame/shadow lineage fields in semantic outputs** when traversal options are enabled.  
   - Impact: better cross-context reasoning on complex apps with iframes/shadow DOM.  
   - **Estimated score delta:** **+1** (C).
