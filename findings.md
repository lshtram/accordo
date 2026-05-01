# Findings

## 2026-04-27 fresh browser-tools review blockers
- Current score from reviewer: 34/45, blocked.
- Blocking findings to remediate: browser-extension typecheck/lint failures; browser-tool modularity gate violations; `accordo_browser_capture_region` runtime description/behavior mismatch; incomplete browser runtime documentation contract.
- Non-blocking risks to track but not necessarily block final score: partial cross-frame continuity, disclosed-but-not-controlled session isolation, browser package lint warnings from non-null assertions.
- Stale review artifacts exist in `docs/reviews/`; they are not evidence for current blockers unless current code independently proves a defect.
- Worktree is dirty before this remediation. Preserve user/other-agent changes and edit only targeted files.

## 2026-04-27 Phase 2 static validation
- Exact initial failures: async `resolveRequestedUrl()` was used synchronously in origin checking; `forwardMainWithAudit()` exposed an obsolete success payload union; `handleFrameIdRequest()` used an unsafe `"success" in pageMap` guard; spatial error code type included optional `undefined`.
- Fixes: await origin URL resolution, return full `RelayActionResponse` from audited main-frame forwarding, add explicit relay response guards, narrow spatial error codes to `NonNullable<RelayActionResponse["error"]>`.
- Result: `packages/browser-extension` typecheck and lint both pass.

## 2026-04-27 Phase 3 runtime contract alignment
- Fixed `accordo_browser_capture_region` description to state default `file-ref` transport with `fileUri`/`filePath`, and `transport: "inline"` as the explicit base64 `dataUrl` opt-in.
- Added a centralized runtime contract suffix to assembled browser tools so `tools/list` descriptions include preconditions, success/failure shapes, recovery guidance, common error codes, and idempotence semantics.

## 2026-04-27 Phase 4 modularity
- Browser package target files are now under 150 lines: `page-tool-pipeline.ts` 140, `comment-context-tool.ts` 98, `security/redaction.ts` 5, `wait-tool.ts` 43.
- Browser-extension target files are now under 150 lines: `relay-actions.ts` 75, `element-inspector-detail.ts` 65, `snapshot-store.ts` 132, `relay-get-page-map.ts` 114, `relay-page-remote-helpers.ts` 22.
- Removed browser lint warnings from `diff-tool-resolution.ts` and `diff-tool-runtime.ts` by replacing non-null assertions with explicit undefined guards.
- Regression found during full browser-extension test: local `get_page_map` path no longer saved snapshots to `defaultStore`; fixed by restoring the save side effect.

## 2026-04-27 Final review result
- Final blocker-focused reviewer pass reports: no blockers remain.
- Final score: 45/45.
- Dedicated pagination regression test: `packages/browser-extension/tests/page-map-local-pagination.test.ts` is 38 lines and asserts `offset: 1, limit: 2` returns exact `nodeId`, `uid`, `ref`, and text order for the second/third nodes.
- Residual non-blocking risks: legacy `page-understanding-actions.test.ts` remains broad/older-style; expected warning noise in tests can slow future triage.

## 2026-04-28 Live-tool phase 1 reproduction
- `accordo_browser_get_page_map` on tab `918313013` returned detailed page/frame/snapshot metadata, bounds, stable-looking `uid`/`ref` handles, pagination, filters, and audit IDs. Baseline output quality is strong.
- `accordo_browser_inspect_element` correctly resolved `uid: "main:0"` immediately after an interactive-only page map, but later `uid: "main:5"` and `ref: "ref-5"` from snapshot `pg_2a29a33263504859810dba80e1f3e90f:16` resolved to `div#et-secondary-menu` in a fresh snapshot instead of the original visible social-sidebar `li.et_social_facebook`. This is a real identity-contract defect, not just evaluator misuse: snapshot-scoped handles are accepted without an originating snapshot ID and can silently target the wrong element.
- `accordo_browser_diff_snapshots` with explicit `fromSnapshotId: ...:15` and `toSnapshotId: ...:16` returned `snapshot-not-found`, while the same error payload listed both `...:15` and `...:16` in `availableSnapshotIds`. This is a real delta/runtime contradiction.
- `accordo_browser_diff_snapshots` with both snapshot IDs omitted attempted to use `...:17`, which did not exist, instead of clearly auto-capturing or deriving from available snapshots. This is a real auto-capture/recovery behavior defect.
- With `redactPII: true`, returned `pageId`/`snapshotId` values are redacted, making them unusable as follow-up tool inputs. Retesting with `redactPII: false` was necessary. This is a potential contract defect: machine identifiers should remain stable or be replaced by non-sensitive opaque IDs, not redacted into unusable strings.
- `accordo_browser_manage_snapshots({ action: "list" })` returned `unsupported-action`. This is a real runtime/contract mismatch because the tool description documents list/clear snapshot management.
- `accordo_browser_get_spatial_relations` was previously invoked with both `nodeIds` and `uids`, which violates the description's mutual-exclusion rule. However, the runtime response was only `action-failed`, so error quality is still defective for invalid arguments. A valid live call was not proven in this phase because the exposed call shape encouraged/provided both identity arrays.

## 2026-04-28 Item 1 implementation notes
- Approved design avoids retained-snapshot replay. It hardens inspect identity by requiring snapshot handles to be paired with the originating `creationSnapshotId` and accepted only while that snapshot is the current page-map owner.
- Initial implementation incorrectly used the browser package generic snapshot retention store for stale/current classification; rejected because that store is updated by non-page-map tools and is not the page-map owner registry.
- Corrected implementation validates at `packages/browser-extension/src/content/message-page-routing-helpers.ts` using `spatial-snapshot-registry.ts`, and `packages/browser-extension/src/content/element-inspector-resolver.ts` now resolves snapshot handles before current-DOM paths to prevent silent fallback.
- Browser-side relay error mapping now preserves `invalid-request`, `snapshot-not-found`, `snapshot-stale`, `element-not-found`, and `element-off-screen` for MCP callers.
- Reviewer identified an additional mixed-valid-request gap: validation happened before normalization, but `toInspectPayload()` could still strip `ref`/`nodeId` when `anchorKey`/`selector` were also present. Final fix preserves snapshot-scoped precedence through normalization and route dispatch.

## 2026-04-28 Item 2 implementation notes
- `diff_snapshots` both-omitted mode now resolves from retained local history instead of inventing next snapshot IDs. Reviewer required global recency across retained snapshots, including cross-page pairs.
- `fromSnapshotId` supplied with omitted `toSnapshotId` now captures a fresh page map and persists that fresh envelope locally before diffing.
- Relay `snapshot-not-found` while both requested snapshots are locally retained is shaped as an extension/runtime lookup mismatch and omits `availableSnapshotIds` to avoid the previous contradiction.
- Recovered tabId forwarding is constrained to same-page explicit diffs; cross-page explicit diffs do not receive recovered tab metadata.

## Initial reviewer findings to address
- Test suite red in navigation/control area
- `redactPatterns` may be dropped during capture payload validation
- Capture error taxonomy may be collapsed to `no-target`
- Browser MCP security/privacy controls may be only partially implemented in browser-extension package
- Static relay auth token in query string is weak security hygiene
- Large files, broad logging, and narrow lint scope are maintainability issues

## Confirmed fixes completed
- `toCapturePayload()` now preserves `redactPatterns` when provided as a string array
- Bounds-resolution errors from `RESOLVE_ANCHOR_BOUNDS` now preserve specific codes such as `element-not-found` and `element-off-screen` instead of collapsing to `no-target`
- Targeted capture tests pass after the fix
- Navigate/control test drift fixed by aligning the debugger mock with `handleNavigate()`'s `Page.getFrameTree` preflight sequence
- Shared privacy middleware added for the five text-producing read tools: origin blocking, `redactPII`, `redactionWarning`, `auditId`, and in-memory audit logging
- Package lint scope now covers `src/` instead of a narrow semantic-graph glob, and the resulting lint issues were fixed
- `PageCommentStore` now matches BR-F-03 (`version`, `url`, `threads` only)
- Extension-layer error responses now carry structured retry metadata via shared helpers
- Remaining reviewer concern is limited to relay auth token hygiene in `relay-bridge.ts`, which appears to be a cross-package design choice rather than a browser-extension-only defect
