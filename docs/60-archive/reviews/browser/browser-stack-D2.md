## Review — browser-stack — Phase D2

### PASS
- Tests: `packages/browser` 1150 passing; `packages/browser-extension` 1294 passing; zero failures.
- Type check: clean in both scoped packages.
- Lint: clean in both scoped packages.
- The recently split barrel/contract files called out in the review request are materially improved:
  - `packages/browser/src/control-tool-types.ts` (16 lines)
  - `packages/browser/src/control-tool-contracts.ts` (73 lines)
  - `packages/browser/src/control-tool-error-mapping.ts` (66 lines)
  - `packages/browser/src/control-tool-handlers.ts` (119 lines)
  - `packages/browser-extension/src/relay-control-handlers.ts` (38 lines)
  - `packages/browser-extension/src/relay-control-click.ts` (99 lines)
  - `packages/browser-extension/src/relay-control-type.ts` (80 lines)
  - `packages/browser-extension/src/relay-control-frame-target.ts` (89 lines)
  - `packages/browser-extension/src/relay-get-page-map.ts` (144 lines)
  - `packages/browser-extension/src/relay-page-secondary-handlers.ts` (146 lines)
  - `packages/browser-extension/src/content/message-handlers.ts` (130 lines)
  - `packages/browser-extension/src/content/message-page-router.ts` (113 lines)

### FAIL — must fix before Phase E
- `packages/browser-extension/src/content/message-handlers.ts:74-75` — `deactivateCommentsModeFromHandlers()` uses CommonJS `require()` inside an ESM/browser-extension runtime. That path will throw `ReferenceError: require is not defined` when comments mode is turned off via message or storage sync. Replace it with a static import or `await import()` path that is valid in MV3/ESM.
- `packages/browser/src/screenshot-retention.ts:169-173` — `deleteFile()` uses `require("fs")` inside an ESM VS Code extension package. When screenshot eviction/cleanup actually runs, cleanup can fail at runtime before `unlinkSync` is reached. Replace with a normal ESM import (`node:fs`) or inject the filesystem dependency.
- `packages/browser/src/semantic-graph-tool-handler.ts:1-162` — this newly split file still exceeds the repo reviewer limit of 150 lines, and `handleGetSemanticGraph()` spans `57-162`, well above the 30-line reviewer limit. Split transport/origin/audit/redaction responsibilities further.
- `packages/browser/src/page-tool-handlers-impl.ts:1-939`, `packages/browser/src/page-tool-types.ts:1-707`, `packages/browser/src/diff-tool.ts:1-735`, `packages/browser-extension/src/relay-capture-handler.ts:1-762`, `packages/browser-extension/src/content/page-map-collector.ts:1-602`, `packages/browser-extension/src/content/element-inspector.ts:1-583`, `packages/browser-extension/src/popup.ts:1-660` — major browser-stack source files remain far above the repo modularity gate, so the browser stack is not yet review-pass under Rule #1.
- `packages/browser/src/__tests__/page-understanding-tools.test.ts:1-2515`, `packages/browser/src/__tests__/text-map-tool.test.ts:1-1526`, `packages/browser-extension/tests/page-map-collector.test.ts:1-2037`, `packages/browser-extension/tests/relay-control-handlers.test.ts:1-880`, `packages/browser-extension/tests/relay-page-map-frames.test.ts:1-961` — test files also still violate the reviewer modularity gate (`<=150` lines each), so the modularity/file-size concern is not fully resolved at package scope.

### Residual risk / coverage notes
- I did not find a still-reproducible version of the previously reported iframe click-coordinate or heuristic frame-routing bug in the newly split control path; the new `relay-control-frame-target.ts` logic plus updated control tests look directionally correct.
- However, the current coverage is still largely mocked/unit-level for the latest nested-iframe click/type fixes; I did not see a true end-to-end browser-runtime test that drives a nested iframe click/type call across the full stack.
- I did not see coverage for the comments-mode **off** path or for real screenshot file eviction in ESM runtime conditions; both missing paths align with the two `require()` defects above.
