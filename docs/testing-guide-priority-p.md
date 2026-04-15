# Testing Guide — Priority P Canvas Interaction Batch

## 1. Automated tests

- `pnpm test` (run in `packages/diagram`)
  - Verifies the full diagram package test suite passes.
  - Confirms class-diagram block grouping and curved-edge waypoint persistence work without regressing the rest of the diagram package.

- `pnpm typecheck` (run in `packages/diagram`)
  - Verifies the new waypoint persistence path and curved routing changes remain type-safe in both host and webview builds.

- `pnpm test -- src/__tests__/priority-p.test.ts` (run in `packages/diagram`)
  - Verifies class-diagram composite elements share the same deterministic `groupIds`.
  - Verifies non-class nodes do not gain grouping unexpectedly.
  - Verifies `toExcalidrawPayload()` preserves `groupIds`.
  - Verifies curved routing consumes stored waypoints for one-waypoint and multi-waypoint cases.
  - Verifies stored edge waypoints survive a render cycle from `layout.edges` into rendered arrow geometry.

- `pnpm test -- src/__tests__/panel-core.test.ts` (run in `packages/diagram`)
  - Verifies webview-to-host canvas message handling remains correct.
  - Covers the `canvas:edge-routed` persistence path through `panel-core.ts` along with existing node-move/node-resize behavior.

- `pnpm test -- src/__tests__/edge-router.test.ts src/__tests__/edge-router-contract.test.ts` (run in `packages/diagram`)
  - Verifies edge routing geometry remains correct across direct, orthogonal, curved, and self-loop paths.
  - Confirms curved routing still preserves auto-curve behavior when no waypoints are stored.

## 2. User journey tests

Use the demo files in `demo/diagram-layout-engine/`.

1. Open `demo/diagram-layout-engine/class-fallback.mmd` in the diagram editor.
   - Expected: you see the `Animal` and `Dog` class blocks rendered as complete class boxes.
   - Expected: each class block includes its outer box and its internal class content.
   - Action: drag part of a class block (for example the outer box, title area, or member text area).
   - Expected: the whole class block moves together as one component; the box and its internal parts do not separate.

2. Open `demo/diagram-layout-engine/flowchart-subgraph.mmd`.
   - Expected: the diagram opens normally with the `Backend` cluster and visible edges.
   - Action: manually adjust a curved edge or drag an edge path/handle so the route changes visibly.
   - Expected: the edge visibly follows the new route.

3. After changing the edge route in `demo/diagram-layout-engine/flowchart-subgraph.mmd`, save if needed and close the diagram.
   - Reopen the same demo file.
   - Expected: the edited edge route is preserved after reopen.
   - Expected: the edge does not snap back to the old auto-generated path.

4. Repeat the same edge-edit persistence check with `demo/diagram-layout-engine/flowchart-basic.mmd`.
   - Expected: the edited edge route is preserved after reopen here as well.

5. Open `demo/diagram-layout-engine/flowchart-duplicate-labels.mmd`.
   - Expected: all three `Service` nodes still render correctly.
   - Expected: no regression from the earlier flowchart-engine work while the new waypoint persistence behavior is active.

## 3. Notes

- The class-block interaction fix is user-visible immediately in the editor.
- The edge-waypoint persistence fix is only considered successful if the edited edge route survives a close/reopen cycle.

## 4. Style persistence checks

Use the same demo files in `demo/diagram-layout-engine/`.

1. Open `demo/diagram-layout-engine/class-fallback.mmd`.
   - Pick a class box such as `Animal` or `Dog`.
   - Change the box corner style in the editor from sharp to rounded (or rounded to sharp).
   - Close and reopen the same diagram.
   - Expected: the chosen class box keeps the same corner style after reopen.

2. In `demo/diagram-layout-engine/class-fallback.mmd`, change the corner style on one class box only.
   - Expected: only that box changes.
   - Expected: other boxes keep their original style.
   - Reopen the diagram.
   - Expected: the per-box style difference is preserved.

3. Open `demo/diagram-layout-engine/flowchart-basic.mmd` or `demo/diagram-layout-engine/flowchart-subgraph.mmd`.
   - Select an edge.
   - Change its visual corner treatment so it becomes sharper or more rounded.
   - Close and reopen the diagram.
   - Expected: the edge keeps the same corner treatment after reopen.

4. In the same flowchart, change only the edge corner style without changing the overall route topology.
   - Expected: the edge keeps the same path/routing mode, but the corner appearance changes.
   - Reopen the diagram.
   - Expected: both the route and the chosen corner style are preserved.

5. Combine both checks on a single flowchart:
   - move an edge waypoint,
   - then change the edge’s corner style,
   - close and reopen.
   - Expected: both the waypoint position and the sharp/rounded edge style remain as edited.
