## Review — browser-tools issue #2

### PASS
- Reviewed only the issue #2 text-map changes.
- Focused tests executed and passed in `packages/browser-extension` and `packages/browser`.
- Default ordering now prioritizes `visible -> offscreen -> hidden`.
- Public browser contract exposes `visibleOnly?: boolean` and documents `bbox`/visibility behavior.
- Collector truncation metadata now uses the filtered/ordered set.
- Residual risk #1 is now closed: `packages/browser-extension/tests/text-map-relay-boundary.test.ts` provides a focused relay/runtime-boundary proof that pagination after `visibleOnly` remains aligned with the filtered set through `handleGetTextMap`.
- Residual risk #2 is now closed: `packages/browser-extension/tests/text-map-ordering.test.ts` now proves geometric reading order is preserved within both the `offscreen` and `hidden` buckets.

### Residual risks
- None for issue #2 on current HEAD.
