# Review — T-01 edgeStyles in `accordo_diagram_patch` — Phase B

**Date:** 2026-04-03  
**Reviewer:** Reviewer agent  
**Prior reviews:** `docs/reviews/t01-edgeStyles-A.md` → `docs/reviews/t01-edgeStyles-A-recheck.md` (PASS)  
**Status:** ✅ PASS — GREEN LIGHT for Phase C

---

## Verdict

**PASS. All 8 tests are correctly written and exercising the right assertions. The test suite is ready for Phase C implementation.**

---

## Test Run Output (live)

```
 Test Files  1 failed | 21 passed (22)
       Tests  7 failed | 551 passed (558)
    Start at  01:16:44
    Duration  2.86s
```

**Failed tests (all 7 fail at `Error: not implemented` — ops.ts:345):**

| Test | Status | Failure source |
|------|--------|----------------|
| DT-59 | ❌ FAIL | `Error: not implemented` at ops.ts:345 |
| DT-60 | ❌ FAIL | `Error: not implemented` at ops.ts:345 |
| DT-61 | ❌ FAIL | `Error: not implemented` at ops.ts:345 |
| DT-62 | ❌ FAIL | `Error: not implemented` at ops.ts:345 |
| DT-63 | ✅ PASS | Absent `edgeStyles` → falls through stub guard cleanly |
| DT-64 | ❌ FAIL | `Error: not implemented` at ops.ts:345 |
| DT-65 | ❌ FAIL | `Error: not implemented` at ops.ts:345 |
| DT-66 | ❌ FAIL | `Error: not implemented` at ops.ts:345 |

No import errors. No syntax errors. No structural test defects. Every failure is the stub throw.

---

## Phase B Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Every requirement has at least one test | ✅ PASS | See coverage table below |
| 2 | All error paths covered | ✅ PASS | Unknown key (DT-61), unknown field (DT-62) |
| 3 | All edge cases covered | ✅ PASS | Absent param (DT-63), deep-merge (DT-66) |
| 4 | Tests fail at assertion level — no import/syntax errors | ✅ PASS | All 7 fail at ops.ts:345 exactly |
| 5 | Tests are independent (no shared mutable state) | ✅ PASS | Each test writes to `tmpDir` and calls `makeCtx()` fresh; `beforeEach` recreates temp dir |
| 6 | DT-63 (absent param) already passes — stub is correctly gated | ✅ PASS | Guard is `rawEdgeStyles !== undefined && typeof rawEdgeStyles === "object"` |
| 7 | Deep-merge test is two-step (not single-step) | ✅ PASS | DT-66 makes two separate `patchHandler` calls |
| 8 | Edge key format matches the actual key produced by the parser | ✅ PASS | See analysis below |

---

## Requirement Coverage

T-01 specified in `workplan.md` line 254:
> `edgeStyles` argument to `accordo_diagram_patch`: `{ strokeColor, strokeWidth, strokeStyle, routing }` per edge key

| Behaviour | Test(s) | Correct? |
|-----------|---------|----------|
| `strokeColor` stored in `layout.edges[key].style.strokeColor` | DT-59 | ✅ |
| `routing` stored in `layout.edges[key].routing`, NOT in `.style` | DT-60, DT-65 | ✅ |
| Unknown edge key silently skipped (no throw) | DT-61 | ✅ |
| Unknown style field silently dropped (whitelist) | DT-62 | ✅ |
| Absent `edgeStyles` param → no error, edges unchanged | DT-63 | ✅ |
| Multiple style fields in one call all persisted | DT-64 | ✅ |
| `routing` + style fields together → routing at `EdgeLayout.routing`, style in `EdgeLayout.style` | DT-65 | ✅ |
| Partial patch does not clobber previously set style fields (deep-merge guard) | DT-66 | ✅ |

---

## Edge Key Format Verification

**Concern:** Do the tests use the right key `"A->B:0"` for `SIMPLE_FLOWCHART = "flowchart TD\nA-->B\n"`?

**Verified:**

1. `packages/diagram/src/parser/flowchart.ts` lines 134–147: the parser assigns ordinals
   per `(from, to)` pair using a counter. For a single `A --> B` edge the ordinal is `0`.
2. `packages/diagram/src/canvas/canvas-generator.ts` lines 37–38:
   ```typescript
   function edgeKey(from: string, to: string, ordinal: number): string {
     return `${from}->${to}:${ordinal}`;
   }
   ```
3. `packages/diagram/src/layout/auto-layout.ts` lines 155–158 uses the same
   `` `${edge.from}->${edge.to}:${edge.ordinal}` `` template.

Therefore `"A->B:0"` is the exact key produced for the only edge in `SIMPLE_FLOWCHART`.  
All 7 tests that reference `layout.edges["A->B:0"]` are using the correct key. ✅

---

## Deep-Merge Test Analysis (DT-66)

DT-66 (`diagram-tools.test.ts` lines 1215–1245) is a genuine two-step patch:

```
Step 1  patchHandler({ edgeStyles: { "A->B:0": { strokeColor: "#f00" } } })
Step 2  patchHandler({ edgeStyles: { "A->B:0": { strokeWidth: 2 } } })

Assert  layout.edges["A->B:0"].style.strokeColor === "#f00"   ← NOT wiped by step 2
Assert  layout.edges["A->B:0"].style.strokeWidth === 2
```

The test reads the layout file after both patches — not after step 1. This means it
can only pass if the implementation merges into the existing style rather than replacing
it. A naïve `style: styleFields` implementation would wipe `strokeColor` and fail the
first assertion. This is the exact trap identified in FINDING-2 of the Phase A review
and confirmed resolved in the A re-check. ✅

---

## Test Independence Verification

Every test in the `patchHandler edgeStyles — T-01` describe block follows the same
three-phase structure:

1. `await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART)` — fresh file
2. Initial `patchHandler` call to create the layout (required to populate `edges["A->B:0"]`)
3. The actual patch under test

The `tmpDir` is created fresh in `beforeEach` (confirmed from `beforeEach`/`afterEach`
at top of the test file). `makeCtx()` is called per-invocation. No mutable state leaks
between tests. ✅

---

## DT-63 Pass Rationale

DT-63 does NOT use `edgeStyles`, so `rawEdgeStyles` is `undefined` and the stub guard
`(rawEdgeStyles !== undefined && typeof rawEdgeStyles === "object")` evaluates to `false`.
The stub is never entered. The test passes because:

1. First `patchHandler` call creates layout with `edges["A->B:0"]`.
2. Second `patchHandler` call (no `edgeStyles`) re-runs without touching edges.
3. `layoutAfter.edges` deep-equals `layoutBefore.edges`. ✅

This is the correct design. It proves absent `edgeStyles` is safe, which is the
backwards-compatibility guarantee of the optional parameter.

---

## Minor Observations (non-blocking)

1. **DT-62 type cast:** The test uses `as Record<string, unknown>` to pass `unknownField`
   past TypeScript's type checker. This is the correct pattern for testing whitelist
   behaviour — the cast is intentional and narrowly scoped to the test assertion. ✅

2. **No test for `edgeStyles: {}`** (empty object): An empty `edgeStyles` would pass
   the `rawEdgeStyles !== undefined` guard and enter the stub. This edge case is not
   covered, but it is a no-op in any correct implementation (nothing to iterate) and is
   not a named requirement. **Non-blocking** — acceptable to defer to Phase D coverage.

3. **`strokeDash` not tested:** `EdgeStyle.strokeDash` is in the schema but no test
   directly targets it. It is a legacy alias for `strokeStyle: "dashed"` (per the
   `EdgeStyle` type comment). Since it follows the same whitelist path as `strokeColor`,
   the path is covered by shape. **Non-blocking.**

---

## Summary

- **Test count:** 558 total, 7 FAIL (`Error: not implemented`), 551 PASS. Matches reported counts. ✅
- **All 8 DT-59..DT-66 tests present and accounted for.** ✅
- **All failures are stub throws — no structural defects in the tests.** ✅
- **DT-63 passes correctly (correct gate logic in stub).** ✅
- **DT-66 is a genuine two-step deep-merge test.** ✅
- **Edge key `"A->B:0"` is correct for `SIMPLE_FLOWCHART`.** ✅
- **Tests are independent — no shared mutable state.** ✅
- **Coverage is complete against all T-01 requirements.** ✅

**→ GREEN LIGHT. Phase C (implementation) may proceed.**
