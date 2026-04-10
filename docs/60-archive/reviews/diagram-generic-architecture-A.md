# Review Memo — Diagram Generic-First Architecture
**Reviewer:** Reviewer Agent  
**Date:** 2026-04-05  
**Phase:** Architecture Direction Review (pre-diag.2)  
**Scope:** Feasibility and correctness of adopting a generic, Mermaid-derived geometry architecture covering all major spatial diagram families

---

## Verdict

**CONDITIONAL PASS — Proceed with qualifications.**

The generic-first direction is correct and the existing codebase is already substantially structured for it. However, four structural issues in the type system and three gaps in the architecture plan must be resolved before diag.2 implementation begins. Sequence diagrams must be removed from the target scope. One new `LayoutStore` field is required. Everything else is either already done or is a naming/documentation gap only.

---

## Section 1 — Is a Generic Core + Per-Type Provider Model the Right Architecture?

### Finding 1.1 — The architecture is already generic-first (PASS)

The core data model (`ParsedDiagram`, `LayoutStore`, `NodeLayout`, `EdgeLayout`, `ClusterLayout`) is already type-agnostic. The adapter (`adapter.ts`) already implements per-type provider dispatch via the `PARSERS` record. The layout layer (`auto-layout.ts`) already implements per-type dispatch via `DAGRE_TYPES` and throws `UnsupportedDiagramTypeError` for unregistered types rather than failing silently. Adding a new diagram type requires exactly three touch-points: (1) a new file in `parser/`, (2) a new entry in `PARSERS`, (3) a new branch in `computeInitialLayout`. This is the correct extensibility surface.

### Finding 1.2 — The dispatch gate is overly conservative and should be widened (MEDIUM)

`adapter.ts` line 199–205 returns a hard error for any type not in `PARSERS`:

```
`Diagram type '${type}' is not supported in diag.1 (flowchart and stateDiagram-v2 only)`
```

The string literal `"diag.1"` and the enumeration of only two types in the error message will become stale the moment the first diag.2 parser is added. This coupling also prevents a clean incremental rollout: if `classDiagram` is added to `PARSERS` but its error message still says "flowchart and stateDiagram-v2 only", it creates confusion.

**Required fix:** The error message must be derived dynamically from `Object.keys(PARSERS)` rather than hardcoded. The `"diag.1"` version reference must be removed from user-facing error text.

### Finding 1.3 — `DAGRE_TYPES` in `auto-layout.ts` is the right pattern but must be extended correctly (PASS with note)

`DAGRE_TYPES` currently contains `["flowchart", "classDiagram", "stateDiagram-v2", "erDiagram"]`. This is correct — these four types all have directed-graph topology and fit the Sugiyama algorithm well. The architecture document (`diagram-types-architecture.md`) correctly identifies that `mindmap` needs `d3-hierarchy` and `block-beta` needs `cytoscape-fcose`. This design decision is sound: using dagre for mindmap or block-beta would produce significantly degraded layouts.

**Note for implementation:** When diag.2 layout providers are added, the dispatch in `computeInitialLayout` must evolve from a single `if (!DAGRE_TYPES.has)` guard to a per-type strategy lookup — the same pattern already used in `PARSERS`. A `LAYOUT_ENGINES: Record<SpatialDiagramType, LayoutEngine>` map is the natural evolution.

---

## Section 2 — What Must the Intermediate Geometry Model Include?

### Finding 2.1 — `ParsedDiagram.direction` is inadequate for mindmap and block-beta (MUST FIX)

`ParsedDiagram.direction` is typed as `"TD" | "LR" | "RL" | "BT"` in `types.ts`. This is correct and sufficient for flowchart, stateDiagram-v2, classDiagram, and erDiagram. It is semantically wrong for mindmap and block-beta:

- **mindmap** has no direction — it radiates from a root. The field has no meaningful value.
- **block-beta** has a grid-column layout constraint, not a rank direction. Storing `"LR"` here would be misleading.

Using `"TD"` as a default placeholder for these types is technically harmless now (since no layout engine reads it for these types yet), but it will silently produce incorrect behaviour when a layout engine is added that consults this field.

**Required fix:** Change `direction` to `direction?: "TD" | "LR" | "RL" | "BT"` (optional). Mindmap and block-beta parsers must leave it `undefined`. The layout engines for those types must not read `direction`.

### Finding 2.2 — `ExcalidrawElement.type` is missing `"line"` (MUST FIX before diag.2 canvas work)

`types.ts` declares `ExcalidrawElement.type` as `"rectangle" | "diamond" | "ellipse" | "arrow" | "text"`. The architecture document (`diagram-types-architecture.md` §9.1, DEC-014) explicitly calls out that polygon shapes (hexagon, parallelogram, trapezoid) must be rendered as Excalidraw `freedraw` or `line` elements, not as rectangles or diamonds.

This gap does not block diag.2 parser work, but it will block diag.2 canvas/rendering work. The type must be extended before the canvas generator is touched.

**Required fix:** Add `"line" | "freedraw"` to the `ExcalidrawElement.type` union.

### Finding 2.3 — `stateStart` and `stateEnd` are missing from the `NodeShape` union (MEDIUM)

`types.ts` defines `NodeShape` as:
```typescript
| "rectangle" | "rounded" | "diamond" | "circle" | "cylinder" | "hexagon"
| "parallelogram" | "trapezoid" | "doubleCircle" | "subroutine" | string
```

The `| string` escape hatch keeps this open, but `stateStart` and `stateEnd` are first-class shapes already used in `auto-layout.ts` (`SHAPE_DIMS` at lines 48–49) and `getClusterAnchorNodes` (lines 137, 155, 167, 172). They are effectively required members of this union that happen to be hidden behind the `| string` fallback.

**Required fix:** Add `"stateStart" | "stateEnd"` to the explicit members of `NodeShape`. This makes the type accurately document the shapes the system actually handles.

### Finding 2.4 — `LayoutStore` cannot round-trip block-beta grid constraints (MEDIUM)

Block-beta diagrams define column counts and per-node `widthInColumns` values. These are structural layout constraints, not arbitrary style properties. The current `LayoutStore` schema has no place to store them: `NodeLayout` has `x, y, w, h, style` only, and `LayoutStore` has no diagram-type-specific metadata field.

For diag.1 this is not a problem — block-beta is unimplemented. For diag.2, if we want to re-run the initial layout or re-sync after a source edit, we need these constraints. Discarding them means every sync produces a layout that ignores the author's column structure.

**Required fix:** Add an optional `metadata?: Record<string, unknown>` field to `LayoutStore`. This is a minimal, non-breaking evolution. Block-beta layout can store `{ columnCount: N }` there. No existing code changes. Version remains `"1.0"`.

### Finding 2.5 — `LayoutStore` handles mindmap's degenerate case adequately (PASS)

Mindmap produces no real edges (synthetic parent→child references) and no subgraph clusters. `LayoutStore.edges` and `LayoutStore.clusters` will be empty objects `{}` for all mindmap diagrams. This is valid under the current schema — empty objects are legal. The reconciler and canvas generator must handle the degenerate case gracefully, but this is an implementation concern, not a schema defect.

---

## Section 3 — Can `LayoutStore` / `layout.json` Remain Unchanged?

### Finding 3.1 — Minimal evolution required: one optional field (MUST ADD)

As described in Finding 2.4, `LayoutStore` needs `metadata?: Record<string, unknown>`. This is the only schema addition required.

The `version: "1.0"` string does **not** need to be bumped for an additive, optional field. Existing layout files without `metadata` remain valid — `readLayout` will simply see `undefined` for the field, which is safe.

**Required addition:**
```typescript
// in LayoutStore interface:
metadata?: Record<string, unknown>;
```

### Finding 3.2 — Version strategy must be documented before diag.2 (MEDIUM)

`readLayout` in `layout-store.ts` line 63 rejects any file where `parsed.version !== "1.0"` with a hard `return null`. There is currently no migration path — a version bump would silently discard all existing user layout files. This is tolerable now (diag.1 only), but diag.2 introduces shape additions, metadata fields, and potentially new edge routing modes. If any of these require a version bump, all existing `.layout.json` files become unreadable with no recovery.

**Required fix before any version bump:** Define a migration function signature in `layout-store.ts` and document the versioning policy in `docs/10-architecture/diagram-architecture.md` §5. The migration function does not need to be implemented now, but the entry-point must exist so that a future developer knows where to put it.

---

## Section 4 — Risks of Over-Generalization

### Finding 4.1 — Generic geometry model is safe; generic layout engine is not (PASS with caveat)

Making `ParsedDiagram` and `LayoutStore` generic across all types is low-risk because they are data structures, not algorithms. A mindmap-specific `ParsedDiagram` that happens to have empty `edges` and no `direction` is just a valid `ParsedDiagram` with sparse fields.

Making the *layout engine* generic would be high-risk. Dagre, d3-hierarchy, and cytoscape-fcose have fundamentally different input models and output formats. Any attempt to unify them behind a single "layout strategy interface" that hides these differences would require significant abstraction tax (e.g., adapter layers for each engine's graph input format). The current design — per-type dispatch to per-type layout functions — is correct and avoids this. **Do not create a unified `ILayoutStrategy` interface for diag.2.** Dispatch is sufficient.

### Finding 4.2 — Generic canvas generator is achievable but requires careful shape mapping (MEDIUM)

The canvas generator (`canvas.ts`, not read but referenced in architecture) converts `ParsedDiagram + LayoutStore` to Excalidraw elements. If the generator has any shape-specific branches hardcoded, adding new shapes (class diagram method boxes, ER crow's-foot notation, mindmap branch curves) will require per-type additions. The risk is that this file grows into a 600-line switch statement.

**Mitigation already in architecture:** The architecture doc specifies that shape rendering should be delegated to per-shape renderers. Verify this pattern is followed when diag.2 canvas work begins, and cap the canvas generator file at the 200-line limit in `coding-guidelines.md`.

### Finding 4.3 — `classDiagram` and `erDiagram` share dagre but differ significantly in semantic model (MEDIUM)

ER entities use synthetic IDs (`entity-X-0`), not entity names. Class diagram nodes have compartments (attributes, methods). Both are modelled as flat nodes + edges in `ParsedDiagram`, which is correct, but the canvas generator must handle:
- ER: crow's-foot notation on edges (not just arrows)
- Class: multi-compartment node rendering (stacked rectangles, not a single shape)

These are canvas-generation concerns, not geometry model concerns. The geometry model (ParsedDiagram + LayoutStore) is adequate. The canvas generator must not assume all nodes are single-box shapes.

---

## Section 5 — Sequence Diagrams: Out of Scope (MUST REMOVE FROM PLAN)

### Finding 5.1 — Sequence diagrams are architecturally incompatible with the spatial whiteboard model (FAIL — scope error)

The user's request lists "sequence" as one of the 7 target diagram families. This is in direct conflict with the existing architectural position (`diagram-architecture.md` §2.2):

> "sequenceDiagram, gantt, gitGraph, timeline, quadrantChart — out of scope. These are sequential/temporal, not spatial."

This is not a conservative constraint — it is a fundamental architectural property. The Accordo diagram modality is a **spatial whiteboard**: every element has an `(x, y, w, h)` position that the user can drag. Sequence diagrams have no 2D canvas. Their layout is entirely determined by message order; `x` positions are actor columns (fixed by declaration order) and `y` positions are message sequence numbers (fixed by source order). There is nothing for the user to drag, no `LayoutStore` that persists meaningful state, and no spatial co-editing that adds value over the raw Mermaid preview.

Additionally, `adapter.ts` line 92–93 already lists `sequenceDiagram` in `UNSUPPORTED_TYPE_RE` and returns an explicit, user-facing error.

**Required action:** Remove "sequence" from the target scope. The architecture should be generic across the 6 *spatial* types: flowchart, stateDiagram-v2, classDiagram, erDiagram, mindmap, block-beta.

If sequence diagram *preview* (render-only, no spatial editing) is desired in the future, that is a separate modality (a read-only rendering pane) and must be designed separately — it does not belong in the spatial whiteboard pipeline.

---

## Section 6 — Rollout Plan

### Finding 6.1 — Proposed safe rollout order (ACTIONABLE)

The following order minimises integration risk while keeping the architecture generic from the start:

**Step 1 — Type system fixes (blocking, do first)**
- Fix `ParsedDiagram.direction` to `direction?` (optional)
- Add `"stateStart" | "stateEnd"` to `NodeShape`
- Add `"line" | "freedraw"` to `ExcalidrawElement.type`
- Add `metadata?: Record<string, unknown>` to `LayoutStore`
- Fix `PARSERS` error message to be dynamic
- Document migration policy in architecture doc

**Step 2 — `classDiagram` parser + dagre layout (first new type)**
- Class diagram is the natural first diag.2 type: it uses dagre (already working), has a well-defined `diag.db` API (verified in `diagram-types-architecture.md`), and its failure mode is obvious (compartments not rendered = visible gap, not silent data loss)
- Parser: extract vertices, relationships, notes from `diag.db`
- Layout: add `"classDiagram"` is already in `DAGRE_TYPES` — zero layout changes needed
- Canvas: add compartment rendering for class nodes

**Step 3 — `erDiagram` parser + dagre layout (second new type)**
- Also uses dagre, already in `DAGRE_TYPES`
- New challenge: synthetic entity IDs (`entity-X-0`) and crow's-foot edge notation
- Parser is the main work; layout is free

**Step 4 — `mindmap` parser + d3-hierarchy layout**
- First non-dagre type — this is the integration test for the per-type layout dispatch evolution
- `computeInitialLayout` dispatch must evolve from `if (!DAGRE_TYPES.has)` to per-type strategy map
- Parser: dot-path IDs, tree structure extraction
- Layout: `d3-hierarchy` radial layout, then convert to flat `NodeLayout` records

**Step 5 — `block-beta` parser + cytoscape-fcose layout**
- Most complex: grid semantics, column constraints, no standard graph topology
- Should be last — lessons from mindmap layout dispatch apply
- Parser needs to extract column count and `widthInColumns` per node, store in `metadata`

**Step 6 — Canvas generator extensions (after all parsers)**
- Extend per-shape renderer for crow's-foot, compartments, mindmap branch curves
- Cap canvas generator file at 200 lines; split into per-shape renderer files if exceeded

### Finding 6.2 — State diagram parser is already started (NOTE)

`adapter.ts` imports `parseStateDiagram` from `./state-diagram.js` and adds it to `PARSERS`. This means stateDiagram-v2 is partially implemented but not fully tested. Before any diag.2 work begins, verify that `parseStateDiagram` has adequate test coverage (all node shapes, all transition types, nested states, fork/join).

---

## Section 7 — Concrete Requirements and Acceptance Criteria

### R-DIAG-GENERIC-01 — Generic parse interface
Every spatial diagram type (flowchart, stateDiagram-v2, classDiagram, erDiagram, mindmap, block-beta) must be parseable via `parseMermaid(source)` and return a valid `ParsedDiagram` with no `any` casts in the parser logic.

**Acceptance criteria:**
- `parseMermaid` returns `{ valid: true, diagram }` for a syntactically valid source string of each type
- `ParsedDiagram.type` equals the expected `DiagramType` value
- `ParsedDiagram.nodes` is non-empty for any diagram with at least one node
- TypeScript compiler reports zero errors with `--strict` across all parser files

### R-DIAG-GENERIC-02 — Layout dispatch
`computeInitialLayout` must produce a valid `LayoutStore` for every spatial type. Block-beta and mindmap must use their type-specific layout engines, not dagre.

**Acceptance criteria:**
- Calling `computeInitialLayout` with a `classDiagram` `ParsedDiagram` does not throw
- Calling `computeInitialLayout` with a `mindmap` `ParsedDiagram` does not call the dagre path
- All produced `LayoutStore` objects pass `readLayout` round-trip (write → read → deep-equal)

### R-DIAG-GENERIC-03 — LayoutStore schema stability
Adding `metadata?: Record<string, unknown>` must be a non-breaking change.

**Acceptance criteria:**
- All existing `.layout.json` files (version `"1.0"`) that lack a `metadata` key are read successfully by `readLayout`
- A `.layout.json` with `metadata: { columnCount: 3 }` is read and the value is accessible

### R-DIAG-GENERIC-04 — No sequence diagram support
`parseMermaid` called with a `sequenceDiagram` source must return `{ valid: false, error: { message: "...not supported..." } }`.

**Acceptance criteria:**
- The error message references the unsupported type by name
- The error message does not say "diag.1" or enumerate other types by name (dynamic derivation)
- No `ParsedDiagram` is ever produced for a sequence diagram source

### R-DIAG-GENERIC-05 — Type safety: no open `| string` for known shapes
`NodeShape` must include explicit members for all shapes the codebase currently handles.

**Acceptance criteria:**
- TypeScript exhaustiveness checks (e.g. a `switch` on `NodeShape` with `default: never`) compile without error after adding `stateStart` and `stateEnd`
- No `SHAPE_DIMS` entry references a shape not present in the `NodeShape` union

### R-DIAG-GENERIC-06 — File size compliance
No new file added during diag.2 exceeds 200 lines.

**Acceptance criteria:**
- `wc -l packages/diagram/src/**/*.ts` shows no file exceeding 200 lines
- Exception: `auto-layout.ts` currently at 511 lines must be split at the diag.2 boundary — the dagre engine moves to `layout/dagre-engine.ts`, the dispatch and public API remain in `auto-layout.ts`

### R-DIAG-GENERIC-07 — Test coverage per type
Every parser function must have a dedicated test file with at least: one happy-path test, one test per distinct node/edge variant, one test for empty input, one test for syntax error input.

**Acceptance criteria:**
- `pnpm test` in `packages/diagram` shows zero failures
- Coverage report shows >90% statement coverage on all `parser/*.ts` files

---

## Required Changes Summary

| # | Severity | Location | Change |
|---|---|---|---|
| RC-01 | MUST FIX | `types.ts` | `direction` → `direction?` (optional) |
| RC-02 | MUST FIX | `types.ts` | Add `"stateStart" \| "stateEnd"` to `NodeShape` |
| RC-03 | MUST FIX | `types.ts` | Add `"line" \| "freedraw"` to `ExcalidrawElement.type` |
| RC-04 | MUST FIX | `types.ts` | Add `metadata?: Record<string, unknown>` to `LayoutStore` |
| RC-05 | MUST FIX | `parser/adapter.ts` | Error message dynamically derives supported types from `Object.keys(PARSERS)` |
| RC-06 | MUST FIX | Scope | Remove "sequence" from target diagram families |
| RC-07 | MEDIUM | `layout/auto-layout.ts` | Split into `auto-layout.ts` (dispatch + API) + `layout/dagre-engine.ts` (dagre impl) before diag.2 adds new engines |
| RC-08 | MEDIUM | `docs/10-architecture/diagram-architecture.md` | Document `LayoutStore` version migration policy and `metadata` field purpose |
| RC-09 | MEDIUM | `layout/layout-store.ts` | Add stub `migrateLayout(raw: unknown): LayoutStore \| null` function with comment explaining the versioning policy |

---

## Medium / Minor Findings (Non-Blocking)

| # | Severity | Finding |
|---|---|---|
| M-01 | MEDIUM | `auto-layout.ts` (511 lines) already exceeds the 200-line limit in `coding-guidelines.md`. Must be split before diag.2 adds more layout engines. |
| M-02 | MEDIUM | `stateDiagram-v2` parser exists (`parseStateDiagram` is imported and registered) but its test coverage status is not confirmed. Must be audited before diag.2 work begins. |
| M-03 | MEDIUM | `DEFAULT_RANKDIR` in `auto-layout.ts` is typed as `Partial<Record<string, LayoutOptions["rankdir"]>>` but the keys are only meaningful for dagre types. When non-dagre layout engines are added, this map must not be consulted for mindmap/block-beta — enforce this with an explicit type guard. |
| M-04 | MINOR | `LayoutStore.aesthetics.theme` is typed as `string` (open). Consider a union `"hand-drawn" \| "clean"` to make the valid values discoverable. |
| M-05 | MINOR | The `CLUSTER_LABEL_HEIGHT = 28` constant in `auto-layout.ts` is a magic number with no connection to the font size used by the canvas generator. If the label font size changes, the constant becomes stale silently. Document the derivation in the comment. |

---

## Final Checklist

- [x] Generic core + per-type provider model: **correct and already implemented**
- [x] Geometry model adequacy: **adequate with 4 fixes (RC-01–RC-04)**
- [x] LayoutStore evolution: **one field addition required (RC-04), no version bump**
- [x] Over-generalization risk: **low for data model; layout engine dispatch is already correctly isolated**
- [x] Rollout plan: **6-step incremental plan defined (Section 6)**
- [x] Concrete requirements: **7 requirements with acceptance criteria defined (Section 7)**
- [❌] Scope: **"sequence" must be removed from target families (RC-06)**
