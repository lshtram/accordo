# Review — D-04 Z-Shape Waypoint Routing — Phase D2

**Date:** 2026-04-03  
**Module:** diagram / canvas / edge-router  
**Phase:** D2 (post-implementation gate)  
**Reviewer:** Reviewer agent  
**Status:** ✅ PASS (3 minor issues — soft, not blocking)

---

## Review Checklist

### PASS

#### 1. Tests: 568 passing, zero failures

```
Test Files  22 passed (22)
      Tests  568 passed (568)
   Start at  17:15:54
   Duration  3.04s
```

All 8 new tests (ER-16, ER-17, ER-18, ER-19, ER-20, ER-23, ER-24, ER-25) are green.  
All 560 pre-existing tests remain green — full backward compatibility confirmed.

#### 2. Type check: clean

```
cd packages/diagram && npx tsc --noEmit
(no output — zero errors)
```

`strict: true` is enforced via `tsconfig.base.json`. No `any`, no unsafe casts, no type errors.

#### 3. Linter: no ESLint config in diagram package

The `packages/diagram` package does not have an `eslint.config.mjs`. Linting is not
configured here. Manual scan for banned patterns applied instead (see §4 below).

#### 4. Banned patterns: clean

| Pattern | Result |
|---|---|
| `: any` | Not found |
| `as any` / `as unknown` casts | Not found |
| `@ts-ignore` / `@ts-nocheck` | Not found |
| `TODO` / `FIXME` | Not found |
| `console.log` in production path | Not found |
| Hardcoded values that should be config | None (geometry is algorithmic, not configurable) |
| Commented-out code | Not found |

#### 5. Algorithm correctness: verified by manual trace

**ER-16 trace** (2 waypoints, LEFT→DIAG, S=(90,130), T=(390,330)):

| Pair | From | To | H-corner `[x2,y1]` | V-end `[x2,y2]` | Points emitted |
|---|---|---|---|---|---|
| S→W1 | (90,130) | (150,200) | (150,130) | (150,200) | `(90,130),(150,130),(150,200)` |
| W1→W2 | (150,200) | (300,250) | (300,200) | (300,250) | `+(300,200),(300,250)` |
| W2→T | (300,250) | (390,330) | (390,250) | (390,330) | `+(390,250),(390,330)` |

Full path: `[(90,130),(150,130),(150,200),(300,200),(300,250),(390,250),(390,330)]` = **7 points** ✓

**ER-17 trace** (3 waypoints, LEFT→DIAG, confirmed 9 points) ✓ (from Phase B review)

**ER-23 trace** (collinear waypoints at y=200, LEFT→RIGHT):  
Path: `[(90,130),(150,130),(150,200),(250,200),(390,200),(390,130)]` — 6 points, zero zero-length segments ✓

**ER-25 trace** (reversed waypoints `[W2=(300,250), W1=(150,200)]`, LEFT→DIAG):  
Path: `[(90,130),(300,130),(300,250),(150,250),(150,200),(390,200),(390,330)]` — 7 points.  
All segments axis-aligned ✓. Both waypoints present in path ✓. No crash ✓.

#### 6. Architecture compliance

- Pure geometry module — no Excalidraw imports, no VSCode imports ✓
- No side effects — `routeOrthogonalMultiWaypoint` is a pure function ✓
- Returns `startBinding: null, endBinding: null` — correct for explicit-path modes ✓
- Dispatch in `routeOrthogonal` correctly routes `waypoints.length >= 2` to the new function ✓
- 0-waypoint and 1-waypoint paths unchanged ✓

#### 7. DEC-012 decision recorded

`docs/decisions.md` contains `DEC-012` (dated 2026-04-03) documenting the H-first
L-junction decision for multi-waypoint routing. JSDoc on `routeOrthogonalMultiWaypoint`
references the requirement range `ER-16..ER-24`. Traceability is complete.

#### 8. Modularity and size

| Metric | Value | Limit |
|---|---|---|
| `routeOrthogonalMultiWaypoint` body | 33 lines | 40 lines |
| `edge-router.ts` total | 263 lines | 200 lines (implementation) |
| Nesting depth | 2 (loop → if) | 4 |
| Cyclomatic complexity | 5 (loop + 2 ifs + 2 conditions) | 10 |

> Note on file length: the 200-line limit in coding-guidelines §3.4 applies to
> "implementation code (stubs + docs don't count)". The file has ~110 lines of
> JSDoc/comments. The implementation body is ~120 lines — within limit.

#### 9. Test quality

All 8 new tests follow the Phase B-approved contract:
- Each test is independent (local constants only, no shared mutable state)
- All use `LEFT`, `RIGHT`, `DIAG` fixture constants (consistent with ER-01..ER-15)
- ER-18 and ER-25 include per-segment diagnostic messages — excellent debuggability
- ER-19 and ER-20 use path-length guards to prevent false-green on degenerate stubs
- No `toBeTruthy()` / `toBeFalsy()` — all assertions use specific matchers

---

### MINOR ISSUES — Soft (not blocking Phase E)

These issues are real but do not affect correctness, tests, or type safety.
They should be addressed in a cleanup commit before or during Phase E.

---

**MINOR-1 — `edge-router.ts:193` — Unused destructured variable `x1`**

```typescript
// Line 193 — as written
const [x1, y1] = controls[i]!;
```

`x1` is never referenced in any expression in the loop body. It is used only in the
comment on line 195 (`// Horizontal-first: go to (x2, y1)`, which mentions `x2` and `y1`,
not `x1`). The current naming implies `x1` is captured for use, which is misleading.

**Fix:** Prefix with underscore to signal intentional non-use:
```typescript
const [_x1, y1] = controls[i]!;
```

---

**MINOR-2 — `edge-router.ts:193,194,199,203` — Non-null assertions lack why-null-is-impossible comment**

Coding guidelines §1.1: *"Every `!` requires a one-line comment explaining why null is impossible here."*

There are 4 `!` assertions in `routeOrthogonalMultiWaypoint`:
- Line 193: `controls[i]!` — loop guard `i < controls.length - 1` ensures index is valid
- Line 194: `controls[i + 1]!` — same guard ensures `i + 1 < controls.length`
- Line 199: `pts[pts.length - 1]!` — `pts` is initialized with `[sx, sy]`, always ≥ 1 element
- Line 203: `pts[pts.length - 1]!` — same guarantee

The justification for each assertion is correct but not stated inline. The dedup comments
on lines 198 and 202 describe *what* the check does, not *why* `!` is safe.

**Fix:** Add brief inline explanation to each:
```typescript
const [_x1, y1] = controls[i]!;    // safe: loop bound i < controls.length - 1
const [x2, y2]  = controls[i + 1]!; // safe: i + 1 <= controls.length - 1 by loop guard
// ...
if (pts[pts.length - 1]![0] !== ...) // safe: pts always has ≥1 element (S pushed before loop)
```

---

**MINOR-3 — `edge-router.ts:177-180` — Parameters prefixed with `_` despite being used**

```typescript
function routeOrthogonalMultiWaypoint(
  _waypoints: ReadonlyArray<...>,
  _source: BoundingBox,
  _target: BoundingBox
): RouteResult {
```

TypeScript convention: a leading `_` signals "intentionally unused". All three parameters
are in fact used (`_waypoints` in the for-loop, `_source` and `_target` in `centre()` calls).
The prefix is misleading and violates coding-guidelines §1.2 (parameters use `camelCase`).

This pattern may have been left from an earlier stub that had `_` prefixes to suppress
the `noUnusedParameters` warning. The stub phase is over.

**Fix:** Remove underscore prefixes:
```typescript
function routeOrthogonalMultiWaypoint(
  waypoints: ReadonlyArray<...>,
  source: BoundingBox,
  target: BoundingBox
): RouteResult {
```

---

## Summary

| Check | Status |
|---|---|
| Tests: 568 passing, 0 failures | ✅ PASS |
| Type check: tsc --noEmit clean | ✅ PASS |
| Linter: no config in package (manual scan applied) | ✅ PASS |
| Banned patterns: clean | ✅ PASS |
| Algorithm correctness (ER-16, ER-17, ER-23, ER-25 traced) | ✅ PASS |
| Backward compatibility (ER-01..ER-15 green) | ✅ PASS |
| Architecture constraints (no side effects, null bindings, no vscode imports) | ✅ PASS |
| DEC-012 decision recorded | ✅ PASS |
| Function length ≤ 40 lines | ✅ PASS (33 lines) |
| File length within limits | ✅ PASS |
| No TODO/FIXME/console.log | ✅ PASS |
| MINOR-1: unused `x1` variable (misleading destructure) | ⚠️ Soft |
| MINOR-2: 4 non-null assertions lack explaining comment | ⚠️ Soft |
| MINOR-3: used parameters prefixed with `_` (misleading) | ⚠️ Soft |

**VERDICT: PASS — Phase D is complete. Phase E (user approval) may begin.**

The 3 minor issues are style and documentation violations (not correctness failures).
They should be fixed in a `refactor(diagram)` cleanup commit. They are not blocking
because:
- The type checker passes with them present
- No test asserts on parameter names or variable names
- The algorithm is correct — the `x1` unused var and `_` prefixes do not affect runtime behaviour
- The missing `!` comments are documentation gaps, not safety issues (the assertions are logically sound)
