# Browser MCP 5/5 Score Contract

## Purpose

This document freezes the scoring target for Browser MCP/WebView reviews. It turns `docs/30-development/mcp-webview-agent-evaluation-checklist.md` from a broad checklist into a deterministic Accordo browser acceptance contract.

If every acceptance row in this document passes, a future reviewer must award 5/5 for the corresponding category. New expectations require an explicit contract amendment before they affect scores.

## Scope

Applies to:

- `packages/browser`
- `packages/browser-extension`
- public `accordo_browser_*` MCP tools
- supporting `chrome-devtools_*` tools only where they are explicitly listed as review-harness evidence

## Evidence Precedence

Use evidence in this order:

1. **Contract fixture live evidence:** tool calls against the canonical Browser MCP 5 fixture.
2. **Automated tests:** package tests that assert the same behavior as the live row.
3. **Public-page smoke evidence:** safe public pages for portability checks.
4. **Docs/source inspection:** supporting context only, never enough by itself for 5/5.

If sources conflict, live fixture evidence wins. A fixture or harness can be declared invalid only by the user or project owner after a written invalidation note identifies the broken assertion, the evidence proving it is broken, and the replacement assertion. Until that approval exists, the review is blocked/provisional rather than allowed to fall back to alternate evidence for final scoring.

## Environment Preconditions

A scoring run is valid only if these preconditions are recorded:

- Accordo browser relay connected: `accordo_browser_health.connected === true`.
- Chrome extension paired and connected.
- Canonical fixture page loaded in at least one Chrome tab.
- Browser control permission granted for A2 navigation/readiness and for all interaction rows.
- `chrome-devtools_*` availability recorded separately.

`chrome-devtools_*` failures are not product failures unless the row explicitly says DevTools availability is part of the product contract. Otherwise they are review-harness failures.

## Canonical Fixture

The canonical fixture is defined in `docs/40-testing/testing-guide-browser-5-score-fixture.md`.

It must contain:

- stable URL/title
- visible, hidden, offscreen, and RTL/bidi text
- headings, landmarks, forms, tables/lists
- open shadow DOM component
- same-origin iframe
- cross-origin iframe served from a second local origin
- interactive controls with enabled, disabled, readonly, and obstructed states
- known geometry relations
- scrollable full-page content
- dynamic DOM mutation button
- text input target
- visible PII text for redaction tests
- region-capture target with known bounds

## Scoring Rules

For each category:

- 5/5: every required row for that category passes on the fixture, and no blocker row fails.
- 4/5: all core rows pass, but one non-blocking row lacks live evidence.
- 3/5: category is usable but one core row fails.
- 2/5: multiple core rows fail or the category is only partially usable.
- 1/5: minimal/stub behavior only.
- 0/5: missing.

Reviewers may not lower a score below the row-based result without adding a specific contract-row failure.

## Category Acceptance Matrix

### A. Session & Context

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| A1 metadata | `accordo_browser_get_page_map` | Returns `pageUrl`, non-empty `title`, `pageId`, `snapshotId`, `capturedAt`, and `viewport.width`, `viewport.height`, `viewport.scrollX`, `viewport.scrollY`, `viewport.devicePixelRatio`. |
| A2 readiness | `accordo_browser_navigate` + `accordo_browser_wait_for` | Navigate returns `readyState` `interactive` or `complete`; wait proves text, selector, and stable layout. |
| A3 tabs | `accordo_browser_list_pages` + `accordo_browser_select_page` | At least two tabs listed; selecting each succeeds and subsequent implicit target reads match selected tab. |
| A4 frames | `accordo_browser_get_page_map({ traverseFrames:true })` | Same-origin and cross-origin frame metadata include `frameId`, `src`, `bounds`, and boolean `sameOrigin` per the fixture assertion manifest. |
| A5 shadow | `accordo_browser_get_page_map({ piercesShadow:true })` or `accordo_browser_get_semantic_graph({ piercesShadow:true })` | Open shadow content is represented with `inShadowRoot:true` and `shadowHostId` on shadow children. |

Once A1-A5 pass, A is 5/5. DevTools tab tools are optional corroboration, not required.

### B. Text Extraction

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| B1 visible text | `accordo_browser_get_text_map({ visibleOnly:true })` | Fixture visible text coverage is at least 95% against the required visible labels in the fixture assertion manifest. |
| B2 mapping | `accordo_browser_get_text_map` | Every expected visible segment has `readingOrderIndex`, `bbox`, `visibility`, and either `role`, `accessibleName`, or both empty with the raw text still present. |
| B3 raw/normalized | `accordo_browser_get_text_map` | Raw text preserves fixture spacing where expected; normalized text collapses whitespace consistently. |
| B4 reading order | `accordo_browser_get_text_map` | LTR and RTL/bidi fixture segments match the reading-order groups in the fixture assertion manifest. |
| B5 visibility flags | `accordo_browser_get_text_map({ visibleOnly:false })` | Hidden/offscreen/visible fixture texts are correctly flagged. |
| B6 redaction fidelity | `accordo_browser_get_text_map({ redactPII:true })` | PII is redacted; opaque IDs, URLs, dimensions, dates, and long non-phone numeric IDs are preserved. |

Once B1-B6 pass, B is 5/5.

### C. Semantic Structure

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| C1 DOM snapshot | `accordo_browser_get_page_map` | Every returned node has `nodeId` and `uid`; child nodes appear only inside their parent `children` array or identify their parent/container via `containerId`. |
| C2 a11y tree | `accordo_browser_get_semantic_graph` | Roles, names, descriptions/states are present for expected controls. |
| C3 frame lineage | `accordo_browser_get_semantic_graph` or `accordo_browser_get_page_map({ traverseFrames:true })` | Same-origin iframe nodes identify frame context; cross-origin boundary is explicit per the fixture assertion manifest. |
| C4 shadow semantics | `accordo_browser_get_semantic_graph({ piercesShadow:true })` | Shadow component appears with shadow annotations or explicit host linkage. |
| C5 landmarks/outline | `accordo_browser_get_semantic_graph` | Expected header/nav/main/footer and H1-H3 outline are returned. |
| C6 forms | `accordo_browser_get_semantic_graph` | Labels, values, required/readonly/validation states appear for fixture form controls. |
| C7 inspect | `accordo_browser_inspect_element` | Selector and `uid` paths return detailed element state, bounds, styles, visibility, and anchor metadata. |

Once C1-C7 pass, C is 5/5.

### D. Layout/Geometry

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| D1 bboxes | `accordo_browser_get_page_map({ includeBounds:true })` | Expected fixture targets have CSS-pixel bboxes within the tolerance in the fixture assertion manifest. |
| D2 relations | `accordo_browser_get_spatial_relations` | `leftOf`, `above`, `contains`, overlap, and distance match the fixture assertion manifest. |
| D3 occlusion | `accordo_browser_get_page_map` or `accordo_browser_inspect_element` | Obstructed target is marked obstructed/occluded; visible target is not. |
| D4 viewport ratio | `accordo_browser_get_page_map` or `accordo_browser_get_text_map` | Fully visible, partially visible, and offscreen elements get expected viewport ratios/flags. |
| D5 grouping | `accordo_browser_get_page_map` | Cards/panels/modals expose container or section grouping for expected nodes. |

Once D1-D5 pass, D is 5/5.

### E. Visual Capture

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| E1 viewport | `accordo_browser_capture_region({ mode:"viewport", transport:"file-ref" })` | Artifact exists; dimensions match the viewport capture assertions in the fixture assertion manifest. |
| E2 full page | `accordo_browser_capture_region({ mode:"fullPage", transport:"file-ref" })` | Artifact exists; height is greater than the viewport height by the minimum in the fixture assertion manifest. |
| E3 region | `accordo_browser_capture_region({ rect })` and one element/anchor path | Region artifact is cropped to the target tolerance in the fixture assertion manifest and excludes most viewport content outside target. |
| E4 formats | `accordo_browser_capture_region` with PNG, JPEG, WebP | MIME/extension/metadata match requested format. |
| E5 linkage | `accordo_browser_capture_region` response | Response includes snapshot/page linkage and retained screenshot metadata has non-zero correct width/height. |

Once E1-E5 pass, E is 5/5. `chrome-devtools_take_screenshot` can be recorded as harness corroboration but is not required for Accordo browser product score.

### F. Interaction Model

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| F1 inventory | `accordo_browser_get_page_map({ interactiveOnly:true })` | All expected fixture controls are listed; non-controls are excluded. |
| F2 actionability | `accordo_browser_inspect_element` + `accordo_browser_get_semantic_graph` | Enabled, disabled, readonly, hidden, and obstructed states are correct. |
| F3 handles | `accordo_browser_get_page_map` or `accordo_browser_inspect_element` | Controls expose usable `uid`, selector/anchor metadata, role/name/text alternatives. |
| F4 click | `accordo_browser_click` by `uid` and selector | Both trigger expected fixture state changes. |
| F5 type | `accordo_browser_type` | Text input receives exact typed value; clear/submit behavior works. |
| F6 key | `accordo_browser_press_key` | Keyboard action produces expected observable fixture effect. |

Once F1-F6 pass, F is 5/5.

### G. Deltas/Efficiency

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| G1 versioning | two `accordo_browser_get_page_map` calls | Snapshot versions are monotonic within a page and reset on navigation/new page session. |
| G2 non-empty diff | fixture mutation + `accordo_browser_diff_snapshots` | Added/removed/changed arrays reflect the expected dynamic DOM/text/layout mutation. |
| G3 paging | `accordo_browser_get_page_map` and `accordo_browser_get_text_map` with pagination | `offset`, `limit`, `hasMore`, `nextOffset`, returned count, and duplicate behavior match the fixture assertion manifest. |
| G4 filtering | `accordo_browser_get_page_map` filters | Visibility, role, text, selector, and region filters reduce payload by at least 40% on fixture medium page. |
| G5 ordering | repeated `accordo_browser_get_page_map` and `accordo_browser_get_text_map` calls | Ordering remains deterministic for unchanged content. |
| G6 artifacts | `accordo_browser_capture_region` default | Binary artifacts default to file references unless inline transport is explicitly requested. |
| G7 retention | `accordo_browser_manage_snapshots` and `accordo_browser_manage_screenshots` | Snapshot and screenshot list operations have no duplicate IDs and support clear lifecycle. |

Once G1-G7 pass, G is 5/5.

### H. Robustness

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| H1 waits | `accordo_browser_wait_for` | Text, selector, and stable-layout waits pass; timeout case returns structured timeout. |
| H2 timeout controls | `accordo_browser_wait_for`, `accordo_browser_capture_region`, and read tools | Timeout failures include `success:false`, `errorCode:"timeout"`, `timeoutMs`, `elapsedMs`, and boolean `retryable`. |
| H3 retry hints | negative matrix | Transient failures include `retryable:true` and `retryAfterMs`; permanent failures do not. |
| H4 error taxonomy | negative matrix | `element-not-found`, `element-off-screen`, `no-target`, `image-too-large`, `capture-failed`, `origin-blocked`, `snapshot-not-found`, `snapshot-stale`, `invalid-request`, and disconnected states return `success:false`, exact `errorCode`, `message`, `retryable`, and `recoveryHints`. |
| H5 no vague failures | all fixture calls | No expected fixture path returns bare `action-failed` or `no-content-script`; unexpected failures include actionable details. |

Once H1-H5 pass, H is 5/5.

### I. Security/Privacy

5/5 requires:

| Row | Required Evidence | Pass Criteria |
|---|---|---|
| I1 text redaction | `accordo_browser_get_text_map`, `accordo_browser_get_dom_excerpt`, and `accordo_browser_get_semantic_graph` with `redactPII:true` | PII is redacted, `redactionApplied:true` appears, and non-PII identifiers are preserved. |
| I2 screenshot policy | `accordo_browser_capture_region` with redaction policy | Screenshot response or tool docs state `ocrRedactionOutOfScope:true`; DOM text-map/bounding-box redaction is the only supported screenshot privacy mode for this review program. |
| I3 origin policy | `accordo_browser_get_page_map`, `accordo_browser_get_text_map`, or `accordo_browser_get_semantic_graph` with denied/allowed origins | Main-origin denied calls return `success:false` with `errorCode:"origin-blocked"`; top-level cross-origin fixture calls succeed with `allowedOrigins:["http://127.0.0.1:4176"]` and return `CROSS_ORIGIN_FRAME_ALPHA`; default main-origin calls do not return cross-origin child DOM text. |
| I4 isolation disclosure | health/tool docs | Session isolation model is explicit; if shared profile is the only supported mode, docs say so and provide operator mitigation. |
| I5 telemetry | health/tool docs | Telemetry policy and opt-out status are visible. |
| I6 audit | `accordo_browser_*` data calls | Audit-log inspection is out of scope for this review program. Passing requires every response that includes audit metadata to expose `auditId` as a non-empty string matching `/^[A-Za-z0-9_.:-]{8,}$/`; tools without audit metadata must be listed in the evidence bundle. |
| I7 retention | `accordo_browser_manage_snapshots` and `accordo_browser_manage_screenshots` | Snapshot/image retention list and clear controls work and remove retained artifacts. |

Once I1-I7 pass, I is 5/5.

## Review-Harness Requirements

The reviewer must attach the raw evidence bundle to the review doc:

- completed harness evidence block from `docs/40-testing/testing-guide-browser-5-score-fixture.md`
- current browser relay health output summary
- fixture URL and tab ID
- command list executed
- category score table
- failed rows with exact response summaries
- environment failures separated from product failures

A row that depends on missing setup evidence is provisional, not failed. In particular, missing fixture server, browser pairing, control permission, target tab, deterministic viewport evidence, or clean fixture baseline evidence must be reported as review-harness readiness until the same row fails after the setup precondition is satisfied. Missing DevTools support alone does not make a row provisional when the required viewport or other precondition is already established through Accordo browser evidence.

## Contract Amendment Rule

Any new criterion must be proposed as a contract amendment with:

- category and row ID
- rationale
- expected tool call
- objective pass/fail output
- whether it is blocking for 5/5

The amendment applies only after user approval. It cannot retroactively lower a score in the same review cycle.

## Starting Gap Hypothesis

The acceptance matrix above is the authority. Based on `docs/50-reviews/browser-mcp-fresh-5-target-review-2026-04-30.md`, these rows are the starting hypothesis for the first contract run:

- A3: `select_page` live activation
- C7: `inspect_element`
- D2/D3: spatial relations and deep geometry proof
- E3/E5: true region crop and retained dimensions
- F4/F5/F6: selector click, type, key effect proof
- G2/G7: non-empty diff and duplicate-free snapshot retention proof
- H3/H4/H5: full structured error matrix and no vague failures
- I2/I6: screenshot privacy proof and audit verification boundary

This list is non-binding and must be replaced by the actual row-failure list from the first contract run. New work may target only failed matrix rows or user-approved contract amendments.
