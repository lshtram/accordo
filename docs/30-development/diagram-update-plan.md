# Diagram Engine Update — Excalidraw Mermaid-to-Excalidraw Integration Plan

**Date:** 2026-04-14  
**Phase:** Post-Phase F (Priority P + Priority D committed)  
**Status:** READY FOR NEXT BATCH — PR-4 (visual snapshot comparison) is the next prioritized item  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)  
**Package:** `accordo-diagram` (`packages/diagram/`)

---

## 1. Module Name & Scope

**Module:** `excalidraw-layout-engine` (internal name)  
**Files live under:** `packages/diagram/src/layout/`

### What this module does

Plugs `@excalidraw/mermaid-to-excalidraw` into Accordo as an **alternative geometry/placement engine** for flowchart diagrams. The library takes raw `.mmd` source, runs its own Mermaid parse + layout pass, and returns `ExcalidrawElementSkeleton[]` with full (x, y, width, height) positions. We extract only the **geometry** (positions, sizes, cluster bounds) and map them back to Accordo's stable identity model (`NodeId`, `EdgeKey`, `ClusterId`).

### What this module does NOT do

- Does NOT replace Accordo's parser, reconciler, layout-store, or canvas generator.
- Does NOT consume the upstream library's element rendering — we still generate `ExcalidrawElement[]` ourselves via `canvas-generator.ts`.
- Does NOT change the identity model (NodeId = Mermaid node ID, EdgeKey = `from->to:ordinal`).
- Does NOT affect non-flowchart diagram types (class, state, ER) in Phase 1.

---

## 2. Architecture Summary

### Current layout pipeline

```
parseMermaid(source)           → ParsedDiagram
reconcile(parsed, layout)      → ReconcileResult { layout, diagram }
generateCanvas(parsed, layout) → CanvasScene
  └─ placeNodes(unplaced, parsed, existingLayout)
       └─ computeInitialLayout(parsed, options) → LayoutStore   ← DAGRE
```

`computeInitialLayout()` in `auto-layout.ts` is the single entry point for layout computation. It dispatches to `layoutWithDagre()` for all dagre-supported types. `placeNodes()` in `placement.ts` calls it internally to get "ideal" positions for collision-free placement.

### Proposed layout pipeline (after integration)

```
parseMermaid(source)           → ParsedDiagram
reconcile(parsed, layout)      → ReconcileResult { layout, diagram }
generateCanvas(parsed, layout) → CanvasScene
  └─ placeNodes(unplaced, parsed, existingLayout)
       └─ computeInitialLayout(parsed, options) → LayoutStore   ← DAGRE (sync)

async callers (panel load / tool ops)
  └─ computeInitialLayoutAsync(parsed, options) → Promise<LayoutStore>
       ├─ [flowchart + engine=excalidraw + source] → layoutWithExcalidraw(source, parsed)
       └─ [fallback / other types]                → computeInitialLayout(parsed, options)
```

**Key design decision:** The `@excalidraw/mermaid-to-excalidraw` library requires **raw Mermaid source** (not a pre-parsed structure). We therefore keep the current sync `computeInitialLayout()` unchanged and add a new async entry point, `computeInitialLayoutAsync()`, for the excalidraw-backed path. This avoids cascading async changes through `placeNodes()` and `generateCanvas()`.

Two options for threading the source string:

| Option | Approach | Trade-off |
|--------|----------|-----------|
| **A (recommended)** | Add optional `source?: string` to `LayoutOptions` | Minimal API change; source is already available at every call site |
| B | Store source on `ParsedDiagram` itself | Pollutes the parsed type with raw text; reconciler doesn't need it |

**Recommendation:** Option A — add `source?: string` to `LayoutOptions`. The excalidraw engine path is only available via `computeInitialLayoutAsync()` and is skipped when source is absent (dagre fallback).

### Identity mapping — the core challenge

The upstream library returns `ExcalidrawElementSkeleton[]` where each element has a `label` or `text` property and geometry (x, y, width, height). These elements do NOT carry Mermaid node IDs. The integration layer must:

1. Parse the upstream output into a map of `{ label → geometry }`.
2. Match upstream labels against `ParsedDiagram.nodes` (which has `id → label`).
3. For edges: match by (fromLabel, toLabel, ordinal) correlation.
4. For clusters: match by subgraph label.

**Deterministic matching rule:**

1. Build a reverse index `label -> NodeId[]` from `ParsedDiagram.nodes`, preserving insertion order.
2. Consume Node IDs in declaration order for each upstream geometry with that label.
3. If upstream output order is unstable, sort upstream geometries by `(y, x)` before matching.
4. Any unmatched nodes fall back deterministically to dagre for the affected scope.

**Fallback:** If a match fails or remains ambiguous after declaration-order matching, fall back to dagre for the affected nodes/scope and emit a warning. No heuristic partial mapping is allowed.

### Engine selection

A new optional field `engine?: "dagre" | "excalidraw"` on `LayoutOptions` controls which engine to use. Default: `"dagre"` (preserves all current behavior). The `"excalidraw"` engine is only valid for `flowchart` type; other types fall back to dagre with a warning.

Future: engine selection could be persisted per-diagram in `LayoutStore.metadata` or `AestheticsConfig`, but that's a Phase 3 concern.

---

## 3. Proposed File/Module Changes

### New files

| File | Purpose |
|------|---------|
| `src/layout/excalidraw-engine.ts` | Adapter: calls `parseMermaidToExcalidraw()`, maps output to `LayoutStore` |
| `src/layout/element-mapper.ts` | Maps `ExcalidrawElementSkeleton[]` → Accordo identity model (NodeId, EdgeKey, ClusterId) |
| `src/__tests__/excalidraw-engine.test.ts` | Unit tests for the adapter |
| `src/__tests__/element-mapper.test.ts` | Unit tests for the identity mapper |

### Modified files

| File | Change |
|------|--------|
| `src/layout/auto-layout.ts` | Add `engine` + `source` to `LayoutOptions`; add new `computeInitialLayoutAsync()` that dispatches to `layoutWithExcalidraw()` or falls through to sync `computeInitialLayout()` |
| `src/reconciler/placement.ts` | No change — remains on sync `computeInitialLayout()` dagre path |
| `src/canvas/canvas-generator.ts` | No change — remains on sync `placeNodes()` path |
| `package.json` | Add `@excalidraw/mermaid-to-excalidraw` dependency |

### Unchanged files (explicitly)

| File | Why unchanged |
|------|---------------|
| `src/types.ts` | No new types needed; `LayoutStore` / `NodeLayout` / etc. are already the right shape |
| `src/reconciler/reconciler.ts` | Reconciler is layout-engine agnostic — no changes needed |
| `src/canvas/shape-map.ts` | Shape dimensions are still authoritative from SHAPE_TABLE |
| `src/canvas/edge-router.ts` | Edge routing is post-layout — unchanged |
| `src/layout/layout-store.ts` | Store format unchanged — engine is selected at compute time, not stored (Phase 1) |

---

## 4. Phased Rollout & PR Breakdown

### Phase 1 — Flowchart adapter (3 PRs)

```
PR-1: Add @excalidraw/mermaid-to-excalidraw dependency + async entrypoint + stubs
PR-2: Implement element-mapper (label→NodeId matching, edge correlation)
PR-3: Implement excalidraw-engine adapter + integrate into computeInitialLayoutAsync()
```

**PR-1: Dependency + Stubs**
- `pnpm add @excalidraw/mermaid-to-excalidraw` in `packages/diagram`
- Create `excalidraw-engine.ts` and `element-mapper.ts` with typed stubs
- Extend `LayoutOptions` with `engine?: "dagre" | "excalidraw"` and `source?: string`
- Add `computeInitialLayoutAsync()` stub in `auto-layout.ts`
- All stubs throw `new Error("not implemented")`
- Zero behavioral change — dagre is still the only active path
- **Acceptance:** `pnpm test` passes, `pnpm typecheck` passes, no new runtime behavior

**PR-2: Element Mapper**
- Implement `mapSkeletonsToLayout()` in `element-mapper.ts`
- Label-matching algorithm: build `label → NodeId[]` reverse index from `ParsedDiagram.nodes`
- Match duplicate labels in declaration order; if upstream order is unstable, sort by `(y, x)` first
- Edge matching: correlate by (source label, target label, ordinal)
- Cluster matching: by subgraph label
- Fallback: unmatched/ambiguous elements → dagre layout for the affected scope
- **Acceptance:** mapper tests pass; 100% coverage on match/miss/fallback scenarios

**PR-3: Engine Integration**
- Implement `layoutWithExcalidraw()` in `excalidraw-engine.ts`
- Wire dispatch in `computeInitialLayoutAsync()`: `engine === "excalidraw" && type === "flowchart" && source`
- Keep sync `computeInitialLayout()` unchanged
- **Acceptance:** async callers can opt into excalidraw layout; dagre fallback works for non-flowchart or no-source cases

### Phase 2 — Validation & Parity (2 PRs)

```
PR-4: Visual snapshot comparison tests (excalidraw engine vs dagre)
PR-5: Edge cases — empty diagrams, single-node, huge diagrams (>100 nodes), unicode labels
```

### Phase 3 — Future (not in immediate scope)

- Persist engine choice per-diagram in `LayoutStore.metadata`
- Extend to class, state, ER diagrams (if upstream library quality warrants it)
- Performance benchmarking: dagre vs excalidraw engine on large diagrams
- Incremental layout: re-layout only changed subgraphs (leveraging upstream library's subgraph support)

---

## 5. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **Label matching is fragile** — upstream elements don't carry Mermaid IDs, only labels. If a diagram has duplicate labels, the mapper must still be deterministic. | HIGH | Use declaration-order matching from `ParsedDiagram.nodes` insertion order. If upstream output order is unstable, sort geometries by `(y, x)` as a stable tiebreaker. If ambiguity remains, fall back to dagre for the affected scope. |
| R2 | **Upstream library bundles its own Mermaid parser** — version skew between Accordo's `mermaid@11.12.3` and the version inside `@excalidraw/mermaid-to-excalidraw` could cause parse differences. | MEDIUM | Pin compatible versions. If skew is detected, the mapper will have unmatched nodes → dagre fallback fires → degraded but functional. Add a startup version-check log warning. |
| R3 | **Performance regression** — the upstream library does a full Mermaid parse + layout, so we're parsing twice (once in Accordo's parser, once in the upstream lib). | MEDIUM | Acceptable for flowcharts <100 nodes. For larger diagrams, consider caching or skipping Accordo's own dagre pass when excalidraw engine is selected. Benchmark in Phase 2. |
| R4 | **Upstream API instability** — `@excalidraw/mermaid-to-excalidraw` is relatively young; API may change. | LOW | The adapter (`excalidraw-engine.ts`) is a single file with no callers outside `auto-layout.ts`. Version-lock the dep. If the API breaks, the fallback is dagre (always available). |
| R5 | **Cluster geometry mismatch** — upstream library may compute different cluster bounds than Accordo's `CLUSTER_MARGIN` / `CLUSTER_LABEL_HEIGHT` constants. | MEDIUM | The mapper normalizes cluster bounds to Accordo's conventions (re-apply margin + label height). Document the normalization in element-mapper. |
| R6 | **Edge routing divergence** — upstream returns edge points in `ExcalidrawElementSkeleton`, but Accordo uses its own `routeEdge()` for edge paths. | LOW | We only extract **node and cluster geometry** from the upstream output. Edge routing stays in Accordo's `edge-router.ts`. Upstream edge data is discarded. |

---

## 6. Content Outline for This Plan Document

This document will be updated as work progresses. Sections below will be filled in during implementation:

- [x] §1 Module Name & Scope
- [x] §2 Architecture Summary
- [x] §3 File/Module Changes
- [x] §4 Phased Rollout & PR Breakdown
- [x] §5 Risks & Mitigations
- [x] §6 Content Outline (this section)
- [x] §7 Stubs & Interfaces
- [x] §8 Implementation Notes (filled during Phase C)
- [x] §9 Test Results & Coverage (filled during Phase D)
- [ ] §10 Visual Comparison Results (filled during Phase 2, PR-4)
- [ ] §11 Required Documentation Updates

---

## 7. Stubs & Interfaces (Phase A deliverables)

### 7.1 `LayoutOptions` extension (in `auto-layout.ts`)

```typescript
export interface LayoutOptions {
  rankdir?: "TB" | "LR" | "RL" | "BT";
  nodeSpacing?: number;
  rankSpacing?: number;
  /** Layout engine to use. Default: "dagre". Only effective via computeInitialLayoutAsync(). */
  engine?: "dagre" | "excalidraw";
  /**
   * Raw Mermaid source string. Required when engine is "excalidraw"
   * (the upstream library needs raw source, not pre-parsed structures).
   * Ignored when engine is "dagre".
   */
  source?: string;
}
```

### 7.2 `element-mapper.ts` — Stub

```typescript
/**
 * Maps ExcalidrawElementSkeleton[] from @excalidraw/mermaid-to-excalidraw
 * output back to Accordo's identity model (NodeId, EdgeKey, ClusterId).
 *
 * The upstream library returns positioned elements with labels but no
 * Mermaid IDs. This module reverse-maps labels to Accordo's stable IDs
 * using the ParsedDiagram as the source of truth.
 */

import type { ParsedDiagram, LayoutStore, NodeLayout, ClusterLayout } from "../types.js";

/** A positioned element extracted from upstream output. */
export interface UpstreamGeometry {
  /** Display label text (used for matching). */
  label: string;
  /** X coordinate (top-left). */
  x: number;
  /** Y coordinate (top-left). */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Upstream element type hint (rectangle, diamond, etc.). */
  type?: string;
  /**
   * Group ID from upstream — used to identify cluster membership.
   * Elements in the same group belong to the same subgraph.
   */
  groupId?: string;
}

/** Result of the mapping pass. */
export interface MappingResult {
  /** Successfully mapped node positions, keyed by NodeId. */
  nodes: Record<string, NodeLayout>;
  /** Successfully mapped cluster bounds, keyed by ClusterId. */
  clusters: Record<string, ClusterLayout>;
  /** Node IDs that could not be matched (will fall back to dagre). */
  unmatchedNodeIds: string[];
  /** Warnings generated during mapping (logged, not thrown). */
  warnings: string[];
}

/**
 * Extract positioned elements from upstream ExcalidrawElementSkeleton[].
 *
 * Filters to shape elements (rectangles, diamonds, ellipses) and extracts
 * their geometry + label text for subsequent identity matching.
 *
 * @param skeletons - Raw output from parseMermaidToExcalidraw()
 * @returns Extracted geometry entries ready for identity matching
 */
export function extractGeometry(
  skeletons: readonly unknown[]
): UpstreamGeometry[] {
  throw new Error("not implemented");
}

/**
 * Map upstream geometry to Accordo's identity model.
 *
 * Algorithm:
 * 1. Build a reverse index: label → NodeId[] from ParsedDiagram.nodes
 * 2. For each upstream geometry element, find matching NodeId(s) by label
 * 3. If multiple nodes share a label, match in declaration order
 *    (consume NodeIds in ParsedDiagram.nodes insertion order)
 * 4. For clusters: match by subgraph label via ParsedDiagram.clusters
 * 5. Unmatched nodes are reported in MappingResult.unmatchedNodeIds
 *
 * @param geometries - Positioned elements from extractGeometry()
 * @param parsed     - Accordo's ParsedDiagram (source of truth for IDs)
 * @returns MappingResult with matched positions and unmatched fallbacks
 */
export function mapGeometryToLayout(
  geometries: readonly UpstreamGeometry[],
  parsed: ParsedDiagram
): MappingResult {
  throw new Error("not implemented");
}
```

### 7.3 `excalidraw-engine.ts` — Stub

```typescript
/**
 * Excalidraw layout engine adapter.
 *
 * Calls @excalidraw/mermaid-to-excalidraw with raw Mermaid source,
 * then maps the output geometry back to Accordo's LayoutStore format
 * using the element-mapper.
 *
 * This is a pluggable alternative to layoutWithDagre() — same input
 * contract (ParsedDiagram + source) → same output contract (LayoutStore).
 *
 * Only valid for flowchart diagrams. Other types must use dagre.
 */

import type { ParsedDiagram, LayoutStore } from "../types.js";

/**
 * Compute a LayoutStore for a flowchart diagram using the
 * @excalidraw/mermaid-to-excalidraw library for geometry.
 *
 * @param source  - Raw Mermaid source string (required)
 * @param parsed  - Accordo ParsedDiagram (for identity matching)
 * @returns LayoutStore with positions from the excalidraw engine
 * @throws Error if source is empty or undefined
 * @throws Error if parsed.type is not "flowchart"
 */
export async function layoutWithExcalidraw(
  source: string,
  parsed: ParsedDiagram
): Promise<LayoutStore> {
  throw new Error("not implemented");
}
```

### 7.4 Async entry point in `auto-layout.ts` (preview, not yet applied)

```typescript
// In auto-layout.ts — computeInitialLayoutAsync():
export async function computeInitialLayoutAsync(
  parsed: ParsedDiagram,
  options?: LayoutOptions
): Promise<LayoutStore> {
  if (
    options?.engine === "excalidraw" &&
    parsed.type === "flowchart" &&
    options.source
  ) {
    return layoutWithExcalidraw(options.source, parsed);
  }

  // Existing dagre path via stable sync API
  return computeInitialLayout(parsed, options);
}
```

> **Rule:** `computeInitialLayout()` stays synchronous and unchanged. Only async callers that explicitly opt into the excalidraw engine use `computeInitialLayoutAsync()`.

---

## 11. Required Documentation Updates

- [ ] `docs/module-map-diagram.md` — add `excalidraw-engine.ts` and `element-mapper.ts`; document `computeInitialLayoutAsync()` in the auto-layout entry
- [ ] `docs/10-architecture/diagram-architecture.md` — document dual-engine layout strategy and sync/async boundary rule
- [ ] Keep this plan updated as PRs land and decisions change

---

## 8. Implementation Notes

**Phase C + Phase D complete.** PR-1, PR-2, PR-3 are implemented.

### Dependencies added
- `@excalidraw/mermaid-to-excalidraw: ^2.1.1` in `packages/diagram/package.json`
- `happy-dom: ^20.8.9` as devDependency (required by vitest environment for DOM APIs used by the upstream library)

### Files implemented

| File | Change |
|------|--------|
| `src/layout/element-mapper.ts` | `extractGeometry()` and `mapGeometryToLayout()` fully implemented |
| `src/layout/excalidraw-engine.ts` | `layoutWithExcalidraw()` fully implemented; calls upstream library and falls back to dagre for unmatched nodes |
| `src/layout/auto-layout.ts` | `computeInitialLayoutAsync()` implemented; exports `layoutWithDagre()` for use by the adapter |
| `vitest.workspace.ts` | **Replaces `vitest.config.ts`** — two-project workspace: `diagram-node` (node env, 31 test files) and `diagram-happy-dom` (happy-dom env, 2 test files). Fixes `types.test.ts` failure caused by `import.meta.url` not being a `file://` URL in happy-dom worker threads. |

### Key design decisions
- **`extractGeometry()`**: Supports `rectangle`, `diamond`, `ellipse`, `circle`. Extracts `label` (from `text` or `label` field), `x`, `y`, `width`, `height`, `type`, `groupId`. Elements without a label are excluded.
- **`mapGeometryToLayout()`**: Builds `label → NodeId[]` reverse index from `ParsedDiagram.nodes` (insertion order). Sorts upstream geometries by `(y, x)` for stable matching. Clusters are **normalized** to Accordo conventions (`CLUSTER_MARGIN=20`, `CLUSTER_LABEL_HEIGHT=28`) via a reverse-order pass — same formula as `recomputeClusterBox()` in `auto-layout.ts`, so excalidraw and dagre cluster bounds are consistent (R5 risk mitigation). Unmatched nodes reported in `unmatchedNodeIds` and fall back to dagre.
- **`layoutWithExcalidraw()`**: Runs the upstream library, extracts geometry, maps to identity model, then overlays excalidraw positions onto a full dagre layout for the diagram. This ensures dagre edges and cluster bounding boxes are always correct.
- **`computeInitialLayoutAsync()`**: Uses dynamic import of `excalidraw-engine` to keep the sync path clean of the excalidraw dependency.
- **Cluster bounds normalization**: Applied in `mapGeometryToLayout` Pass 2. Iterates `parsed.clusters` in reverse order so nested clusters are processed before their parents. For each cluster, computes bounds from member nodes and already-normalized child clusters, then applies `CLUSTER_MARGIN` + `CLUSTER_LABEL_HEIGHT` adjustments.

---

## 9. Test Results & Coverage

**Test run:** `pnpm test` in `packages/diagram`

### Summary
- **884 tests pass** ✅
- **0 tests skipped**
- **0 tests failed**

### Test files by project
- `diagram-node` (31 files, node env): all pass — includes `types.test.ts` which requires `import.meta.url = file://`
- `diagram-happy-dom` (2 files: `excalidraw-engine.test.ts`, `auto-layout.test.ts`): all pass — required because `@excalidraw/mermaid-to-excalidraw` calls `document.createElement()` internally

### Key changes vs Phase C
- **RED-phase stub tests removed**: The "stub wiring (RED phase)" describe block in `excalidraw-engine.test.ts` (5 tests) and the RED-phase `computeInitialLayoutAsync` describe blocks in `auto-layout.test.ts` (7 tests) were removed and replaced with GREEN-phase contract tests.
- **Cluster bounds normalized**: `element-mapper.test.ts` ELM-07 tests updated to expect `CLUSTER_MARGIN` + `CLUSTER_LABEL_HEIGHT` adjustments (consistent with `recomputeClusterBox`).
- **types.test.ts fixed**: Moved to `diagram-node` project via `vitest.workspace.ts`; no longer runs in happy-dom.
- **Safety comment added**: `nodes[member.id]!.y` in `auto-layout.ts` state-diagram post-processing has an explaining comment (member ID guaranteed to exist in `nodes` map when `isCluster === false`).

### Environment
- `vitest` workspace: `diagram-node` (node env) + `diagram-happy-dom` (happy-dom env)
- TypeScript: `strict: true`, zero type errors
- ESLint: not yet configured (`echo 'no lint configured yet'`)

---

## 10. Visual Comparison Results

_To be filled during Phase 2, PR-4._

---

## 12. Priority P — Canvas Interaction Batch

This batch addresses two user-observed editing gaps that remain after the
flowchart excalidraw-engine integration:

1. **Class diagram blocks do not move as one component** — the outer box,
   divider, title, and members text are separate Excalidraw elements today.
2. **User-edited curved edge geometry / waypoints are not persisted** — manual
   edge adjustments are lost on reload because the persistence path is not fully
   wired and curved routing does not yet consume stored waypoints.

### 12.1 Revised scope decision

`@excalidraw/mermaid-to-excalidraw` remains **flowchart-only in the current Accordo implementation**, but no longer because upstream is believed to be limited to flowcharts.

Revised understanding:
- upstream appears to support structured element output for at least **flowchart, sequence, class, ER, and state**
- therefore, for **class/state/ER**, the remaining work is primarily **Accordo-side integration work** (mapping, normalization, identity preservation, persistence, and reconciliation), not an upstream capability blocker
- **sequence** appears technically feasible upstream, but still requires an **Accordo product/architecture decision** because sequence diagrams are currently outside the extension’s spatial-surface scope
- **mindmap** remains a separate blocker/track and should not be assumed supported by this engine without fresh validation
- **block-beta** also remains unconfirmed for this engine and should stay on a separate evaluation track

Current rollout decision:
- keep the implemented engine path **flowchart-only for now**
- treat **class/state/ER** as next expansion candidates after the current interaction/persistence work
- treat **sequence** as a product-scope decision
- keep **mindmap/block-beta** on separate layout-engine tracks unless upstream support is explicitly verified

### 12.2 Corrected architecture summary

#### P-A — Class-block grouping

Use Excalidraw `groupIds` so all class-node sub-elements move/select together.

End-to-end contract:

```text
types.ts
  ExcalidrawElement.groupIds?: string[]
    ↓
canvas-generator.ts
  assign one shared groupId to the class box + title + divider + members
    ↓
scene-adapter.ts
  pass el.groupIds through instead of hardcoding []
```

Notes:
- rendering concern only
- no layout-store schema change needed
- no new protocol message needed

#### P-B — Edge waypoint persistence

Wire the existing edge-routed persistence path end-to-end.

End-to-end contract:

```text
User edits edge geometry in Excalidraw
  → webview posts canvas:edge-routed { edgeKey, waypoints }
    → panel-core.ts handles canvas:edge-routed
      → patchEdge(layout, edgeKey, { waypoints })
        → layout.json persists waypoints
          → routeEdge()/routeCurved() consume stored waypoints on next render
```

Boundary rule:
- `canvas:edge-routed` is the explicit persistence path for edited edge geometry
- node move/resize/style diff detection remains separate

### 12.3 Curved waypoint semantics

For `routing="curved"`:

| Stored waypoints | Behavior |
|---|---|
| `[]` | Existing auto-curve behavior remains unchanged |
| one waypoint | That waypoint becomes the explicit curve control point |
| two or more waypoints | Use them as explicit control points in order |

Rule:
- if stored waypoints exist, they take precedence over auto-generated control points
- if no stored waypoints exist, preserve today’s auto-curve behavior

### 12.4 Files/modules in scope

| File | Planned change |
|---|---|
| `packages/diagram/src/types.ts` | Add `groupIds?: string[]` to `ExcalidrawElement` |
| `packages/diagram/src/canvas/canvas-generator.ts` | Assign shared `groupIds` to class-node composite elements |
| `packages/diagram/src/webview/scene-adapter.ts` | Pass `el.groupIds ?? []` through |
| `packages/diagram/src/webview/panel-core.ts` | Replace `canvas:edge-routed` stub with `patchEdge()` wiring |
| `packages/diagram/src/canvas/edge-router.ts` | Add curved-waypoint consumption and pass waypoints through from `routeEdge()` |
| `docs/10-architecture/diagram-architecture.md` | Document groupIds and edge-routed persistence flow |
| `docs/module-map-diagram.md` | Update module map to reflect the changed interaction flow |

### 12.5 Phase A interface targets

```typescript
// types.ts
interface ExcalidrawElement {
  groupIds?: string[];
}

// edge-router.ts
function routeCurved(
  source: BoundingBox,
  target: BoundingBox,
  direction?: "TD" | "LR" | "RL" | "BT",
  waypoints?: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): RouteResult;
```

### 12.6 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Grouped class elements may change drag/mutation behavior | Keep persisted move handling on the main node element only; verify sub-elements do not create duplicate persisted moves |
| Stored edge points may use wrong coordinate space | Define and test the coordinate convention explicitly when wiring `canvas:edge-routed` |
| Curved waypoint persistence may conflict with auto-routing | Make precedence explicit: stored waypoints win; empty waypoints preserve auto-curve |

---

## 13. Priority D — Style Intent Persistence Batch

This batch covers persistence of user-selected style intent beyond pure geometry.

### 13.1 Scope

- **P-D.1 Node corner style persistence** — remember whether a box uses sharp or rounded corners where that concept applies.
- **P-D.2 Edge corner style persistence** — remember whether an edge should render with sharp or rounded corners independently from its routing geometry.

### 13.2 Data-model decision

Add optional `roundness?: number | null` to both `NodeStyle` and `EdgeStyle`.

Semantics:

| Value | Meaning |
|---|---|
| `undefined` | Use existing/default behavior |
| `null` | Force sharp corners |
| `number > 0` | Use rounded corners |

Boundary rule:
- `NodeStyle.shape` remains the logical/default shape selector
- `NodeStyle.roundness` is an explicit user override for rectangle-family shapes only
- `EdgeLayout.routing` remains the path strategy (`auto`, `curved`, `orthogonal`, `direct`)
- `EdgeStyle.roundness` is visual corner treatment only and does **not** replace routing

### 13.3 Persistence contract

Write path:

```text
User changes roundness in Excalidraw
  → message-handler detects roundness mutation
    → emits canvas:node-styled { nodeId, style: { roundness } }
      → panel-core routes node IDs to patchNode / edge keys to patchEdge
        → layout.json persists style.roundness
```

Read path:

```text
layout.json style.roundness
  → canvas-generator resolves explicit override vs default shape/routing behavior
    → scene-adapter maps numeric roundness to Excalidraw roundness payload
```

### 13.4 Rendering precedence

For nodes:

```text
explicit NodeStyle.roundness
  > shape-map default roundness
  > sharp/null
```

For edges:

```text
EdgeLayout.routing selects path geometry
EdgeStyle.roundness selects corner curvature appearance
```

### 13.5 In-scope shapes

Editable node roundness applies only to rectangle-family shapes:
- `rectangle`
- `rounded`
- `stadium`
- compatible rectangle-based composites where corners exist visually

Ignored for non-applicable shapes:
- `diamond`
- `ellipse` / `circle`
- `hexagon`
- `cylinder`
- other structurally fixed shapes without meaningful corner roundness

### 13.6 Phase A interface targets

```typescript
// types.ts
interface NodeStyle {
  roundness?: number | null;
}

interface EdgeStyle {
  roundness?: number | null;
}

// canvas-generator.ts
function resolveNodeRoundness(
  nodeStyle: NodeStyle,
  shapeDefault: number | null,
): number | null;

function resolveEdgeRoundness(
  edgeStyle: EdgeStyle | undefined,
): number | null | undefined;

// message-handler.ts
// detectNodeMutations() / edge-style detection must include style.roundness
// when the user changes element roundness in Excalidraw.
```

### 13.7 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Shape default vs explicit roundness conflict | Explicit `roundness` override wins; document precedence clearly |
| Users try to round shapes where it has no meaning | Ignore for non-rectangle-family shapes |
| Confusion between routing mode and edge corner style | Keep `EdgeLayout.routing` for geometry, `EdgeStyle.roundness` for visual corner treatment |

---

## TODOs

- [x] PR-1: Add dependency, create stub files, extend LayoutOptions
- [x] PR-2: Implement element-mapper with label→NodeId matching
- [x] PR-3: Implement excalidraw-engine adapter + `computeInitialLayoutAsync()` dispatch
- [x] PR-D: Fix RED-phase stub tests, types.test.ts, cluster bounds, non-null assertions
- [ ] PR-4: Visual snapshot comparison tests
- [ ] PR-5: Edge case handling (empty, single-node, large, unicode)
- [ ] Benchmark: dagre vs excalidraw engine performance on large flowcharts
- [ ] Decide: persist engine choice in LayoutStore.metadata (Phase 3)
- [ ] Evaluate and prototype extension to class/state/ER diagram types (next likely engine-expansion batch)
- [x] P-A: add `groupIds` contract so class-diagram blocks move as one component
- [x] P-B: wire `canvas:edge-routed` persistence and curved-waypoint consumption
- [ ] Persist user-selected edge route style/intent (e.g. rounded/curved vs sharp/orthogonal/direct), not just waypoint coordinates
- [x] P-D.1: persist node corner roundness overrides in `NodeStyle.roundness`
- [x] P-D.2: persist edge corner curvature in `EdgeStyle.roundness`
- [x] P-C: reassess broader mermaid-to-excalidraw expansion — decision: upstream likely supports class/state/ER/sequence structured output; keep Accordo implementation flowchart-only for now, expand later by batch
- [ ] Decide whether sequence diagrams should enter Accordo’s editable-surface scope
- [ ] Revalidate upstream support for mindmap/block-beta before planning those engines around mermaid-to-excalidraw
- [ ] Update `docs/module-map-diagram.md` for the new engine modules
- [ ] Update `docs/10-architecture/diagram-architecture.md` for dual-engine layout flow
