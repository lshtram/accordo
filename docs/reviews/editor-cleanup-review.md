## Review — accordo-editor cleanup alignment

Date: 2026-04-21  
Scope: editor package docs/contracts + activation/registration test hardening.

### Summary

PASS (editor cleanup batch)

- Tool-surface docs now align with current implementation (23 tools; underscore naming; de-scoped workspace/diagnostics tools).
- Architecture docs updated to reflect current editor composition and registration flow.
- Added explicit activation tests for bridge-present/bridge-missing and tool-count stability.
- Updated package README and package metadata to current tool/test counts.

### Evidence

- `pnpm --filter accordo-editor test -- --run`
- Result: 9 files, 354 tests passing.

### Residual follow-up (non-blocking)

- `packages/editor/test-output.txt` and `packages/editor/test-result.txt` exist as local artifacts (currently untracked); decide whether to delete automatically in scripts or ignore explicitly.
