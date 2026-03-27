# MCP WebView Visibility — Agent Evaluation Checklist

> Purpose: evaluate whether a browser/webview MCP surface gives an agent high-quality, efficient page understanding.
>
> Scope note: this checklist is implementation-aware and maps expectations to the current Accordo tool surface so reviewers can score consistently.

---

## 0) Current-state mapping (for reviewer orientation)

Use this status legend during review:

- ✅ Implemented
- 🟡 Partially implemented
- ❌ Missing

| Capability | Primary tools today | Status |
|---|---|---|
| Structured page map | `accordo_browser_get_page_map` | ✅ |
| Deep element inspection | `accordo_browser_inspect_element` | ✅ |
| DOM excerpt retrieval | `accordo_browser_get_dom_excerpt` | ✅ |
| Region screenshot | `accordo_browser_capture_region` | ✅ |
| Viewport/full-page screenshot | `chrome-devtools_take_screenshot` | ✅ |
| A11y snapshot | `chrome-devtools_take_snapshot` | 🟡 |
| Wait primitives | `chrome-devtools_wait_for` | 🟡 |
| Change deltas between snapshots | (none) | ❌ |
| Snapshot versioning contract | (none explicit) | ❌ |
| Privacy redaction controls | (none explicit) | ❌ |

---

## 1) What an agent needs (wish list)

An agent should be able to answer, reliably and quickly:

1. **What page is this?** (URL, title, frame context, load state)
2. **What text is actually visible to users?** (not just raw HTML)
3. **What is the semantic structure?** (headings, landmarks, forms, tables, lists)
4. **Where are elements located?** (x/y/width/height, relative layout)
5. **What can be interacted with?** (clickable, editable, disabled, hidden)
6. **What changed since last step?** (DOM/text/layout deltas)
7. **What does it look like visually?** (viewport/full-page and element screenshots)
8. **Can I inspect deeply only when needed?** (progressive detail)

---

## 2) Required service surface (MCP tool capabilities)

Use this as a reviewer checklist.

For each item, fill:
- **Status**: ✅ / 🟡 / ❌
- **Tool(s)** used today
- **Evidence**: command + short result summary

### A. Session & page context

- [ ] **Get page metadata**: URL/title + viewport and context data.
  - Suggested tools: `chrome-devtools_list_pages`, `chrome-devtools_take_snapshot`, `accordo_browser_get_page_map`
- [ ] **Get load/readiness state**: `loading | interactive | complete` + wait support.
  - Suggested tools: `chrome-devtools_navigate_page`, `chrome-devtools_wait_for`
- [ ] **Handle multiple tabs/pages** with stable page IDs.
  - Suggested tools: `chrome-devtools_list_pages`, `chrome-devtools_select_page`
- [ ] **Handle iframes** with explicit frame relationships (if required by product scope).
  - Suggested tools: validate via snapshot/inspection evidence

### B. Text extraction quality

- [ ] **Visible text extraction** (what user can see), not only DOM text.
- [ ] **Per-text-node source mapping** to element IDs and bounding boxes.
- [ ] **Whitespace-normalized + raw modes**.
- [ ] **Reading order output** (top-to-bottom, left-to-right with bidi awareness).
- [ ] **Hidden/offscreen flags** so the agent can filter correctly.

### C. Structural and semantic understanding

- [ ] **DOM snapshot API** with stable node IDs.
- [ ] **Accessibility tree snapshot** (roles, names, states, descriptions).
- [ ] **Landmark extraction** (header/nav/main/aside/footer).
- [ ] **Document outline extraction** (H1..H6 hierarchy).
- [ ] **Form model extraction** (labels, controls, required, validation, current values).

### D. Spatial/layout intelligence

- [ ] **Bounding boxes** for relevant nodes in CSS pixels.
- [ ] **Relative geometry helpers** (`leftOf`, `above`, `contains`, overlap, distance).
- [ ] **Z-order / stacking visibility hints** (occluded vs visible).
- [ ] **Viewport intersection ratios** (fully visible, partially visible, offscreen).
- [ ] **Container/section grouping** (cards, panels, modals) for context.

### E. Visual capture for multimodal agents

- [ ] **Viewport screenshot** capture.
  - Suggested tool: `chrome-devtools_take_screenshot`
- [ ] **Full-page screenshot** capture.
  - Suggested tool: `chrome-devtools_take_screenshot` with `fullPage=true`
- [ ] **Element/region screenshot** by node ID or box.
  - Suggested tool: `accordo_browser_capture_region`
- [ ] **Configurable image quality & format** (PNG/JPEG/WebP).
- [ ] **Visual-to-structure linkage** (screenshot references node/page snapshot IDs).

### F. Interaction discoverability

- [ ] **Interactive element inventory** (buttons, links, inputs, custom controls).
- [ ] **Actionability state** (enabled, disabled, readonly, hidden, obstructed).
- [ ] **Selector + semantic handles** (CSS/XPath + role/name/text alternatives).
- [ ] **Eventability hints** (click target area size, potential interception).

### G. Change tracking / efficiency

- [ ] **Snapshot versioning** with monotonic IDs.
- [ ] **Delta APIs** for text/DOM/layout changes since prior snapshot.
- [ ] **Incremental retrieval** (paging/chunking large pages).
- [ ] **Server-side filtering** (by role, visibility, text match, region).
- [ ] **Deterministic ordering** for stable agent reasoning.

### H. Robustness and operability

- [ ] **Wait primitives** (`waitForText`, `waitForSelector`, `waitForStableLayout`).
- [ ] **Timeout controls** and clear timeout error semantics.
- [ ] **Retries/backoff hints** for transient render states.
- [ ] **Error taxonomy** (navigation error, detached node, stale snapshot, blocked resource).

**Minimum error contract expected:**
- `element-not-found`
- `element-off-screen`
- `no-target`
- `image-too-large`
- `capture-failed`

### I. Security/privacy controls

- [ ] **Redaction hooks** for PII/secrets in text and screenshots.
- [ ] **Origin allow/deny policies**.
- [ ] **Audit trail** of tool calls and artifacts generated.
- [ ] **Data-retention controls** for snapshots/images.

---

## 3) Recommended response organization (how data should be shaped)

Implementation note:
- For existing tools, treat these as **target schema conventions**.
- Backward-compatible rollout is preferred: add fields without breaking existing fields.

### 3.1 Canonical object model

Every data-producing call should include:

- `pageId`
- `frameId` (if applicable)
- `snapshotId`
- `capturedAt` (ISO timestamp)
- `viewport` (`width`, `height`, `scrollX`, `scrollY`, `dpr`)
- `source` (`dom`, `a11y`, `visual`, `layout`, `network`)

### 3.2 Node identity rules

- Stable `nodeId` within snapshot.
- Optional `persistentId` across snapshots (explicitly experimental until contract is defined).
- Parent/children references and optional sibling order.

`persistentId` is considered valid only if it remains stable across minor DOM updates for at least 90% of unchanged elements in validation tests.

### 3.3 Multi-layer output (progressive detail)

1. **Summary layer**: page outline, main sections, key actions.
2. **Focused layer**: only relevant subtree/region.
3. **Deep layer**: full DOM/a11y/layout details.

### 3.4 Text model shape

For each text segment:

- `textRaw`, `textNormalized`
- `nodeId`, `role`, `accessibleName`
- `bbox`
- `visibility` (`visible`, `hidden`, `occluded`, `offscreen`)
- `readingOrderIndex`

### 3.5 Layout model shape

For each layout node:

- `bbox` (x, y, w, h)
- `zIndex`/stacking hint
- `display`, `position`, overflow clipping hint
- containment relations (section/card/modal)

---

## 4) Minimal MCP call set (baseline)

These are the minimum calls expected for a practical agent experience.

### 4.1 Baseline using current tool names

1. `chrome-devtools_list_pages`
2. `chrome-devtools_select_page`
3. `accordo_browser_get_page_map`
4. `accordo_browser_inspect_element`
5. `accordo_browser_get_dom_excerpt`
6. `chrome-devtools_take_snapshot` (a11y-oriented text snapshot)
7. `chrome-devtools_take_screenshot` (viewport/full-page)
8. `accordo_browser_capture_region`
9. `chrome-devtools_wait_for`

### 4.2 Target unified interface (optional future abstraction)

1. `page.getMetadata(pageId)`
2. `page.getTextMap(pageId, { visibleOnly: true })`
3. `page.getDomSnapshot(pageId, { depth, includeStyles? })`
4. `page.getA11ySnapshot(pageId)`
5. `page.getLayoutMap(pageId, { includeOcclusion: true })`
6. `page.listInteractives(pageId, { actionableOnly: true })`
7. `page.captureScreenshot(pageId, { viewport|fullPage })`
8. `page.captureRegion(pageId, { nodeId|bbox })`
9. `page.diffSnapshots(pageId, { fromSnapshotId, toSnapshotId })`
10. `page.waitFor(pageId, { text|selector|state })`

Review rule: score against **4.1** for current implementation review. Use **4.2** only for roadmap planning.

---

## 5) Efficiency expectations (review criteria)

- [ ] Can retrieve **summary first**, details later.
- [ ] Large pages don’t require transferring entire DOM for simple questions.
- [ ] Agent can request “only visible text in viewport” quickly.
- [ ] Agent can request “only changed elements since last check”.
- [ ] Tool outputs are compact and reference-linked (no duplicate blobs).

Measurable targets (recommended):
- Page map request returns first useful response in ≤ 2.5s on medium pages (~1k nodes).
- Region capture returns in ≤ 3.0s at default quality.
- Repeated calls with filtering reduce payload by ≥ 40% vs full deep snapshot.

---

## 6) Quality bar (pass/fail rubric)

### Must-have to pass

- [ ] Visible text extraction with element mapping coverage ≥ 95% on benchmark pages
- [ ] Semantic structure available via DOM + accessibility surfaces
- [ ] Spatial/layout context includes element bboxes for inspected targets
- [ ] Screenshot capture supports viewport + full-page + region capture
- [ ] Stable `nodeId` within snapshot

### Strongly recommended

- [ ] Snapshot versioning and delta/change APIs
- [ ] Occlusion and visibility quality
- [ ] Progressive detail retrieval
- [ ] Privacy/redaction controls

### Nice-to-have

- [ ] Saliency ranking (likely relevant regions)
- [ ] Heuristic content blocks (article, comments, sidebar, ads)
- [ ] Built-in “agent briefing” endpoint summarizing page state

---

## 7) Reviewer scorecard template

Use this compact template during implementation review.

| Category | Score (0-5) | Notes |
|---|---:|---|
| Session & Context |  |  |
| Text Extraction |  |  |
| Semantic Structure |  |  |
| Layout/Geometry |  |  |
| Visual Capture |  |  |
| Interaction Model |  |  |
| Deltas/Efficiency |  |  |
| Robustness |  |  |
| Security/Privacy |  |  |

**Scoring guide:**
- 0 = missing
- 1 = minimal stub / unusable
- 2 = partial, major gaps
- 3 = usable with known limitations
- 4 = strong, minor gaps
- 5 = production-ready

**Passing threshold (recommended):**
- No category below 2
- All Must-have items in §6 are checked
- Total score ≥ 30 / 45

### 7.1 Evidence table (required)

| Item ID | Status | Tool calls used | Evidence summary |
|---|---|---|---|
| A1 |  |  |  |
| A2 |  |  |  |
| ... |  |  |  |

---

## 8) Final acceptance question

> “Can the agent understand **what the user sees**, **where it is**, **what it means**, and **what changed**, without over-fetching data?”

If the answer is consistently yes, the MCP webview visibility layer is likely fit for production agent workflows.
