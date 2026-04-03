# Review — D-04 Z-Shape Waypoint Routing — Phase A

**Date:** 2026-04-03  
**Reviewer:** Independent gate (Phase A review)  
**Module:** `diagram / canvas / edge-router`  
**Source doc:** `docs/reviews/D-04-zshape-waypoints-A.md`  
**Verdict: PASS** — with three advisory notes, none blocking

---

## Verification Steps Performed

### 1. Test suite

```
pnpm test -- --run   (packages/diagram)

Test Files  1 failed | 21 passed (22)
      Tests  7 failed | 560 passed (567)
```

- **560 existing tests pass.** Backward compatibility is confirmed: 0-waypoint and 1-waypoint orthogonal paths are completely unaffected by the dispatch change.
- **7 new stubs fail at `Error: not implemented`** — correct Phase-A behaviour. No import errors, no test framework errors, no skips.
- Failing tests are exactly ER-16, ER-17, ER-18, ER-19, ER-20, ER-23, ER-24.

### 2. Type checker

```
npx tsc --noEmit   (packages/diagram)
```

Zero errors. The `_waypoints`, `_source`, `_target` parameter prefixes on the stub are correct TypeScript idiom for unused parameters.

---

## Architecture Correctness

### Dispatch logic — CORRECT

The three-way branch in `routeOrthogonal()` is sound and backward-compatible:

| `waypoints.length` | Code path | Status |
|---|---|---|
| 0 | L-shape (existing `pts = [[sx,sy],[tx,sy],[tx,ty]]` or V-variant) | Unchanged |
| 1 | Bend-hint (existing 4-point path) | Unchanged |
| ≥ 2 | New `routeOrthogonalMultiWaypoint()` | New stub |

The dispatch guard at line 193 (`>= 2`) fires before the existing `=== 1` branch, which is the correct order. The public `routeEdge()` signature is untouched.

### Staircase algorithm — CORRECT

The H-first L-junction algorithm was manually simulated for all test cases and several
non-test edge cases:

| Case | Result |
|---|---|
| 2 waypoints (ER-16: `L→DIAG`, wps at 150,200 and 300,250) | 7 points — satisfies `>= 5` ✓ |
| 3 waypoints (ER-17) | 9 points — satisfies `>= 6` ✓ |
| Collinear same-y wps (ER-23: `L→R`, y=200) | 6 points, no zero-length segments ✓ |
| Waypoint ON source centre | Dedup collapses the doubled point; path remains valid and `ER-20` still holds ✓ |
| Duplicate adjacent waypoints | Dedup removes the duplicate; no zero-length segment ✓ |
| U-shape (waypoint behind source) | 7 points, all axis-aligned ✓ |
| Reversed waypoint order | 7 points, all axis-aligned, endpoints correct ✓ |
| Waypoints outside source+target bounding box | Correct; algorithm makes no assumption about waypoint bounds ✓ |

**The horizontal-first (H-V) convention is correct and consistent** with the existing
1-waypoint code at `edge-router.ts:199` (`[bend.x, sy]` is a horizontal move first).
DEC-012 correctly records the rationale.

### Type adequacy — CORRECT

- `EdgeLayout.waypoints: ReadonlyArray<{readonly x: number; readonly y: number}>` is already present in `types.ts:126` — no schema change needed.
- `RouteResult.points: Array<[number, number]>` already supports variable length — no change needed.
- `routeOrthogonalMultiWaypoint` is module-private (no `export`) — correct encapsulation. Only `routeOrthogonal` calls it.

### Exclusion of `waypoints` from `edgeStyles` — CORRECT

DEC-011 documents this explicitly. The T-01 `edgeStyles` tool is already shipped with `waypoints` excluded. Including waypoints in the tool schema at this point would set wrong expectations about interactive drag-to-create behaviour, which is deferred. The MVP scope is limited to routing waypoints provided programmatically through future API calls, not by the MCP schema.

### Out-of-scope deferral — CORRECT

The three deferred items (edge mutation capture, waypoint UI, auto-waypoint computation) are correctly excluded. The stubs for `canvas:edge-routed` (protocol.ts:42–46, panel-core.ts:181–183) already exist — D-04 does not need to touch them.

---

## Test Quality

### Coverage against requirements table

| Req ID | Description | Test coverage |
|---|---|---|
| ER-16 | 2 waypoints → ≥ 5 points | ER-16 stub ✓ |
| ER-17 | 3 waypoints → ≥ 6 points | ER-17 stub ✓ |
| ER-18 | All segments axis-aligned | ER-18 stub ✓ |
| ER-19 | Path starts at source centre, ends at target centre | ER-19 stub ✓ |
| ER-20 | Each waypoint appears as a vertex in the path | ER-20 stub ✓ |
| ER-21 | 0-waypoint backward compat unchanged | Covered by existing ER-05, ER-06 ✓ |
| ER-22 | 1-waypoint backward compat unchanged | Covered by existing ER-07 ✓ |
| ER-23 | No zero-length segments from collinear wps | ER-23 stub ✓ |
| ER-24 | Null bindings for multi-waypoint paths | ER-24 stub ✓ |

All 9 requirements have test coverage. No requirement is untested.

### Test quality assessment — SOUND

- Tests are independent: no shared mutable state, all fixture boxes are `const`.
- ER-18 tests axis-alignment at the segment level (correct: `Δx=0 || Δy=0`).
- ER-20 tests each waypoint by exact coordinate match — appropriate given the algorithm emits waypoints as literal vertices.
- ER-23 tests the dedup invariant with the exactly relevant degenerate input (two same-y waypoints).
- All 7 stubs fail via `Error: not implemented` propagated from the stub — no false negatives.

---

## Advisory Notes (non-blocking)

### A1 — Minor: `docs/reviews/D-04-zshape-waypoints-A.md` §8 overclaims test count

Section 8 says "Nine new tests (ER-16 to ER-24)". There are actually **7 new test stubs**; ER-21 and ER-22 are covered by 3 pre-existing tests. The requirement table in §2 correctly notes this, so the contradiction is within the same document. Not a functional issue — worth correcting for accuracy, but does not block Phase B.

### A2 — Note: ER-20 (waypoint-on-path) relies on exact float equality

`ER-20` checks `px === wp.x && py === wp.y`. The staircase algorithm writes waypoints as literal vertices by design, so exact integer equality will always hold for the current implementation. However, if a future implementation uses a smoothing or snapping pass that nudges coordinates, this test would correctly fail as a regression guard. The assertion is intentional and correct for the current design.

### A3 — Missing test for 2 waypoints forming a U-shape / backward path

The test suite covers forward-progressing waypoints (ER-16 through ER-20) and collinear cases (ER-23). There is no test for waypoints that cause a reversal — e.g., a waypoint whose x-coordinate is less than the source x (creating a U or S shape). Simulation confirms the algorithm handles these correctly (all axis-aligned, correct endpoints), but a regression test would strengthen the contract. **Recommended for Phase B**, but not required to unblock it.

---

## Verdict

**PASS.** The Phase A design is correct, feasible, and complete for the MVP scope.

- The staircase algorithm is correct and consistent with existing 1-waypoint behaviour.
- All 9 requirements have test coverage (7 new stubs + 3 reused existing tests).
- Backward compatibility is fully preserved: 560 existing tests pass, zero regressions.
- Type system is clean. DEC-012 records the design decision.
- Advisory A3 (U-shape regression test) is recommended but does not block Phase B.

**Phase B (test implementation) may proceed.**
