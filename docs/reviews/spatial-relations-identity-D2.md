## Review — spatial-relations-identity — Phase D2

### Causality Note — shared-relay-server-metadata transient failure

The prior `shared-relay-server-metadata.test.ts` failure (reconnect timestamp assertion) was **transient and non-reproducing** on the current HEAD. Evidence:

- The failure was **not reproduced** after the spatial-relations module was introduced; `shared-relay-server.test.ts` and `shared-relay-server-metadata.test.ts` both pass on current HEAD without modification to the shared-relay server layer.
- The spatial-relations change set touches only `browser-extension` (relay routing + validator) and `browser` (runtime + tool registration); neither package modifies the shared-relay server metadata store or timestamp logic.
- The failure was observed once during an earlier development iteration and has not recurred in subsequent test runs, indicating it was likely caused by a timing artifact in the test environment rather than a code path introduced by the spatial change set.

**Conclusion:** The reconnect timestamp failure is independent of the spatial-relations change set and does not indicate a regression in shared-relay server behavior.

### PASS
- `packages/browser-extension/src/spatial-grammar.ts` is now the neutral shared parser location for `parseSnapshotId()` and `parseUid()`, and `packages/browser-extension/src/content/spatial-relations-grammar.ts` cleanly re-exports from it.
- `packages/browser-extension/src/relay-page-remote.ts` now special-cases `get_spatial_relations` routing through `getSpatialRoutingFrame()`, ignoring legacy `payload.frameId` and singular `payload.uid` for this action.
- `packages/browser/src/spatial-relations-runtime.ts` is now split; `handleGetSpatialRelationsRuntime()` is 15 lines and within the modularity cap.
- `packages/browser/src/__tests__/spatial-relations-tool.test.ts` was replaced by focused files under `packages/browser/src/__tests__/`, each under the 150-line cap.
- Current focused test runs are green on HEAD:
  - `packages/browser-extension`: 78 files / 1435 tests passing
  - `packages/browser`: 71 files / 1227 tests passing
- `packages/browser-extension/tests/spatial-relay-routing.test.ts` now exercises the real `handleRemotePageUnderstandingAction()` path and verifies preserved public `invalid-request` outcomes for malformed UID, mixed-frame `uids[]`, and mixed `nodeIds[] + uids[]` inputs.
- `packages/browser-extension/src/relay-page-frames.ts`, `packages/browser-extension/src/relay-page-frame-tree.ts`, `packages/browser-extension/src/relay-page-frame-runtime.ts`, `packages/browser-extension/src/relay-page-remote-helpers.ts`, and `packages/browser-extension/src/content/spatial-relations-validator.ts` are all within the active finding's modularity limits (touched files `<=150` lines; touched functions `<=30` lines).

### FAIL — must fix before approval
- None.
