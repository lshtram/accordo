# Code Review — Browser MCP Module (Post-Fix)
**Date:** 2026-04-05  
**Reviewer:** Reviewer Agent  
**Scope:** `packages/browser` + `packages/browser-extension` — post-fix pass after 4 user-reported issues were resolved  
**Checklist:** `docs/30-development/mcp-webview-agent-evaluation-checklist.md`

---

## Test Suite Baseline

| Package | Result |
|---|---|
| `packages/browser-extension` | ✅ 1034 / 1034 passing |
| `packages/browser` | ⚠️ 695 / 696 passing — 1 pre-existing failure (see F-1 below) |

---

## Section 1 — Findings (ordered by severity)

### MEDIUM

#### F-1 · Failing test — port hardcoding drift
**File:** `packages/browser/src/__tests__/extension-activation.test.ts:472`  
**Symptom:** `BR-F-123` fails — test asserts `relayPort: 40111`, actual is `40112`.  
**Impact:** CI is red for this file. Not a runtime bug, but the test is validating a real config field and its hardcoded expectation has drifted from the actual value. If the port is ever wrong at runtime, the test won't catch it.  
**Fix:** Update the test expectation to match the current value, or read it from the same config constant the production code uses.

---

#### F-2 · `resolveElement` silently returns wrong element on hidden ref/nodeId
**File:** `packages/browser-extension/src/content/element-inspector.ts:325–335, 355–364`  
**Symptom:** When a ref or nodeId resolves to a hidden element, the code falls back to the first visible sibling and returns it *with no indication to the caller* that a different element was returned.  
**Impact:** `inspect_element` can report attributes, bounds, and state for an element the caller did not request. Agents relying on inspect to confirm a specific node's state will silently receive wrong data. This is the highest-impact logic risk in the current codebase.  
**Fix:** Either return `element-not-found` for hidden nodes (let caller decide), or include a `resolvedFromSibling: true` flag in the response so the caller can detect the substitution.

---

#### F-3 · Hardcoded `1920×1080` viewport fallback in capture_region
**File:** `packages/browser-extension/src/relay-capture-handler.ts:272–279`  
**Symptom:** When `mode === "viewport"` and the actual viewport bounds cannot be read, the code returns a region with `width: 1920, height: 1080` hardcoded.  
**Impact:** On any screen smaller (or larger) than 1920×1080 — including mobile emulation, or any DevTools-throttled viewport — the captured region does not match what the user sees. Agents using this for visual verification against layout data will get mismatched coordinates.  
**Fix:** Read the actual viewport dimensions via the content script envelope's `viewport` field. Fail with a clear error if unavailable rather than silently substituting a wrong size.

---

#### F-4 · FIFO eviction can silently fail diff_snapshots with no user-actionable error
**File:** `packages/browser/src/diff-tool.ts:300–309`; `packages/browser-extension/src/snapshot-store.ts`  
**Symptom:** `resolveFromSnapshot` computes `{pageId}:{version-1}` to find the prior snapshot. The service worker retains only 5 slots per page (FIFO). If the prior version was evicted (rapid navigation, many captures), the diff fails with `snapshot-not-found`.  
**Impact:** Agents doing multi-step workflows with frequent captures will encounter intermittent diff failures with no indication that eviction was the cause. The error message doesn't distinguish "snapshot never existed" from "snapshot was evicted".  
**Fix:** Add an eviction hint to the error: e.g., `"snapshot-not-found: version N was evicted (retention window: 5 snapshots)"`. This gives the agent actionable signal to re-capture before diffing.

---

### LOW

#### F-5 · `DEFAULT_PAGE_ID = "page"` — all tabs share same pageId in snapshot envelope
**File:** `packages/browser-extension/src/snapshot-versioning.ts:240`  
**Symptom:** Every snapshot envelope uses `pageId: "page"` regardless of which tab or URL it came from.  
**Impact:** The canonical object model in checklist §3.1 requires a meaningful `pageId`. Currently `pageId` is not usable for tab differentiation — that distinction lives only in relay routing. Snapshot IDs from different tabs are not namespaced and could collide in theory, though relay routing prevents practical collisions today.  
**Fix:** Derive `pageId` from the tab's URL or a stable tab identifier at capture time. This is a tracked known limitation; document it explicitly in the snapshot envelope schema.

---

#### F-6 · Invalid CSS selector in get_page_map silently passes all elements
**File:** `packages/browser-extension/src/content/page-map-filters.ts:234–235`  
**Symptom:** `matchesSelector()` catches `querySelectorAll` parse errors and returns `() => true` (no filtering) instead of failing or returning empty.  
**Impact:** An agent that passes a malformed selector string (e.g. a typo) will receive the full unfiltered page map with no error. This can generate unexpectedly large responses and masks the input error.  
**Fix:** Return a `filter-error` response when the selector is unparseable, or at minimum log a warning and return empty results rather than unfiltered results.

---

#### F-7 · Duplicate `persistentId` silently collapses repeated list items in diff
**File:** `packages/browser-extension/src/diff-engine.ts:281`  
**Symptom:** `buildNodeIndex` uses first-occurrence-wins for duplicate `persistentId` values. Identical list items (same tag + text + no distinguishing id) hash to the same `persistentId`.  
**Impact:** Diff reports no change for repeated identical items even if they are reordered, duplicated, or removed. Silent false negatives in diff output.  
**Fix:** This is a documented limitation of hash-based persistent IDs. It should be explicitly disclosed in the diff response (e.g., `"collisions": N`) so agents know to treat diffing of homogeneous lists as unreliable.

---

#### F-8 · Audit log marks timeouts as `action: "blocked"`
**File:** `packages/browser/src/page-tool-handlers-impl.ts:123–128`  
**Symptom:** Timeout errors in all 4 primary handlers are logged with `action: "blocked"` in the audit trail.  
**Impact:** Misleading audit semantics. `"blocked"` implies a security or policy block; timeouts are operational failures. Any downstream audit analysis (alerting, compliance) will misclassify timeout events.  
**Fix:** Use `action: "timeout"` (or `"error"`) for timeout paths, reserving `"blocked"` for actual policy/auth rejections.

---

#### F-9 · `(result as any).auditId` unsafe cast in all 4 handlers
**File:** `packages/browser/src/page-tool-handlers-impl.ts` — present in all 4 handler functions  
**Symptom:** `auditId` is injected into the response object via `(result as any).auditId = ...`, bypassing TypeScript's type checker.  
**Impact:** Low runtime risk (the field is set correctly), but this is a banned pattern per `docs/30-development/coding-guidelines.md §3` (untyped escape hatches). It will fail a strict D2 review.  
**Fix:** Add `auditId?: string` to the response type, or use a wrapper type that includes `auditId`.

---

#### F-10 · `handleGetTextMap` drops filter params other than `maxSegments`
**File:** `packages/browser-extension/src/relay-page-handlers.ts` — `handleGetTextMap`  
**Symptom:** Only `maxSegments` is forwarded to the content script. Other MCP-layer params (`redactPII`, `allowedOrigins`, `deniedOrigins`) are not forwarded.  
**Impact:** Agents requesting `get_text_map` with privacy controls (`redactPII: true`) may receive unredacted text. The MCP layer validates the params but the relay handler does not act on them.  
**Note:** `get_semantic_graph` has the same gap for `redactPII`.  
**Fix:** Forward all declared filter params from the relay handler to the content script payload.

---

## Section 2 — Confirmed Fixes (all 4 verified ✅)

| Fix # | Description | Location | Status |
|---|---|---|---|
| 1 | Zero-sized `regionFilter` must not activate filtering | `page-map-filters.ts:279–283` | ✅ Correctly guards `width > 0 && height > 0` |
| 2 | `inspect_element`: ref → selector → nodeId priority | `relay-page-handlers.ts:73–87` | ✅ Correctly implemented |
| 3 | Blank snapshot IDs treated as omitted | `diff-tool.ts:101–105` (`normalizeSnapshotId`) | ✅ `s.trim() === ""` → `undefined` |
| 4 | Zero-sized rect must not mask nodeRef/anchorKey | `relay-capture-handler.ts:114` (`hasUsableRect`) | ✅ Guards `w > 0 && h > 0` |

---

## Section 3 — Checklist Scorecard

Scored against §4.1 baseline tool set and §7 rubric (0–5 per category).

| Category | Score | Rationale |
|---|---:|---|
| **A. Session & Context** | 4 | URL/title/viewport available via `list_pages` + `get_page_map`. Multi-tab stable IDs via `list_pages`/`select_page`. Shadow DOM and iframe traversal are partial (content-script scope limited). `pageId` in snapshot envelope is hardcoded `"page"` (F-5). |
| **B. Text Extraction** | 4 | `get_text_map` returns `textRaw`, `textNormalized`, `bbox`, `readingOrderIndex`, `visibility`. Hidden/offscreen flags present. Gap: `redactPII` not forwarded to content script (F-10). |
| **C. Semantic Structure** | 4 | `get_semantic_graph` returns a11y tree, landmarks, heading outline, form model. `get_dom_excerpt` provides DOM subtree. Gap: `redactPII` not forwarded (F-10). Cross-frame model is partial. |
| **D. Layout/Geometry** | 4 | Bboxes on all nodes when `includeBounds: true`. `get_spatial_relations` covers leftOf/above/contains/overlap/distance. Z-order hints present. Viewport intersection available via `visibleOnly`. |
| **E. Visual Capture** | 3 | Viewport + full-page via `chrome-devtools_take_screenshot`. Region by nodeRef, anchorKey, rect via `capture_region`. PNG/JPEG/WebP supported. Gap: viewport fallback hardcoded to `1920×1080` (F-3); no visual-to-structure snapshot linkage. |
| **F. Interaction Model** | 3 | `interactiveOnly` filter on `get_page_map`. Actionability (enabled/disabled/hidden) in `inspect_element`. Silent hidden→sibling fallback (F-2) undermines actionability state reliability. No explicit "eventability hint" (click target size). |
| **G. Deltas/Efficiency** | 3 | `diff_snapshots` functional. Snapshot versioning present but `pageId` is not meaningful (F-5). Server-side filtering (role, visibility, text, region) all implemented. FIFO eviction not surfaced in error messages (F-4). Deterministic ordering present. |
| **H. Robustness** | 3 | `wait_for` (text/selector/stableLayout) implemented. Timeout controls present on all tools. Error taxonomy covers `element-not-found`, `no-target`, `capture-failed`. Gap: timeout logged as "blocked" (F-8); eviction errors not distinguished (F-4); 1 failing test in CI (F-1). |
| **I. Security/Privacy** | 3 | `redactPII` on `get_page_map`/`get_semantic_graph`, `allowedOrigins`/`deniedOrigins` on read tools, audit trail on all 4 primary handlers. Gaps: `redactPII` not forwarded to content script for `get_text_map`/`get_semantic_graph` (F-10); audit log misclassifies timeouts (F-8); no data-retention controls exposed to caller; `(result as any).auditId` unsafe cast (F-9). |

**Total: 31 / 45**

### §6 Must-Have Checklist

| Item | Status |
|---|---|
| Visible text extraction with element mapping coverage ≥ 95% | ✅ |
| Semantic structure via DOM + accessibility surfaces | ✅ |
| Spatial/layout context includes element bboxes | ✅ |
| Screenshot capture supports viewport + full-page + region | ✅ |
| Stable `nodeId` within snapshot | ✅ |

All must-have items are satisfied. No category is below 3. Total 31 ≥ 30.

### Verdict: **PASS** (with tracked issues)

---

## Section 4 — Residual Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hidden→sibling fallback (F-2) causes wrong element to be inspected silently | Medium | High — corrupts agent state machine | Add `resolvedFromSibling` flag or return not-found |
| FIFO eviction causes intermittent diff failures in long workflows (F-4) | Medium | Medium — breaks multi-step diff chains | Improve error message; consider 10-slot retention |
| `redactPII` not reaching content script for text_map/semantic_graph (F-10) | Low | High (privacy) — PII returned despite opt-in | Forward all declared params through relay handler |
| Port hardcoding in test means CI stays red (F-1) | Certain | Low — test confidence undermined | One-line fix |
| Viewport fallback 1920×1080 causes coordinate mismatch on non-standard viewports (F-3) | Low | Medium — visual validation incorrect | Use actual envelope viewport dimensions |

### Testing Gaps

- No test covering hidden→sibling fallback behavior in `inspect_element`
- No test for `get_text_map` verifying `redactPII` is forwarded to content script
- No integration test for FIFO eviction scenario causing diff failure
- No test asserting actual viewport dimensions are used in `capture_region` viewport mode

---

## Summary

The 4 user-reported bugs are all correctly fixed. The module passes the checklist threshold (31/45, all must-haves satisfied, no category below 3). The most impactful remaining issue is **F-2** (silent element substitution in `inspect_element`) which should be addressed before relying on inspect for correctness-critical agent workflows. **F-10** (privacy params not forwarded) is the highest-priority security item.
