# Browser MCP Comprehensive Evaluation — 2026-04-06 (v3)

## Summary

- **Verdict:** **FAIL**
- **Total score:** **29 / 45**
- **Date:** 2026-04-06
- **Threshold check:** Required ≥30/45 (not met)

This run covered all checklist categories A–I with live tool evidence across MDN (shadow DOM), Hacker News (text/interaction/layout), GitHub (semantic/landmarks/forms), and W3Schools iframe route (frame handling). Core extraction and geometry are strong, but frame context reliability, cross-page delta ergonomics, robustness error contracts, and privacy/session policy disclosure remain below production bar.

---

## Starting conditions

- Initial health check:
  - `accordo_browser_health({})`
  - Evidence: `{connected:true, debuggerUrl:"ws://localhost:9222", recentErrors:[]}`.
- Initial tab inventory:
  - `accordo_browser_list_pages({})`
  - Evidence: multiple existing tabs listed; active tab started from browser reset flow and was controllable.
- Tool availability note:
  - `chrome-devtools_*` tools are not present in this runtime; evaluation performed with Accordo browser tools only.
  - During evaluation, one explicit interaction call on another tab failed with `control-not-granted` (documented under H/I), while core browser-read operations remained available.

---

## Phase execution notes

1. Read checklist and prior report template in full.
2. Ran health + page inventory baseline.
3. Ran context/readiness/text/semantic/layout/interaction tests on Hacker News.
4. Ran iframe tests on W3Schools iframe tutorial (observed ad/recaptcha frame-context drift).
5. Ran shadow DOM tests on MDN `slotchange` web component demo (`piercesShadow` true/false comparison).
6. Ran semantic/landmark/form extraction on GitHub settings page.
7. Ran visual capture modes (viewport/full-page/rect region).
8. Ran snapshot listing + delta tests including special cross-page diff error test.
9. Ran robustness/security tests for timeout, no-target, not-found, origin policy, redactPII.

---

## A) Session & page context

### A1 — Page metadata (URL/title/viewport/context)
- **Status:** ✅
- **Call:** `accordo_browser_get_page_map({tabId:918300491, includeBounds:true, maxDepth:6, maxNodes:300})`
- **Evidence:** Returned `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `pageUrl`, `title`.

### A2 — Readiness / load state + wait support
- **Status:** 🟡
- **Calls:**
  - `accordo_browser_navigate({url:'https://news.ycombinator.com/', waitUntil:'domcontentloaded'})` → `readyState:'interactive'`
  - `accordo_browser_navigate({url:'https://news.ycombinator.com/', waitUntil:'load'})` → `readyState:'complete'`
  - `accordo_browser_wait_for({texts:['Hacker News']})`, `...{selector:'body'}`, `...{stableLayoutMs:800}`
- **Evidence:** Strong readiness support; timeout path returns unstructured `timeout` string in one case (see H2).

### A3 — Multi-tab handling
- **Status:** ✅
- **Calls:** `accordo_browser_list_pages({})`, `accordo_browser_select_page({tabId:918300294})`, `accordo_browser_select_page({tabId:918300491})`
- **Evidence:** Active tab switched correctly; operations can target by `tabId`.

### A4 — iframe relationships
- **Status:** ❌
- **Call:** `accordo_browser_get_page_map({tabId:918300491, traverseFrames:true, includeBounds:true})` on W3Schools iframe tutorial
- **Evidence:** Returned ad/recaptcha/sodar endpoints (e.g., `cm.g.doubleclick.net`, `google recaptcha aframe`) with `iframes:[]`; explicit parent/child frame lineage not surfaced.

### A5 — shadow DOM handling
- **Status:** ✅
- **Calls:**
  - `get_page_map({piercesShadow:false,...})`
  - `get_page_map({piercesShadow:true,...})`
- **Evidence:** With `piercesShadow:true`, nodes include `inShadowRoot:true` and `shadowHostId`; shadow subtree became inspectable without CSS/XPath fallback.

---

## B) Text extraction quality

### B1 — Visible text extraction
- **Status:** ✅
- **Call:** `accordo_browser_get_text_map({tabId:918300491, maxSegments:200})` on HN
- **Evidence:** Returned rich user-visible content (story titles, metadata, nav links).

### B2 — Text-to-node mapping + bboxes
- **Status:** ✅
- **Call:** same as B1
- **Evidence:** Per segment includes `nodeId` and `bbox`.

### B3 — Raw + normalized text
- **Status:** ✅
- **Call:** same as B1
- **Evidence:** Per segment includes both `textRaw` and `textNormalized`.

### B4 — Reading order
- **Status:** ✅
- **Call:** same as B1
- **Evidence:** `readingOrderIndex` emitted per segment.

### B5 — Hidden/offscreen flags
- **Status:** ✅
- **Call:** `get_text_map(...)` on GitHub + MDN
- **Evidence:** `visibility` values include `visible`, `hidden`, `offscreen`.

---

## C) Structural + semantic understanding

### C1 — DOM snapshot with stable node IDs
- **Status:** ✅
- **Call:** `get_page_map(...)`
- **Evidence:** Returns `snapshotId`, `nodeId`, `persistentId`, tree hierarchy.

### C2 — Accessibility tree
- **Status:** ✅
- **Call:** `accordo_browser_get_semantic_graph({tabId:918300294, maxDepth:8, visibleOnly:true})`
- **Evidence:** Rich a11y roles/names/states (banner, navigation, buttons, links, headings).

### C3 — Cross-frame model lineage
- **Status:** ❌
- **Call:** `get_page_map({traverseFrames:true})` on iframe-heavy page
- **Evidence:** No robust node-to-frame lineage; frame context drifts to ad/recaptcha endpoints.

### C4 — Shadow-root aware semantic model
- **Status:** 🟡
- **Calls:** `get_page_map({piercesShadow:true})`, `get_semantic_graph(...)` on MDN shadow demo
- **Evidence:** Shadow content appears in semantic output, but semantic graph lacks explicit shadow lineage metadata comparable to page map (`inShadowRoot`, `shadowHostId`).

### C5 — Landmark extraction
- **Status:** ✅
- **Call:** `get_semantic_graph(...)` on GitHub
- **Evidence:** Landmarks include `banner`, `navigation`, `main`, `contentinfo`, forms.

### C6 — Heading outline extraction
- **Status:** ✅
- **Call:** `get_semantic_graph(...)` on GitHub + MDN
- **Evidence:** Non-empty `outline` with H1/H2/H3 entries.

### C7 — Form model extraction
- **Status:** ✅
- **Call:** `get_semantic_graph(...)` on GitHub
- **Evidence:** Multiple form models returned with fields, names, required flags, methods/actions.

---

## D) Spatial/layout intelligence

### D1 — Bounding boxes in CSS px
- **Status:** ✅
- **Call:** `get_page_map({includeBounds:true,...})`
- **Evidence:** Nodes include `bounds:{x,y,width,height}`.

### D2 — Relative geometry helpers
- **Status:** ✅
- **Call:** `accordo_browser_get_spatial_relations({nodeIds:[0,1,2,3,4,5,6,7]})`
- **Evidence:** Returned `leftOf`, `above`, `contains`, `containedBy`, `overlap`, `distance`, plus `missingNodeIds` diagnostics.

### D3 — Z-order / occlusion hints
- **Status:** ✅
- **Calls:** `get_page_map(includeBounds:true)`, `inspect_element(...)`
- **Evidence:** Fields include `zIndex`, `isStacked`, `occluded`, `isObstructed`.

### D4 — Viewport intersection ratios
- **Status:** ✅
- **Call:** `get_page_map(includeBounds:true)`
- **Evidence:** `viewportRatio` present.

### D5 — Container/section grouping
- **Status:** ✅
- **Call:** `get_page_map(...)`
- **Evidence:** `containerId` surfaced in nested layouts (e.g., GitHub main content / MDN shadow article subtree).

---

## E) Visual capture

### E1 — Viewport screenshot
- **Status:** ✅
- **Call:** `accordo_browser_capture_region({tabId:918300491, mode:'viewport', format:'png'})`
- **Evidence:** Success with linked metadata (`pageId`, `snapshotId`, `relatedSnapshotId`, `capturedAt`).

### E2 — Full-page screenshot
- **Status:** ✅
- **Call:** `accordo_browser_capture_region({tabId:918300491, mode:'fullPage', format:'jpeg', quality:80})`
- **Evidence:** Success in full-page mode.

### E3 — Element/region capture
- **Status:** ✅
- **Call:** `accordo_browser_capture_region({rect:{x:8,y:80,width:500,height:180}, format:'png', padding:4})`
- **Evidence:** Region crop succeeded with expected dimensions.

### E4 — Configurable quality & format
- **Status:** 🟡
- **Call:** `capture_region(... format:'png')`, `capture_region(... format:'jpeg', quality:80)`
- **Evidence:** PNG/JPEG + JPEG quality supported; no WebP option observed.

### E5 — Visual-to-structure linkage
- **Status:** ✅
- **Call:** screenshot responses above
- **Evidence:** Responses include linkage fields (`snapshotId`, `relatedSnapshotId`, `pageId`, timestamps).

---

## F) Interaction discoverability

### F1 — Interactive inventory
- **Status:** 🟡
- **Calls:**
  - `get_page_map({interactiveOnly:true, maxNodes:80})` on HN (rich output)
  - `get_page_map({interactiveOnly:true, maxNodes:50})` on MDN (empty)
- **Evidence:** Capability exists, but inconsistent practical inventory across pages.

### F2 — Actionability state
- **Status:** 🟡
- **Call:** `inspect_element({selector:"a[href='news']"})`
- **Evidence:** Good `visible/hasPointerEvents/isObstructed/clickTargetSize`; explicit `enabled/disabled/readonly` actionability taxonomy not consistently exposed.

### F3 — Selector + semantic handles
- **Status:** ✅
- **Call:** `inspect_element({selector:'summary-display'})`
- **Evidence:** Returns selector-targeted inspection plus `anchorKey`, `anchorStrategy`, parent/sibling context.

### F4 — Eventability hints
- **Status:** ✅
- **Call:** inspect outputs above
- **Evidence:** Click target sizes + obstruction and pointer event hints available.

---

## G) Change tracking / efficiency

### G1 — Snapshot versioning
- **Status:** ✅
- **Calls:** `accordo_browser_manage_snapshots({action:'list'})`, repeated map/text/semantic/capture calls
- **Evidence:** Monotonic per-page snapshot IDs; source tagging (`dom`, `visual`).

### G2 — Delta APIs (including special cross-page test)
- **Status:** 🟡
- **Calls:**
  - Same-page: `diff_snapshots({fromSnapshotId:'pg_26...:10'})` → success/no-change summary
  - Cross-page: `diff_snapshots({fromSnapshotId:'pg_26...:10', toSnapshotId:'pg_b380...:3'})`
- **Evidence:** Cross-page call returned structured failure with `details.reason`, but no `details.recoveryHints` field; response leaned on eviction-style `suggestedAction` patterns in other failure cases.

### G3 — Incremental retrieval / chunking
- **Status:** 🟡
- **Calls:** `get_page_map({maxNodes:...})`, `get_text_map({maxSegments:...})`
- **Evidence:** Truncation and max-limits supported; no cursor/pagination contract found.

### G4 — Server-side filtering
- **Status:** ✅
- **Calls:**
  - `get_page_map({interactiveOnly:true})`
  - `get_page_map({textMatch:'Hacker News'})`
  - `get_page_map({visibleOnly:true, roles:[...]})`
  - origin policy filters (allowed/denied)
- **Evidence:** `filterSummary` + reduction ratios returned; policy filtering enforced.

### G5 — Deterministic ordering
- **Status:** 🟡
- **Call:** repeated page/text snapshots on same pages
- **Evidence:** Ordering generally stable, but no explicit determinism guarantee surfaced.

### G6 — Artifact indirection vs inline blobs
- **Status:** ❌
- **Call:** screenshot calls
- **Evidence:** Binary payloads returned inline as large `dataUrl` with `artifactMode:'inline'` by default.

---

## H) Robustness

### H1 — Wait primitives
- **Status:** ✅
- **Call:** `wait_for({texts:[...]})`, `wait_for({selector:'body'})`, `wait_for({stableLayoutMs:...})`
- **Evidence:** All three wait primitives work.

### H2 — Timeout controls + semantics
- **Status:** 🟡
- **Call:** `wait_for({texts:['THIS_TEXT_SHOULD_NEVER_APPEAR_12345'], timeout:2000})`
- **Evidence:** Timeout is controllable, but returned bare `timeout` string (not consistently structured contract).

### H3 — Retry/backoff hints (special focus)
- **Status:** ❌
- **Calls:** failing `diff_snapshots`, `capture_region` no-target, origin-blocked policy failures
- **Evidence:** `retryable` appears on some errors, but no consistent `retryAfterMs` and no consistent `recoveryHints` field found.

### H4 — Error taxonomy quality
- **Status:** 🟡
- **Calls:**
  - `capture_region({format:'png'})` without target → `no-target`
  - `inspect_element({selector:'#definitely-not-present-xyz'})` → `found:false`
  - `diff_snapshots(...)` → `snapshot-not-found`
  - `wait_for(...)` timeout
- **Evidence:** Useful partial taxonomy, but not full expected set/shape for deterministic recovery.

---

## I) Security/privacy

### I1 — Redaction hooks (text + screenshots)
- **Status:** 🟡
- **Calls:** `get_text_map({redactPII:true})`, screenshot calls
- **Evidence:** Redaction flag available, but test page had no PII and returned `redactionApplied:false`; screenshots explicitly warn `screenshots-not-subject-to-redaction-policy`.

### I2 — Origin allow/deny
- **Status:** ✅
- **Calls:**
  - `get_page_map({allowedOrigins:['https://news.ycombinator.com']})`
  - `get_page_map({deniedOrigins:['https://mdn.github.io']})`
- **Evidence:** Policy enforcement works (`origin-blocked` on mismatch/denied).

### I3 — Session/storage isolation controls (special focus)
- **Status:** ❌
- **Call:** `accordo_browser_health({})`
- **Evidence:** No `sessionIsolation` field found in health response.

### I4 — Telemetry disclosure / opt-out (special focus)
- **Status:** ❌
- **Call:** `accordo_browser_health({})`
- **Evidence:** No `telemetryPolicy` field found in health response.

### I5 — Audit trail of calls/artifacts
- **Status:** ✅
- **Evidence:** Most responses include `auditId`, with traceable snapshot linkage/timestamps.

### I6 — Data-retention controls
- **Status:** ✅
- **Call:** `accordo_browser_manage_snapshots({action:'list'})`
- **Evidence:** Retention inventory visible per page with source and capture times.

---

## Scorecard (9 categories)

| Category | Score (0–5) | Notes |
|---|---:|---|
| Session & Context (A) | 3 | Good metadata/readiness/tab controls; iframe lineage unreliable |
| Text Extraction (B) | 5 | Strong segment quality + mapping + order + visibility |
| Semantic Structure (C) | 3 | Strong semantic stack, but frame lineage gap + partial shadow semantics |
| Layout/Geometry (D) | 5 | Complete practical geometry support |
| Visual Capture (E) | 4 | Viewport/full/region strong; format matrix still limited |
| Interaction Model (F) | 3 | Good inspect/eventability; interactive inventory/actionability consistency gaps |
| Deltas/Efficiency (G) | 2 | Versioning works; cross-page diff ergonomics + inline artifacts + pagination gaps |
| Robustness (H) | 2 | Basic waits/errors present; retry/backoff contract weak |
| Security/Privacy (I) | 2 | Origin controls/audit good; session+telemetry contract fields missing |

**Total: 29 / 45**

---

## Evidence table (A1–I6)

| Item | Status | Tool calls used | Evidence summary |
|---|---|---|---|
| A1 | ✅ | get_page_map | Full context object (page/frame/snapshot/viewport/title/url) |
| A2 | 🟡 | navigate + wait_for | `interactive/complete` readiness + waits; timeout shape inconsistent |
| A3 | ✅ | list_pages/select_page | Tab switching by `tabId` works |
| A4 | ❌ | get_page_map(traverseFrames) | iframe-heavy page mapped to ad/recaptcha contexts, no lineage |
| A5 | ✅ | get_page_map(piercesShadow true/false) | shadow nodes exposed with `inShadowRoot` metadata |
| B1 | ✅ | get_text_map | User-visible text extracted on HN/MDN |
| B2 | ✅ | get_text_map | Per-segment `nodeId` + `bbox` |
| B3 | ✅ | get_text_map | `textRaw` + `textNormalized` |
| B4 | ✅ | get_text_map | `readingOrderIndex` present |
| B5 | ✅ | get_text_map | `visibility` includes visible/hidden/offscreen |
| C1 | ✅ | get_page_map | stable in-snapshot ids + persistent ids |
| C2 | ✅ | get_semantic_graph | rich a11y tree on GitHub |
| C3 | ❌ | get_page_map(traverseFrames) | no explicit cross-frame lineage model |
| C4 | 🟡 | get_page_map + get_semantic_graph | shadow content included, but semantic lineage fields sparse |
| C5 | ✅ | get_semantic_graph | landmarks extracted (banner/nav/main/contentinfo/forms) |
| C6 | ✅ | get_semantic_graph | heading outline populated |
| C7 | ✅ | get_semantic_graph | form models with fields/method/action |
| D1 | ✅ | get_page_map(includeBounds) | node bounding boxes present |
| D2 | ✅ | get_spatial_relations | relation matrix + overlap + distance |
| D3 | ✅ | get_page_map/inspect_element | `zIndex`, `isStacked`, `occluded`, `isObstructed` |
| D4 | ✅ | get_page_map | `viewportRatio` surfaced |
| D5 | ✅ | get_page_map | `containerId` grouping in layouts |
| E1 | ✅ | capture_region(viewport) | viewport capture success + snapshot linkage |
| E2 | ✅ | capture_region(fullPage) | full-page capture success |
| E3 | ✅ | capture_region(rect) | explicit region capture works |
| E4 | 🟡 | capture_region(format/quality) | png/jpeg + quality yes; no webp observed |
| E5 | ✅ | capture_region | visual responses include structural linkage fields |
| F1 | 🟡 | get_page_map(interactiveOnly) | strong on HN, empty on MDN case |
| F2 | 🟡 | inspect_element | pointer/obstruction/size present; incomplete enable/readonly states |
| F3 | ✅ | inspect_element | selector + anchor strategy/context returned |
| F4 | ✅ | inspect_element | click target + interception hints present |
| G1 | ✅ | manage_snapshots(list) | per-page monotonic snapshot histories |
| G2 | 🟡 | diff_snapshots | same-page works; cross-page error has reason but no recoveryHints |
| G3 | 🟡 | get_page_map/get_text_map | max-limits + truncation, no cursor pagination |
| G4 | ✅ | filtered page_map calls | server-side filtering + policy enforcement |
| G5 | 🟡 | repeated map/text calls | observed stable behavior, no explicit deterministic contract |
| G6 | ❌ | capture_region | default inline base64 artifacts |
| H1 | ✅ | wait_for variants | text/selector/stable-layout all work |
| H2 | 🟡 | wait_for(timeout) | timeout works but non-structured response path observed |
| H3 | ❌ | failing diff/capture/policy calls | no consistent `retryAfterMs`/`recoveryHints` |
| H4 | 🟡 | capture/inspect/diff/wait errors | partial taxonomy; incomplete canonical contract |
| I1 | 🟡 | get_text_map(redactPII), capture_region | text redaction hook exists; screenshot redaction not applied |
| I2 | ✅ | page_map(origin allow/deny) | origin policies enforced |
| I3 | ❌ | browser_health | `sessionIsolation` missing |
| I4 | ❌ | browser_health | `telemetryPolicy` missing |
| I5 | ✅ | broad tool responses | `auditId` traceability present |
| I6 | ✅ | manage_snapshots(list) | retention inventory controls present |

---

## Must-have §6 checklist

- [x] Visible text extraction with element mapping
- [x] Semantic structure via DOM + accessibility surfaces
- [x] Spatial/layout context includes bboxes
- [x] Viewport + full-page + region screenshot capture
- [x] Stable `nodeId` within snapshot

**Note:** Must-haves are met, but total score still fails threshold and category minimum-strength expectations for robust agent workflows.

---

## Top issues (ranked)

### P0 — Frame/iframe context continuity is unreliable
- **Observed:** iframe traversal on W3Schools frequently returned ad/recaptcha frame context and empty iframe lineage.
- **Impact:** Agents may reason over wrong document surface.

### P1 — Cross-page diff ergonomics incomplete
- **Observed:** Cross-page diff test did not provide expected `details.recoveryHints`; failures were mostly snapshot-not-found/eviction style.
- **Impact:** Weak guided recovery in multi-page workflows.

### P2 — Robustness error contract is partial
- **Observed:** `retryable` appears sometimes, but `retryAfterMs` and consistent `recoveryHints` absent; timeout path may be unstructured.
- **Impact:** Harder deterministic retry/backoff orchestration.

### P3 — Artifact transport is inline by default
- **Observed:** screenshots returned as large inline data URLs (`artifactMode:'inline'`).
- **Impact:** Context/token bloat and reduced throughput.

### P4 — Security metadata disclosure gaps in health endpoint
- **Observed:** no `sessionIsolation` and no `telemetryPolicy` in health response.
- **Impact:** Policy posture not explicit to agent clients.

---

## Final verdict (§8 acceptance question)

> “Can the agent understand what the user sees, where it is, what it means, and what changed, without over-fetching data?”

**Answer:** **Not consistently yet.**

The stack is strong for single-page visible-text/semantic/layout reasoning, but production confidence is limited by iframe continuity, diff/recovery contracts, and policy/transport ergonomics.
