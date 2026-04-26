# Testing Guide — diagram-parser-placement-hardening

**Package:** `accordo-diagram`  
**Module:** Parser / Placement hardening (H0-01..H0-05)  
**Phase:** D3  
**Date:** 2026-04-08

---

## Section 1 — Automated tests

All commands below were executed in:

```bash
cd /data/projects/accordo/packages/diagram
```

### 1.1 Full package regression

```bash
pnpm test -- --run
```

**Result:** `783 passed, 0 failed`  
**Verifies:** No regressions across the full diagram package after hardening changes.

### 1.2 Type safety

```bash
pnpm typecheck
```

**Result:** clean (no TypeScript errors)  
**Verifies:** Hardening changes keep package typing/contracts valid.

### 1.3 Requirement-focused suites

These suites contain the hardening requirements and validate each target contract.

```bash
pnpm test -- --run
```

#### `src/__tests__/shape-dims-consistency.test.ts` (H0-01c)
- Verifies `getShapeDimensions(shape)` returns expected `w/h` for known shapes.
- Verifies unknown shape fallback dimensions contract.

#### `src/__tests__/parser-containment.test.ts` (H0-02a/b/c/d)
- Verifies parser dispatch exceptions are contained into resolved `{ valid: false, error }` results.
- Verifies guard-first error handling behavior.
- Verifies exact non-Error throw mapping via `String(thrown)`:
  - string → same string
  - number → `"42"`
  - null → `"null"`
  - undefined → `"undefined"`

#### `src/__tests__/edge-router-contract.test.ts` (H0-03a/b/c)
- Verifies routing point-count contract:
  - `auto = 2`
  - `direct = 2 + N waypoints`
  - `orthogonal >= 3`
  - `self-loop = 4`
- Verifies orthogonal matrix behavior and contract-level invariants.

#### `src/__tests__/layout-store-validation.test.ts` (H0-04a/b/c/d/e/f)
- Verifies strict `readLayout()` structural validation.
- Verifies malformed `nodes/edges/clusters/unplaced/aesthetics` return `null`.

#### `src/__tests__/scene-adapter.test.ts` (H0-05a/b/c)
- Verifies opacity fidelity at scene adapter boundary:
  - absent opacity defaults to `100`
  - explicit opacity values pass through unchanged
  - `0` opacity is preserved (not clobbered)

---

## Section 2 — User journey tests

### Journey 1 — Parser containment on malformed Mermaid
1. Open a `.mmd` diagram in VS Code.
2. Introduce malformed Mermaid syntax that would previously crash parser dispatch.
3. Trigger diagram render/update.
4. **Expected:** panel remains stable; user receives controlled invalid-diagram outcome (no extension crash / no unhandled exception flow).

### Journey 2 — Layout file resilience to corruption
1. Open a diagram with a `.layout.json` sidecar.
2. Manually corrupt part of the sidecar structure (e.g., make `nodes` a string, or waypoint coords non-numeric).
3. Re-open/reload the diagram panel.
4. **Expected:** invalid layout is rejected safely; diagram still opens using safe fallback/recomputed layout behavior.

### Journey 3 — Shape sizing consistency for newly placed/unplaced nodes
1. Open a flowchart diagram and add/move nodes so placement logic is exercised.
2. Save and reload.
3. **Expected:** node dimensions/spacing are stable and consistent across render/reconcile cycles.

### Journey 4 — Edge routing contract stability
1. Create edges with auto/direct/orthogonal routing and a self-loop.
2. Add/remove waypoints for direct/orthogonal edges.
3. Save and reload.
4. **Expected:** routing remains deterministic and structurally valid; no collapsed/invalid orthogonal routes.

### Journey 5 — Opacity fidelity from model to canvas
1. Apply node opacity styles (including 0, mid-range, full).
2. Save and reload panel.
3. **Expected:** visual opacity matches configured value after roundtrip.

---

## Notes

- Lint command currently exists as a no-op in this package; typecheck + tests are the active quality gates.
- This module has user-visible behavior through the diagram panel, so user journeys are applicable (not N/A).
