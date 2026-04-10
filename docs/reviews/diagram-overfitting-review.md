## Diagram Module Over-Fitting Audit

### Summary
**Assessment: CONCERN**

I did **not** find direct over-fitting patterns such as hard-coded demo node IDs/labels (e.g. `A`, `Start`, `conference`) or conditionals keyed to specific `flowchart-XX.mmd` content. The core parser/reconciler logic appears general-purpose.

However, I found a few **heuristic constants** that are likely safe for current demos but may be implicitly tuned to the current flowchart corpus and could degrade on larger or unusual diagrams.

---

### Findings

#### 1) Fixed parallel-edge label offsets may be implicitly tuned to current test sizes
- **File/line:** `packages/diagram/src/canvas/canvas-generator.ts:72, 291-293`
- **Snippet:**
  ```ts
  const LABEL_OFFSET_PX = 15;
  ...
  const spread = 10;
  const horizShift = cdx >= 0 ? -side * spread : side * spread;
  ```
- **Why this is an over-fitting concern:**
  These are fixed pixel offsets independent of node dimensions, zoom, or edge length. They likely work for the current example set (mostly moderate-size nodes), but can under-separate or over-separate labels in denser/larger/smaller real diagrams.
- **Recommendation:**
  Scale offsets from edge length and/or average node size (e.g., `min(max(edgeLen * k, a), b)`), or expose them as configurable layout aesthetics.

#### 2) Composite-shape geometry uses fixed skew constants
- **File/line:** `packages/diagram/src/canvas/canvas-generator.ts:390, 488-520`
- **Snippet:**
  ```ts
  const SKEW = 20;
  ```
- **Why this is an over-fitting concern:**
  A fixed skew value can look correct for default shape dimensions used in demos, but becomes proportionally wrong when shapes are resized significantly.
- **Recommendation:**
  Derive skew from width (e.g., `Math.round(w * 0.1)` with bounds), not a constant.

#### 3) Collision search has fixed attempt limits
- **File/line:** `packages/diagram/src/reconciler/placement.ts:219-244`
- **Snippet:**
  ```ts
  for (let i = 0; i < 10; i++) { ... }
  ```
- **Why this is an over-fitting concern:**
  Hard caps of `10` for each search pass may be sufficient for the current 51 demo files, but can fail in dense or large graphs (placement may stop before finding a free slot).
- **Recommendation:**
  Make attempt budget proportional to node count / occupied area, or continue until a safe bound based on diagram size is reached.

---

### Positive Observations

1. **No hard-coded demo node IDs/labels found** in reviewed production files (`flowchart.ts`, `adapter.ts`, `canvas-generator.ts`, `shape-map.ts`, `edge-router.ts`, `placement.ts`, `reconciler.ts`).
2. **Parser logic is schema-driven**, using Mermaid DB fields and mapping tables (`SHAPE_MAP`, `MERMAID_EDGE_ARROWHEADS`) rather than content-specific checks.
3. **Reconciler behavior is ID-diff based**, not example-pattern based; rename and edge migration are generic.
4. **Routing and rendering decisions are type/routing-mode based**, not branch-on-test-diagram constructs.

---

### Recommendations

1. Parameterize current geometry constants (`LABEL_OFFSET_PX`, `spread`, `SKEW`, placement iteration caps) under a small `layout/aesthetics` config.
2. Add stress tests beyond `demo/flowchart/`:
   - very dense node grids,
   - very small/very large node dimensions,
   - many parallel edges (>4 between same pair),
   - deep cluster nesting.
3. Track quality metrics (label overlap count, edge-node intersection count) in tests to ensure heuristics generalize beyond the 51 demo fixtures.
