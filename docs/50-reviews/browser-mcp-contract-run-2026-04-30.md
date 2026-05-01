# Browser MCP Contract Run — 2026-04-30

## Summary

First execution pass against `docs/30-development/browser-mcp-5-score-contract.md` using the committed fixture.

This replaces the previous speculative gap list with concrete row failures from the canonical fixture run.

## Environment

- Fixture runner: `scripts/serve-browser-mcp-5-fixture.sh`
- Main fixture URL: `http://127.0.0.1:4175/index.html`
- Cross-origin fixture URL: `http://127.0.0.1:4176/cross-origin.html`
- Browser tab used: `918313013`
- Accordo browser health: connected, no recent relay errors.
- Control permission: already granted on reused tab.
- DevTools harness: unavailable; `chrome-devtools_list_pages` failed with `Could not find DevToolsActivePort`.
- Actual viewport during run: `1843x871`, `devicePixelRatio:1`.

## Passed Or Mostly Passed Rows

- A1 metadata: page map returned URL, title, page ID, snapshot ID, timestamp, and viewport metadata.
- A2 readiness: navigation succeeded with `readyState:"complete"`; wait for fixture text/selector passed.
- A4 frame metadata: `traverseFrames:true` returned same-origin and cross-origin iframe metadata with IDs, src, bounds, and same-origin classification.
- A5 shadow: shadow DOM children returned with `inShadowRoot` and `shadowHostId`.
- B1-B5 text extraction: visible labels, raw/normalized whitespace, reading order, hidden/offscreen flags, and segment metadata were present.
- C1/C2/C4/C5/C6 semantic structure: DOM nodes, a11y tree, landmarks/outline, form labels/state, validation text, and shadow semantics were present.
- D1 geometry bounds: expected geometry targets returned bboxes.
- D5 grouping: key fixture nodes exposed `containerId`/ancestor grouping.
- E1/E2 visual capture: viewport and full-page captures produced file artifacts.
- F1 interaction inventory: interactive-only inventory returned expected controls.
- F5 typing: `accordo_browser_type` wrote `accordo typed value` into `#type-target` and `#type-output` reflected it.
- G1 snapshot versioning: snapshot IDs advanced monotonically during repeated reads.
- G4 filtering: role/text/interactive filters reduced payload size by more than 40% in sampled calls.
- I3 origin policy: same-origin denial returned `origin-blocked`; top-level cross-origin allowed read returned `CROSS_ORIGIN_FRAME_ALPHA`; top-level cross-origin denial returned `origin-blocked`.
- I4/I5 privacy disclosure: `accordo_browser_health` returned shared-profile isolation and telemetry disabled/on-device policy.

## Failed Rows

| Row | Failure Evidence | Required Fix Direction |
|---|---|---|
| A3 tabs | `accordo_browser_select_page({ tabId:918313013 })` returned `success:false`, `error:"action-failed"`. | Fix select-page activation or error contract. |
| B6 redaction fidelity | `redactPII:true` redacted non-PII fixture values: `123` in bidi text, URL digits, `2026-04-30`, `1920x1080`, long numeric ID, and opaque ID digits. | Tighten browser text-map redaction to preserve contract non-PII identifiers. |
| C3 frame lineage/content | `accordo_browser_get_text_map({ frameId:"same-origin-frame" })` returned `action-failed`; cross-origin frame correctly returned `iframe-cross-origin`. | Fix same-origin iframe targeting/readback. |
| C7 inspect | `accordo_browser_inspect_element({ selector:"#click-target" })` and disabled target inspection returned `no-content-script`. | Fix inspect-element current-page resolution/content-script path. |
| D2 spatial relations | Tool could not be executed through MCP wrapper without passing both identity arrays; failures returned exact-one identity-mode validation errors. | Fix schema/tool adapter so one identity array can be empty and valid. |
| D3 occlusion | `#obstructed-button` appeared with `occluded:false`; inspect path also failed. | Fix obstruction/occlusion detection or fixture-compatible inspect fallback. |
| D4 viewport ratio | Contract requires `1280x900`; run viewport was `1843x871` because DevTools resize was unavailable. Partial target was reported offscreen, not partial. | Provide deterministic viewport setup or add an Accordo-owned viewport control; then re-run D4. |
| E3 region capture | Rect capture call with a region returned `anchorSource:"viewport"`, `mode:"viewport"`, and full viewport bounds, ignoring the rect. | Fix region capture mode/argument handling so rect and element captures are actual crops. |
| E5 retained screenshot dimensions | `accordo_browser_manage_screenshots` listed fixture screenshots with `width:0`, `height:0`. | Persist non-zero screenshot dimensions for viewport/full-page/region captures. |
| F2 actionability | Depends on `inspect_element`; current inspect path fails with `no-content-script`. | Fix inspect actionability state reporting. |
| F4 click | UID click returned `element-not-found`; selector and coordinate clicks returned `invalid-request`. | Fix click target union handling and uid/selector resolution. |
| F6 key | Not provable because click/focus path failed; `KEY_STATE` remained `idle`. | Fix focus/click path or key-target focusing semantics. |
| G2 diff mutation | Not provable because mutation buttons require click and click failed. | Fix click first, then re-run mutation/diff rows. |
| G3 page-map pagination | `offset:0, limit:5` returned more than five nested nodes; `offset:5, limit:5` returned empty `nodes` while `hasMore:true`. Text-map pagination worked. | Fix page-map pagination to apply to returned nodes consistently and return coherent `nextOffset`. |
| G7 retention | Snapshot list contained duplicate snapshot ID `pg_ed7d231ccd1842bbabc922c1a7575105:38`; screenshot list showed zero dimensions. | Deduplicate retained snapshot records and fix screenshot metadata dimensions. |
| H1/H2 timeout shape | Timeout returned `{ met:false, error:"timeout", elapsedMs, retryable, retryAfterMs }`, but contract requires `success:false`, `errorCode:"timeout"`, `timeoutMs`, `elapsedMs`, and `retryable`. | Normalize wait timeout response shape. |
| H4 error taxonomy | Errors use `error`/`details` rather than exact `errorCode`; `recoveryHints` is sometimes a string instead of a non-empty array. | Normalize browser error envelope across tools. |
| H5 no vague fixture failures | Valid fixture inspect calls returned `no-content-script`; select-page returned `action-failed`. | Replace vague internal failures with structured product/action errors. |
| I1 redaction | Same as B6; non-PII fixture identifiers were redacted. | Fix redaction classifier. |
| I2 screenshot privacy | Capture responses did not expose `ocrRedactionOutOfScope:true`; this may be present only in docs, not live response. | Add live policy field or explicitly map runtime docs as evidence for I2. |

## Provisional Or Not Executed

- E4 JPEG format was not run in this first pass; PNG and WebP were sampled.
- I7 clear lifecycle was not executed to avoid clearing retained artifacts during the first evidence-gathering pass; list output was sufficient to expose G7 metadata issues.
- D4 could not be final-scored because the required `1280x900` viewport was not available through Accordo and DevTools was unavailable.

## Actual Priority Order

1. Fix shared action/target resolution issues: `select_page`, `inspect_element`, `click`, same-origin iframe targeting.
2. Fix browser redaction false positives against the canonical fixture.
3. Fix capture metadata/region capture and retained screenshot dimensions.
4. Fix page-map pagination and snapshot retention duplicates.
5. Normalize browser error envelopes for timeout, origin-blocked, invalid-request, no-content-script/action-failed cases.
6. Add deterministic viewport setup or revise the contract to an Accordo-owned viewport precondition.

## Score Implication

Do not assign final 5/5 category scores yet. The first contract run produced blocking row failures in every category except parts of text/semantic metadata. Future work should target only the failed rows above until the contract is amended.
