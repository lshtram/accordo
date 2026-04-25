# Review — browser-wave5 — Phase D

Date: 2026-04-06
Reviewer: AI Reviewer
Scope: Uncommitted Wave 5 changes in `packages/browser`

## Summary

I reviewed the listed implementation and test changes for correctness, coding-guideline alignment, architecture constraints, and edge-case coverage.

I also ran verification commands in `packages/browser`:

- `pnpm test -- packages/browser/src/__tests__/security-structured-errors.test.ts packages/browser/src/__tests__/wait-tool.test.ts packages/browser/src/__tests__/mcp-a11y-states.test.ts packages/browser/src/__tests__/security-redaction.test.ts`
  - Result: **825 passing, 0 failing** (full suite executed by Vitest selection behavior)
- `pnpm typecheck`
  - Result: **clean**
- `pnpm lint`
  - Result: **clean**

---

## Findings

### Bug (blocking)

1. **`ElementStates` is incomplete vs declared Wave 5 contract**
   - **File:** `packages/browser/src/page-tool-types.ts:368-381`
   - **Issue:** The new `ElementStates` interface currently includes:
     - `states?`, `disabled?`, `readonly?`, `required?`, `checked?`, `expanded?`
     
     but it is missing fields that were explicitly part of the Wave 5 change contract:
     - `focused?`, `selected?`, `invalid?`
   - **Why this is a bug:** This is a mismatch between intended API surface and shipped type contract. Consumers relying on the typed fields cannot use the missing properties without casts, defeating the stated goal of typed actionability/accessibility states.
   - **Fix:** Extend `ElementStates` with:
     - `focused?: boolean`
     - `selected?: boolean`
     - `invalid?: boolean`

---

### Style/minor (non-blocking)

1. **F2 tests do not strongly prove compile-time typing claim**
   - **File:** `packages/browser/src/__tests__/mcp-a11y-states.test.ts:546,573,598`
   - **Issue:** The test descriptions say access is "typed ... without type assertion", but the handler invocation is cast via `as any`, which weakens compile-time type guarantees.
   - **Suggestion:** Add a focused type-level test (without `any`) that assigns handler output to `InspectElementResponse` (or a narrowed helper type) and accesses `element.disabled/readonly/...` directly.

2. **Potential flakiness window in elapsed-time assertions**
   - **File:** `packages/browser/src/__tests__/wait-tool.test.ts:519,534`
   - **Issue:** Assertions like `elapsedMs < 1000` are generally fine, but time-based upper bounds can become brittle under heavily loaded CI.
   - **Suggestion:** Keep intent but consider slightly more tolerant thresholds or mocked timers where practical.

---

### Feature request

None.

---

## Correctness check by changed file

- `page-tool-types.ts`
  - `PageToolError.recoveryHints?`: implemented correctly.
  - `RECOVERY_HINTS` + `buildStructuredError` integration: implemented correctly.
  - `InspectElementResponse.element` narrowing to `Record<string, unknown> & Partial<ElementStates>`: implemented correctly.
  - `CaptureRegionArgs.redactPII?`: implemented correctly.
  - **But** `ElementStates` does not include all promised fields (blocking bug above).

- `wait-tool.ts`
  - `startMs` + fallback `elapsedMs: Date.now() - startMs`: bug fix implemented as intended.

- `page-tool-handlers-impl.ts`
  - Capture redaction gating `args.redactPII !== false && hasRedactPatterns`: implemented correctly and matches intended behavior matrix.

- `page-tool-definitions.ts`
  - `capture_region` schema now exposes `redactPII`: implemented correctly.

- New tests
  - Coverage is good for recovery hints, wait fallback elapsed time, and redactPII behavior matrix.
  - Main gap is compile-time strength of F2 typing proof (not blocking, but worth tightening).

---

## Architecture constraints check

No architecture constraint violations observed in scoped changes:

- No forbidden VSCode dependency crossing in Hub packages.
- No handler serialization issue introduced.
- No security middleware ordering regressions introduced by these changes.

---

## Verdict

## **PASS** (after fix)

Blocking bug fixed:

1. `packages/browser/src/page-tool-types.ts` — `ElementStates` extended with `focused`, `selected`, and `invalid` fields. All 825 tests still pass.
