# Testing Guide — Browser MCP 5-Score Fixture

## Purpose

This guide defines the canonical fixture required by `docs/30-development/browser-mcp-5-score-contract.md`. It prevents browser reviews from drifting across arbitrary public pages.

## Fixture Strategy

The canonical scoring fixture is committed in the repo and is the only fixture that can produce final Browser MCP 5-score results.

- Main source: `demo/browser-mcp-5-fixture/index.html`
- Same-origin frame source: `demo/browser-mcp-5-fixture/same-origin-frame.html`
- Cross-origin source: `demo/browser-mcp-5-fixture-cross-origin/cross-origin.html`
- Runner: `scripts/serve-browser-mcp-5-fixture.sh`
- Main URL: `http://127.0.0.1:4175/index.html`
- Cross-origin URL: `http://127.0.0.1:4176/cross-origin.html`

Start the fixture from the repository root:

```bash
scripts/serve-browser-mcp-5-fixture.sh
```

## Live Harness Setup

A final 5-score run is valid only after the reviewer records this setup evidence.

1. Start `scripts/serve-browser-mcp-5-fixture.sh` and leave it running for the whole review. The runner must print both fixture URLs.
2. Open `http://127.0.0.1:4175/index.html` in the paired Chrome profile.
3. Confirm `accordo_browser_health.connected === true` and record any recent relay errors.
4. Grant browser control permission in the Accordo browser extension popup before navigation, click, type, key, or tab-selection rows.
5. Run `accordo_browser_list_pages`, record the fixture `tabId`, then target that tab explicitly in row evidence whenever possible.
6. Establish and record a desktop viewport of `1280x900` for geometry rows. `chrome-devtools_resize_page` is one acceptable setup path, but not required if the actual viewport from `accordo_browser_get_page_map` already satisfies the row precondition. Mark viewport-dependent rows provisional only when the required viewport cannot be established and recorded deterministically.
7. Record `chrome-devtools_*` availability separately. DevTools setup failures are review-harness failures unless a contract row explicitly makes DevTools part of the product evidence.
8. Reload or otherwise reset the fixture before interaction and delta rows. Record baseline sentinel text before mutation: `CLICK_COUNT: 0`, `SELECTOR_CLICK_COUNT: 0`, `KEY_STATE: idle`, `CHANGE_TEXT_BEFORE`, and the presence of `#removable-target`.
9. Before delta rows, capture and record the baseline `snapshotId`. After mutation, record the fresh `snapshotId` and the exact diff call.
10. For artifact rows, record returned `fileUri`/`filePath`, `artifactMode`, dimensions, and retained screenshot metadata.

Harness setup failures do not prove Browser MCP product defects. If the fixture server, browser pairing, control permission, target tab, deterministic viewport evidence, or clean baseline evidence is missing, mark affected rows provisional and fix the harness before scoring.

## Evidence Bundle Template

Every final review document must include this block before category scores:

```markdown
## Harness Evidence

- Fixture runner: scripts/serve-browser-mcp-5-fixture.sh
- Main fixture URL: http://127.0.0.1:4175/index.html
- Cross-origin fixture URL: http://127.0.0.1:4176/cross-origin.html
- Fixture tabId:
- Accordo browser health summary:
- Browser control permission:
- Chrome DevTools availability:
- Viewport used:
- Device pixel ratio:
- Fixture baseline sentinels: CLICK_COUNT: 0 / SELECTOR_CLICK_COUNT: 0 / KEY_STATE: idle / CHANGE_TEXT_BEFORE / #removable-target present
- Baseline snapshotId for delta rows:
- Screenshot artifact directory or returned file paths:
- Harness failures separated from product failures:
```

Reviewers may use public pages only for smoke evidence. Public pages cannot by themselves produce a binding 5/5 score.

## Required Fixture Content

The fixture page must include stable IDs and text labels for every expected assertion.

### Metadata

- Title: `Accordo Browser MCP 5 Fixture`
- Main heading: `Browser MCP 5 Fixture`
- At least one long scrollable document section.

### Text Cases

- Visible text: `VISIBLE_TEXT_ALPHA`
- Hidden text: `HIDDEN_TEXT_BRAVO`
- Offscreen text: `OFFSCREEN_TEXT_CHARLIE`
- Whitespace case: raw text with repeated spaces and line breaks, plus expected normalized text.
- RTL/bidi text with documented expected reading order.
- PII text: email and phone number.
- Non-PII identifiers: URL fragment, date, dimensions, long digit ID, and video-like opaque ID.

### Semantic Cases

- Landmarks: header, nav, main, aside, footer.
- Outline: H1, H2, H3 hierarchy.
- Form with labeled input, required input, readonly input, disabled button, hidden button, checkbox, select, and validation text.
- Table or list with meaningful labels.
- Open shadow DOM custom element with a button and text.
- Same-origin iframe with at least one heading and input.
- Cross-origin iframe pointing to `http://127.0.0.1:4176/cross-origin.html` for boundary behavior.

### Layout Cases

- Two boxes with known `leftOf` and `above` relation.
- Parent container and child target for containment.
- Overlapping boxes with known overlap.
- Obstructed button covered by modal/overlay.
- Partially visible target near viewport edge.
- Card/panel section grouping.

### Visual Capture Cases

- `#region-target`: a visually distinctive box with known dimensions.
- Full-page height greater than viewport height.
- Region target far enough from page edges that crop correctness is obvious.

### Interaction Cases

- `#click-target`: click increments visible counter.
- `#selector-click-target`: selector click increments a separate counter.
- `#type-target`: typing displays exact value in `#type-output`.
- `#key-target`: key press changes visible state.
- Disabled, readonly, hidden, and obstructed controls.

### Delta Cases

- `#mutate-button`: adds a new node with text `DYNAMIC_TEXT_DELTA`.
- `#remove-button`: removes a known node.
- `#change-button`: changes text of a known node.

## Required Evidence Bundle

A valid 5-score review must capture:

- tool call transcript or summarized response for every contract row
- fixture URL and tab ID
- before/after snapshot IDs for delta tests
- screenshot artifact paths for viewport, full-page, and region captures
- retained snapshot/screenshot list before and after clear
- negative error matrix results

## Fixture Assertion Manifest

These assertions are normative. A reviewer must not invent alternate expected values during scoring. If the implemented fixture cannot satisfy one of these assertions, the review is provisional until the contract or fixture is amended.

### Text Assertions

| Assertion | Expected Value |
|---|---|
| Required visible labels | `Browser MCP 5 Fixture`, `VISIBLE_TEXT_ALPHA`, `WHITESPACE_RAW_ALPHA`, `RTL_TEXT_ALPHA`, `BIDI_TEXT_ALPHA`, `PII_TEXT_ALPHA`, `OPAQUE_ID_ALPHA`, `REGION_TARGET_ALPHA`, `CLICK_COUNT: 0`, `SELECTOR_CLICK_COUNT: 0`, `KEY_STATE: idle` |
| Hidden text | `HIDDEN_TEXT_BRAVO` appears only when hidden/offscreen text is requested; it is not included when `visibleOnly:true`. |
| Offscreen text | `OFFSCREEN_TEXT_CHARLIE` is returned with offscreen or zero viewport visibility metadata before scrolling to it. |
| Raw whitespace | Raw segment for `WHITESPACE_RAW_ALPHA` preserves at least one repeated-space run and one newline. |
| Normalized whitespace | Normalized segment for `WHITESPACE_RAW_ALPHA` is exactly `WHITESPACE_RAW_ALPHA spaced words next line`. |
| Reading-order group | `VISIBLE_TEXT_ALPHA` appears before `WHITESPACE_RAW_ALPHA`; `RTL_TEXT_ALPHA` and `BIDI_TEXT_ALPHA` remain individually addressable and keep deterministic relative order across repeated calls. |
| Redacted PII | Email and phone in `PII_TEXT_ALPHA` are replaced with `[REDACTED]` when `redactPII:true`. |
| Preserved non-PII | `https://example.test/path?id=abc123`, `2026-04-30`, `1920x1080`, `98765432101234567890`, and `abc123XYZ789` remain unredacted. |

### Semantic Assertions

| Assertion | Expected Value |
|---|---|
| Landmarks | Semantic graph returns landmark region entries named `banner`, `navigation`, `main`, `complementary`, and `contentinfo`. |
| Outline | H1 `Browser MCP 5 Fixture`, H2 `Fixture Controls`, and H3 `Nested Fixture Detail` are returned in that order. |
| Form fields | `#type-target`, `#required-target`, `#readonly-target`, `#fixture-checkbox`, and `#fixture-select` have labels and expected required/readonly/checked/value state; `#validation-text` is associated with `#required-target`. |
| Disabled/hidden controls | `#disabled-target` is disabled and not actionable; `#hidden-control` is hidden and not actionable. |
| Shadow component | `#shadow-host` exposes open shadow text `SHADOW_TEXT_ALPHA` and shadow button `SHADOW_BUTTON_ALPHA` with host linkage. |
| Same-origin frame | Same-origin frame includes heading `SAME_ORIGIN_FRAME_ALPHA` and input `#frame-input`. |
| Cross-origin frame | Default traversal records iframe metadata with src `http://127.0.0.1:4176/cross-origin.html` and `sameOrigin:false` or `originBlocked:true`; child DOM text `CROSS_ORIGIN_FRAME_ALPHA` is not returned in default main-origin traversal. |

### Geometry Assertions

Use a desktop viewport of `1280x900` for geometry scoring. Bounding boxes may vary by 2 CSS pixels unless otherwise specified.

| Assertion | Expected Value |
|---|---|
| `#left-box` and `#right-box` | `#left-box` is left of `#right-box`; center-to-center horizontal distance is greater than 140 px. |
| `#above-box` and `#below-box` | `#above-box` is above `#below-box`; center-to-center vertical distance is greater than 80 px. |
| `#container-box` and `#contained-box` | `#container-box` contains `#contained-box`. |
| `#overlap-a` and `#overlap-b` | Boxes overlap with non-zero IoU; expected IoU tolerance is `0.05` absolute. |
| `#obstructed-button` | Element is visible in DOM but reported obstructed/occluded by `#obstruction-overlay`. |
| `#region-target` | CSS size is `320x180` px; region capture tolerance is plus/minus 12 px per side including padding. |
| Full page | Document scroll height is at least 1400 px and at least 1.5 times viewport height. |
| Viewport ratio | At `1280x900`, `#left-box` has viewport ratio `1`, `#offscreen-text` has viewport ratio `0`, and `#partial-visible-target` has viewport ratio greater than `0` and less than `1`. |
| Grouping | `#contained-box` has container/ancestor `#container-box`; `#region-target` has container/ancestor `#geometry-section`; control buttons have container/ancestor `#controls`. |

### Visual Capture Assertions

| Assertion | Expected Value |
|---|---|
| Viewport capture | With viewport `1280x900`, viewport capture image width is `1280 * devicePixelRatio` and height is `900 * devicePixelRatio`, plus/minus 2 pixels. |
| Full-page capture | Full-page capture image height is greater than viewport capture height by at least 500 pixels. |
| Region capture | Capturing `#region-target` with `padding:0` yields width `320 * devicePixelRatio` and height `180 * devicePixelRatio`, plus/minus 12 pixels per side. |
| Format capture | PNG, JPEG, and WebP captures return a file path or URI ending in `.png`, `.jpeg` or `.jpg`, and `.webp` respectively, and any response `format` or MIME field matches the requested format. |

### Interaction Assertions

| Assertion | Expected Value |
|---|---|
| `#click-target` | One click changes `CLICK_COUNT: 0` to `CLICK_COUNT: 1`. |
| `#selector-click-target` | One selector click changes `SELECTOR_CLICK_COUNT: 0` to `SELECTOR_CLICK_COUNT: 1`. |
| `#type-target` | Typing `accordo typed value` with `clearFirst:true` makes `#type-output` exactly `accordo typed value`. |
| `#key-target` | Pressing `Enter` while focused changes `KEY_STATE: idle` to `KEY_STATE: enter`. |
| Non-actionable controls | `#disabled-target`, `#readonly-target`, `#hidden-control`, and `#obstructed-button` return `success:false` with a specific structured error for normal click/type actions. |

### Delta And Paging Assertions

| Assertion | Expected Value |
|---|---|
| Add mutation | `#mutate-button` adds one visible node with text `DYNAMIC_TEXT_DELTA`. |
| Remove mutation | `#remove-button` removes node `#removable-target`. |
| Change mutation | `#change-button` changes `#change-target` from `CHANGE_TEXT_BEFORE` to `CHANGE_TEXT_AFTER`. |
| Pagination | With `offset:0` and `limit:5`, first page has returned count `<= 5`; `nextOffset` is `5` when `hasMore:true`; a second call with `offset:5` has no duplicate node IDs or text segment `readingOrderIndex` values from the first page. |
| Filtering | Role, text, selector, visibility, and region filters each reduce fixture page-map payload size by at least 40% compared to the unfiltered call. |

### Robustness Assertions

| Assertion | Expected Value |
|---|---|
| Timeout shape | A wait for text `TEXT_THAT_NEVER_APPEARS` with `timeout:250` returns `success:false`, `errorCode:"timeout"`, numeric `timeoutMs`, numeric `elapsedMs`, and boolean `retryable`. |
| Retry hints | Transient errors include `retryable:true` and numeric `retryAfterMs`; permanent validation errors include `retryable:false` and omit `retryAfterMs` or set it to `0`. |
| Error shape | Negative-path calls return `success:false`, exact `errorCode`, non-empty `message`, boolean `retryable`, and non-empty `recoveryHints` array. |
| No vague fixture failures | Calls that target valid fixture selectors, uids, snapshots, and origins never return bare `action-failed` or `no-content-script`. |

### Security Assertions

| Assertion | Expected Value |
|---|---|
| Allowed origin | Main fixture origin `http://127.0.0.1:4175` succeeds when included in `allowedOrigins`. |
| Denied origin | Main fixture origin returns `success:false` and `errorCode:"origin-blocked"` when included in `deniedOrigins`. |
| Cross-origin boundary | Default main-origin calls do not return child DOM text `CROSS_ORIGIN_FRAME_ALPHA`; top-level navigation to `http://127.0.0.1:4176/cross-origin.html` with `allowedOrigins:["http://127.0.0.1:4176"]` succeeds and returns `CROSS_ORIGIN_FRAME_ALPHA`; the same top-level call with `deniedOrigins:["http://127.0.0.1:4176"]` returns `success:false` and `errorCode:"origin-blocked"`. |
| Screenshot privacy | If screenshot text redaction is not supported for image-only PII, capture response or runtime docs explicitly say OCR/image-only PII redaction is out of scope. |
| Audit ID shape | Any response-level `auditId` is a non-empty string matching `/^[A-Za-z0-9_.:-]{8,}$/`; tools without audit IDs are listed once in the evidence bundle. |
| Retention clear | After clear, retained snapshot/screenshot list for the page is empty or contains only entries created after the clear call. |

## Public-Page Smoke Targets

These may supplement fixture evidence:

- `https://shoelace.style/components/button` for web components and shadow DOM.
- `https://example.com` for simple page metadata smoke tests.
- A stable form demo page for typing/clicking if fixture is unavailable.

Public-page results are useful for portability but are not binding score gates.

## Review Rule

If the fixture is unavailable, the reviewer must mark the review as `provisional` and may not claim final 5/5 in any category that depends on fixture-only assertions.
