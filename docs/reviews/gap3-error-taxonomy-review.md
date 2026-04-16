# Review — Gap 3 Error Taxonomy (`capture_region`)

## Verdict: **PASS**

Gap 3 is correctly implemented and the added tests close the original checklist gap for runtime coverage of distinct error codes.

## Scope Reviewed

- `packages/browser-extension/tests/capture-tabid-routing.test.ts` (new block lines 807–939)
- `packages/browser-extension/src/relay-capture-handler.ts` (retry + capture-failed paths)
- `packages/browser-extension/src/relay-definitions.ts` (`ERROR_META`)
- `docs/30-development/coding-guidelines.md` compliance checks relevant to this change

---

## Findings by Focus Area

### 1) Test quality (new integration tests)

**PASS**

- The new `capture-failed` test is a real handler-path integration test:
  - calls `handleCaptureRegion`
  - resolves bounds successfully first
  - forces `chrome.tabs.captureVisibleTab` to throw
  - verifies emitted error code is exactly `"capture-failed"` and includes metadata.
- The new `image-too-large` test also exercises real handler flow:
  - calls `handleCaptureRegion`
  - uses large data URL payload to exceed size threshold
  - reaches retry logic and verifies final emitted code `"image-too-large"`.
- Test setup is isolated (`beforeEach` + `resetChromeMocks`) and does not depend on cross-test mutable state.

### 2) `image-too-large` path and OffscreenCanvas fallback assumption

**PASS (with note)**

- Assumption is correct in current code:
  - `cropImageToBounds` explicitly catches failures and returns original `dataUrl` (with comment: fallback in test environments).
  - This makes large-size behavior deterministic in Vitest/JSDOM-like environments where image/canvas pipeline is incomplete.
- The assumption is documented in production code (`relay-capture-handler.ts` comment and fallback implementation).

**Non-blocking improvement:**
- The test currently relies on environment behavior implicitly. Consider adding one clarifying inline test comment that this scenario depends on crop fallback semantics in non-canvas test runtime, to reduce future confusion if test runtime capabilities change.

### 3) `capture-failed` metadata correctness

**PASS**

- Verified in `relay-definitions.ts`:
  - `"capture-failed": { retryable: false }`
  - `"image-too-large": { retryable: false }`
  - `"element-off-screen": { retryable: false }`
- Test assertion `retryable === false` is correct and aligned with `ERROR_META` contract.

### 4) Coverage completeness for `element-off-screen`

**PASS**

- Existing test `CR-F-12: propagate element-off-screen error code from content script` (line ~727) already exercises real handler propagation path via `handleCaptureRegion`.
- Combined with new Gap 3 tests, all three architecture-defined codes are now exercised through runtime handler behavior (not just type-level object construction).

### 5) Coding guidelines compliance

**PASS for Gap 3 changes**

- No `any` introduced in reviewed additions.
- Tests use explicit assertions (no `toBeTruthy`/`toBeFalsy` misuse).
- Error-path testing is appropriate and requirement-tagged (`CR-F-12`).
- No commented-out dead code introduced.

**Repo note (non-blocking, unrelated to Gap 3):**
- `pnpm lint` in `packages/browser-extension` reports 1 warning in `src/popup.ts` (unused eslint-disable directive). Not in reviewed Gap 3 files and not a blocking issue for this change.

---

## Validation Commands Run

From `packages/browser-extension`:

- `pnpm test` → **50 files, 1253 passed, 0 failed**
- `pnpm typecheck` → **clean (0 errors)**
- `pnpm lint` → **0 errors, 1 warning (unrelated file: `src/popup.ts`)**

---

## Final Decision

✅ **PASS** — Gap 3 error taxonomy coverage is complete for runtime handler behavior, and the implementation aligns with the architecture-defined error codes and metadata semantics.
