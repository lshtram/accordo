# D-04 Phase B Review — Z-Shape Waypoint Routing Tests

**Date:** 2026-04-03 (recheck after ER-17 fix)
**Module:** diagram / canvas / edge-router  
**Phase:** B (test-builder)  
**Reviewer:** Reviewer agent  
**Status:** ✅ PASS

---

## Test Run Result

```
Tests  8 failed | 560 passed (568)
```

All 8 new tests (ER-16..ER-25) fail at the stub level with `Error: not implemented`
from `routeOrthogonalMultiWaypoint`. No import errors. No test-framework errors.  
All 560 existing tests pass — backward compatibility confirmed.

---

## ER-17 Arithmetic Verification

Previous review flagged `toBe(7)` as wrong. Fix applied: assertion is now `toBe(9)`.

Manual trace of the H-first staircase algorithm for ER-17 inputs:

| Pair | From | To | H-first corner | Points emitted |
|---|---|---|---|---|
| S→W1 | (90,130) | (150,200) | (150,130) | `(90,130),(150,130),(150,200)` |
| W1→W2 | (150,200) | (250,250) | (250,200) | `+(250,200),(250,250)` |
| W2→W3 | (250,250) | (350,280) | (350,250) | `+(350,250),(350,280)` |
| W3→T | (350,280) | (390,330) | (390,280) | `+(390,280),(390,330)` |

Full path: `(90,130),(150,130),(150,200),(250,200),(250,250),(350,250),(350,280),(390,280),(390,330)` = **9 points**

No adjacent duplicates. No collinear collapsing. `toBe(9)` is **correct**.

JavaScript simulation confirms count: 9. ✓

---

## ER-16 Arithmetic Verification

H-first trace for ER-16 inputs (`LEFT→DIAG`, waypoints `[(150,200),(300,250)]`):

| Pair | From | To | H-first corner | Points emitted |
|---|---|---|---|---|
| S→W1 | (90,130) | (150,200) | (150,130) | `(90,130),(150,130),(150,200)` |
| W1→W2 | (150,200) | (300,250) | (300,200) | `+(300,200),(300,250)` |
| W2→T  | (300,250) | (390,330) | (390,250) | `+(390,250),(390,330)` |

Full path: 7 points. `toBe(7)` is **correct**. ✓

---

## Phase B Checklist

| Check | Result |
|---|---|
| Every requirement (ER-16..ER-24) has ≥ 1 test | ✓ — ER-16..ER-20, ER-23, ER-24, ER-25 present |
| ER-21, ER-22 (backward compat) covered by pre-existing tests | ✓ — ER-05, ER-06, ER-07 still pass |
| All 8 new tests fail at assertion/stub level (not import or syntax errors) | ✓ — all throw `Error: not implemented` from stub |
| No test fails due to a wrong assertion (assertion-level only once implemented) | ✓ — all assertions verified correct by manual trace and simulation |
| Tests are independent (no shared mutable state between tests) | ✓ — all inputs are local constants, no module-level mutation |
| Backward compatibility: 0-waypoint and 1-waypoint tests still pass | ✓ — ER-05, ER-06, ER-07, ER-09 all green |
| ER-17 `toBe(9)` correct | ✓ — fixed; arithmetic confirmed |
| ER-16 `toBe(7)` correct | ✓ — arithmetic confirmed |
| ER-18 axis-aligned invariant | ✓ — correct invariant; excellent per-segment error message |
| ER-19 endpoint coordinates | ✓ — precise `toEqual([sx,sy])` / `toEqual([tx,ty])` assertions with guard |
| ER-20 waypoint fidelity | ✓ — loop checks every waypoint appears in path |
| ER-23 no zero-length segments | ✓ — collinear same-y geometry; `hypot` check clean |
| ER-24 null bindings contract | ✓ — explicit-path contract verified |
| ER-25 reversed waypoint ordering | ✓ — crash guard + axis-aligned + waypoint-presence all checked |

---

## Test Quality Notes

- **ER-18, ER-25** include per-segment diagnostic messages with coordinates — excellent for debugging Phase C failures.
- **ER-19, ER-20** combine a path-length guard (`> waypoints.length + 2`) with the substantive assertion, preventing false-green on a degenerate 2-point stub.
- **ER-25** is a particularly valuable regression test: reversed ordering exercises a non-obvious path through the algorithm that would expose incorrect assumption about monotone ordering.
- All tests use the shared `LEFT`, `RIGHT`, `DIAG` constants — consistent with ER-01..ER-15 conventions.

---

## Coverage Gap Assessment (Informational — Not Blocking)

| Gap | Severity | Notes |
|---|---|---|
| Waypoint coincides with source/target centre | Low | Degenerate; dedup handles it; can add post-Phase C if needed |
| Source and target at same y with 2 waypoints | Low | ER-23 partially covers collinear geometry |
| Waypoint behind source (U-shape) | Low | ER-25 covers backward routing partially |

These are acceptable gaps. The 8 tests provide sufficient coverage to drive Phase C.

---

## Summary

| Item | Status |
|---|---|
| Test count | 568 total (560 pass, 8 fail as expected) |
| All 8 new tests fail at stub level | ✓ |
| All 8 failure modes are `Error: not implemented` | ✓ |
| Backward compat tests still pass | ✓ |
| ER-16 `toBe(7)` correct | ✓ |
| ER-17 `toBe(9)` correct (fixed) | ✓ |
| ER-18..ER-20, ER-23..ER-25 assertions correct | ✓ |
| Tests independent / no shared state | ✓ |

**VERDICT: PASS — Phase B is complete. Phase C (implementation) may begin.**
