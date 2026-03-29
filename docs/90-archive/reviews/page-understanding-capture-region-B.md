## Review — page-understanding-capture-region — Phase B/B2 (Re-review)

### Scope Reviewed
- `packages/browser-extension/tests/page-understanding-actions.test.ts`
- `packages/browser-extension/tests/page-map-collector.test.ts`
- `packages/browser-extension/tests/element-inspector.test.ts`
- `packages/browser-extension/tests/enhanced-anchor.test.ts`
- `packages/browser-extension/tests/capture-region.test.ts`
- `packages/browser/src/__tests__/page-understanding-tools.test.ts`

### Execution Evidence
- Ran:
  - `packages/browser-extension`: `pnpm test -- tests/page-understanding-actions.test.ts tests/page-map-collector.test.ts tests/element-inspector.test.ts tests/enhanced-anchor.test.ts tests/capture-region.test.ts`
  - `packages/browser`: `pnpm test -- src/__tests__/page-understanding-tools.test.ts`
- Results now:
  - Browser-extension run: **22 files / 327 tests passing**
  - Browser run: **10 files / 107 tests passing** (including `page-understanding-tools.test.ts`)

---

## Gate Decision
## **FAIL — Phase B gate is still not valid for implementation**

---

## Concise rationale

The suite is still predominantly **stub-oriented** and **type/shape-oriented**, not behavior-specifying. Many new tests pass by asserting `"not implemented"`, `success:false`, static literals, or type assignability, which allows full-green status without real feature behavior.

For B2, tests must define intended runtime behavior and fail for missing implementation (red intent). Current posture is mostly green against stubs, so it is not a valid gate.

---

## Key checks requested

### 1) Behavioral specification vs stub assertions
- **Not sufficient.** A large portion of tests still assert stubs throw or generic failure envelopes.

### 2) Red intent quality
- **Not sufficient.** The suite is largely green; it does not create failing behavioral expectations for unimplemented logic.

### 3) Previously missing requirements
- **PU-F-53:** still mostly comments/placeholder intent; assertions verify stub/failure, not forwarding/action/passthrough semantics.
- **PU-F-25:** tests mostly assert throws or static key formats; fallback hierarchy behavior is not truly exercised.
- **PU-F-33:** labeled as runtime, but assertions still expect throw/failure paths instead of `{ found: false }` behavior.
- **CR-F-07:** represented via type/result-shape checks and comments; no executable behavior path validating capture/crop flow contract.
- **CR-F-09..12:** mostly synthetic object assertions and stub failures; missing meaningful failing behavior tests for downscale/min-size/retry/error mapping logic.

---

## Required corrective action before Phase C

1. Replace stub-assertion tests with **behavioral assertions** (real expected outputs/interactions).
2. Ensure each critical requirement above has at least one test that would fail until real implementation exists.
3. For relay handlers, assert concrete forwarding contract (`action`, payload mapping, timeout, passthrough/error mapping), not just thrown/not-thrown behavior.
4. For content functions, use DOM fixtures/mocks to verify fallback order, found/not-found paths, truncation/sanitization, and capture constraints.

**Phase C must remain blocked until a true red behavioral B2 suite is presented.**
