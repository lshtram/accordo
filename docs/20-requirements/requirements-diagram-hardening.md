# accordo-diagram — Hardening Requirements Addendum (Phase 0)

**Package:** `accordo-diagram`  
**Date:** 2026-04-08  
**Parent document:** `docs/20-requirements/requirements-diagram.md`  
**Execution plan:** `docs/30-development/diagram-hardening-plan.md`  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)

---

## 1. Purpose

This addendum defines requirements for Phase 0 hardening of the diagram engine foundation. These requirements address reviewer findings that, if left unresolved, will compound during diag.2 feature work (new parsers, fine-grained topology tools, undo/redo).

Phase 0 introduces no new features. It strengthens existing contracts, eliminates duplicate data sources, and deepens input validation.

---

## 2. Requirements

### H0-01: Single source of truth for shape dimensions

**Rationale:** Shape dimensions are currently defined independently in `shape-map.ts` (`SHAPE_TABLE`) and `placement.ts` (`SHAPE_DIMS`). Adding a new shape requires updating both. Drift risk is high as diag.2 adds shapes.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| H0-01a | `shape-map.ts` exports a `getShapeDimensions(shape): { w, h }` function | Function exists, returns correct `{ w, h }` for all known shapes and a fallback for unknown shapes |
| H0-01b | `placement.ts` imports dimensions from `shape-map.ts` | `SHAPE_DIMS` constant and `dimForShape()` removed from `placement.ts`; only `getShapeDimensions` used |
| H0-01c | Cross-module consistency test locks the invariant | A test asserts that every shape previously in `SHAPE_DIMS` returns identical dimensions from `getShapeDimensions` |

---

### H0-02: Parser exception containment

**Rationale:** `adapter.ts` wraps the mermaid API call in try/catch (line 174), but the per-type parser dispatch (`parser(db)` at line 211) has no exception boundary. If `parseFlowchart`, `parseStateDiagram`, or `parseClassDiagram` throws, the exception propagates unhandled past `parseMermaid()`. Additionally, the mermaid catch block uses an unsafe `as` cast without a type guard.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| H0-02a | Per-type parser dispatch wrapped in try/catch | `parser(db)` call returns `{ valid: false, error }` on any exception instead of propagating |
| H0-02b | Mermaid error catch uses type guard | `catch` block at line 176 uses `instanceof Error` or a proper type guard instead of `as { message?, hash? }` |
| H0-02c | Non-Error throws handled | String, number, null, and undefined throws all produce `{ valid: false }` with a meaningful message via `String(thrown)` |
| H0-02d | Containment tests | At least 3 test cases: Error throw, string throw, falsy throw |

---

### H0-03: Orthogonal routing point-count contract

**Rationale:** `routeEdge()` returns different point counts depending on waypoint count and routing mode. The `RouteResult` JSDoc says "≥ 3 points" for orthogonal, but the actual invariant is not enforced programmatically. Downstream consumers (canvas-generator) cannot rely on a stable contract.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| H0-03a | `routeEdge` returns the correct point count per mode: auto = 2, direct = 2+N, orthogonal ≥ 3, self-loop = 4 | Tests assert exact point counts for each mode; `RouteResult` JSDoc updated to match |
| H0-03b | Orthogonal routing enforces ≥ 3 points post-condition | If computation produces < 3 points, the route is padded or falls back so the invariant holds |
| H0-03c | Contract tests cover every mode × waypoint combination | Test matrix: auto, direct/0wp, direct/2wp, orthogonal/0wp, orthogonal/1wp, orthogonal/2+wp, self-loop |

---

### H0-04: Layout-store structural validation

**Rationale:** `readLayout()` checks only `version` and `diagram_type`. A file with `{ "version": "1.0", "diagram_type": "flowchart", "nodes": 42 }` passes validation and is returned as a `LayoutStore`. Downstream code crashes when it tries to iterate `nodes`.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| H0-04a | `readLayout()` validates `nodes` shape | Returns `null` if `nodes` is not a plain object, or if any node entry lacks numeric `x`, `y`, `w`, `h` or object `style` |
| H0-04b | `readLayout()` validates `edges` shape | Returns `null` if `edges` is not a plain object, or if any edge entry lacks string `routing` or array `waypoints` |
| H0-04c | `readLayout()` validates `clusters` shape | Returns `null` if `clusters` is not a plain object, or if any cluster entry lacks numeric `x`, `y`, `w`, `h` or string `label` |
| H0-04d | `readLayout()` validates `unplaced` shape | Returns `null` if `unplaced` is not an array of strings |
| H0-04e | `readLayout()` validates `aesthetics` shape | Returns `null` if `aesthetics` is not a plain object |
| H0-04f | Validation tests cover each rule | At least 8 test cases, one per structural violation path |

---

### H0-05: Scene-adapter opacity passthrough

**Rationale:** `toExcalidrawPayload()` hardcodes `opacity: 100` (line 151 of `scene-adapter.ts`), ignoring `ExcalidrawElement.opacity` which is already declared in `types.ts` (line 505). The MCP tool `set_node_style` accepts an opacity parameter, but the value is dropped at the rendering boundary.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| H0-05a | `toExcalidrawPayload()` reads `el.opacity` | Output `opacity` equals `el.opacity` when set; defaults to `100` when absent/undefined |
| H0-05b | Zero opacity is not clobbered | `el.opacity === 0` → output `opacity === 0` (not replaced by default) |
| H0-05c | Opacity tests | At least 3 test cases: absent → 100, explicit 50 → 50, explicit 0 → 0 |

---

## 3. Traceability Matrix

| Requirement | PR | Reviewer Finding | Test File |
|---|---|---|---|
| H0-01a | PR-01 | #2 (dimensions duplicated) | `shape-map.test.ts` (extended) |
| H0-01b | PR-02 | #2 | `placement.test.ts` (existing) |
| H0-01c | PR-03 | #2 | `shape-dims-consistency.test.ts` (new) |
| H0-02a | PR-04 | #1 (parser exception) | `parser-containment.test.ts` (new) |
| H0-02b | PR-04 | #1 | `parser-containment.test.ts` (new) |
| H0-02c | PR-04 | #1 | `parser-containment.test.ts` (new) |
| H0-02d | PR-05 | #1 | `parser-containment.test.ts` (new) |
| H0-03a | PR-06 | #3 (routing contract) | `edge-router-contract.test.ts` (new) |
| H0-03b | PR-06 | #3 | `edge-router-contract.test.ts` (new) |
| H0-03c | PR-07 | #3 | `edge-router-contract.test.ts` (new) |
| H0-04a–e | PR-08 | #4 (layout validation) | `layout-store-validation.test.ts` (new) |
| H0-04f | PR-09 | #4 | `layout-store-validation.test.ts` (new) |
| H0-05a | PR-10 | #5 (opacity leak) | `scene-adapter.test.ts` (extended) |
| H0-05b | PR-10 | #5 | `scene-adapter.test.ts` (extended) |
| H0-05c | PR-10 | #5 | `scene-adapter.test.ts` (extended) |

---

## 4. Non-Requirements (Explicitly Out of Scope)

| Item | Reason |
|------|--------|
| New parser implementations (erDiagram, mindmap, block-beta) | Feature work; depends on H0-02 being complete |
| D-03 Curved routing (Catmull-Rom spline) | Feature work; separate from contract hardening |
| Full composite shape fidelity | Deferred per D-01 research |
| Undo/redo operation log | Feature work; benefits from H0-04 validation but is not a prerequisite |
| NodeStyle opacity → canvas-generator propagation | Canvas-generator already passes `opacity` through to ExcalidrawElement; the gap is only in scene-adapter |
