# Testing Guide — A4 Auto-layout (`layout/auto-layout.ts`)

`computeInitialLayout` takes a `ParsedDiagram` and returns a `LayoutStore` with
every node placed at (x, y) coordinates computed by the dagre Sugiyama algorithm.

This module has **no HTTP or MCP surface** — there are no curl commands or VS Code
debug sessions required. All verification is done by the automated test suite plus
an optional interactive REPL step for eyeballing real coordinates.

---

## Part 1 — Confirm the automated suite is green

**Step 1 — Build the package.**

```
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build
```

Expected: exits `0` with no TypeScript errors printed.

**Step 2 — Run the full test suite.**

```
pnpm test
```

Expected output (last lines):

```
 Test Files  4 passed (4)
      Tests  192 passed (192)
```

All four test files must pass. The A4-specific file is
`src/__tests__/auto-layout.test.ts` (35 tests). The prior three files
(types, parser, layout-store) must remain untouched at 157 tests.

**Step 3 — Type-check.**

```
pnpm typecheck
```

Expected: exits `0`. Any line beginning with a file path and `error TS` is a failure; pnpm script banners on success are normal.

---

## Part 2 — Interactive REPL smoke-test (optional but recommended)

This step lets you visually inspect that dagre actually computed non-trivial
coordinates. Run it any time you're unsure whether the algorithm produced
meaningful output.

**Step 1 — Open a Node.js REPL with the built module.**

```
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build
node --input-type=module
```

**Step 2 — Paste the following snippet.**

```javascript
import { computeInitialLayout } from "./dist/layout/auto-layout.js";

// Build a minimal three-node chain: A -> B -> C
const parsed = {
  type: "flowchart",
  nodes: new Map([
    ["A", { id: "A", label: "Ingest",   shape: "rounded",   classes: [] }],
    ["B", { id: "B", label: "Process",  shape: "rectangle", classes: [] }],
    ["C", { id: "C", label: "Persist",  shape: "cylinder",  classes: [] }],
  ]),
  edges: [
    { from: "A", to: "B", ordinal: 0, label: "", type: "arrow" },
    { from: "B", to: "C", ordinal: 0, label: "", type: "arrow" },
  ],
  clusters: [],
  renames: [],
};

const layout = computeInitialLayout(parsed, { rankdir: "TB" });
console.log("version:", layout.version);
console.log("diagram_type:", layout.diagram_type);
console.log("nodes:");
for (const [id, n] of Object.entries(layout.nodes)) {
  console.log(`  ${id}: x=${n.x} y=${n.y} w=${n.w} h=${n.h}`);
}
console.log("edges:", Object.keys(layout.edges));
console.log("aesthetics:", layout.aesthetics);
```

**What you should see:**

```
version: 1.0
diagram_type: flowchart
nodes:
  A: x=<number> y=<lower number>   w=180 h=60
  B: x=<number> y=<middle number>  w=180 h=60
  C: x=<number> y=<higher number>  w=120 h=80
edges: [ 'A->B:0', 'B->C:0' ]
aesthetics: { roughness: 1, animationMode: 'draw-on', theme: 'hand-drawn' }
```

Key checks to do by eye:

| What to check | Good sign | Bad sign |
|---|---|---|
| `version` | `"1.0"` | anything else |
| `diagram_type` | `"flowchart"` | anything else |
| A.y < B.y < C.y | y grows downward, confirming TB rank order | all equal, or out of order |
| C.w = 120, C.h = 80 | cylinder default dims applied | 180/60 (rectangle fallback used by mistake) |
| `aesthetics.roughness` | `1` | `0` or `undefined` |

**Step 3 — Test the error guard.**

```javascript
try {
  computeInitialLayout({ ...parsed, type: "mindmap" });
} catch (e) {
  console.log(e.name);    // UnsupportedDiagramTypeError
  console.log(e.message); // contains "mindmap"
}
```

Expected output:

```
UnsupportedDiagramTypeError
Auto-layout for diagram type "mindmap" is not supported in diag.1. ...
```

**Step 4 — Try LR direction on the same chain.**

```javascript
const lr = computeInitialLayout(parsed, { rankdir: "LR" });
const xs = Object.values(lr.nodes).map(n => n.x);
const ys = Object.values(lr.nodes).map(n => n.y);
console.log("x values (should differ):", xs);  // three distinct values
console.log("y values (should be close):", ys); // roughly the same row
```

Expected: `xs` shows three different values increasing left → right; `ys` shows
similar or identical values (all nodes on one horizontal plane).

---

## Part 3 — Final checks before approving Phase E

1. **`pnpm test`** → `192 passed (192)`, exit code `0`.
2. **`pnpm typecheck`** → exit code `0`, no lines of output.
3. **VS Code Problems panel** → zero errors in `packages/diagram/src/`.
4. **No `any` in new code** → `grep -r ": any" packages/diagram/src/layout/auto-layout.ts` returns nothing.
