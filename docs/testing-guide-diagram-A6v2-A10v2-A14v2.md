# Testing Guide — Backfill TDD Pass: A6-v2, A10-v2, A14-v2

**Modules covered:**
- **A6-v2** — `reconciler/placement.ts` — dagre-first placement algorithm (PL-21..PL-24)
- **A10-v2** — `canvas/canvas-generator.ts` — per-node visual style overrides (CG-28..CG-33)
- **A14-v2** — `tools/diagram-tools.ts` — `nodeStyles` width/height segregation in `patchHandler` (DT-49..DT-52)

**Package:** `packages/diagram`  
**Date:** 2026-03-14  
**Backfill note:** Implementation preceded tests by agreement (reviewer approval on file). Tests are discriminating and verified against live dagre output.

---

## Part 1 — Automated Tests

Run these two checks every time you change the module. Both must be clean before anything else.

### Step 1 — Build the package

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build
```

Expected: exits `0` with no TypeScript errors.

### Step 2 — Run the full test suite

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec vitest run
```

Expected output (last lines):

```
 Test Files  17 passed (17)
      Tests  444 passed (444)
```

All 444 tests must pass. The three test files under review are:
- `src/__tests__/placement.test.ts` — 24 tests (PL-01..PL-24; PL-21..24 are the A6-v2 additions)
- `src/__tests__/canvas-generator.test.ts` — 33 tests (CG-01..CG-33; CG-28..33 are the A10-v2 additions)
- `src/__tests__/diagram-tools.test.ts` — 52 tests (DT-01..DT-52; DT-49..52 are the A14-v2 additions)

### Step 3 — TypeScript typecheck

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm typecheck
```

Expected: exits `0`. Any line beginning with a file path followed by `error TS` is a failure.

---

## Part 2 — REPL Smoke Tests

These verify runtime behaviour via Node.js against the compiled `dist/` output.
Run `pnpm build` first (once per session after any source change).

All snippets must be run from inside `packages/diagram`:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
```

---

### Section 1 — A6-v2: Dagre-first placement (`placeNodes`)

#### Test 1a — New node placed relative to its dagre-nearest placed neighbour

Verifies PL-21: when a node is added to a diagram where one parent is already placed
at a far-off position, the unplaced node anchors to that parent via dagre-relative
offset rather than the canvas-nearest placed node.

```bash
node --input-type=module << 'EOF'
import { placeNodes } from "./dist/reconciler/placement.js";

// P1 (placed, near origin) → P2 (placed, far away) → C (unplaced)
// Also has P1 → C edge.
// Old canvas-nearest logic picks P1 (closer in canvas space) and places C near (100, 220).
// Dagre-nearest logic: in dagre ideal, C is closer to P2 — so anchors there → C.y > 1000.

const parsed = {
  type: "flowchart",
  nodes: new Map([
    ["P1", { id: "P1", label: "P1", shape: "rectangle", classes: [] }],
    ["P2", { id: "P2", label: "P2", shape: "rectangle", classes: [] }],
    ["C",  { id: "C",  label: "C",  shape: "rectangle", classes: [] }],
  ]),
  edges: [
    { from: "P1", to: "P2", ordinal: 0, label: "", type: "arrow" },
    { from: "P2", to: "C",  ordinal: 0, label: "", type: "arrow" },
    { from: "P1", to: "C",  ordinal: 0, label: "", type: "arrow" },
  ],
  clusters: [],
  renames: [],
  direction: "TD",
};
const layout = {
  version: "1.0", diagram_type: "flowchart", edges: {}, clusters: {}, unplaced: [], aesthetics: {},
  nodes: {
    P1: { x: 100, y: 100, w: 180, h: 60, style: {} },
    P2: { x: 1000, y: 1000, w: 180, h: 60, style: {} },
  },
};

const result = placeNodes(["C"], parsed, layout, { direction: "TD" });
const C = result.get("C");
console.log("C defined:", C !== undefined);
console.log("C.y > 1000:", C.y > 1000);   // dagre-nearest anchors to P2 → C near (1065, 1140)
console.log("C.y actual:", C.y);
EOF
```

**Expected:**

```
C defined: true
C.y > 1000: true
C.y actual: <number above 1000>
```

---

#### Test 1b — All-unplaced chain: dagre-absolute gap > nodeSpacing gap

Verifies PL-22: when no placed neighbours exist, nodes are placed at dagre-absolute
coordinates. The dagre rank gap (ranksep=80 → gap=140) is larger than the legacy
heuristic gap (parent.h + nodeSpacing = 120), distinguishing the two code paths.

```bash
node --input-type=module << 'EOF'
import { placeNodes } from "./dist/reconciler/placement.js";

const parsed = {
  type: "flowchart",
  nodes: new Map([
    ["parent", { id: "parent", label: "parent", shape: "rectangle", classes: [] }],
    ["child",  { id: "child",  label: "child",  shape: "rectangle", classes: [] }],
  ]),
  edges: [{ from: "parent", to: "child", ordinal: 0, label: "", type: "arrow" }],
  clusters: [],
  renames: [],
  direction: "TD",
};
const emptyLayout = {
  version: "1.0", diagram_type: "flowchart", nodes: {}, edges: {}, clusters: {}, unplaced: [], aesthetics: {},
};

const result = placeNodes(["parent", "child"], parsed, emptyLayout, { direction: "TD" });
const parentPos = result.get("parent");
const childPos  = result.get("child");
const gap = childPos.y - parentPos.y;
console.log("parent.y:", parentPos.y);
console.log("child.y:", childPos.y);
console.log("gap:", gap);
console.log("gap > 120 (dagre > heuristic):", gap > 120);
EOF
```

**Expected:**

```
parent.y: <small number, ~30>
child.y: <~170>
gap: 140
gap > 120 (dagre > heuristic): true
```

---

#### Test 1c — Unsupported diagram type falls back gracefully (no throw)

Verifies PL-23: when the diagram type is not supported by dagre (`block-beta`), `placeNodes`
catches the error and falls back to the neighbour-adjacent heuristic. No exception is thrown.

```bash
node --input-type=module << 'EOF'
import { placeNodes } from "./dist/reconciler/placement.js";

const blockBeta = {
  type: "block-beta",
  nodes: new Map([
    ["anchor",  { id: "anchor",  label: "anchor",  shape: "rectangle", classes: [] }],
    ["newNode", { id: "newNode", label: "newNode", shape: "rectangle", classes: [] }],
  ]),
  edges: [{ from: "anchor", to: "newNode", ordinal: 0, label: "", type: "arrow" }],
  clusters: [],
  renames: [],
  direction: "TD",
};
const layout = {
  version: "1.0", diagram_type: "block-beta", edges: {}, clusters: {}, unplaced: [], aesthetics: {},
  nodes: { anchor: { x: 200, y: 200, w: 180, h: 60, style: {} } },
};

let threw = false;
let pos;
try {
  const result = placeNodes(["newNode"], blockBeta, layout);
  pos = result.get("newNode");
} catch {
  threw = true;
}
console.log("threw:", threw);           // must be false
console.log("pos defined:", pos !== undefined);
console.log("pos.x finite:", isFinite(pos.x));
console.log("pos.y finite:", isFinite(pos.y));
// Must not overlap anchor (200,200,180,60)
const noOverlap = pos.x + pos.w <= 200 || 200 + 180 <= pos.x
               || pos.y + pos.h <= 200 || 200 + 60  <= pos.y;
console.log("no overlap with anchor:", noOverlap);
EOF
```

**Expected:**

```
threw: false
pos defined: true
pos.x finite: true
pos.y finite: true
no overlap with anchor: true
```

---

### Section 2 — A10-v2: Per-node visual styles (`generateCanvas`)

#### Test 2a — `fillStyle` override applied to node shape element

Verifies CG-28: a node with `style.fillStyle: "cross-hatch"` produces an Excalidraw shape
element with `fillStyle: "cross-hatch"`.

```bash
node --input-type=module << 'EOF'
import { generateCanvas } from "./dist/canvas/canvas-generator.js";

const parsed = {
  type: "flowchart",
  nodes: new Map([["A", { id: "A", label: "A", shape: "rectangle", classes: [] }]]),
  edges: [], clusters: [], renames: [],
};
const layout = {
  version: "1.0", diagram_type: "flowchart", edges: {}, clusters: {}, unplaced: [], aesthetics: {},
  nodes: { A: { x: 100, y: 100, w: 180, h: 60, style: { fillStyle: "cross-hatch" } } },
};

const scene = generateCanvas(parsed, layout);
const shapeEl = scene.elements.find(el => el.mermaidId === "A" && el.type !== "text");
console.log("element found:", shapeEl !== undefined);
console.log("fillStyle:", shapeEl?.fillStyle);
EOF
```

**Expected:**

```
element found: true
fillStyle: cross-hatch
```

---

#### Test 2b — No `fillStyle` in style → field is `undefined` (Excalidraw default preserved)

Verifies CG-29: if `style.fillStyle` is not set, the generated element does not have
a `fillStyle` field (or has `undefined`), leaving Excalidraw to apply its own default.

```bash
node --input-type=module << 'EOF'
import { generateCanvas } from "./dist/canvas/canvas-generator.js";

const parsed = {
  type: "flowchart",
  nodes: new Map([["A", { id: "A", label: "A", shape: "rectangle", classes: [] }]]),
  edges: [], clusters: [], renames: [],
};
const layout = {
  version: "1.0", diagram_type: "flowchart", edges: {}, clusters: {}, unplaced: [], aesthetics: {},
  nodes: { A: { x: 100, y: 100, w: 180, h: 60, style: {} } },
};

const scene = generateCanvas(parsed, layout);
const shapeEl = scene.elements.find(el => el.mermaidId === "A" && el.type !== "text");
console.log("element found:", shapeEl !== undefined);
console.log("fillStyle:", shapeEl?.fillStyle);   // undefined — no override
EOF
```

**Expected:**

```
element found: true
fillStyle: undefined
```

---

#### Test 2c — `strokeStyle: "dotted"` override applied

Verifies CG-30: a node with `style.strokeStyle: "dotted"` produces a shape element
with `strokeStyle: "dotted"`.

```bash
node --input-type=module << 'EOF'
import { generateCanvas } from "./dist/canvas/canvas-generator.js";

const parsed = {
  type: "flowchart",
  nodes: new Map([["A", { id: "A", label: "A", shape: "rectangle", classes: [] }]]),
  edges: [], clusters: [], renames: [],
};
const layout = {
  version: "1.0", diagram_type: "flowchart", edges: {}, clusters: {}, unplaced: [], aesthetics: {},
  nodes: { A: { x: 100, y: 100, w: 180, h: 60, style: { strokeStyle: "dotted" } } },
};

const scene = generateCanvas(parsed, layout);
const shapeEl = scene.elements.find(el => el.mermaidId === "A" && el.type !== "text");
console.log("strokeStyle:", shapeEl?.strokeStyle);
EOF
```

**Expected:**

```
strokeStyle: dotted
```

---

#### Test 2d — `strokeDash: true` (legacy) still produces `strokeStyle: "dashed"` when no explicit `strokeStyle`

Verifies CG-31: the legacy `strokeDash` field is honoured for backward compatibility
when the newer `strokeStyle` field is absent.

```bash
node --input-type=module << 'EOF'
import { generateCanvas } from "./dist/canvas/canvas-generator.js";

const parsed = {
  type: "flowchart",
  nodes: new Map([["A", { id: "A", label: "A", shape: "rectangle", classes: [] }]]),
  edges: [], clusters: [], renames: [],
};
const layout = {
  version: "1.0", diagram_type: "flowchart", edges: {}, clusters: {}, unplaced: [], aesthetics: {},
  nodes: { A: { x: 100, y: 100, w: 180, h: 60, style: { strokeDash: true } } },
};

const scene = generateCanvas(parsed, layout);
const shapeEl = scene.elements.find(el => el.mermaidId === "A" && el.type !== "text");
console.log("strokeStyle:", shapeEl?.strokeStyle);
EOF
```

**Expected:**

```
strokeStyle: dashed
```

---

#### Test 2e — `roughness` override takes precedence over `aesthetics.roughness`

Verifies CG-32: `style.roughness: 0` on a node overrides the diagram-level
`aesthetics.roughness: 2`.

```bash
node --input-type=module << 'EOF'
import { generateCanvas } from "./dist/canvas/canvas-generator.js";

const parsed = {
  type: "flowchart",
  nodes: new Map([["A", { id: "A", label: "A", shape: "rectangle", classes: [] }]]),
  edges: [], clusters: [], renames: [],
};
const layout = {
  version: "1.0", diagram_type: "flowchart", edges: {}, clusters: {}, unplaced: [], aesthetics: { roughness: 2 },
  nodes: { A: { x: 100, y: 100, w: 180, h: 60, style: { roughness: 0 } } },
};

const scene = generateCanvas(parsed, layout);
const shapeEl = scene.elements.find(el => el.mermaidId === "A" && el.type !== "text");
console.log("roughness:", shapeEl?.roughness);   // 0, not 2
EOF
```

**Expected:**

```
roughness: 0
```

---

#### Test 2f — `fontFamily` override applied to text element

Verifies CG-33: a node with `style.fontFamily: "Nunito"` produces a text element
(mermaidId `"A:text"`) with `fontFamily: "Nunito"`.

```bash
node --input-type=module << 'EOF'
import { generateCanvas } from "./dist/canvas/canvas-generator.js";

const parsed = {
  type: "flowchart",
  nodes: new Map([["A", { id: "A", label: "Hello", shape: "rectangle", classes: [] }]]),
  edges: [], clusters: [], renames: [],
};
const layout = {
  version: "1.0", diagram_type: "flowchart", edges: {}, clusters: {}, unplaced: [], aesthetics: {},
  nodes: { A: { x: 100, y: 100, w: 180, h: 60, style: { fontFamily: "Nunito" } } },
};

const scene = generateCanvas(parsed, layout);
const textEl = scene.elements.find(el => el.mermaidId === "A:text");
console.log("text element found:", textEl !== undefined);
console.log("fontFamily:", textEl?.fontFamily);
EOF
```

**Expected:**

```
text element found: true
fontFamily: Nunito
```

---

### Section 3 — A14-v2: `nodeStyles` in `patchHandler`

#### Test 3a — `width` and `height` go into layout sizing, not `style`

Verifies DT-49 and DT-50: when `nodeStyles` contains `width` or `height`, those values are
written to `NodeLayout.w` / `NodeLayout.h`, not into the visual `style` object.

```bash
node --input-type=module << 'EOF'
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHandler, patchHandler } from "./dist/tools/diagram-tools.js";
import { readLayout } from "./dist/layout/layout-store.js";

const root = mkdtempSync(join(tmpdir(), "a14v2-sizing-"));
const ctx = { workspaceRoot: root, getPanel: () => undefined };

await createHandler(
  { path: "svc.mmd", content: "flowchart TD\nA[Service A]\nB[Service B]\nA-->B\n" },
  ctx,
);

const patch = await patchHandler(
  {
    path: "svc.mmd",
    content: "flowchart TD\nA[Service A]\nB[Service B]\nA-->B\n",
    nodeStyles: { A: { width: 300, height: 100 } },
  },
  ctx,
);
console.log("ok:", patch.ok);

const lPath = join(root, "svc.layout.json");
const layout = await readLayout(lPath);
console.log("A.w:", layout.nodes.A.w);              // 300
console.log("A.h:", layout.nodes.A.h);              // 100
console.log("style.width:", layout.nodes.A.style.width);    // undefined
console.log("style.height:", layout.nodes.A.style.height);  // undefined
EOF
```

**Expected:**

```
ok: true
A.w: 300
A.h: 100
style.width: undefined
style.height: undefined
```

---

#### Test 3b — Visual style fields go into `style`, not layout dimensions

Verifies DT-51 and DT-52: `fillStyle`, `strokeStyle`, `roughness`, and `fontFamily` are
stored in `NodeLayout.style`, and `w`/`h` remain at their auto-layout values.

```bash
node --input-type=module << 'EOF'
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHandler, patchHandler } from "./dist/tools/diagram-tools.js";
import { readLayout } from "./dist/layout/layout-store.js";

const root = mkdtempSync(join(tmpdir(), "a14v2-style-"));
const ctx = { workspaceRoot: root, getPanel: () => undefined };

await createHandler(
  { path: "ui.mmd", content: "flowchart TD\nBtn[Button]\nForm[Form]\nForm-->Btn\n" },
  ctx,
);

const patch = await patchHandler(
  {
    path: "ui.mmd",
    content: "flowchart TD\nBtn[Button]\nForm[Form]\nForm-->Btn\n",
    nodeStyles: {
      Btn: { fillStyle: "cross-hatch", strokeStyle: "dotted", roughness: 0, fontFamily: "Nunito" },
    },
  },
  ctx,
);
console.log("ok:", patch.ok);

const lPath = join(root, "ui.layout.json");
const layout = await readLayout(lPath);
const btn = layout.nodes.Btn;
console.log("style.fillStyle:", btn.style.fillStyle);    // cross-hatch
console.log("style.strokeStyle:", btn.style.strokeStyle); // dotted
console.log("style.roughness:", btn.style.roughness);    // 0
console.log("style.fontFamily:", btn.style.fontFamily);  // Nunito
console.log("w unchanged (180):", btn.w === 180);         // true — width not passed, untouched
EOF
```

**Expected:**

```
ok: true
style.fillStyle: cross-hatch
style.strokeStyle: dotted
style.roughness: 0
style.fontFamily: Nunito
w unchanged (180): true
```

---

#### Test 3c — Unknown field in `nodeStyles` is silently dropped (whitelist enforced)

Verifies D2 fix F1: the `nodeStyles` whitelist allows only known `NodeStyle` keys.
An unknown field from agent MCP args must not appear in the stored style object.

```bash
node --input-type=module << 'EOF'
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHandler, patchHandler } from "./dist/tools/diagram-tools.js";
import { readLayout } from "./dist/layout/layout-store.js";

const root = mkdtempSync(join(tmpdir(), "a14v2-whitelist-"));
const ctx = { workspaceRoot: root, getPanel: () => undefined };

await createHandler(
  { path: "srv.mmd", content: "flowchart TD\nA-->B\n" },
  ctx,
);

const patch = await patchHandler(
  {
    path: "srv.mmd",
    content: "flowchart TD\nA-->B\n",
    nodeStyles: {
      A: { fillStyle: "solid", __proto__: "injected", unknownField: "should-be-dropped" },
    },
  },
  ctx,
);
console.log("ok:", patch.ok);

const lPath = join(root, "srv.layout.json");
const layout = await readLayout(lPath);
const aStyle = layout.nodes.A.style;
console.log("fillStyle stored:", aStyle.fillStyle);           // solid
console.log("unknownField absent:", aStyle.unknownField === undefined); // true
console.log("__proto__ absent:", aStyle["__proto__"] === undefined);    // true
EOF
```

**Expected:**

```
ok: true
fillStyle stored: solid
unknownField absent: true
__proto__ absent: true
```

---

## Part 4 — Manual / End-User Tests (VS Code Extension)

These tests verify what a real user can see when working with the system the normal way:
open a diagram, then ask the agent in the chat to make changes. The agent calls the MCP
tools on your behalf — you just watch the canvas.

> **Assumed state before starting:**
> - `pnpm build` has completed (Part 1 Step 1 done)
> - The Extension Development Host is running (F5)
> - The Accordo Bridge and Hub are active (agent chat responds to tool calls)

---

### Setup — Create the test diagram

If `test-diagrams/arch.mmd` does not already exist in the workspace root, create it as a
plain text file with this content:

```
flowchart TD
  A[Client] --> B{API Gateway}
  B -- auth --> C[Auth Service]
  B -- data --> D[Data Service]
  C --> E[(User DB)]
  D --> F[(Data DB)]
```

### Setup — Open the diagram panel

| # | Action | Expected |
|---|--------|----------|
| 0.1 | Open the Command Palette (**Cmd+Shift+P**) in the EDH | Palette opens |
| 0.2 | Type `Accordo: Open Diagram` and press Enter | A file picker appears |
| 0.3 | Select `test-diagrams/arch.mmd` | A webview tab opens titled `arch.mmd` |
| 0.4 | Wait for the Excalidraw canvas to load | Six shapes visible: Client, API Gateway, Auth Service, Data Service, User DB, Data DB |

---

### Test M1 — A6-v2: New node placed near its topological neighbour

**What it verifies:** When you ask the agent to add a node connected to an existing one,
the new node appears physically close to its neighbour on the canvas — not in a corner or
at the origin.

With the `arch.mmd` panel open, type this prompt in the agent chat:

> "Add a Cache node to test-diagrams/arch.mmd, connected from Data Service."

| # | What to observe | Expected |
|---|-----------------|----------|
| M1.1 | Agent responds | Agent calls `accordo_diagram_patch` and reports success |
| M1.2 | Canvas | Auto-refreshes and a new "Cache" shape appears |
| M1.3 | Canvas position of "Cache" | Appears directly below or beside "Data Service" — not isolated in a corner or at the top-left of the canvas |
| M1.4 | Other nodes | Remain in approximately the same positions they were before |

---

### Test M2 — A10-v2: Per-node visual styles — fill, stroke, roughness

**What it verifies:** Asking the agent to style a node visually changes how it looks on
the canvas immediately after the agent's call.

With the panel open, type this prompt:

> "In test-diagrams/arch.mmd, make the Client node use a cross-hatch fill, a dotted border, and roughness 0."

| # | What to observe | Expected |
|---|-----------------|----------|
| M2.1 | Agent response | Agent calls `accordo_diagram_patch` with `nodeStyles` and reports success |
| M2.2 | "Client" node fill | Background changes from the default solid/hachure fill to a **cross-hatch pattern** |
| M2.3 | "Client" node border | Border is **dotted** (short dashes, not solid) |
| M2.4 | "Client" node line quality | Appears crisply drawn (roughness 0 = precise, clean lines) compared to the slightly wobbly default |
| M2.5 | All other nodes | Visually unchanged |

---

### Test M3 — A14-v2: Node resizing via agent instruction

**What it verifies:** Asking the agent to resize a node changes its dimensions visibly on
the canvas. The size is stored as top-level `w`/`h` in the layout, not inside the style
object.

With the panel open, type this prompt:

> "Make the API Gateway node in test-diagrams/arch.mmd 280 px wide and 90 px tall."

| # | What to observe | Expected |
|---|-----------------|----------|
| M3.1 | Agent response | Agent calls `accordo_diagram_patch` with `nodeStyles: { B: { width: 280, height: 90 } }` and reports success |
| M3.2 | "API Gateway" node width | Visibly wider than the other nodes (roughly double the default width) |
| M3.3 | "API Gateway" node height | Visibly taller than the neighbouring nodes |
| M3.4 | All other nodes | Not resized |

Now ask the agent to confirm what was stored:

> "Show me the current layout data for the API Gateway node in test-diagrams/arch.mmd."

| # | What to observe | Expected |
|---|-----------------|----------|
| M3.5 | Agent response | Agent calls `accordo_diagram_get` and shows the node data |
| M3.6 | `w` and `h` values | `w: 280` and `h: 90` at the top level of the node object |
| M3.7 | `style.width` / `style.height` | Must be **absent** — sizing is top-level, not inside `style` |

---

### Test M4 — A10-v2: Font family override visible on canvas

**What it verifies:** Asking the agent to change a node's font renders the new typeface
visibly inside the node on the canvas.

With the panel open, type this prompt:

> "Change the font of the Auth Service node in test-diagrams/arch.mmd to Nunito."

| # | What to observe | Expected |
|---|-----------------|----------|
| M4.1 | Agent response | Agent calls `accordo_diagram_patch` with `nodeStyles: { C: { fontFamily: "Nunito" } }` |
| M4.2 | "Auth Service" label | Text renders in **Nunito** — a round, clean sans-serif — noticeably different from the hand-drawn Excalifont default |
| M4.3 | "Data Service" label (untouched) | Still uses the default Excalifont hand-drawn style |

---

### Test M5 — Moving a node manually and confirming layout persistence

**What it verifies:** The user can drag a node on the canvas and the position is saved.
This is a baseline interaction check unrelated to the new modules but confirms the system
is healthy end-to-end.

| # | Action | Expected |
|---|--------|----------|
| M5.1 | On the canvas, click and drag the "User DB" node to a new position | Node moves smoothly |
| M5.2 | Wait ~1 second after releasing | Canvas does not snap back; the node stays where you dropped it |
| M5.3 | Ask the agent: "What is the current position of the User DB node in test-diagrams/arch.mmd?" | Agent calls `accordo_diagram_get` and returns coordinates that match the dragged position |

---

## Part 5 — Final Check

### Step 1 — Full build

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build
```

Expected: exits `0`.

### Step 2 — Full test suite (monorepo)

```bash
cd /Users/Shared/dev/accordo
pnpm --filter accordo-diagram test
```

Expected last lines:

```
 Test Files  17 passed (17)
      Tests  444 passed (444)
```

### Step 3 — Typecheck

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm typecheck
```

Expected: exits `0`.

### Step 4 — VS Code Problems panel

Open the `packages/diagram/src` folder in VS Code. The Problems panel must show zero
errors under the `accordo-diagram` source files. (Webview bundle warnings from
Excalidraw are pre-existing and out of scope for this pass.)
