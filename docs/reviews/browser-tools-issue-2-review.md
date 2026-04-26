## Review — browser-tools issue #2

### PASS
- Reviewed only the issue #2 text-map changes.
- Focused tests executed and passed in `packages/browser-extension` and `packages/browser`.
- Default ordering now prioritizes `visible -> offscreen -> hidden`.
- Public browser contract exposes `visibleOnly?: boolean` and documents `bbox`/visibility behavior.
- Collector truncation metadata now uses the filtered/ordered set.

### Residual risks
- No focused end-to-end test currently proves pagination after `visibleOnly` through the real relay boundary.
- No focused test currently proves geometric order is preserved within the `offscreen` and `hidden` buckets.
