## Review — m112-text — Phase B (Post-B2 Tests)

### Scope
- Requirements: **B2-TX-001..010** (`docs/requirements-browser2.0.md` §3.15)
- Test files:
  - `packages/browser-extension/tests/text-map-collector.test.ts`
  - `packages/browser/src/__tests__/text-map-tool.test.ts`
- Focus: RED quality, requirement traceability, false-green risk

### Evidence executed
- `packages/browser-extension`: `pnpm test -- tests/text-map-collector.test.ts`
  - Result: target suite is RED with `collectTextMap` stub throws (`M112-TEXT: collectTextMap not implemented`), no import/setup failures.
- `packages/browser`: `pnpm test -- src/__tests__/text-map-tool.test.ts`
  - Result: suite passes.

## Gate Decision

**CHANGES REQUIRED** (do not start implementation yet)

## Findings

### HIGH

1. **False-green pattern in tool tests skips assertions on successful responses**
   - **File:** `packages/browser/src/__tests__/text-map-tool.test.ts`
   - **Lines:** 286, 303, 375, 383, 398, 410, 421, 434, 445, 456, 466
   - **Issue:** Multiple tests gate assertions behind `if ("success" in result && result.success) { ... }`.
     For successful `TextMapResponse`, `success` is not a field, condition is false, assertions are skipped, test passes vacuously.
   - **Risk:** High false-green risk; regressions in response shape/content can pass undetected.
   - **Required fix:** Replace guard with explicit failure-on-error branch and unconditional success assertions (or strong type guard asserting response is `TextMapResponse`).

2. **B2-TX-004 acceptance incomplete: missing RTL ordering test**
   - **File:** `packages/browser-extension/tests/text-map-collector.test.ts`
   - **Area:** `B2-TX-004` block (around lines 220–281)
   - **Issue:** Requirement explicitly mandates reversed within-band ordering for RTL content; tests cover only LTR.
   - **Risk:** Contract gap against acceptance criteria.
   - **Required fix:** Add an RTL fixture (`dir="rtl"`) test verifying within-band ordering is descending `bbox.x`.

### MEDIUM

3. **B2-TX-008 acceptance is under-asserted for exact truncation count semantics**
   - **File:** `packages/browser-extension/tests/text-map-collector.test.ts`
   - **Lines:** 430–434
   - **Issue:** Test asserts `segments.length <= 3` instead of exact cap behavior when source count exceeds cap.
   - **Risk:** Implementation could return fewer-than-requested segments incorrectly and still pass.
   - **Required fix:** Build fixture guaranteeing >N segments and assert `segments.length === N` with `truncated === true`.

4. **B2-TX-009/010 additive compatibility coverage is weak at registry/integration boundary**
   - **File:** `packages/browser/src/__tests__/text-map-tool.test.ts`
   - **Lines:** 358–366
   - **Issue:** Current check validates only that `get_text_map` was called; it does not prove existing tool registrations/interfaces remain unchanged.
   - **Risk:** Additive requirement can regress without test detection.
   - **Required fix:** Add registry-level assertion (tool list includes new tool + existing expected tools unchanged) or integration test against real registration surface.

5. **Shared mutable test fixture may reduce isolation confidence**
   - **File:** `packages/browser/src/__tests__/text-map-tool.test.ts`
   - **Lines:** 108, 116
   - **Issue:** `noopStore` is shared across tests.
   - **Risk:** Hidden inter-test coupling if future tests read/store state.
   - **Required fix:** Instantiate store per test (`beforeEach`) or within helper call.

### LOW

6. **RED quality is mostly good, but extension suite currently fails by thrown stub rather than explicit assertion failures**
   - **File:** `packages/browser-extension/tests/text-map-collector.test.ts`
   - **Issue:** Failures are expected due unimplemented stub and are not import/setup failures; acceptable for now, but richer negative assertions would improve signal clarity.

## Requirement Traceability (B2-TX-001..010)

- **Covered:** 001, 002, 003, 005, 006, 007, 008, 009, 010
- **Partially covered / gap:**
  - **004**: LTR path covered; **RTL acceptance missing**.
  - **008**: truncation flag covered; **exact count semantics under-asserted**.
  - **009/010**: registration unit checks exist; **integration-level additive proof insufficient**.

## B2 outcome for project-manager

Phase B2 for **M112-TEXT** is **not ready to advance**. Address the HIGH/MEDIUM items above (especially false-green guards and RTL coverage), then request re-review.
