# Testing Guide — Diagram Modality: A5, A6, A8, A9, A11

**Modules:** edge-identity · placement · shape-map · edge-router · webview protocol  
**Batch:** diag_workplan.md Week D1, modules A5–A11 (leaf batch)  
**Date:** 2026-03-12  
**Prerequisites:** A1–A4 must be green before running this guide.

---

## Part 1 — Automated Tests (CI / developer)

These run without any manual interaction and should be your first stop.

### 1.1 Run the full diagram package suite

```bash
cd packages/diagram
pnpm vitest run
```

**Expected output:**

```
 Test Files  9 passed (9)
      Tests  270 passed (270)
```

All 270 tests must pass. Zero failures. Zero skipped.

### 1.2 Run only the A5–A9 test files

If you want to exercise only the new batch in isolation:

```bash
cd packages/diagram
pnpm vitest run \
  src/__tests__/edge-identity.test.ts \
  src/__tests__/placement.test.ts \
  src/__tests__/shape-map.test.ts \
  src/__tests__/edge-router.test.ts
```

**Expected output:**

```
 Test Files  4 passed (4)
      Tests  72 passed (72)
```

### 1.3 What each test file covers

| File | Module | Req IDs | Count | Key scenarios |
|---|---|---|---|---|
| `edge-identity.test.ts` | A5 `matchEdges` | EI-01..EI-22 | 22 | empty sets, label-match priority, ordinal tie-break, label-change remove+add, unlabeled reindex, self-loops, mixed |
| `placement.test.ts` | A6 `placeNodes` | PL-01..PL-20 | 20 | empty input, neighbour-adjacent TD/LR, nodeSpacing, shape dims, collision avoidance, grid fallback, dense-layout cap, immutability |
| `shape-map.test.ts` | A8 `getShapeProps` | SM-01..SM-15 | 15 | all 9 named shapes, fallback, roundness ordering, strokeDash subgraph |
| `edge-router.test.ts` | A9 `routeEdge` | ER-01..ER-15 | 15 | auto/direct/orthogonal, self-loop, waypoints, bindings, focus+gap range, unknown fallback |

### 1.4 TypeScript typecheck

```bash
cd packages/diagram
pnpm exec tsc --noEmit
```

**Expected:** exits 0; no `error TS` lines in output. Banner text from pnpm is normal.

---

## Part 2 — REPL Smoke Tests (developer — no webview required)

These verify runtime behaviour via the Node.js REPL against the compiled `dist/`
JavaScript output. Run `pnpm build` first (once per session after any source
change), then run each snippet from `packages/diagram`.

```bash
cd packages/diagram
pnpm build
```

### 2.1 A5 — Edge identity

```bash
node --input-type=module << 'EOF'
import { matchEdges } from "./dist/reconciler/edge-identity.js";

// Labeled edge reorder: "data" and "ctrl" swapped
const oldE = [
  { from: "A", to: "B", ordinal: 0, label: "data", type: "arrow" },
  { from: "A", to: "B", ordinal: 1, label: "ctrl", type: "arrow" },
];
const newE = [
  { from: "A", to: "B", ordinal: 0, label: "ctrl", type: "arrow" },
  { from: "A", to: "B", ordinal: 1, label: "data", type: "arrow" },
];
const r = matchEdges(oldE, newE, {});
console.log("preserved count:", r.preserved.size);              // expect 2
console.log("data migration:", r.preserved.get("A->B:1"));     // {oldKey:"A->B:0", newKey:"A->B:1"}
console.log("ctrl migration:", r.preserved.get("A->B:0"));     // {oldKey:"A->B:1", newKey:"A->B:0"}
console.log("added:", r.added);                                 // []
console.log("removed:", r.removed);                            // []
EOF
```

**Expected:** preserved count 2, data and ctrl keys swapped, added/removed empty.

### 2.2 A6 — Placement

```bash
node --input-type=module << 'EOF'
import { placeNodes } from "./dist/reconciler/placement.js";

const anchor = { id: "anchor", label: "anchor", shape: "rectangle", classes: [] };
const newNode = { id: "newNode", label: "newNode", shape: "diamond", classes: [] };
const parsed = {
  type: "flowchart",
  nodes: new Map([["anchor", anchor], ["newNode", newNode]]),
  edges: [{ from: "anchor", to: "newNode", ordinal: 0, label: "", type: "arrow" }],
  clusters: [], renames: [],
};
const layout = {
  version: "1.0", diagram_type: "flowchart",
  nodes: { anchor: { x: 0, y: 0, w: 180, h: 60, style: {} } },
  edges: {}, clusters: {}, unplaced: [], aesthetics: {},
};

const r = placeNodes(["newNode"], parsed, layout);
console.log("newNode placed:", r.get("newNode"));
// expect: { x: 0, y: 120, w: 140, h: 80 }
// diamond shape → 140×80; TD default; y = anchor.y + anchor.h + 60 = 120
EOF
```

**Expected:** x=0, y=120, w=140, h=80.

### 2.3 A8 — Shape map

```bash
node --input-type=module << 'EOF'
import { getShapeProps } from "./dist/canvas/shape-map.js";

for (const shape of ["rectangle","rounded","diamond","circle","subgraph","unknown"]) {
  const p = getShapeProps(shape);
  console.log(shape.padEnd(14), p.elementType.padEnd(12),
              `${p.width}x${p.height}`.padEnd(8),
              "roundness:", p.roundness, p.strokeDash ? "dashed" : "");
}
EOF
```

**Expected output:**

```
rectangle      rectangle    180x60   roundness: null
rounded        rectangle    180x60   roundness: 8
diamond        diamond      140x80   roundness: null
circle         ellipse      80x80    roundness: null
subgraph       rectangle    200x120  roundness: null dashed
unknown        rectangle    180x60   roundness: null
```

### 2.4 A9 — Edge router

```bash
node --input-type=module << 'EOF'
import { routeEdge } from "./dist/canvas/edge-router.js";

const src = { x: 0,   y: 100, w: 180, h: 60 };
const tgt = { x: 300, y: 100, w: 180, h: 60 };

const auto = routeEdge("auto", [], src, tgt);
console.log("auto points:", auto.points.length,     // 2
            "startBinding:", auto.startBinding,      // { focus:0, gap:8 }
            "endBinding:", auto.endBinding);

const direct = routeEdge("direct", [{ x: 200, y: 200 }], src, tgt);
console.log("direct(1 wp) points:", direct.points.length, // 3
            "bindings null:", direct.startBinding === null);

const ortho = routeEdge("orthogonal", [], src, tgt);
console.log("orthogonal points:", ortho.points.length, // 3 (L-shape)
            "bindings null:", ortho.startBinding === null);

const selfLoop = routeEdge("auto", [], src, src);
console.log("self-loop points:", selfLoop.points.length); // >= 4

const unknown = routeEdge("future-mode", [], src, tgt);
console.log("unknown fallback points:", unknown.points.length); // 2 (auto)
EOF
```

**Expected:** matches comments above.

---

## Part 3 — A11 Webview Protocol (type compilation only)

A11 (`webview/protocol.ts`) contains only TypeScript type definitions. There is no
runtime code and no test file. Verification is via `tsc --noEmit`:

```bash
cd packages/diagram
pnpm exec tsc --noEmit
```

To confirm the types are importable in a consumer context:

```bash
node --input-type=module << 'EOF'
// Type-only import — just checks the module resolves at runtime
// (actual types are erased; this tests the JS output exists)
import {} from "./dist/webview/protocol.js";
console.log("A11 protocol module loads cleanly");
EOF
```

**Expected:** `A11 protocol module loads cleanly` (no import errors).

---

## Part 4 — Final Checklist

Run these after all automated tests pass:

- [ ] `pnpm vitest run` → 270 passed, 0 failed
- [ ] `pnpm exec tsc --noEmit` → exits 0, no `error TS` lines
- [ ] A5 REPL smoke: labeled edge reorder → preserved with migrated keys
- [ ] A6 REPL smoke: diamond node placed below anchor at (0, 120)
- [ ] A8 REPL smoke: all 6 rows match expected output
- [ ] A9 REPL smoke: correct point counts and binding presence/absence for all modes
- [ ] A11 protocol module loads without import error
- [ ] No `test.only` or `it.only` left in any test file
- [ ] No new `TODO` or `FIXME` comments in new modules

---

## Scope boundary note

This batch (A5/A6/A8/A9/A11) contains the leaf modules that unblock:
- **A7** (reconciler) — requires A5 + A6 + A2 + A3
- **A10** (canvas-generator) — requires A8 + A9

Neither A7 nor A10 is implemented yet. The smoke tests above verify the leaf modules
in isolation. Integration testing of the full reconcile → layout → canvas pipeline
is deferred to the testing guides for A7 and A10.
