# Fresh independent review: Accordo browser MCP/webview surface (2026-04-30)

## Scope and method

- Scoring authority: `docs/30-development/mcp-webview-agent-evaluation-checklist.md`
- Live surface reviewed: `accordo_browser_*` tools available in this session, plus checklist-named `chrome-devtools_*` tools where feasible
- Safe public pages used:
  - `https://jeremysiskind.com/jazz-piano-fundamentals-unit-two/`
  - `https://shoelace.style/components/button`
- Supporting docs used only as secondary evidence:
  - `docs/20-requirements/requirements-browser-mcp.md`
  - `docs/40-testing/testing-guide-browser-closeout.md`

### Bounded interpretation of ambiguous checklist points

I treated a category as **5/5** only if the live session could prove the checklist item end-to-end on the current surface, using the current tool contracts, without relying on intended behavior from code/docs. Where the checklist explicitly names `chrome-devtools_*` tools, I treated their live unavailability in this session as a blocker to a 5/5 score unless an equivalent live proof existed through `accordo_browser_*` and the checklist item did not depend on the DevTools tool specifically.

## Final scorecard

| Category | Score (0-5) | Summary |
|---|---:|---|
| A. Session & Context | 3 | Strong explicit-`tabId` reads and iframe metadata, but `accordo_browser_select_page` failed and `chrome-devtools_*` session tools were unavailable. |
| B. Text Extraction | 4 | Visible/offscreen/hidden text, raw+normalized text, bboxes, roles, names, and reading order all worked live. |
| C. Semantic Structure | 4 | Landmarks, outline, forms, states, and shadow-root-aware a11y traversal worked well; deep inspect was not live-usable. |
| D. Layout/Geometry | 3 | Rich bbox/occlusion/viewport/container data exists, but spatial-relations live proof failed and deep inspect geometry was unavailable. |
| E. Visual Capture | 2 | Viewport/full-page capture worked, but repeated supposed region captures returned whole-viewport artifacts and retained metadata had `width:0,height:0`. |
| F. Interaction Model | 2 | Inventory is good and UID click works, but selector click failed, type could not target safely, inspect/actionability proof was broken, and keypress success was not observable. |
| G. Deltas/Efficiency | 4 | Snapshot IDs, filtering, pagination, diffing, and file-ref artifacts worked well; one snapshot list duplicate and spatial helper issues remain. |
| H. Robustness | 2 | Waits worked, but several core tools failed with weak/inconsistent errors; `chrome-devtools_*` wait/screenshot/snapshot were unavailable. |
| I. Security/Privacy | 3 | Origin blocking, text redaction, redaction warnings, audit IDs, telemetry disclosure, and retention listing worked; screenshot/privacy controls remain partial. |

**Total: 27 / 45**

## High-level findings

1. **The browser read surface is materially useful today.** `get_page_map`, `get_text_map`, `get_semantic_graph`, `get_dom_excerpt`, `diff_snapshots`, and `wait_for` all produced live value.
2. **The deepest live gaps are in interaction and capture correctness, not in basic page understanding.**
3. **Two items specifically prevent a credible 5/5 path today:**
   - `accordo_browser_inspect_element` was not usable live (`action-failed`, `no-content-script`)
   - `accordo_browser_capture_region` did not demonstrate true element/rect cropping; multiple attempts returned full viewport captures
4. **The live session’s `chrome-devtools_*` bridge was unavailable**, so every checklist item that names those tools could only be partially evidenced via `accordo_browser_*` substitutes.

---

## Evidence table (A-I + must-haves)

| Item | Tool calls used | Evidence summary |
|---|---|---|
| A. Session & Context | `accordo_browser_health`; `accordo_browser_list_pages`; `accordo_browser_get_page_map(tabId=918313013, traverseFrames=true)`; `accordo_browser_navigate(url=shoelace)`; `accordo_browser_wait_for`; attempted `accordo_browser_select_page`; attempted `chrome-devtools_list_pages/take_snapshot/wait_for` | Relay connected; stable `tabId`s listed; page metadata and iframe list returned; navigate returned `readyState:"interactive"`; `select_page` failed `action-failed`; all attempted `chrome-devtools_*` calls failed due missing DevTools connection. |
| B. Text Extraction | `accordo_browser_get_text_map` on Jeremy page; `accordo_browser_get_text_map(visibleOnly=true, redactPII=true)`; `accordo_browser_get_text_map` on Shoelace page | Returned visible/offscreen/hidden segments with `textRaw`, `textNormalized`, `bbox`, `role`, `accessibleName`, `readingOrderIndex`; live redaction replaced phone/email and added `redactionApplied:true`. |
| C. Semantic Structure | `accordo_browser_get_semantic_graph` on Jeremy and Shoelace pages; `accordo_browser_get_dom_excerpt(selector=form)`; `accordo_browser_get_dom_excerpt(selector=sl-button)`; attempted `accordo_browser_inspect_element` | Landmarks, outline, forms, and shadow-root-aware a11y nodes returned; DOM excerpts resolved and carried anchor metadata; inspect never produced live element detail. |
| D. Layout/Geometry | `accordo_browser_get_page_map(includeBounds=true)`; `accordo_browser_get_page_map(regionFilter=...)`; attempted `accordo_browser_get_spatial_relations` | Page map included bounds, viewport ratios, occlusion, zIndex, container IDs; region filtering worked; spatial-relations proof failed at request-contract level. |
| E. Visual Capture | `accordo_browser_capture_region(mode=viewport, format=png, file-ref)`; `accordo_browser_capture_region(mode=fullPage, format=webp, file-ref)`; `accordo_browser_capture_region(transport=inline, format=jpeg)`; attempted anchor/rect “region” captures; `accordo_browser_manage_screenshots(list)`; attempted `chrome-devtools_take_screenshot` | Viewport/full-page capture succeeded with `artifactMode`; inline transport succeeded; but anchor/rect captures still returned full-viewport `originalBounds`; retained screenshot metadata reported `width:0,height:0`; DevTools screenshots unavailable. |
| F. Interaction Model | `accordo_browser_get_page_map(interactiveOnly=true, roles/text filters)`; `accordo_browser_get_semantic_graph`; `accordo_browser_click(uid=main:5)`; `accordo_browser_click(uid=main:10)`; `accordo_browser_press_key(PageDown)`; attempted `accordo_browser_click(selector=...)`; attempted `accordo_browser_type(selector=...)` | Interactive inventory/filtering worked; a11y states such as `disabled`, `collapsed`, `checked`, `hidden` surfaced; UID click scrolled/navigated to in-page anchor; selector click returned `invalid-request`; type returned `element-not-found`; keypress had no visible effect. |
| G. Deltas/Efficiency | `accordo_browser_diff_snapshots(from=...:28)`; `accordo_browser_get_page_map` with text/role/visibility/region filters; `accordo_browser_manage_snapshots(list)`; file-ref captures | Snapshot IDs were monotonic by page; diff returned fresh `toSnapshotId` and empty summary when no changes; filtering cut payload by ~94-99%; artifacts were returned by file reference; snapshot list contained a duplicate `...:38`. |
| H. Robustness | `accordo_browser_wait_for`; failed `accordo_browser_select_page`; failed `accordo_browser_inspect_element`; failed `accordo_browser_get_spatial_relations`; failed `accordo_browser_get_text_map(deniedOrigins=...)`; failed `chrome-devtools_*` calls | Wait succeeded instantly; some browser errors were structured and useful (`origin-blocked`, `iframe-cross-origin`), but several core failures were vague/inconsistent (`action-failed`, `no-content-script`, selector click `invalid-request`); DevTools path unavailable. |
| I. Security/Privacy | `accordo_browser_health`; `accordo_browser_get_text_map(redactPII=true)`; `accordo_browser_get_text_map(deniedOrigins=[...])`; normal read calls with `redactionWarning`; `accordo_browser_manage_snapshots(list)`; `accordo_browser_manage_screenshots(list)` | Telemetry policy disclosed as off; session isolation disclosed as shared-profile; per-request origin blocking worked; text redaction worked; audit IDs present on data calls; retention listing exists, but screenshot privacy/redaction remains partial and audit log itself is not reviewer-visible. |
| Must-have: visible text extraction with mapping | `accordo_browser_get_text_map` | PASS live: text segments mapped to node IDs/uids and bboxes. |
| Must-have: semantic structure via DOM + a11y | `accordo_browser_get_semantic_graph`; `accordo_browser_get_dom_excerpt` | PASS live: semantic graph + DOM excerpt both usable. |
| Must-have: spatial context with bboxes | `accordo_browser_get_page_map(includeBounds=true)` | PASS live at page-map level. |
| Must-have: viewport + full-page + region screenshot | `accordo_browser_capture_region(...)`; attempted `chrome-devtools_take_screenshot` | PARTIAL: viewport/full-page passed; region capture did not prove actual cropping. |
| Must-have: stable nodeId within snapshot | `accordo_browser_get_page_map`; `accordo_browser_get_text_map`; `accordo_browser_get_semantic_graph`; `accordo_browser_diff_snapshots` | PASS live within each snapshot envelope. |

---

## Category reviews

### A. Session & Context — **3/5**

**Live/tool evidence used**

- `accordo_browser_health` → relay connected, telemetry off, shared-profile isolation disclosed
- `accordo_browser_list_pages` → stable `tabId`s across many tabs; one public tab had `controlGranted:true`
- `accordo_browser_get_page_map(tabId=918313013, traverseFrames=true)` → returned `pageId`, `snapshotId`, `viewport`, URL/title, and explicit iframe metadata
- `accordo_browser_navigate(url=https://shoelace.style/components/button)` → succeeded with `readyState:"interactive"`
- `accordo_browser_wait_for(texts=["Examples"], selector="sl-button", stableLayoutMs=800)` → succeeded
- `accordo_browser_select_page(tabId=918313013)` → failed `action-failed`
- `chrome-devtools_list_pages`, `chrome-devtools_take_snapshot`, `chrome-devtools_wait_for` → all failed: `Could not find DevToolsActivePort`

**Concrete gaps vs 5/5**

- Multi-tab handling is only partially live because `select_page` failed.
- The checklist baseline explicitly names `chrome-devtools_list_pages/select_page/take_snapshot`; in this session those were unavailable.
- Load/readiness evidence was only via navigate + wait, not via a consistent multi-tool session baseline.

**Exact actions required to reach 5/5**

1. Make `accordo_browser_select_page` reliably activate the requested tab/window.
2. Restore live `chrome-devtools_*` connectivity in standard review sessions, or formally replace that baseline in the checklist.
3. Keep explicit iframe metadata and shadow-aware traversal as currently observed.

**Objective acceptance criteria**

- `accordo_browser_select_page` succeeds on at least 3 distinct listed public tabs and the selected tab becomes the implicit target.
- In a normal review session, `chrome-devtools_list_pages`, `chrome-devtools_select_page`, and `chrome-devtools_take_snapshot` all succeed against the same browser instance.
- `navigate` returns non-empty `title` and `readyState in {interactive, complete}` on a public page; `wait_for` can then prove text, selector, and stable-layout waits.

**5/5 reachability**: Yes — the target is bounded and achievable.

### B. Text Extraction — **4/5**

**Live/tool evidence used**

- Jeremy page `accordo_browser_get_text_map` returned visible/offscreen/hidden segments with raw/normalized text, bbox, role, accessible name, and reading order.
- Jeremy page `accordo_browser_get_text_map(visibleOnly=true, redactPII=true)` redacted phone/email and set `redactionApplied:true`.
- Shoelace page `accordo_browser_get_text_map(visibleOnly=true)` returned reading-order output on a component-heavy page.

**Concrete gaps vs 5/5**

- Redaction was slightly over-aggressive on one YouTube URL segment (`618IlFt0uho` partially redacted), which is safe but harms fidelity.
- I did not obtain bidi-specific proof; the checklist mentions bidi-aware ordering.
- No independent chrome-devtools text snapshot was available for cross-validation.

**Exact actions required to reach 5/5**

1. Tighten identifier-safe redaction so opaque IDs inside benign URLs are not spuriously redacted.
2. Add a live regression page to prove bidi/RTL ordering correctness.
3. Ensure a second live text surface (`chrome-devtools_take_snapshot` or equivalent) is available for cross-checking when checklist-baseline tools are expected.

**Objective acceptance criteria**

- On benchmark pages, `get_text_map` returns visible text with ≥95% correct visible-text coverage and correct node/bbox mapping.
- Redaction removes actual PII but leaves non-PII opaque identifiers/URLs unchanged.
- A bidi/RTL fixture demonstrates correct `readingOrderIndex` behavior and is documented in a repeatable live test guide.

**5/5 reachability**: Yes.

### C. Semantic Structure — **4/5**

**Live/tool evidence used**

- Jeremy page `accordo_browser_get_semantic_graph` returned landmarks, outline, forms, and stateful nodes.
- Shoelace page `accordo_browser_get_semantic_graph(piercesShadow=true)` returned extensive `inShadowRoot`/`shadowHostId` evidence and actionability states like `disabled`, `collapsed`, `checked`, `hidden`.
- `accordo_browser_get_dom_excerpt(selector=form)` and `accordo_browser_get_dom_excerpt(selector=sl-button)` returned sanitized HTML excerpts with anchor metadata.
- `accordo_browser_get_text_map(frameId="fitvid4")` failed `iframe-cross-origin`, proving cross-origin frame boundaries are explicit.
- `accordo_browser_inspect_element` attempts failed (`action-failed`, `no-content-script`).

**Concrete gaps vs 5/5**

- Deep per-element inspection was not live-usable.
- Cross-frame semantic traversal is explicit but limited; cross-origin iframe content remains inaccessible.
- I could not prove current-page re-resolution via inspect handles because inspect itself failed.

**Exact actions required to reach 5/5**

1. Make `accordo_browser_inspect_element` work reliably with current selector, current `uid`, and anchor-key resolution paths.
2. Preserve current shadow-root richness.
3. Document/standardize the expected boundary behavior for cross-origin iframes while preserving explicit frame lineage on accessible frames.

**Objective acceptance criteria**

- `inspect_element` succeeds on a normal DOM target and a shadow-DOM target, returning bounds, styles, states, visibility, and anchor-resolution metadata.
- `get_semantic_graph` continues to expose landmarks, outline, forms, and shadow-root annotations on the Shoelace page.
- For same-origin iframes, semantic traversal returns frame lineage; for cross-origin iframes, the tool returns an explicit non-success boundary error without silent omission.

**5/5 reachability**: Yes.

### D. Layout/Geometry — **3/5**

**Live/tool evidence used**

- Jeremy page `accordo_browser_get_page_map(includeBounds=true)` returned `bounds`, `viewportRatio`, `zIndex`, `isStacked`, `occluded`, and `containerId`.
- Shoelace page `accordo_browser_get_page_map(regionFilter=...)` returned a compact top-right TOC/action slice with accurate bounds.
- `accordo_browser_get_spatial_relations` could not be proven live: requests hit contract-level `invalid-request` friction around identity-mode handling.
- `inspect_element` was unavailable, so deep geometry inspection could not be verified.

**Concrete gaps vs 5/5**

- Relative geometry helpers (`leftOf`, `above`, `contains`, overlap, distance) were not live-proven.
- The client/tool boundary around empty unused identity arrays appears brittle.
- Deep element geometry/actionability proof is blocked by inspect failures.

**Exact actions required to reach 5/5**

1. Make `accordo_browser_get_spatial_relations` succeed with exactly one non-empty identity mode and an empty unused mode, as required by `requirements-browser-mcp.md`.
2. Restore working `inspect_element` geometry output.
3. Add a public geometry regression page with known relative relations and occlusion cases.

**Objective acceptance criteria**

- `get_spatial_relations({ snapshotId, nodeIds:[...], uids:[] })` and `get_spatial_relations({ snapshotId, nodeIds:[], uids:[...] })` both succeed live.
- Returned relations include at least `leftOf`, `above`, containment/overlap, and distance on a known fixture page.
- `inspect_element` returns accurate bbox and obstruction info for a visible control.

**5/5 reachability**: Yes.

### E. Visual Capture — **2/5**

**Live/tool evidence used**

- `accordo_browser_capture_region(mode="viewport", format="png", transport="file-ref")` succeeded with `artifactMode:"file-ref"`.
- `accordo_browser_capture_region(mode="fullPage", format="webp", transport="file-ref")` succeeded with `artifactMode:"file-ref"`.
- `accordo_browser_capture_region(mode="viewport", format="jpeg", transport="inline")` succeeded with `artifactMode:"inline"`.
- Multiple attempted region-style captures (via `anchorKey`, `nodeRef`, and explicit `rect`) all returned `anchorSource:"viewport"` and full-viewport `originalBounds` instead of a cropped target.
- `accordo_browser_manage_screenshots(list)` returned retained artifacts, but every record had `width:0,height:0`.
- `chrome-devtools_take_screenshot` was unavailable in this session.

**Concrete gaps vs 5/5**

- True element/region capture is not credibly demonstrated; live behavior looked like viewport capture regardless of target.
- Retained screenshot metadata is incomplete (`width:0,height:0`), contrary to the closeout testing guide.
- The checklist baseline names DevTools viewport/full-page screenshots; that path was unavailable.

**Exact actions required to reach 5/5**

1. Fix `accordo_browser_capture_region` so omitted `mode` (or explicit region mode) actually crops by `anchorKey`, `nodeRef`, or `rect`.
2. Populate accurate retained `width`/`height` metadata for screenshots.
3. Keep `artifactMode`, `relatedSnapshotId`, format choice, and file-ref transport behavior.
4. Restore `chrome-devtools_take_screenshot` availability for the checklist baseline, or formally replace that expectation.

**Objective acceptance criteria**

- Three live captures on the same page prove distinct behavior: viewport = whole visible page, fullPage = full scrollable page, region = tightly cropped target element/rect.
- `manage_screenshots(list)` reports non-zero correct width/height for each retained artifact.
- A region capture’s returned image visibly excludes most of the viewport outside the target bounds.
- `chrome-devtools_take_screenshot(fullPage=false/true)` succeeds in a standard review session, or the checklist baseline is explicitly revised.

**5/5 reachability**: Yes.

### F. Interaction Model — **2/5**

**Live/tool evidence used**

- `accordo_browser_get_page_map(interactiveOnly=true, roles/text filters)` returned concise interactive inventories on Jeremy and Shoelace pages.
- `accordo_browser_get_semantic_graph` exposed meaningful states (`disabled`, `collapsed`, `checked`, `hidden`).
- `accordo_browser_click(uid="main:10")` successfully navigated within Shoelace, changing URL fragment and `scrollY` from `0` to `3348`.
- `accordo_browser_click(selector="a[href='#examples']")` returned `invalid-request`.
- `accordo_browser_type(selector="input[aria-label='Search']")` returned `element-not-found`.
- `accordo_browser_press_key("PageDown")` returned success but produced no observed scroll/state change.
- `accordo_browser_inspect_element` was unavailable, so eventability/click-target-size proof could not be obtained.

**Concrete gaps vs 5/5**

- Inventory is good, but actionability proof is incomplete because inspect is broken.
- Selector-based click did not work in a common case.
- Type was not reliably targetable on a safe public page.
- Keyboard interactions may be returning success without effect.

**Exact actions required to reach 5/5**

1. Repair `inspect_element` and use it to surface click-target size, obstruction, disabled/readonly, and pointer-event hints.
2. Make selector-based click reliable or document a narrower supported selector contract and enforce it consistently.
3. Prove `type` and `press_key` on a safe public fixture page with a known text field and keyboard-sensitive control.

**Objective acceptance criteria**

- On a public fixture page, `click` succeeds by `uid` and by selector.
- `type` successfully enters text into a known input and `press_key` causes an observable expected effect.
- `inspect_element` exposes obstruction and target-size/actionability details for the same controls.

**5/5 reachability**: Yes.

### G. Deltas/Efficiency — **4/5**

**Live/tool evidence used**

- `accordo_browser_diff_snapshots(fromSnapshotId="...:28")` returned a fresh `toSnapshotId` and explicit empty summary on unchanged content.
- Filtered page-map calls cut payload dramatically, e.g. `reductionRatio` about `0.988`, `0.992`, `0.943`.
- Pagination metadata (`hasMore`, `nextOffset`, `totalAvailable`) appeared on page/text map responses.
- Screenshot artifacts defaulted cleanly to file references.
- `accordo_browser_manage_snapshots(list)` showed retained snapshots but duplicated snapshot `...:38`.

**Concrete gaps vs 5/5**

- Duplicate retained snapshot listing suggests retention bookkeeping noise.
- I did not prove a non-empty diff on a changing page.
- Spatial helper/live incremental geometry proof remains blocked.

**Exact actions required to reach 5/5**

1. Remove duplicate retained snapshot records.
2. Add a stable public dynamic fixture to prove non-empty deltas and repeated filtered retrieval gains.
3. Keep current filtering/pagination/deterministic ordering and file-ref artifact behavior.

**Objective acceptance criteria**

- `manage_snapshots(list)` never duplicates snapshot IDs.
- A live changing-page test shows non-empty `diff_snapshots` output for DOM/text/layout changes.
- Filtered calls continue to reduce payload by at least 40% versus broad snapshots on a medium page.

**5/5 reachability**: Yes.

### H. Robustness — **2/5**

**Live/tool evidence used**

- `accordo_browser_wait_for` succeeded for text/selector/stability patterns.
- Useful explicit failures observed: `origin-blocked`, `iframe-cross-origin`, `invalid-request` from spatial-relations validation.
- Weak/inconsistent failures observed: `select_page -> action-failed`; `inspect_element -> action-failed` then `no-content-script`; selector click `invalid-request`; some interaction errors included `message/agentAction` but not the structured `retryable` fields expected by requirements.
- All attempted `chrome-devtools_*` calls failed due missing DevTools connection.

**Concrete gaps vs 5/5**

- Error shape is not consistent across tools.
- Several core failures did not provide actionable structured retry semantics.
- The checklist baseline DevTools robustness path could not be exercised at all.

**Exact actions required to reach 5/5**

1. Normalize all browser-tool errors to one documented shape with `success:false`, `error`, `retryable`, optional `retryAfterMs`, and structured details.
2. Replace generic `action-failed`/`no-content-script` outcomes with concrete operator-relevant causes and hints.
3. Restore DevTools bridge availability for baseline snapshot/screenshot/wait evidence.

**Objective acceptance criteria**

- For a defined negative test matrix (`origin-blocked`, stale snapshot, no target, element not found, invalid request, timeout, disconnected bridge), every browser tool returns the documented structured error shape.
- No core tool emits a bare/underspecified failure for a reproducible scenario.
- `chrome-devtools_wait_for`, `chrome-devtools_take_snapshot`, and `chrome-devtools_take_screenshot` succeed in a standard review session.

**5/5 reachability**: Yes.

### I. Security/Privacy — **3/5**

**Live/tool evidence used**

- `accordo_browser_health` disclosed `telemetryPolicy.enabled:false` and `sessionIsolation.model:"shared-profile"`.
- `accordo_browser_get_text_map(redactPII=true)` redacted visible PII and returned `redactionApplied:true`.
- Unredacted read calls returned `redactionWarning:"PII may be present in response"`.
- `accordo_browser_get_text_map(deniedOrigins=["https://jeremysiskind.com"])` returned `origin-blocked`.
- Data-producing calls carried `auditId`.
- `manage_snapshots(list)` and `manage_screenshots(list)` provided retention visibility.

**Concrete gaps vs 5/5**

- Screenshot redaction behavior was not proven end-to-end.
- Audit IDs are visible, but the audit trail itself is not externally inspectable by the reviewer.
- Session isolation is disclosed but not tool-controllable; it remains shared-profile only in this live flow.
- Screenshot retention metadata quality is incomplete.

**Exact actions required to reach 5/5**

1. Make screenshot redaction/warning behavior live-provable on a safe PII fixture page.
2. Expose a reviewer/operator-safe way to inspect audit-log entries by `auditId`, or document why that is intentionally inaccessible.
3. Provide explicit session-isolation options or an explicit reviewed operator flow that can start an isolated profile/session.
4. Fix retained screenshot metadata completeness.

**Objective acceptance criteria**

- Text tools redact actual PII and set `redactionApplied:true`; screenshot responses emit the documented warning behavior under a configured redaction policy.
- A reviewer can verify that `auditId` maps to a logged record with tool name, timestamp, pageId/origin, redaction flag, and duration.
- The live surface either offers explicit isolated-session controls or the checklist/docs explicitly define shared-profile as the only supported model and provide an audited isolation workflow outside the tool.

**5/5 reachability**: Yes.

---

## Concise roadmap to 5/5 (ordered by impact/risk)

1. **Fix `inspect_element` end-to-end**
   - Unlocks higher scores in C, D, F, and H.
2. **Fix true region capture + retained screenshot dimensions**
   - Biggest blocker in E; also improves I and testing confidence.
3. **Normalize all error contracts and replace vague failures**
   - Biggest blocker in H; also improves A/F/D usability.
4. **Repair `select_page`, selector click, and prove `type`/`press_key` on a stable public fixture**
   - Needed for A and F.
5. **Make `get_spatial_relations` live-usable with empty unused identity arrays**
   - Needed for D/G.
6. **Restore `chrome-devtools_*` availability in standard review sessions**
   - Needed to satisfy the checklist baseline where those tools are explicitly named.
7. **Tighten privacy behavior**
   - Improve identifier-safe redaction, screenshot privacy proof, audit-log verifiability, and explicit isolation options.
8. **Add repeatable public regression fixtures**
   - One for dynamic deltas, one for region capture, one for text input/keyboard behavior, one for bidi/RTL text.

---

## Tool calls that could not be fully performed and why

- `chrome-devtools_list_pages`
- `chrome-devtools_take_snapshot`
- `chrome-devtools_take_screenshot`
- `chrome-devtools_wait_for`

All failed in this session with the same live environment issue:

> `Could not connect to Chrome. Check if Chrome is running. Cause: Could not find DevToolsActivePort for chrome at /home/liorshtram/.config/google-chrome/DevToolsActivePort`

Additional partial live limitations:

- `accordo_browser_select_page` consistently failed with `action-failed`
- `accordo_browser_inspect_element` failed with `action-failed` and `no-content-script`
- `accordo_browser_get_spatial_relations` could not be successfully exercised due request-contract friction around the unused identity array
- `accordo_browser_type` could be attempted but not successfully proven on a safe public input target during this review

## Bottom line

The current browser MCP surface is **good at reading pages, middling at session/geometry/diff ergonomics, and weak at deep interaction/capture correctness**. The path to a future **5/5 in every category is realistic and non-moving**: it mainly requires making the already-designed tools consistently work live, standardizing failures, and restoring the explicitly named DevTools baseline where the checklist still depends on it.
