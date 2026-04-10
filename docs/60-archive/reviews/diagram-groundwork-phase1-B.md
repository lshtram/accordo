# Review — diagram-groundwork-phase1 — Phase B

**Reviewer:** reviewer agent  
**Date:** 2026-04-05  
**Scope:** Generic spatial diagram groundwork — packages/diagram (Phase 1 TDD)  
**Files reviewed:**
- `packages/diagram/src/__tests__/types.test.ts`
- `packages/diagram/src/__tests__/layout-store.test.ts`
- `packages/diagram/src/__tests__/parser.test.ts`

---

## Verdict: PASS WITH FINDINGS

The test suite is structurally sound and the Phase B RED run is confirmed. All five stated
assertion-level failures reproduce exactly as reported. No import errors. Three tests that
were described as green (R1, layout-store happy paths) are indeed already green due to the
existing implementation. The findings below are **informational** and two require attention
before B2 is presented to the user.

---

## RED Run Evidence

```
 FAIL  src/__tests__/types.test.ts (44 tests | 3 failed)
   × REQ-R2: NodeShape explicitly includes stateStart and stateEnd
   × REQ-R3: ExcalidrawElement.type explicitly includes line and freedraw
   × REQ-R4: LayoutStore declares optional metadata alongside version 1.0 fields

 FAIL  src/__tests__/parser.test.ts (65 tests | 2 failed)
   × REQ-R5: classDiagram unsupported error is driven by registered parsers
   × REQ-R6: sequenceDiagram remains unsupported without advertising non-registered support

 PASS  src/__tests__/layout-store.test.ts (55 tests)
```

Total: 5 test failures at assertion level. Zero import errors. Confirms Phase B RED state.

---

## Requirement Coverage Matrix

| Req | Description | Test file | Test name | RED? |
|-----|-------------|-----------|-----------|------|
| R1 | `ParsedDiagram.direction` optional | types.test.ts line 61 | `REQ-R1: …direction is declared optional` | GREEN (pre-existing) |
| R1 | direction type-check | types.test.ts line 226 | `ParsedDiagram > direction is optional direction union` | GREEN (pre-existing) |
| R2 | `NodeShape` includes `stateStart` | types.test.ts line 65–66 | `REQ-R2: NodeShape explicitly includes stateStart and stateEnd` | RED ✓ |
| R2 | `NodeShape` includes `stateEnd` | types.test.ts line 65–67 | (same test, second assert) | RED ✓ |
| R3 | `ExcalidrawElement.type` includes `line` and `freedraw` | types.test.ts line 70–72 | `REQ-R3: ExcalidrawElement.type explicitly includes line and freedraw` | RED ✓ |
| R4 | `LayoutStore` schema declares `metadata?:` | types.test.ts line 74–76 | `REQ-R4: LayoutStore declares optional metadata alongside version 1.0 fields` | RED ✓ |
| R4 | runtime round-trip preserves `metadata` | layout-store.test.ts line 309–330 | `REQ-R4: preserves optional metadata during version 1.0 write/read round-trip` | GREEN (runtime already works) |
| R5 | error text derived from registered parsers | parser.test.ts line 621–632 | `REQ-R5: classDiagram unsupported error…` | RED ✓ |
| R6 | sequence unsupported; stale type list absent | parser.test.ts line 634–643 | `REQ-R6: sequenceDiagram remains unsupported…` | RED ✓ |

All six requirements have at least one test. R1 and the R4 runtime path are already green
due to the pre-existing implementation — this is correct (spec-conformant) behaviour, not a
premature green.

---

## Findings

### F-1 (HIGH) — R3 type-check test has a scope mismatch with the schema test

**File:** `types.test.ts`, lines 315–321 (ExcalidrawElement describe block)

The schema-source test (R3, line 70–72) correctly asserts that `ExcalidrawElement.type`
must include `"line"` and `"freedraw"` in the source text.

However, the companion `expectTypeOf` test at line 315–321 asserts the *old* narrow union:

```typescript
expectTypeOf<ExcalidrawElement["type"]>().toEqualTypeOf<
  "rectangle" | "diamond" | "ellipse" | "arrow" | "text"
>();
```

This test is currently **green** only because the current source matches the old union.
Once the developer adds `| "line" | "freedraw"` to satisfy R3, this `expectTypeOf` test
will flip **red** and block Phase D completion. The developer will then face a choice:
either weaken the type test (bad) or widen the `toEqualTypeOf` check to include `line` and
`freedraw` (correct).

**Required fix:** The `expectTypeOf` at line 315–321 must be updated **now** in Phase B to
include `"line"` and `"freedraw"` in the expected union. This ensures it fails RED today and
turns green together with the R3 schema test after Phase C implementation. Leaving it as-is
creates a silent regression trap.

---

### F-2 (MEDIUM) — R5 test does not verify the full registered-parser list is reflected in the error

**File:** `parser.test.ts`, lines 621–632

The R5 test correctly asserts the error message contains `"classDiagram"`, `"flowchart"`,
and `"stateDiagram-v2"`, and does NOT contain `"diag.1"` or the stale phrase
`"flowchart and stateDiagram-v2 only"`. This is sufficient to force the implementation to
stop hardcoding those exact strings.

However, the test only checks for two of the registered parsers by name. The full
`PARSERS` registry in `adapter.ts` currently contains `flowchart` and `stateDiagram-v2`.
The test does not assert that all registered parsers appear in the error message, so a
future registration of a third parser (e.g. `classDiagram`) without updating the error
message would not be caught.

This is a **medium** risk — it is a Phase 1 groundwork review and the full parser list is
not yet finalized — so this finding does **not block B2**. It is flagged for the developer
to keep in mind when implementing the dynamic error string.

---

### F-3 (LOW) — R6 test asserts `not.toContain("erDiagram, mindmap, block-beta")` as a proxy

**File:** `parser.test.ts`, lines 634–643

The R6 test checks that the sequential-type error message for `sequenceDiagram` does NOT
contain the substring `"erDiagram, mindmap, block-beta"`. This is a valid proxy for "the
stale hardcoded type list has been removed", but it is tightly coupled to the exact current
error text. If the implementation changes the comma-separated format (e.g. to a bulleted
list), this test will pass trivially even if it still leaks unregistered types.

A stronger alternative would be to assert that the message only mentions types in
`SPATIAL_TYPES` (or the registered parsers). However, since R6 is specifically about
confirming sequence remains unsupported and not advertising support for unregistered types,
the current proxy is *adequate for Phase 1*.

No test change required. Noted for Phase C implementation guidance.

---

### F-4 (LOW) — `LayoutStore` R4 runtime test uses unsafe `as` cast without narrowing

**File:** `layout-store.test.ts`, line 319

```typescript
await writeLayout(filePath, layoutWithMetadata as LayoutStore);
```

And line 327:
```typescript
(result as LayoutStore & { metadata?: Record<string, unknown> })?.metadata
```

Both casts are in test code and are forced by the current `LayoutStore` type not yet
having the `metadata?:` field. Once Phase C adds the field, these casts become unnecessary.
The test-builder should revisit them after Phase C to remove the `as` casts and use the
proper typed field access. This is a **minor** smell in test code; it does not affect
correctness of the RED/GREEN cycle.

No test change required before B2.

---

## Required Test Changes Before B2

Only **F-1** requires a fix before the B2 user checkpoint:

| # | File | Line | Change |
|---|------|------|--------|
| 1 | `types.test.ts` | 315–321 | Extend the `toEqualTypeOf` for `ExcalidrawElement["type"]` to include `"line" \| "freedraw"` so the type test is RED now and turns green together with the R3 schema test. |

---

## Safety Assessment for B2

**Safe to present to user after F-1 is fixed.**

The test suite covers all six requirements. Five tests are correctly RED at assertion level
(not import-error level). The pre-existing green tests for R1 and the R4 runtime path are
correctly green. The structure, isolation, and fixture quality are high. The rich-fixture
approach in `layout-store.test.ts` provides excellent edge-case coverage for parallelism
and deduplication. The mermaid mock in `parser.test.ts` is clean, per-test, and correctly
isolated with `beforeEach` reset.

**Condition for B2 clearance:** test-builder fixes F-1 (the `toEqualTypeOf` for
`ExcalidrawElement["type"]`) and re-runs to confirm the updated test is RED, then this
review considers the B2 gate clear.
