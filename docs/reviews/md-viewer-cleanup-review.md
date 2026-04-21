## Review — accordo-md-viewer cleanup alignment

Date: 2026-04-21  
Scope: documentation and architecture alignment for md-viewer related contracts.

### Summary

PASS (docs alignment)

- Requirements doc now reflects current runtime behavior (`render(...)->{html,resolver}`, fixed shiki theme, reserved `fenceRenderers`).
- Test coverage summary updated to current observed suite size (131 tests / 7 files).
- Architecture references updated to reflect command-driven navigation routing and md-viewer command ownership.
- Active testing guide added under `docs/40-testing/testing-guide-md-viewer.md`.

### Residual follow-up (non-blocking)

- `RenderOptions.fenceRenderers` remains a reserved API field; if product decides to support pluggable fence renderers, add implementation + requirement updates in a dedicated feature batch.
- `packages/md-viewer/package.json` still uses placeholder lint script (`echo 'no lint configured yet'`) and should be addressed in a tooling-focused cleanup batch.
