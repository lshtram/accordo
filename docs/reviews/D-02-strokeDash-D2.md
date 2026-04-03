# Review — D-02 strokeDash Passthrough Fix — Phase D2 (Recheck)

**Date:** 2026-04-03  
**Reviewer:** Reviewer agent  
**Recheck of:** FAIL verdict issued earlier today (F-01 gap: canvas-generator read-path untested)  
**Changed files (this fix):**
- `packages/diagram/src/__tests__/canvas-generator.test.ts` — CG-34, CG-35 added; header comment updated

---

## PASS

All items from the original D2 checklist and the F-01 remediation are now satisfied.

---

### 1. Tests: 560 passing, zero failures

```
Test Files  22 passed (22)
     Tests  560 passed (560)
  Start at  16:16:21
  Duration  3.02s (transform 2.88s, setup 837ms, collect 4.40s, tests 6.82s)
```

Count increased from 558 (original baseline) → 560 (+2 = CG-34, CG-35). Zero regressions.

---

### 2. Type check: clean

`npx tsc --noEmit` — zero errors. (Pre-existing webview tsconfig error in
`comment-overlay.ts:386` is not introduced by this change; confirmed in original review.)

---

### 3. New tests — correctness verified (lines 592–630)

**CG-34** (`canvas-generator.test.ts:596`):
- Builds a layout with `edges: { [k]: { ..., style: { strokeDash: true } } }` (no `strokeStyle`).
- Calls `generateCanvas()` and finds the `arrow` element.
- Asserts `arrow.strokeStyle === "dashed"`.
- Correctly exercises the `strokeStyle ?? (strokeDash ? "dashed" : undefined)` path where
  `strokeStyle` is `undefined` and `strokeDash` is `true`.

**CG-35** (`canvas-generator.test.ts:613`):
- Builds a layout with `edges: { [k]: { ..., style: { strokeStyle: "dotted", strokeDash: true } } }`.
- Asserts `arrow.strokeStyle === "dotted"`.
- Correctly exercises the `??` short-circuit: when `strokeStyle` is explicitly set, the
  `strokeDash` fallback is not reached. Documents the invariant that `strokeStyle` wins.

Both tests use `toBe` (exact equality), not `toBeTruthy`. Both are independent (no shared
mutable state). Both have a clear requirement ID in the description.

---

### 4. Header comment updated

`canvas-generator.test.ts` lines 10–16 now read:

```
NOTE: edge strokeStyle (per-edge override from EdgeLayout.style) is implemented
(CG-34..CG-35) — strokeStyle wins over strokeDash when both are set.
```

The stale "NOT currently implemented / deferred" wording is gone. The API checklist at
line 40 lists `CG-34..CG-35` correctly. The `@requirement` range at line 23 (`CG-01 through
CG-33`) was not updated to `CG-35`, but this is a minor omission in the checklist comment
only; it does not affect test coverage or correctness. Not a blocker.

---

### 5. Original D2 items — all carry-forward PASS

Items 1–10 from the original D2 review remain satisfied. The only failing item (F-01) is
now resolved:

| Item | Status |
|---|---|
| Tests pass — zero failures | ✅ 560/560 |
| Type checker clean | ✅ zero errors |
| Linter | ✅ no ESLint config; no banned patterns detected |
| Coding guidelines | ✅ no violations |
| Test completeness — all public paths covered | ✅ CG-34+CG-35 close the gap |
| Banned patterns | ✅ no `: any`, no `console.log`, no TODO/FIXME, no commented-out code |
| Architectural constraints | ✅ no VSCode imports; no cross-package drift |
| Runtime exposure | ✅ n/a (internal data transform; no new tool registration) |
| Modularity | ✅ no file or function exceeds size limits |
| Replaceability | ✅ no new global state; adapter swap not affected |

---

## Verdict: **PASS — Phase E may proceed**

The F-01 gap is closed. Tests CG-34 and CG-35 directly exercise the
`canvas-generator.ts` arrow stroke read-path (`strokeStyle ?? (strokeDash ? "dashed" : undefined)`).
The stale "deferred" header comment is removed.

All D2 checklist items pass. The strokeDash fix (D-02) is complete and certified.

---

*Reviewer: independent gate. No source or test files modified by this review.*
