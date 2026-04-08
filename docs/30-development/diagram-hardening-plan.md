# Diagram Parser/Placement Hardening — Execution Plan

**Date:** 2026-04-08  
**Phase:** 0 (foundation hardening before diag.2 implementation gaps)  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)  
**Requirements addendum:** `docs/20-requirements/requirements-diagram-hardening.md`  
**Status:** PLANNED

---

## 1. Motivation

Reviewer evaluation of the diag.1 engine (568 tests, A1–A18 modules) identified five structural weaknesses that will compound during diag.2 work (new parsers, fine-grained topology tools, undo/redo). Fixing them now — before adding new features — prevents drift and reduces rework.

### Reviewer Findings (ranked by cascade risk)

| # | Finding | Cascade risk | Modules affected |
|---|---------|-------------|------------------|
| 1 | Parser exception containment gap | HIGH — unhandled throw in per-type parser crashes the full parse path | `adapter.ts`, `flowchart.ts`, `state-diagram.ts`, `class-diagram.ts` |
| 2 | Geometry dimensions duplicated across placement/shape-map | HIGH — adding new shapes requires updating two independent tables | `placement.ts`, `shape-map.ts` |
| 3 | Orthogonal routing contract inconsistency by waypoint count | MEDIUM — callers cannot rely on a stable point-count invariant | `edge-router.ts` |
| 4 | Layout-store validation too shallow | MEDIUM — corrupt JSON with correct version/type passes silently | `layout-store.ts` |
| 5 | Scene-adapter opacity leak (hardcoded 100) | LOW — visual-only; no data loss | `scene-adapter.ts` |

---

## 2. First 10 PRs — Breakdown

### Dependency Order

```
PR-01 (shape-dims)
  └─→ PR-02 (placement-reuse) ─→ PR-03 (placement-tests)
PR-04 (parser-containment)
  └─→ PR-05 (parser-tests)
PR-06 (route-contract)
  └─→ PR-07 (route-tests)
PR-08 (layout-validation)
  └─→ PR-09 (layout-tests)
PR-10 (opacity-fix) — independent
```

PRs 01–03 and 04–05 and 06–07 and 08–09 are four independent chains. PR-10 is standalone. All chains can proceed in parallel.

---

### PR-01: Extract canonical shape dimensions from shape-map

**Scope:** Export a `getShapeDimensions(shape: NodeShape): { w: number; h: number }` function from `shape-map.ts`. This is a pure read of the existing `SHAPE_TABLE` — no new data, just a new accessor.

**Target files:**
- `packages/diagram/src/canvas/shape-map.ts` — add `getShapeDimensions()` export

**Risk level:** LOW  
**Acceptance tests:**
- `getShapeDimensions("rectangle")` returns `{ w: 180, h: 60 }`
- `getShapeDimensions("diamond")` returns `{ w: 140, h: 80 }`
- `getShapeDimensions("unknown_future_shape")` returns `{ w: 180, h: 60 }` (fallback)
- All existing shape-map tests still pass (no regressions)

**Rollback strategy:** Revert commit; no callers depend on the new export yet.

---

### PR-02: Replace placement's SHAPE_DIMS with shape-map import

**Scope:** Remove the duplicated `SHAPE_DIMS` constant and `dimForShape()` from `placement.ts`. Replace with `import { getShapeDimensions } from "../canvas/shape-map.js"`.

**Target files:**
- `packages/diagram/src/reconciler/placement.ts` — remove lines 44–63 (`SHAPE_DIMS`, `FALLBACK_DIMS`, `dimForShape`), import `getShapeDimensions`

**Risk level:** MEDIUM — changes the dimension lookup path for placement; if `getShapeDimensions` returns different values than the old table, node positions shift.  
**Acceptance tests:**
- All 24 existing placement tests pass unchanged (dimensions are identical)
- Manual: create a new diagram, add 3 nodes, verify no overlap or position shift vs. baseline

**Rollback strategy:** Restore the deleted `SHAPE_DIMS` block from git; no schema changes.

---

### PR-03: Add cross-module dimension consistency test

**Scope:** Add a dedicated test that asserts `getShapeDimensions(shape)` returns the same `{ w, h }` for every shape that placement previously hardcoded. This test locks the single-source-of-truth invariant.

**Target files:**
- `packages/diagram/src/__tests__/shape-dims-consistency.test.ts` — new test file

**Risk level:** LOW  
**Acceptance tests:**
- Test file compiles and passes
- Covers all shapes from the old `SHAPE_DIMS`: rectangle, rounded, stadium, parallelogram, diamond, hexagon, circle, ellipse, cylinder, subgraph

**Rollback strategy:** Delete test file.

---

### PR-04: Wrap per-type parser dispatch in try/catch

**Scope:** In `adapter.ts`, wrap the `parser(db)` call (line 211) in a try/catch that converts unexpected exceptions into `{ valid: false, error }` results. Also add a type guard for the mermaid error catch at line 176–184.

**Target files:**
- `packages/diagram/src/parser/adapter.ts` — lines 176–184 (type guard), line 211 (wrap)

**Risk level:** MEDIUM — changes error propagation path; must not swallow legitimate parse errors that currently produce valid `{ valid: false }` results.  
**Acceptance tests:**
- A per-type parser that throws returns `{ valid: false }` with the thrown message
- A per-type parser that throws a non-Error (string, number) returns `{ valid: false }` with `String(thrown)`
- The mermaid API catch (line 176) uses `instanceof Error` instead of unsafe `as` cast
- All 67 existing parser tests pass unchanged

**Rollback strategy:** Revert the two catch blocks to their previous form.

---

### PR-05: Add parser exception containment tests

**Scope:** Add tests for the new containment boundary: mock a parser that throws, verify `parseMermaid()` returns `{ valid: false }` instead of propagating.

**Target files:**
- `packages/diagram/src/__tests__/parser-containment.test.ts` — new test file

**Risk level:** LOW  
**Acceptance tests:**
- Tests mock a throwing parser entry in `PARSERS` dispatch
- Assert `valid === false` and `error.message` contains the thrown message
- At least 3 cases: Error throw, string throw, null throw

**Rollback strategy:** Delete test file.

---

### PR-06: Normalise orthogonal routing point-count contract

**Scope:** Enforce a consistent point-count invariant for each routing mode in `routeEdge()`: auto = 2, direct = 2+N, orthogonal ≥ 3, self-loop = 4. Update `RouteResult` JSDoc to match. Add post-condition assertion inside `routeOrthogonal` and `routeOrthogonalMultiWaypoint`.

**Target files:**
- `packages/diagram/src/canvas/edge-router.ts` — update `RouteResult` JSDoc, add post-condition check in `routeOrthogonal` (if points < 3 after computation, pad with midpoint)

**Risk level:** MEDIUM — changes output shape for edge cases; downstream consumers (canvas-generator) must handle the invariant.  
**Acceptance tests:**
- 0 waypoints → exactly 3 points (L-shape, already the case)
- 1 waypoint → exactly 4 points (bend, already the case)
- 2+ waypoints → ≥ 3 points (staircase, already the case)
- Self-loop → exactly 4 points (already the case)
- Post-condition: `routeEdge(...).points.length >= 2` always (auto=2, orthogonal≥3)
- All 15 existing edge-router tests pass

**Rollback strategy:** Remove the post-condition assertion; restore original JSDoc.

---

### PR-07: Add orthogonal routing contract tests

**Scope:** Add explicit tests that assert the point-count contract for every routing mode × waypoint count combination.

**Target files:**
- `packages/diagram/src/__tests__/edge-router-contract.test.ts` — new test file

**Risk level:** LOW  
**Acceptance tests:**
- Tests cover: auto (2 pts), direct (2+N pts), orthogonal/0wp (3 pts), orthogonal/1wp (4 pts), orthogonal/2+wp (≥5 pts), self-loop (4 pts)
- All pass

**Rollback strategy:** Delete test file.

---

### PR-08: Deepen layout-store validation in readLayout

**Scope:** After the version/type check in `readLayout()`, validate structural shape:
- `nodes` is an object; each entry has numeric `x`, `y`, `w`, `h` and an object `style`
- `edges` is an object; each entry has string `routing` and array `waypoints`
- `clusters` is an object; each entry has numeric `x`, `y`, `w`, `h` and string `label`
- `unplaced` is an array of strings
- `aesthetics` is an object

Return `null` for any violation (same behaviour as corrupt JSON).

**Target files:**
- `packages/diagram/src/layout/layout-store.ts` — `readLayout()` function (lines 57–69)

**Risk level:** MEDIUM — tighter validation may reject previously-accepted layout files if they have unexpected shapes (e.g., missing `style` on a node). Mitigation: log a warning (via returned null) so the reconciler regenerates the layout.  
**Acceptance tests:**
- Valid layout.json → returned as LayoutStore (existing tests)
- Missing `nodes` field → null
- Node with string `x` → null
- Edge with missing `routing` → null
- `unplaced` is object instead of array → null
- `aesthetics` is string → null
- All 54 existing layout-store tests pass

**Rollback strategy:** Revert `readLayout()` to version/type-only check.

---

### PR-09: Add layout-store validation edge-case tests

**Scope:** Dedicated test file for the new validation rules.

**Target files:**
- `packages/diagram/src/__tests__/layout-store-validation.test.ts` — new test file

**Risk level:** LOW  
**Acceptance tests:**
- At least 8 test cases covering each validation rule
- All pass

**Rollback strategy:** Delete test file.

---

### PR-10: Pass element opacity through scene-adapter

**Scope:** In `toExcalidrawPayload()`, replace hardcoded `opacity: 100` with `opacity: el.opacity ?? 100`. The `ExcalidrawElement.opacity` field (0–100 Excalidraw convention) already exists in `types.ts` line 505.

**Target files:**
- `packages/diagram/src/webview/scene-adapter.ts` — line 151 (`opacity: 100` → `opacity: el.opacity ?? 100`)

**Risk level:** LOW — currently all elements have `opacity: undefined` from canvas-generator, so `?? 100` preserves existing behaviour. Only affects future callers that explicitly set opacity.  
**Acceptance tests:**
- Element with no opacity → output `opacity: 100` (backward compat)
- Element with `opacity: 50` → output `opacity: 50`
- Element with `opacity: 0` → output `opacity: 0` (not clobbered by default)
- All existing scene-adapter tests pass

**Rollback strategy:** Revert line 151 to `opacity: 100`.

---

## 3. Out of Scope

These items were considered but deliberately excluded from Phase 0:

| Item | Reason |
|------|--------|
| D-03 Curved routing implementation | Separate feature (Catmull-Rom spline); not a hardening issue |
| diag.2 new parsers (erDiagram, mindmap, block-beta) | Feature work; depends on Phase 0 parser containment being done first |
| Full shape fidelity (hexagon, cylinder polygons) | Deferred per D-01 research |
| Undo/redo operation log | Feature work; depends on layout-store validation being clean first |

---

## 4. Success Criteria

1. All 568 existing tests still pass after every PR.
2. Shape dimensions have a single source of truth (`shape-map.ts`).
3. Parser exceptions never propagate past `parseMermaid()`.
4. `readLayout()` rejects structurally invalid JSON instead of returning it as LayoutStore.
5. Orthogonal routing point-count invariants are documented and tested.
6. Opacity flows through the scene adapter.
7. No new runtime dependencies introduced.
