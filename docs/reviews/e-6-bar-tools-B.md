# E-6 Bar Tools — Phase B2 Review

## Verdict: FAIL with conditions

The suite is broad and close to complete, but it is **not ready for Phase C** yet.

Primary gate failure: many tests fail by uncaught `Error: not implemented` (execution-level failure), not assertion-level failure. Per B2 gate, failures must be assertion-driven.

## Requirements Coverage (E-6-01 through E-6-10)

- **E-6-01** (single tool registration): ✅ covered (registration tests present)
- **E-6-02** (BarState tracker shape): ⚠️ partial (state behavior is covered, but shape/allowed values not explicitly asserted as a contract)
- **E-6-03** (initial `unknown`, reset on reload): ⚠️ partial (reset is tested; initial-state intent exists but is entangled with stub behavior)
- **E-6-04** (`unknown → close` uses focus-first then close): ✅ covered (transition table includes sequence expectation)
- **E-6-05** (idempotent open/open and closed/close): ✅ covered (transition table includes both idempotent cases)
- **E-6-06** (`view` opens view and area): ✅ covered (sidebar/panel view-open tests, panel focus-first sequencing)
- **E-6-07** (`view` + `close` error): ✅ covered
- **E-6-08** (view-area mismatch error): ✅ covered
- **E-6-09** (unknown view heuristic + graceful failure): ⚠️ partial (cases present, but success-path assertions are weak)
- **E-6-10** (`rightBar` area-level only): ✅ covered

## Findings (blocking)

1. **Tests do not fail at assertion level (B2 gate violation).**
   - File: `packages/editor/src/__tests__/bar.test.ts`
   - Issue: tests call `layoutPanelHandler` directly; stub throws `not implemented`; failures are uncaught runtime exceptions.
   - Required fix: route calls through wrapped handler path (or otherwise convert thrown stub into structured result), then assert expected outputs so RED is assertion-level.

2. **Response-shape tests are currently inverted and will reject correct implementation.**
   - Lines around `359-374`
   - Issue: both tests assert `{ error }` for operations that should eventually succeed.
   - Required fix: assert success schema fields/types (`area`, `action`, `previousState`, `wasNoOp`; plus `view` for view-level open).

3. **Cross-area independence test encodes incorrect expected behavior.**
   - Lines around `331-341`
   - Issue: expects all areas remain `unknown` after sidebar open; this contradicts E-6-02/E-6-06 semantics.
   - Required fix: assert only target area changes (`sidebar=open`) while non-target areas remain unchanged.

4. **Open/closed transition setup currently depends on unimplemented behavior and fails before real assertions.**
   - Lines around `127-149`
   - Issue: initial-state setup (`open` / `closed`) calls unimplemented handler directly, causing premature throw.
   - Required fix: use a setup path that survives stubs in Phase B (e.g., wrapped handler), then assert transition outputs.

## Findings (non-blocking)

1. **Error message checks are loose vs design §1.6 contract.**
   - Many tests only use `/area/i`, `/action/i`, etc.
   - Suggestion: assert exact error strings for contract-critical validation paths.

2. **E-6-09 heuristic success case should assert command + state update more strictly.**
   - Suggested additions: verify attempted command is `workbench.view.<view>` (plus `focusPanel` first for panel unknown views), and verify final area state is `open`.

3. **State-shape contract can be made explicit.**
   - Add a dedicated assertion that `_getBarState()` has exactly keys `sidebar|panel|rightBar` and only `unknown|open|closed` values.

## Gaps

- No explicit test that **known-view errors** include the documented known-view list text (design §1.6 string contract).
- No explicit test for **unknown panel view heuristic success** (only reject path present).

---

### Reviewer signal to project-manager

**Phase B2 = FAIL (blocking issues above).**
Please return to test-builder for fixes, then request re-review before Phase C.
