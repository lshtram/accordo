# Testing Guide — M112-TEXT (Text Map Tool)

Module: `browser_get_text_map`  
Date: 2026-03-29  
Status: Phase D3 complete — D2 PASS

---

## Section 1 — Automated Tests

Run command (browser package):

```bash
cd packages/browser && pnpm test
```

Run command (browser-extension package):

```bash
cd packages/browser-extension && pnpm test
```

All tests confirmed passing as of 2026-03-29:  
- **browser**: 335 passing  
- **browser-extension**: 664 passing (41 specific to M112-TEXT)

### browser-extension tests (`tests/text-map-collector.test.ts` — 43 tests)

| Requirement | Test description | Verifies |
|---|---|---|
| B2-TX-001 | Returns ordered array of TextSegment | `collectTextMap()` returns non-empty array for page with content |
| B2-TX-001 | Page with heading Hello and paragraph World returns at least two segments | Basic extraction coverage |
| B2-TX-001 | Each segment has required top-level fields | Shape validation: `textNormalized`, `textRaw`, `nodeId`, `bbox`, `visibility`, `readingOrderIndex` |
| B2-TX-002 | Every segment has non-negative integer nodeId | nodeId ≥ 0 and is an integer |
| B2-TX-002 | Every segment has bbox with non-negative width and height | bbox dimensions are valid |
| B2-TX-002 | nodeId is stable across two calls on unchanged DOM | Same DOM → same nodeIds |
| B2-TX-002 | nodeId is per-call scoped — different from page-map ref indices | nodeIds are independent from page-map IDs |
| B2-TX-002 | bbox has x, y coordinates | bbox position fields present |
| B2-TX-003 | textRaw preserves original whitespace | Raw text keeps internal whitespace |
| B2-TX-003 | textNormalized collapses whitespace runs to single space, leading/trailing trimmed | Normalized text is clean |
| B2-TX-003 | textNormalized does not have leading/trailing whitespace | No padding in normalized output |
| B2-TX-003 | textRaw for simple text equals textNormalized | Single-word text: both fields match |
| B2-TX-004 | readingOrderIndex is 0-based integer | Index starts at 0 |
| B2-TX-004 | readingOrderIndex is assigned top-to-bottom | Elements higher on page get lower index |
| B2-TX-004 | Within same vertical band, LTR sorts by x ascending | Left-to-right ordering within band |
| B2-TX-004 | Two-column layout — sidebar headings have lower readingOrderIndex than main headings at same vertical position | Multi-column reading order is correct |
| B2-TX-004 | readingOrderIndex is unique within the response | No duplicate indices |
| B2-TX-004 RTL | Within same vertical band, RTL sorts by x descending (right-to-left band reversal) | RTL language reading order |
| B2-TX-005 | visibility field is one of 'visible', 'hidden', 'offscreen' | Enum validation |
| B2-TX-005 | Element with display:none has visibility 'hidden' | CSS hidden → hidden flag |
| B2-TX-005 | Element with opacity:0 has visibility 'hidden' | Opacity-hidden → hidden flag |
| B2-TX-005 | Element scrolled off-screen (negative x) has visibility 'offscreen' | Off-viewport → offscreen flag |
| B2-TX-005 | Normal in-viewport element has visibility 'visible' | Standard visible element |
| B2-TX-006 | Heading element has role 'heading' | Semantic role extraction |
| B2-TX-006 | Button element has role 'button' | Semantic role extraction |
| B2-TX-006 | Element with aria-label has accessibleName set | aria-label → accessibleName |
| B2-TX-006 | Element without semantic attributes has role and accessibleName omitted | No spurious fields |
| B2-TX-006 | accessibleName uses aria-label when present | aria-label priority |
| B2-TX-007 | Result includes full SnapshotEnvelope fields | Envelope: pageId, frameId, snapshotId, capturedAt, viewport, source |
| B2-TX-007 | pageId is non-empty string | pageId validity |
| B2-TX-007 | frameId is 'main' for top-level frame | frameId value |
| B2-TX-007 | snapshotId format is {pageId}:{version} | snapshotId format |
| B2-TX-007 | capturedAt is ISO 8601 timestamp | Timestamp format |
| B2-TX-007 | viewport has width, height, scrollX, scrollY, devicePixelRatio | Viewport shape |
| B2-TX-007 | source is 'dom' | Source constant |
| B2-TX-007 | pageUrl and title are present | URL and title included |
| B2-TX-008 | Default maxSegments is 500 | DEFAULT_MAX_SEGMENTS constant |
| B2-TX-008 | Maximum limit is 2000 | MAX_SEGMENTS_LIMIT constant |
| B2-TX-008 | maxSegments option truncates response to exactly N segments | Truncation works |
| B2-TX-008 | When truncated, totalSegments reflects actual count before truncation | totalSegments = full count |
| B2-TX-008 | When not truncated, truncated flag is false | Correct `truncated=false` |
| B2-TX-008 | maxSegments: 1 returns exactly 1 segment | Minimum truncation |
| B2-TX-008 | maxSegments respects maximum of 2000 | Cap enforcement |
| B2-TX-008 | VERTICAL_BAND_TOLERANCE_PX is 5 | Band tolerance constant |
| (type exports) | TextSegment interface has all required fields | Type shape |
| (type exports) | TextMapResult interface has all required fields | Type shape |
| (edge cases) | empty page returns segments=[], truncated=false, totalSegments=0 | Empty DOM edge case |
| (edge cases) | all-hidden page: display:none elements are reported with visibility='hidden' | All-hidden page edge case |

### browser tests (`src/__tests__/text-map-tool.test.ts` — 35 tests)

| Requirement | Test description | Verifies |
|---|---|---|
| B2-TX-009 | buildTextMapTool returns tool with name 'browser_get_text_map' | Tool name |
| B2-TX-009 | Tool description mentions key capabilities | text, bounding box, visibility, reading |
| B2-TX-009 | Tool dangerLevel is 'safe' | Safety classification |
| B2-TX-009 | Tool idempotent is true | Idempotent flag |
| B2-TX-009 | Tool inputSchema has maxSegments as integer with minimum 1, maximum 2000 | Schema correctness |
| B2-TX-009 | Tool handler exists and is callable | Handler is a function |
| B2-TX-007 | Handler returns TextMapResponse with all envelope fields | End-to-end envelope pass-through |
| B2-TX-007 | Handler persists snapshot to retention store | Snapshot stored after call |
| B2-TX-007 | Handler passes pageUrl and title through | URL/title in response |
| B2-TX-007 | pageId is included in persisted snapshot | Retention store key |
| B2-TX-007 | capturedAt is ISO 8601 | Timestamp format via relay |
| B2-TX-007 | viewport fields are present | Viewport pass-through |
| B2-TX-008 | maxSegments forwarded to content script | Default forwarded |
| B2-TX-008 | maxSegments forwarded when specified | Custom value forwarded |
| B2-TX-008 | Truncated response is passed through | Truncated flag relayed |
| B2-TX-008 | totalSegments reflects actual count before truncation | Count relayed |
| B2-TX-008 | TEXT_MAP_TIMEOUT_MS is 10 seconds | Timeout constant |
| B2-TX-010 | Handler returns browser-not-connected error when relay disconnected | Error mapping |
| B2-TX-010 | Handler maps relay error to action-failed | Generic error mapping |
| B2-TX-010 | Handler maps browser-not-connected relay error correctly | Specific error mapping |
| B2-TX-010 | BrowserRelayAction union includes 'get_text_map' | Type union updated |
| B2-TX-010 | Tool is purely additive — new tool added, no existing tools removed | No regressions |
| B2-TX-010 | Tool is registered alongside all previously-existing browser tools | Co-existence |
| B2-TX-001..006 | Response includes segments array | Segments field present |
| B2-TX-002 | Segments have nodeId and bbox | Shape |
| B2-TX-002 | nodeId is non-negative integer | nodeId validity |
| B2-TX-002 | bbox has non-negative width and height | bbox dimensions |
| B2-TX-003 | Segments have textRaw and textNormalized | Text fields present |
| B2-TX-004 | Segments have readingOrderIndex | Index present |
| B2-TX-004 RTL | RTL text map reverses within-band x-order | RTL relayed |
| B2-TX-005 | Segments have visibility field with valid value | Visibility enum |
| B2-TX-006 | Segments may have role and accessibleName | Optional semantic fields |
| B2-TX-006 | accessibleName is string or undefined | Type of accessibleName |
| (type exports) | GetTextMapArgs allows optional maxSegments | Type shape |
| (type exports) | TextVisibility type has all three visibility states | Enum coverage |
| (type exports) | TEXT_MAP_TIMEOUT_MS is exported and is a number | Export check |

---

## Section 2 — User Journey Tests

These scenarios describe what a real user (or an AI agent using the MCP tool) would experience when using `browser_get_text_map` through the Accordo Hub.

### Scenario 1 — Basic text extraction from a web page

**Setup:** Browser extension installed and connected. Navigate to any news or blog article (e.g., https://example.com).

**Steps:**
1. With the extension connected, call `browser_get_text_map` with no arguments.
2. Observe the returned `segments` array.

**Expected:**
- The response contains an array of `segments`, each with:
  - `textNormalized` — the readable text with whitespace collapsed
  - `textRaw` — the original text as found in the DOM
  - `bbox` — the bounding box `{ x, y, width, height }` in pixels
  - `visibility` — one of `"visible"`, `"hidden"`, or `"offscreen"`
  - `readingOrderIndex` — a 0-based integer indicating reading sequence
- `truncated` is `false` if the page has fewer than 500 text nodes
- `totalSegments` matches `segments.length` when not truncated

### Scenario 2 — Reading order on a two-column article

**Setup:** Navigate to a page with a sidebar and main content (e.g., a docs site).

**Steps:**
1. Call `browser_get_text_map`.
2. Sort results by `readingOrderIndex` ascending.

**Expected:**
- Segments at the top of the viewport (e.g., page title, nav) have lower `readingOrderIndex` values than content below them.
- Within the same horizontal band, left-column items (sidebar headings) appear before right-column items (main headings) — each with a lower `readingOrderIndex`.

### Scenario 3 — Hidden and off-screen elements flagged correctly

**Setup:** Navigate to any page with modals, tooltips, or off-canvas menus (likely hidden on load).

**Steps:**
1. Call `browser_get_text_map`.
2. Inspect the `visibility` field on segments.

**Expected:**
- Elements with CSS `display:none` or `visibility:hidden` or `opacity:0` are returned with `visibility: "hidden"`.
- Elements positioned outside the viewport (e.g., `left: -9999px`) are returned with `visibility: "offscreen"`.
- Normal in-viewport elements are returned with `visibility: "visible"`.

### Scenario 4 — Limiting results with maxSegments

**Setup:** Navigate to a large, text-heavy page (e.g., a Wikipedia article).

**Steps:**
1. Call `browser_get_text_map` with `{ maxSegments: 10 }`.

**Expected:**
- `segments` contains exactly 10 items.
- `truncated` is `true`.
- `totalSegments` is a number larger than 10, reflecting how many text nodes were found before truncation.

### Scenario 5 — Semantic context for interactive elements

**Setup:** Navigate to any page with buttons, links, and form inputs that have `aria-label` attributes.

**Steps:**
1. Call `browser_get_text_map`.
2. Find segments for `<button>` or `<h1>`–`<h6>` elements.

**Expected:**
- Button segments have `role: "button"`.
- Heading segments have `role: "heading"`.
- Elements with an `aria-label` have `accessibleName` set to that label value.
- Plain `<div>` or `<p>` elements with no ARIA role have `role` and `accessibleName` omitted (not present in the segment object).

### Scenario 6 — Snapshot envelope and retention

**Setup:** Any connected page.

**Steps:**
1. Call `browser_get_text_map`.
2. Inspect the top-level fields of the response (outside `segments`).

**Expected:**
- Response includes: `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `source`, `pageUrl`, `title`.
- `snapshotId` format is `{pageId}:{N}` where N is a monotonically increasing version.
- `capturedAt` is a valid ISO 8601 timestamp.
- `source` is `"dom"`.
- The snapshot is retained internally so `browser_diff_snapshots` can be called on it later.

### Scenario 7 — No browser connected

**Setup:** Disconnect the browser extension (or call from a machine with no extension).

**Steps:**
1. Call `browser_get_text_map`.

**Expected:**
- Response is `{ success: false, error: "browser-not-connected" }`.
- No crash or unhandled error occurs.
