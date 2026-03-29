# Browser 2.0 — Requirements Specification

**Package:** `packages/browser`, `packages/browser-extension`, `packages/browser-core` (new)  
**Type:** Incremental upgrade to browser page-understanding and comment-anchor infrastructure  
**Version:** 0.2.0  
**Date:** 2026-03-27  
**Architecture:** [`docs/10-architecture/browser2.0-architecture.md`](../10-architecture/browser2.0-architecture.md)  
**Evaluation framework:** [`docs/30-development/mcp-webview-agent-evaluation-checklist.md`](../30-development/mcp-webview-agent-evaluation-checklist.md)  
**Supersedes:** Nothing — extends [`docs/20-requirements/requirements-browser-extension.md`](requirements-browser-extension.md)

---

## 1. Purpose

Close the visibility and efficiency gaps identified by the MCP WebView Agent Evaluation Checklist. Enable agents to understand what the user sees, where it is, what it means, and what changed — with minimal token cost and strong privacy controls.

Browser 2.0 requirements are organized into three delivery phases (P1/P2/P3). Each phase is independently shippable and backward-compatible with existing tool consumers.

---

## 2. Requirement ID Convention

All requirement IDs follow the pattern `B2-{category}-{number}`:

| Category | Prefix | Scope |
|---|---|---|
| Snapshot versioning | B2-SV | Snapshot IDs, versioning, storage |
| Diff engine | B2-DE | Change tracking between snapshots |
| Server-side filtering | B2-FI | Filter parameters, payload reduction |
| Visibility depth | B2-VD | Shadow DOM, iframes, occlusion, virtualized lists |
| Wait primitives | B2-WA | `browser_wait_for` tool |
| Privacy/security | B2-PS | Redaction, origin policy, audit |
| Comment anchor v2 | B2-CA | Snapshot-linked anchors, confidence scoring |
| Compatibility | B2-CO | Backward compatibility, migration |
| Error handling | B2-ER | New error codes, error semantics |
| Performance | B2-PF | Latency, token budget, resource limits |
| Testability | B2-TE | Testability requirements for each capability |
| Text extraction | B2-TX | `browser_get_text_map` tool — visible text, reading order, visibility |

---

## 3. Functional Requirements

### 3.1 Snapshot Versioning (P1)

**B2-SV-001: Snapshot ID in all data-producing responses**  
All data-producing browser tools (`browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt`, `browser_capture_region`) MUST include a `snapshotId` field in their response.  
**Acceptance:** Every tool response contains `snapshotId` as a non-empty string matching the format `{pageId}:{version}`.

**B2-SV-002: Monotonically increasing snapshot version**  
The `version` component of `snapshotId` MUST be a monotonically increasing integer within a page session (reset on navigation).  
**Acceptance:** For any two consecutive data-producing calls on the same page without navigation, `version(snapshotId_2) > version(snapshotId_1)`.

**B2-SV-003: Canonical metadata envelope**  
All data-producing tool responses MUST include the `SnapshotEnvelope` fields: `pageId`, `frameId`, `snapshotId`, `capturedAt` (ISO 8601), `viewport` (`width`, `height`, `scrollX`, `scrollY`, `devicePixelRatio`), `source`.  
**Acceptance:** JSON schema validation of all tool responses against the `SnapshotEnvelope` type passes.

**B2-SV-004: Snapshot storage**  
The content script MUST retain the last N snapshots (configurable, default 5) per page for diff operations.  
**Acceptance:** After 7 data-producing calls on the same page, only the last 5 snapshots are retrievable; earlier ones return `snapshot-not-found`.

**B2-SV-005: Navigation resets version counter**  
On page navigation (URL change or reload), the snapshot version counter MUST reset to 0 and all stored snapshots MUST be discarded.  
**Acceptance:** After navigating to a new page, the next snapshot version is 0 or 1 (implementation may use 0-based or 1-based).

**B2-SV-006: Stable nodeId within snapshot**  
Each node in a page map snapshot MUST have a `nodeId` (integer) that is stable within that snapshot.  
**Acceptance:** Two calls to `browser_inspect_element` with the same `nodeId` from the same snapshot return the same element.

**B2-SV-007: Experimental persistentId across snapshots**  
Nodes MAY include an optional `persistentId` field that is stable across snapshots for unchanged elements.  
**Acceptance:** For elements that have not changed between two consecutive snapshots, `persistentId` matches in ≥90% of cases. Field is explicitly marked experimental.

### 3.2 Diff Engine (P1)

**B2-DE-001: Diff tool exists**  
A new MCP tool `browser_diff_snapshots` MUST be registered with `dangerLevel: "safe"` and `idempotent: true`.  
**Acceptance:** Tool appears in MCP tool registry with correct metadata.

**B2-DE-002: Diff between two snapshots**  
Given `fromSnapshotId` and `toSnapshotId`, the tool MUST return `added`, `removed`, and `changed` arrays.  
**Acceptance:** On a page where a `<div>` is added between snapshots, the `added` array contains a node with the correct `tag` and `text`.

**B2-DE-003: Diff with implicit latest**  
If `toSnapshotId` is omitted, the tool MUST capture a fresh snapshot and use it as `to`.  
**Acceptance:** Calling with only `fromSnapshotId` returns a valid diff against the current page state.

**B2-DE-004: Diff with implicit previous**  
If `fromSnapshotId` is omitted, the tool MUST use the snapshot immediately before `toSnapshotId`.  
**Acceptance:** Calling with only `toSnapshotId` returns a diff against the preceding snapshot.

**B2-DE-005: Diff summary**  
The diff result MUST include a `summary` object with `addedCount`, `removedCount`, `changedCount`, and `textDelta` (human-readable).  
**Acceptance:** Summary counts match the lengths of the `added`, `removed`, and `changed` arrays.

**B2-DE-006: Diff error for missing snapshot**  
If a requested snapshot does not exist, the tool MUST return `{ success: false, error: "snapshot-not-found" }`.  
**Acceptance:** Requesting a pruned or never-created snapshot ID returns the correct error.

**B2-DE-007: Diff error for stale snapshot**  
If a requested snapshot is from a previous navigation session, the tool MUST return `{ success: false, error: "snapshot-stale" }`.  
**Acceptance:** After navigation, requesting a pre-navigation snapshot ID returns the correct error.

### 3.3 Server-Side Filtering (P1)

**B2-FI-001: visibleOnly filter**  
`browser_get_page_map` MUST accept a `visibleOnly: boolean` parameter. When `true`, only elements whose bounding box intersects the current viewport are returned.  
**Acceptance:** On a page with 500 nodes, 200 in viewport, `visibleOnly: true` returns ≤200 nodes.

**B2-FI-002: interactiveOnly filter**  
`browser_get_page_map` MUST accept an `interactiveOnly: boolean` parameter. When `true`, only interactive elements are returned. An element is classified as interactive if it satisfies **any** of:
- Intrinsic interactive tag: `button`, `a`, `input`, `select`, `textarea`
- Explicit ARIA role from the interactive-role set (e.g. `role="button"`, `role="link"`, `role="textbox"`, etc.)
- `[contenteditable]` attribute present and not `"false"`
- Inline event-handler attribute present (e.g. `onclick="..."`, `onkeydown="..."`)
- Property-assigned `onclick` handler (i.e. `element.onclick` is a `function`)

**Platform limitation — `addEventListener` listeners (accepted, not a future TODO):**  
Listeners registered via `element.addEventListener('click', ...)` are **not detectable** in a content-script context. The browser provides no synchronous DOM API to enumerate registered listeners; `getEventListeners()` is a DevTools-only API unavailable to content scripts. This is a hard browser platform constraint, not an implementation gap. Elements whose only interactivity signal is an `addEventListener`-registered listener will be omitted by this filter. Agents that need comprehensive interactive-element detection should combine this filter with CSS-selector or ARIA-role hints.

**Acceptance:** On a page with 500 nodes, 50 interactive, `interactiveOnly: true` returns ≤50 nodes. Elements with property-assigned `onclick` handlers are included. Elements whose only handler was registered via `addEventListener` are not included (platform limitation — accepted behavior).

**B2-FI-003: roles filter**  
`browser_get_page_map` MUST accept a `roles: string[]` parameter. Only elements matching any of the specified ARIA roles are returned.  
**Acceptance:** `roles: ["heading"]` returns only elements with `role="heading"` or `<h1>`–`<h6>`.

**B2-FI-004: textMatch filter**  
`browser_get_page_map` MUST accept a `textMatch: string` parameter. Only elements containing the substring (case-insensitive) in their text content are returned.  
**Acceptance:** `textMatch: "login"` returns elements whose text content contains "login", "Login", "LOGIN", etc.

**B2-FI-005: selector filter**  
`browser_get_page_map` MUST accept a `selector: string` parameter. Only elements matching the CSS selector are returned.  
**Acceptance:** `selector: ".nav-item"` returns only elements matching that class.

**B2-FI-006: regionFilter**  
`browser_get_page_map` MUST accept a `regionFilter: { x, y, width, height }` parameter. Only elements whose bounding box intersects the specified region (in viewport coordinates) are returned.  
**Acceptance:** Elements outside the region are excluded.

**B2-FI-007: Filter combination**  
Multiple filters MUST be composable (AND semantics). `visibleOnly: true, interactiveOnly: true` returns only elements that are both visible and interactive.  
**Acceptance:** Combining two filters produces a result set that is the intersection of each filter applied individually.

**B2-FI-008: Payload reduction target**  
Filtered requests MUST reduce payload by ≥40% compared to unfiltered full-depth requests on a medium-complexity page (~1,000 nodes).  
**Acceptance:** Measured on 3 benchmark pages, average reduction ≥40%.

### 3.4 Shadow DOM (P2)

**B2-VD-001: Open shadow root traversal**  
When `piercesShadow: true`, the page map collector MUST traverse `open` shadow roots and include shadow DOM nodes in the response.  
**Acceptance:** On a page with a Web Component using open shadow DOM, shadow children appear in the page map with `inShadowRoot: true`.

**B2-VD-002: Shadow host identification**  
Shadow DOM nodes MUST include `shadowHostId` referencing the host element's `nodeId`.  
**Acceptance:** `shadowHostId` resolves to the correct host element.

**B2-VD-003: Closed shadow root reporting**  
When encountering a `closed` shadow root, the collector MUST report `shadowRoot: 'closed'` on the host node without attempting traversal.  
**Acceptance:** No error is thrown; host node is annotated correctly.

**B2-VD-004: piercesShadow default**  
`piercesShadow` MUST default to `false` in P1 and `true` in P2+.  
**Acceptance:** Existing tests pass without modification when the default is `false`.

### 3.5 Iframe Traversal (P2)

**B2-VD-005: Same-origin iframe traversal**  
When `traverseFrames: true`, content scripts MUST run in same-origin iframes (via `all_frames: true` manifest config). Child frame page maps are included in the parent response under an `iframes` array.  
**Acceptance:** On a page with a same-origin iframe containing a form, the form elements appear in the response with the correct `frameId`.

**B2-VD-006: Iframe metadata**  
Each iframe in the `iframes` array MUST include: `frameId`, `src`, `bounds` (bounding box in parent coordinates), `sameOrigin` (boolean).  
**Acceptance:** All fields are present and `sameOrigin` correctly reflects the origin comparison.

**B2-VD-007: Cross-origin iframe opacity**  
Cross-origin iframes MUST NOT be traversed. This is a **hard browser platform security boundary** (Same-Origin Policy) — not a design constraint that may be relaxed in future phases. They are listed in the `iframes` array with `sameOrigin: false` and no child nodes. CDP-level access via `chrome-devtools_*` tools is a separate capability path.  
**Acceptance:** No error is thrown; iframe is reported as opaque.

**B2-VD-008: Cross-origin iframe error code**  
If an agent explicitly requests traversal of a cross-origin iframe by `frameId`, the tool MUST return `{ success: false, error: "iframe-cross-origin" }`.  
**Acceptance:** Error code matches.

**B2-VD-009: traverseFrames default**  
`traverseFrames` MUST default to `false` in P2.  
**Acceptance:** Existing tests pass without modification.

### 3.6 Occlusion Detection (P2)

**B2-VD-010: Center-point occlusion check**  
When `includeOcclusion: true`, each element in the page map MUST include a `visibility` field with `state`, `viewportIntersectionRatio`, and optionally `isOccluded` and `occludedBy`.  
**Acceptance:** An element behind a modal overlay has `state: 'occluded'` and `occludedBy` set to the overlay's `nodeId`.

**B2-VD-011: Occlusion element cap**  
Occlusion checks MUST be limited to `maxOcclusionChecks` elements (default 200). Elements beyond the cap are not checked (no `isOccluded` field).  
**Acceptance:** On a page with 500 elements and `maxOcclusionChecks: 200`, exactly 200 elements have `isOccluded` populated.

**B2-VD-012: Occlusion sampling modes**  
The tool MUST support `occlusionSampling: 'center'` (default) and `occlusionSampling: 'corners'` (4-point check).  
**Acceptance:** With `'corners'`, an element partially occluded at all 4 corners is correctly reported as occluded even if center is visible.

**B2-VD-013: Skip hidden/offscreen for occlusion**  
Elements already determined to be `hidden` or `offscreen` MUST be skipped for occlusion checks (optimization).  
**Acceptance:** Hidden elements do not consume occlusion check budget.

### 3.7 Virtualized List Detection (P2)

**B2-VD-014: Virtualized container hint**  
Containers with `overflow: auto|scroll` that have many uniform-height same-tag children SHOULD be annotated with `virtualizedHint: true`.  
**Acceptance:** A React Virtualized list container is annotated with `virtualizedHint: true`.

**B2-VD-015: Rendered range reporting**  
Virtualized containers MUST report `renderedRange: { start, end }` and estimated `totalItemCount`.  
**Acceptance:** Values are plausible (totalItemCount ≥ number of rendered children).

### 3.8 Wait Primitives (P3)

**B2-WA-001: Wait for text**  
`browser_wait_for` MUST support waiting for any of a list of text strings to appear on the page.  
**Acceptance:** After a delayed DOM insertion of text "Success", `waitForText(["Success"])` resolves with `met: true`.

**B2-WA-002: Wait for selector**  
`browser_wait_for` MUST support waiting for a CSS selector to match at least one element.  
**Acceptance:** After a delayed insertion of `<div class="result">`, `waitForSelector(".result")` resolves with `met: true`.

**B2-WA-003: Wait for stable layout**  
`browser_wait_for` MUST support waiting until no layout changes occur for a specified duration (`stableLayoutMs`).  
**Acceptance:** On a page with animated layout changes, wait resolves after animation completes.

**B2-WA-004: Configurable timeout**  
`browser_wait_for` MUST accept a `timeout` parameter (ms). Default: 10,000. Max: 30,000.  
**Acceptance:** A wait that exceeds timeout returns `{ met: false, error: "timeout" }`.

**B2-WA-005: Timeout error semantics**  
When timeout is reached, the response MUST include `error: "timeout"` and `elapsedMs` equal to the timeout value.  
**Acceptance:** Error code and elapsed time are correct.

**B2-WA-006: Navigation interrupt**  
If the page navigates during a wait, the tool MUST return `{ met: false, error: "navigation-interrupted" }`.  
**Acceptance:** Navigating during an active wait returns the correct error within 1s.

**B2-WA-007: Page close interrupt**  
If the tab is closed during a wait, the tool MUST return `{ met: false, error: "page-closed" }`.  
**Acceptance:** Closing the tab during an active wait returns the correct error.

### 3.9 Privacy and Security (P3)

**B2-PS-001: Origin allow list**  
The system MUST support an `allowList` of origins. When non-empty, only pages from listed origins can be inspected.  
**Acceptance:** A request for a page from an unlisted origin returns `{ success: false, error: "origin-blocked" }`.

**B2-PS-002: Origin block list**  
The system MUST support a `blockList` of origins. Block list takes precedence over allow list.  
**Acceptance:** A request for a blocked origin returns `{ success: false, error: "origin-blocked" }` even if the origin is also in the allow list.

**B2-PS-003: Default origin policy**  
When both lists are empty, the `defaultAction` determines behavior: `'allow'` (default) permits all origins; `'deny'` blocks all.  
**Acceptance:** With `defaultAction: 'deny'` and empty lists, all requests are blocked.

**B2-PS-004: PII redaction in text outputs**  
When a `RedactionPolicy` with `redactPatterns` is configured, matching text MUST be replaced with the specified replacement string (default: `"[REDACTED]"`) in all text-producing tool outputs.  
**Acceptance:** An email address on the page is replaced with `[REDACTED]` in page map text content.

**B2-PS-005: Redaction before data leaves core**  
Redaction MUST be applied in `@accordo/browser-core` before data reaches the adapter/transport layer.  
**Acceptance:** Unit test confirms redacted data is returned from core functions regardless of adapter.

**B2-PS-006: Audit trail logging**  
Every tool invocation MUST be logged to the `AuditSink` with: `timestamp`, `toolName`, `pageId`, `origin`, `action` (allowed/blocked), `redacted` (boolean).  
**Acceptance:** After 5 tool invocations, 5 audit entries exist with correct metadata.

**B2-PS-007: Screenshot redaction (deferred)**  
The `RedactionPolicy` interface MUST include a `redactScreenshots: boolean` field. Implementation is NOT required until OCR integration is available. The field MUST be ignored (no error) if set to `true` without OCR.  
**Acceptance:** Setting `redactScreenshots: true` does not cause an error; screenshots are returned un-redacted with a warning in the response.

### 3.10 Comment Anchor v2 (P1+)

> **Upstream compatibility:** The base browser anchor schema is defined in `requirements-comments.md` §3.5 as `{ kind: "browser"; anchorKey?: string }`. The B2-CA fields below (`snapshotId`, `confidence`, `resolvedTier`, `snapshotDrift`) are **additive optional extensions** — they do not modify or replace any existing fields. Consumers that only understand the base schema will ignore the new fields safely.

**B2-CA-001: Snapshot-linked comment anchors**  
Comments created via `comment_create` with `scope.modality = 'browser'` SHOULD include `snapshotId` in the anchor metadata.  
**Acceptance:** Created comment's anchor data includes `snapshotId` field.

**B2-CA-002: Anchor confidence scoring**  
Anchor resolution MUST return a `confidence` field: `'high'` (tier 1–2), `'medium'` (tier 3–4), `'low'` (tier 5–6), `'none'` (failed).  
**Acceptance:** An anchor resolved via `id` returns `confidence: 'high'`; via `viewport-pct` returns `confidence: 'low'`.

**B2-CA-003: Snapshot drift detection**  
When resolving an anchor, if the current `snapshotId` version is >10 versions away from the creation snapshot, the resolution MUST include `snapshotDrift: true`.  
**Acceptance:** A comment created at snapshot v5, resolved at snapshot v20, has `snapshotDrift: true`.

**B2-CA-004: Resolution tier reporting**  
Anchor resolution MUST include `resolvedTier` indicating which tier of the 6-tier strategy resolved the anchor.  
**Acceptance:** Field is present and matches the actual resolution path.

### 3.11 Backward Compatibility (All Phases)

**B2-CO-001: Existing tool names preserved**  
All existing MCP tool names (`browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt`, `browser_capture_region`) MUST continue to work with their current input signatures.  
**Acceptance:** Existing integration tests pass without modification after Browser 2.0 changes.

**B2-CO-002: Additive schema changes only**  
Response schemas MUST only add new fields. No existing fields are removed, renamed, or have their types changed.  
**Acceptance:** A diff of the response TypeScript types shows only additions.

**B2-CO-003: New tool registration**  
New tools (`browser_diff_snapshots`, `browser_wait_for`) MUST be registered as separate MCP tools with their own names.  
**Acceptance:** New tools appear in the MCP registry alongside existing tools.

**B2-CO-004: Error code preservation**  
All existing error codes MUST continue to be returned in the same situations as before.  
**Acceptance:** Error handling tests from the existing suite pass unchanged.

### 3.12 Error Handling (All Phases)

**B2-ER-001: snapshot-not-found error**  
Returned when a requested `snapshotId` does not exist or has been pruned.  
**Acceptance:** Requesting a non-existent snapshot returns this error with `success: false`.

**B2-ER-002: snapshot-stale error**  
Returned when a requested snapshot is from a previous navigation session.  
**Acceptance:** After navigation, pre-navigation snapshot requests return this error.

**B2-ER-003: iframe-cross-origin error**  
Returned when explicitly requesting traversal of a cross-origin iframe.  
**Acceptance:** Error includes the iframe's origin in the error message.

**B2-ER-004: shadow-root-closed error**  
Returned when explicitly requesting traversal into a closed shadow root.  
**Acceptance:** Error is returned without crash; host element data is still available.

**B2-ER-005: navigation-interrupted error**  
Returned when a wait operation is interrupted by page navigation.  
**Acceptance:** Error is returned within 1s of navigation event.

**B2-ER-006: page-closed error**  
Returned when a wait operation is interrupted by tab closure.  
**Acceptance:** Error is returned within 1s of tab close event.

**B2-ER-007: origin-blocked error**  
Returned when a request targets an origin blocked by the privacy policy.  
**Acceptance:** Error is returned before any DOM access occurs.

**B2-ER-008: redaction-failed error**  
Returned when the redaction engine encounters an error. Data is NOT returned (fail-closed).  
**Acceptance:** Malformed regex in redaction policy causes this error, not a crash.

### 3.13 Performance (All Phases)

**B2-PF-001: Page map latency**  
`browser_get_page_map` MUST return within 2.5s on a medium-complexity page (~1,000 nodes).  
**Acceptance:** Measured on 3 benchmark pages, P95 latency ≤2.5s.

**B2-PF-002: Diff computation latency**  
`browser_diff_snapshots` diff engine computation (pure diff in the service worker) MUST complete within 1.0s. The MCP tool-level relay round-trip timeout (covering WebSocket transport, serialization, and diff computation) is 5.0s.  
**Acceptance:** Measured with 5-snapshot history on a medium page, P95 diff computation ≤1.0s; P95 tool-level round-trip ≤5.0s.

**B2-PF-003: Occlusion check latency**  
Occlusion detection for 200 elements MUST complete within 500ms.  
**Acceptance:** Measured on 3 benchmark pages, P95 ≤500ms.

**B2-PF-004: Shadow DOM traversal overhead**  
Shadow DOM traversal MUST NOT add more than 30% overhead compared to non-shadow traversal.  
**Acceptance:** Page map time with `piercesShadow: true` vs `false` differs by ≤30%.

**B2-PF-005: Snapshot memory limit**  
In-memory snapshot storage MUST NOT exceed 10 MB per page (5 snapshots × ~2 MB each).  
**Acceptance:** Memory usage measured after 10 snapshots (with pruning to 5) stays ≤10 MB.

**B2-PF-006: Token budget compliance**  
Filtered page map responses MUST produce ≤400 tokens on average for common filter combinations.  
**Acceptance:** Measured with `visibleOnly: true, interactiveOnly: true` on benchmark pages.

### 3.14 Testability (All Phases)

**B2-TE-001: Unit testable core**  
`@accordo/browser-core` MUST be testable with mock `DomProvider`, `ScreenshotProvider`, and `SnapshotStore` implementations — no browser environment required.  
**Acceptance:** Core tests run in Node.js (vitest) without Chrome or VS Code.

**B2-TE-002: Benchmark page suite**  
A set of at least 3 static HTML benchmark pages MUST be maintained as test fixtures covering: (a) large page with 1,000+ nodes, (b) page with shadow DOM components, (c) page with same-origin iframe.  
**Acceptance:** Benchmark pages exist in the test fixture directory and are used by performance tests.

**B2-TE-003: Snapshot diffing test coverage**  
Diff engine MUST have test cases for: add, remove, change text, change attribute, change visibility, no change.  
**Acceptance:** ≥6 diff scenario tests exist and pass.

**B2-TE-004: Privacy test coverage**  
Redaction and origin policy MUST have test cases for: allow, block, redact email, redact phone, redact custom pattern, empty policy, conflicting allow/block.  
**Acceptance:** ≥7 privacy scenario tests exist and pass.

**B2-TE-005: Backward compatibility test suite**  
A dedicated test suite MUST verify that all existing tool response shapes are preserved after Browser 2.0 changes.  
**Acceptance:** Test suite runs against both pre- and post-upgrade response shapes.

### 3.15 Text Extraction (M112-TEXT)

> **Evaluation category:** B (Text Extraction Quality) — see [`docs/30-development/mcp-webview-agent-evaluation-checklist.md`](../30-development/mcp-webview-agent-evaluation-checklist.md) §B and §3.4.

**B2-TX-001: Visible text extraction**  
A new MCP tool `browser_get_text_map` MUST return the visible text content of the current page — the text the user can see — as an ordered array of `TextSegment` objects. Each segment corresponds to a contiguous run of text within a single DOM element.  
**Acceptance:** On a page with a heading "Hello" and a paragraph "World", the response contains at least two segments with `textNormalized` values `"Hello"` and `"World"`.

**B2-TX-002: Per-segment source mapping**  
Each `TextSegment` MUST include `nodeId` (integer, per-call scoped — assigned by the text-map traversal's own counter, reset to 0 on each invocation; not shared with page-map ref indices) and `bbox` (bounding box in viewport coordinates: `{ x, y, width, height }`), enabling agents to correlate text with specific elements and their positions on the page. Cross-tool element correlation (e.g. from text-map to `browser_inspect_element`) uses `bbox` intersection or CSS-selector re-lookup, not `nodeId`.  
**Acceptance:** Every segment's `nodeId` is a stable, non-negative integer unique within the response. Every segment's `bbox` has non-negative `width` and `height`. Two calls to `browser_get_text_map` on an unchanged DOM produce the same `nodeId` for the same text node.

**B2-TX-003: Whitespace-normalized and raw text modes**  
Each `TextSegment` MUST include both `textRaw` (original whitespace, line breaks, and Unicode preserved) and `textNormalized` (collapsed whitespace: runs of whitespace → single space, leading/trailing trimmed). Agents can choose the appropriate mode for their task (exact match vs. semantic comparison).  
**Acceptance:** For text content `"  Hello   World  \n"`, `textRaw` preserves original whitespace; `textNormalized` equals `"Hello World"`.

**B2-TX-004: Reading order**  
Segments MUST be assigned a `readingOrderIndex` (0-based integer) reflecting visual reading order: top-to-bottom, left-to-right within the same vertical band. Two segments are in the same vertical band when their vertical midpoints are within 5px. Within a band, segments sort by horizontal position (ascending `bbox.x`). For RTL content, the ordering within a band is reversed (descending `bbox.x`).  
**Acceptance:** On an LTR page with a two-column layout (sidebar left, main right), sidebar headings at the same vertical position as main headings have *lower* `readingOrderIndex`. On an RTL page, the ordering within a horizontal band is reversed.

**B2-TX-005: Visibility flags**  
Each `TextSegment` MUST include a `visibility` field with value `"visible"`, `"hidden"`, or `"offscreen"`. Definitions:
- `"visible"`: element is not hidden (via CSS) and its bounding box intersects the current viewport.
- `"hidden"`: element has `display: none`, `visibility: hidden/collapse`, `opacity: 0`, or the `hidden` attribute.
- `"offscreen"`: element is not hidden but its bounding box does not intersect the viewport.
Agents can filter segments by visibility to focus on what the user can currently see.  
**Acceptance:** An element with `display: none` has `visibility: "hidden"`. An element scrolled below the viewport has `visibility: "offscreen"`. An element in the visible viewport has `visibility: "visible"`.

**B2-TX-006: Semantic context per segment**  
Each `TextSegment` MUST include `role` (ARIA role or implicit HTML role if available, e.g. `"heading"` for `<h1>`) and `accessibleName` (from `aria-label`, `alt`, `title`, or derived — same logic as `getAccessibleName()` in `page-map-traversal.ts`). Both fields are optional strings (omitted when no role or accessible name applies).  
**Acceptance:** An `<h2 aria-label="Section Title">Foo</h2>` produces a segment with `role: "heading"` and `accessibleName: "Section Title"`.

**B2-TX-007: Snapshot envelope compliance**  
The `browser_get_text_map` response MUST include the full `SnapshotEnvelope` (B2-SV-003: `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `source`). The snapshot is retained by the `SnapshotRetentionStore` for future diff operations.  
**Acceptance:** Response passes `hasSnapshotEnvelope()` validation. Snapshot is retrievable from the retention store.

**B2-TX-008: Maximum segment limit**  
The tool MUST accept an optional `maxSegments` parameter (default: 500, max: 2000) to cap the number of returned segments. When truncated, the response includes `truncated: true`.  
**Acceptance:** On a page with 1000 text nodes, `maxSegments: 100` returns exactly 100 segments with `truncated: true`.

**B2-TX-009: Tool registration**  
`browser_get_text_map` MUST be registered as a separate MCP tool with `dangerLevel: "safe"` and `idempotent: true`. It MUST NOT modify the existing `browser_get_page_map` tool interface.  
**Acceptance:** Tool appears in the MCP registry alongside existing tools. Existing tools continue to work unchanged.

**B2-TX-010: Backward compatibility**  
The `browser_get_text_map` tool is purely additive — it MUST NOT change the behavior or response schema of any existing tool. The `BrowserRelayAction` union type gains `"get_text_map"` as a new member.  
**Acceptance:** All existing integration tests pass unchanged.

### 3.17 Semantic Graph (M113-SEM)

**B2-SG-001: Unified semantic graph response**  
The `browser_get_semantic_graph` tool MUST return a single `SemanticGraphResult` containing four sub-trees: `a11yTree` (accessibility tree snapshot), `landmarks` (landmark region extraction), `outline` (document heading outline H1–H6), and `forms` (form model extraction). All four sub-trees are collected in a single relay round-trip.  
**Acceptance:** Response contains all four sub-tree arrays. A single relay request produces all four.

**B2-SG-002: Accessibility tree snapshot**  
The `a11yTree` field MUST be an array of `SemanticA11yNode` objects representing the accessible hierarchy of the page. Each node includes `role` (ARIA role or implicit HTML role), `name` (computed accessible name), `level` (heading level if applicable), `nodeId` (0-based per-call scoped integer), and `children` (nested child nodes). Nodes with no accessible role are excluded.  
**Acceptance:** An `<h2 aria-label="About">` produces a node with `role: "heading"`, `name: "About"`, `level: 2`.

**B2-SG-003: Landmark extraction**  
The `landmarks` field MUST be an array of `Landmark` objects, one per ARIA landmark region on the page. Each landmark includes `role` (e.g. `"navigation"`, `"main"`, `"banner"`, `"contentinfo"`, `"complementary"`, `"search"`, `"form"`, `"region"`), `label` (from `aria-label` or `aria-labelledby`, if present), `nodeId` (per-call scoped integer matching the a11y tree node), and `tag` (the HTML tag name). Only elements with landmark roles (explicit via `role` attribute or implicit via HTML5 semantic elements) are included.  
**Acceptance:** A `<nav aria-label="Main Menu">` produces a landmark with `role: "navigation"`, `label: "Main Menu"`, `tag: "nav"`.

**B2-SG-004: Document outline**  
The `outline` field MUST be an array of `OutlineHeading` objects, one per heading element (H1–H6) in document order. Each heading includes `level` (1–6), `text` (trimmed text content), `nodeId` (per-call scoped integer), and `id` (the element's `id` attribute, if present). Only `<h1>` through `<h6>` elements are included.  
**Acceptance:** An `<h3 id="faq">FAQ</h3>` produces `{ level: 3, text: "FAQ", nodeId: <n>, id: "faq" }`.

**B2-SG-005: Form model extraction**  
The `forms` field MUST be an array of `FormModel` objects, one per `<form>` element on the page. Each form includes `formId` (the `id` attribute if present), `name` (the `name` attribute if present), `action` (the form action URL), `method` (GET/POST), `nodeId` (per-call scoped integer), and `fields` (array of `FormField`). Each `FormField` includes `tag` (input/select/textarea/button), `type` (the `type` attribute, e.g. `"text"`, `"email"`, `"submit"`), `name` (field name attribute), `label` (associated label text or `aria-label`), `required` (boolean), `value` (current value, redacted for password fields), and `nodeId`.  
**Acceptance:** A `<form id="login"><input type="email" name="user" required><input type="password" name="pass"></form>` produces a form with two fields, the password field having `value: "[REDACTED]"`.

**B2-SG-006: Node ID scope**  
All `nodeId` values across the four sub-trees MUST share a single per-call counter, starting at 0. The same DOM element appearing in multiple sub-trees (e.g. a heading that is also in the a11y tree) MUST have the same `nodeId` value. Node IDs are per-call scoped and do NOT share identity with page-map ref indices or text-map node IDs.  
**Acceptance:** A `<h2>` element that appears in both `a11yTree` and `outline` has the same `nodeId` value in both.

**B2-SG-007: Snapshot envelope compliance**  
The `browser_get_semantic_graph` response MUST include the full `SnapshotEnvelope` (B2-SV-003: `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `source`). The snapshot is retained by the `SnapshotRetentionStore` for future diff operations.  
**Acceptance:** Response passes `hasSnapshotEnvelope()` validation. Snapshot is retrievable from the retention store.

**B2-SG-008: Maximum depth limit**  
The tool MUST accept an optional `maxDepth` parameter (default: 8, max: 16) that limits the nesting depth of the `a11yTree`. Nodes beyond the depth limit are excluded. The `landmarks`, `outline`, and `forms` sub-trees are not affected by depth limiting.  
**Acceptance:** On a page with 20-level nesting, `maxDepth: 4` produces an a11y tree with no node deeper than 4 levels.

**B2-SG-009: Visibility filtering**  
The tool MUST accept an optional `visibleOnly` parameter (default: `true`). When `true`, hidden elements (display:none, visibility:hidden/collapse, opacity:0, [hidden]) are excluded from all four sub-trees. When `false`, all elements are included regardless of visibility.  
**Acceptance:** With `visibleOnly: true`, an `<h2 style="display:none">` does not appear in the outline.

**B2-SG-010: Performance budget**  
Semantic graph collection MUST complete within 15 seconds on a complex page (~5,000 nodes). The tool-level relay timeout is 15 seconds.  
**Acceptance:** Collection on a test page with 5,000 nodes completes within 15 seconds.

**B2-SG-011: Tool registration**  
`browser_get_semantic_graph` MUST be registered as a separate MCP tool with `dangerLevel: "safe"` and `idempotent: true`. It MUST NOT modify any existing tool interface.  
**Acceptance:** Tool appears in the MCP registry alongside existing tools. Existing tools continue to work unchanged.

**B2-SG-012: Backward compatibility**  
The `browser_get_semantic_graph` tool is purely additive — it MUST NOT change the behavior or response schema of any existing tool. The `BrowserRelayAction` union type gains `"get_semantic_graph"` as a new member.  
**Acceptance:** All existing tests pass unchanged.

**B2-SG-013: Password redaction**  
Password field values MUST be replaced with `"[REDACTED]"` in the form model. No actual password content is ever returned to the agent.  
**Acceptance:** An `<input type="password" value="secret123">` produces `value: "[REDACTED]"`.

**B2-SG-014: Implicit ARIA role mapping**  
The collector MUST map HTML5 semantic elements to their implicit ARIA roles per the WAI-ARIA spec: `<nav>` → `"navigation"`, `<main>` → `"main"`, `<header>` → `"banner"`, `<footer>` → `"contentinfo"`, `<aside>` → `"complementary"`, `<section>` → `"region"` (when labelled), `<form>` → `"form"`, `<search>` → `"search"`.  
**Acceptance:** A `<main>` element with no explicit role attribute produces `role: "main"`.

**B2-SG-015: Empty sub-trees**  
When a sub-tree has no elements (e.g. a page with no forms), the corresponding array MUST be empty (`[]`), not absent.  
**Acceptance:** Response always contains all four sub-tree fields, even when empty.

### 3.16 Evaluation Harness (M111-EVAL)

**B2-EV-001: Scorecard structure**  
The evaluation harness MUST define a scorecard with 9 categories (A–I) matching the evaluation checklist (`docs/30-development/mcp-webview-agent-evaluation-checklist.md` §7). Each category score is an integer 0–5.
**Acceptance:** A `Scorecard` type has exactly 9 required category fields, each constrained to 0–5.

**B2-EV-002: Passing threshold**  
The harness MUST implement the passing criteria: total score ≥ 30/45 AND no individual category score below 2.  
**Acceptance:** `isPassingScore(scorecard)` returns `false` for a scorecard totalling 29 or one with any category at 1.

**B2-EV-003: Category score function**  
Each category (A–I) MUST have a dedicated scoring function that accepts evidence items and returns a score 0–5 with a rationale string.  
**Acceptance:** 9 scoring functions exist, each returning `{ score: number; rationale: string }`.

**B2-EV-004: Evidence item model**  
The harness MUST define an `EvidenceItem` type that captures: `itemId` (matching checklist §7.1 item IDs like `"A1"`, `"B2"` — typed as `ChecklistItemId`, a template literal `${ChecklistCategoryLetter}${number}` where `ChecklistCategoryLetter` is `"A"|"B"|"C"|"D"|"E"|"F"|"G"|"H"|"I"`), `status` (`"pass"` | `"partial"` | `"fail"` | `"skip"`), `toolCalls` (array of tool names used), and `summary` (human-readable description). `buildEvidenceTable` MUST validate each `itemId` at runtime (regex `/^[A-I]\d+$/`) and throw on malformed IDs.  
**Acceptance:** `EvidenceItem` type is defined with `ChecklistItemId` and enforced by TypeScript. Runtime validation rejects non-conforming IDs.

**B2-EV-005: Evidence table**  
The harness MUST produce an evidence table matching checklist §7.1 — one row per checklist item with `itemId`, `status`, `toolCalls`, and `summary`.  
**Acceptance:** `buildEvidenceTable(items)` returns a `readonly EvidenceItem[]`.

**B2-EV-006: JSON evidence emitter**  
The harness MUST emit machine-readable evidence as JSON to a configurable output location. The JSON document includes the scorecard, evidence table, timestamp, and surface identifier (e.g. `"accordo-mcp"`, `"playwright-mcp"`, `"chrome-devtools"`). Output configuration uses `EmitOptions` (`{ outputDir: string; filenamePrefix?: string }`) to support multi-surface file separation (B2-EV-008).  
**Acceptance:** `emitJsonEvidence(result, options)` writes valid JSON that round-trips through `JSON.parse()`. File is written to the configured `outputDir` (default: `docs/reviews/`).

**B2-EV-007: Markdown evidence emitter**  
The harness MUST emit human-readable evidence as a Markdown report containing the scorecard table (§7 format) and evidence table (§7.1 format). Output configuration uses the same `EmitOptions` as B2-EV-006.  
**Acceptance:** `emitMarkdownEvidence(result, options)` writes a `.md` file with the scorecard and evidence table rendered as Markdown tables.

**B2-EV-008: Multi-surface comparison**  
The harness MUST support scoring multiple surfaces in a single evaluation run and storing results side-by-side. The `EvaluationResult` type includes a `surface` field.  
**Acceptance:** Two `EvaluationResult` objects with different `surface` values can coexist in `docs/reviews/`.

**B2-EV-009: Gate checking**  
The harness MUST implement the 3-tier gate check (G1: 36+/no category below 3; G2: 40+/A–H ≥4, I ≥3; G3: 45/45) from the Browser 2.1 program.  
**Acceptance:** `checkGate(scorecard)` returns the highest gate passed (`"G1"` | `"G2"` | `"G3"` | `"none"`).

**B2-EV-010: Deterministic scoring**  
Category scoring functions MUST be pure functions (no side effects, no network calls). They receive evidence items and return a deterministic score.  
**Acceptance:** Calling the same scoring function with the same evidence twice returns the same result.

**B2-EV-011: Evaluation run metadata**  
Each `EvaluationResult` MUST include: `runId` (unique identifier), `timestamp` (ISO 8601), `surface`, `scorecard`, `evidenceTable`, and `gateResult`.  
**Acceptance:** All fields are present and correctly typed.

**B2-EV-012: Harness is testable without browser**  
The evaluation harness MUST be unit-testable with mock evidence — no browser, relay, or Chrome extension required.  
**Acceptance:** All harness tests run in vitest without any browser dependencies.

---

## 4. Non-Functional Requirements

**B2-NF-001: Detachable core**  
`@accordo/browser-core` MUST have zero imports from `vscode`, `@accordo/hub`, or `@accordo/bridge-types`.  
**Acceptance:** `tsc --noEmit` passes with no vscode/hub/bridge-types imports in the dependency graph.

**B2-NF-002: No new permissions in P1**  
P1 (Snapshot Versioning + Filtering + Diff) MUST NOT require Chrome extension manifest permission changes.  
**Acceptance:** P1 manifest diff is empty.

**B2-NF-003: System prompt token budget**  
New tools MUST add ≤200 tokens to the MCP tool registry section of the system prompt.  
**Acceptance:** Token count of tool descriptions is ≤200 tokens above current baseline.

**B2-NF-004: Conventional commit format**  
All commits follow existing project convention: `feat(browser): ...`, `fix(browser): ...`, `test(browser): ...`.  
**Acceptance:** All commit messages match conventional commit regex.

---

## 5. Phase-to-Requirement Mapping

| Phase | Requirements |
|---|---|
| P1 | B2-SV-001..007, B2-DE-001..007, B2-FI-001..008, B2-CA-001..004, B2-CO-001..004, B2-ER-001..002, B2-PF-001..002, B2-PF-005..006, B2-TE-001..003, B2-TE-005, B2-NF-002..004 |
| P1+ | B2-TX-001..010 (M112-TEXT text extraction — evaluation category B) |
| P2 | B2-VD-001..015, B2-ER-003..004, B2-PF-003..004, B2-TE-002, B2-NF-001 |
| P3 | B2-WA-001..007, B2-PS-001..007, B2-ER-005..008, B2-TE-004 |
| Cross-cutting | B2-EV-001..012 (M111-EVAL evaluation harness — applies across all categories A..I) |

---

## 6. Traceability to Evaluation Checklist

| Checklist Category | Key Items | Browser 2.0 Requirements |
|---|---|---|
| A. Session & Context | Page metadata, load state, tabs, iframes | B2-SV-003 (metadata), B2-VD-005..009 (iframes) |
| B. Text Extraction | Visible text, source mapping, visibility flags | B2-TX-001..010 (M112-TEXT: text map, source mapping, normalized/raw, reading order, visibility) |
| C. Semantic Structure | DOM snapshot, a11y, landmarks, forms | B2-SV-006 (stable nodeId), B2-VD-001..003 (shadow DOM) |
| D. Spatial/Layout | Bounding boxes, z-order, viewport intersection | B2-VD-010..013 (occlusion), B2-FI-006 (regionFilter) |
| E. Visual Capture | Screenshots, region capture, format | Existing tools — no new requirements |
| F. Interaction Discoverability | Interactive inventory, actionability | B2-FI-002 (interactiveOnly filter) |
| G. Change Tracking | Snapshot versioning, deltas, filtering | B2-SV-001..007, B2-DE-001..007, B2-FI-001..008 |
| H. Robustness | Wait primitives, timeouts, error taxonomy | B2-WA-001..007, B2-ER-001..008 |
| I. Security/Privacy | Redaction, origin policies, audit | B2-PS-001..007 |
| Cross-cutting | Evaluation scoring, evidence emission, gate checking | B2-EV-001..012 |
