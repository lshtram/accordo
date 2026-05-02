# Testing Guide — Diagram Excalidraw Layout Engine

## 1. Automated tests

- `pnpm test` (run in `packages/diagram`)
  - Verifies the full diagram package test suite passes.
  - Confirms the new async excalidraw-backed layout path works without regressing existing parser, layout, reconciler, canvas, panel, and comments behavior.

- `pnpm typecheck` (run in `packages/diagram`)
  - Verifies TypeScript types are clean for both host and webview builds.
  - Confirms the new `computeInitialLayoutAsync()` path, mapper types, and engine adapter compile safely under strict typing.

- `pnpm test -- src/__tests__/element-mapper.test.ts` (run in `packages/diagram`)
  - Verifies `extractGeometry()` accepts `unknown[]`, filters supported geometry, and excludes unmappable entries.
  - Verifies `mapGeometryToLayout()` matches nodes deterministically by declaration order, reports unmatched node IDs, emits warnings for unknown geometry, and normalizes cluster bounds.

- `pnpm test -- src/__tests__/excalidraw-engine.test.ts` (run in `packages/diagram`)
  - Verifies `layoutWithExcalidraw()` rejects empty source and non-flowchart diagrams.
  - Verifies successful flowchart conversion returns a valid `LayoutStore` with version `1.0`, diagram type `flowchart`, and finite node coordinates.

- `pnpm test -- src/__tests__/auto-layout.test.ts` (run in `packages/diagram`)
  - Verifies `computeInitialLayout()` remains synchronous and unchanged.
  - Verifies `computeInitialLayoutAsync()` is the async opt-in path and falls back to dagre unless `engine="excalidraw"`, `type="flowchart"`, and `source` are all present.

## 2. User journey tests

Use the demo files in `demo/diagram-layout-engine/`.

1. Open `demo/diagram-layout-engine/flowchart-basic.mmd` in the diagram editor.
   - Expected: you see three visible nodes: `Start`, `Check`, and `Done`.
   - Expected: there is an arrow from `Start` to `Check` and another from `Check` to `Done`.
   - Expected: nothing overlaps and the diagram opens without errors.

2. Open `demo/diagram-layout-engine/flowchart-duplicate-labels.mmd`.
   - Expected: you see three separate nodes, and all three are labeled `Service`.
   - Expected: the diagram opens cleanly even though the labels repeat.
   - Expected: if you close and reopen it, the nodes stay in a stable, readable arrangement and do not jump unpredictably.

3. Open `demo/diagram-layout-engine/flowchart-subgraph.mmd`.
   - Expected: you see a cluster titled `Backend`.
   - Expected: the `Backend` box surrounds `Auth`, `DB`, and `Cache` with visible padding.
   - Expected: the `Backend` title has space above the nodes and does not sit on top of them.
   - Expected: `Gateway` remains outside the cluster, with an arrow into `Auth`.

4. Open `demo/diagram-layout-engine/class-fallback.mmd`.
   - Expected: the class diagram renders successfully.
   - Expected: `Animal` and `Dog` appear as class boxes.
   - Expected: the inheritance relation still renders, confirming non-flowchart diagrams still use the existing fallback path without regression.

5. Re-open each of the three flowchart demos above.
   - Expected: they reopen successfully every time.
   - Expected: no nodes disappear, no cluster box collapses, and no arrows go missing.

## 3. Important note about current manual coverage

These demos verify the user-visible diagram behavior around this change.

The new excalidraw-backed placement engine currently has strong automated coverage (`element-mapper`, `excalidraw-engine`, and `computeInitialLayoutAsync()` tests), but there is not yet a user-facing product switch in the editor that explicitly toggles between dagre and the new engine during manual testing.

So:

- the demos above are the correct manual regression checks to run in the product
- the exact engine-selection path is currently verified by automated tests
