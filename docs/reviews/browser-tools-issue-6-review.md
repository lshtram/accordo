## Review — browser-tools issue #6

### Findings
- No issue-#6 blockers found in this re-review.

### Approval status
- APPROVED for issue #6.

### Satisfied requirements
- Internal capture resolve errors are normalized to public capture codes. Evidence: `packages/browser-extension/src/relay-capture-execution.ts:23-34` maps internal `not-found` to public `element-not-found`, and `packages/browser-extension/tests/capture-error-normalization.test.ts` passes.
- Query tools distinguish `no-target`, `invalid-request`, and valid miss. Evidence: `packages/browser-extension/src/content/message-page-routing-helpers.ts:24-27` plus `packages/browser-extension/tests/query-target-errors.test.ts`.
- Target precedence is respected for issue-#6 query and control paths. Evidence: query routing validates selector only when no higher-priority target exists, and `packages/browser/src/control-tool-handlers.ts:119-133` now prefers `uid`, then `coordinates`, then `selector`; `packages/browser/src/__tests__/target-error-contract.test.ts:25-39` passes and records the relay payload as `{ coordinates: { x: 1, y: 2 } }`.
- Control frame-target failures are classified as `iframe-cross-origin`, `element-not-found`, and `no-content-script`. Evidence: `packages/browser-extension/src/relay-control-frame-target.ts:87-118` plus `packages/browser-extension/tests/control-frame-target-errors.test.ts`.
- Browser-side control handlers add actionable guidance for known target failures. Evidence: `packages/browser/src/control-tool-guidance.ts:11-27` and `packages/browser/src/__tests__/target-error-contract.test.ts:20-23`.
- Public tool wording no longer overclaims `uid` stability. Evidence: `packages/browser/src/page-tool-page-map-definition.ts:17-18` now says `snapshot/frame-scoped reference for click/type`.
- Re-run verification:
  - `packages/browser-extension`: `pnpm exec tsc --noEmit` ✅
  - `packages/browser`: `pnpm exec tsc --noEmit` ✅
  - `packages/browser-extension`: `pnpm test -- --run tests/capture-error-normalization.test.ts tests/query-target-errors.test.ts tests/control-frame-target-errors.test.ts` ✅ (workspace ran broader extension suite; target issue-#6 tests passed)
  - `packages/browser`: `pnpm exec vitest run src/__tests__/target-error-contract.test.ts src/__tests__/target-validation.test.ts src/__tests__/control-tools.test.ts src/__tests__/page-understanding-tools.test.ts` ✅ (4 files, 233 tests)

### Residual non-blocking risks
- `packages/browser` still has unrelated `browser-family-modularity.test.ts` hard-coded-path failures when invoked through the package's `pnpm test -- --run ...` wrapper. That remains outside issue #6 scope but can obscure focused verification until the test harness path assumptions are fixed.
