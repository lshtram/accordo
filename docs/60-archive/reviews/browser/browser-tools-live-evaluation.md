# Review: Browser Tools Live Evaluation

## Findings

### High — Action/control tools are not currently usable end to end
- `accordo_browser_navigate` returned `control-not-granted` on both localhost tabs and a selected public tab.
- `accordo_browser_click`, `accordo_browser_type`, and `accordo_browser_press_key` also returned `control-not-granted` on a tab where read tools were otherwise working.
- Impact: the browser surface is effectively read-mostly in this session; an agent cannot reliably perform safe end-to-end workflows that require navigation or form interaction.

### High — `accordo_browser_diff_snapshots` is not reliable today
- `accordo_browser_manage_snapshots list` showed snapshots `...:46` through `...:55` retained for the active page.
- `accordo_browser_diff_snapshots` with explicit IDs (`fromSnapshotId ...:50`, `toSnapshotId ...:52`) still returned `snapshot-not-found` while listing those same IDs as available.
- Calling `diff_snapshots` with both IDs omitted also failed and referenced a non-existent `...:58` snapshot.
- Impact: agents cannot currently rely on snapshot diffing for change tracking.

### Medium — Read surface availability is inconsistent across tabs
- `accordo_browser_get_page_map` on localhost tabs returned `no-content-script` / `action-failed`.
- The same tools worked on a public tab, so this is not a total outage.
- Impact: availability depends on page/runtime state more than the tool contract suggests; agents need fallback behavior.

### Medium — Screenshot privacy controls are incomplete for visual capture
- `accordo_browser_capture_region` succeeded for viewport and full-page capture, but returned `redactionWarning: "screenshots-not-subject-to-redaction-policy"` even when `redactPII:true` was set.
- Impact: text redaction works on structured reads, but screenshots remain raw artifacts.

## Capability score / checklist summary

- Directly exercised live: 18 browser tools
- Pass: 11
- Partial: 2
- Fail: 5

### Working well now
- `accordo_browser_health`
- `accordo_browser_list_pages`, `accordo_browser_select_page`
- `accordo_browser_get_page_map`
- `accordo_browser_inspect_element`
- `accordo_browser_get_dom_excerpt`
- `accordo_browser_get_text_map`
- `accordo_browser_get_semantic_graph`
- `accordo_browser_get_spatial_relations`
- `accordo_browser_wait_for`
- `accordo_browser_capture_region` (region/viewport/fullPage)
- `accordo_browser_manage_snapshots` (list/clear)
- `accordo_browser_manage_screenshots` (list/clear)
- origin policy enforcement via `allowedOrigins` / `deniedOrigins`

### Partial / constrained
- Read tools only worked on some tabs in this session.
- Screenshot capture works, including `png`/`webp` and `fullPage`, but screenshot redaction does not.
- The older checklist document is now stale in several places: full-page capture, format selection, and spatial-relations support are present live.

### Failing in this session
- `accordo_browser_navigate`
- `accordo_browser_click`
- `accordo_browser_type`
- `accordo_browser_press_key`
- `accordo_browser_diff_snapshots`

## Open questions / assumptions

- I did not independently validate iframe traversal or shadow traversal because I could not get a safe controlled fixture page into a browser tab with working control permissions.
- `accordo_browser_pair` was not exercised because the browser relay was already connected and re-pairing would have changed session state.
- `accordo_browser_resolve_comment_context` was not available in this session's tool list, so it was not evaluated.

## Readiness verdict with residual risks

**Verdict: not ready for fully autonomous browser-task execution; usable for read-heavy inspection workflows.**

Residual risks:
- Agent plans that depend on clicking, typing, keyboard control, or navigation can fail immediately with `control-not-granted`.
- Agent plans that depend on DOM/text diffs cannot rely on `accordo_browser_diff_snapshots` today.
- Privacy-sensitive use cases should treat screenshots as unredacted artifacts.

## Appendix — browser tools exercised live

- `accordo_browser_health`
- `accordo_browser_list_pages`
- `accordo_browser_select_page`
- `accordo_browser_navigate`
- `accordo_browser_get_page_map`
- `accordo_browser_inspect_element`
- `accordo_browser_get_dom_excerpt`
- `accordo_browser_get_text_map`
- `accordo_browser_get_semantic_graph`
- `accordo_browser_get_spatial_relations`
- `accordo_browser_capture_region`
- `accordo_browser_wait_for`
- `accordo_browser_diff_snapshots`
- `accordo_browser_click`
- `accordo_browser_type`
- `accordo_browser_press_key`
- `accordo_browser_manage_snapshots`
- `accordo_browser_manage_screenshots`
