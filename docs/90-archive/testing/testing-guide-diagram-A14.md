# Testing Guide — A14: Diagram MCP Tool Definitions (`tools/diagram-tools.ts`)

**Module:** A14 — `tools/diagram-tools.ts`
**Package:** `packages/diagram`
**Date:** 2026-03-12
**Scope:** Six `accordo_diagram_*` MCP tool definitions, handler implementations, and the
`resolveGuarded` path-safety helper. A14 defines the tool objects as
`ExtensionToolDefinition[]`; they will be registered with the Hub in A17 (extension entry).
This guide covers everything that can be verified before the extension entry is wired.

---

## Part 1 — Automated Tests

Run these two checks every time you change the module. They must both be clean before
anything else.

### Step 1 — Build the package

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build
```

Expected: exits `0` with no TypeScript errors. pnpm script banners on success are normal.

### Step 2 — Run the full test suite

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec vitest run
```

Expected output (last lines):

```
 Test Files  12 passed (12)
      Tests  377 passed (377)
```

All 377 tests must pass. The A14-specific file is
`src/__tests__/diagram-tools.test.ts` (45 tests, DT-01..DT-45). The prior eleven
files (types, parser, layout-store, auto-layout, edge-identity, placement, shape-map,
edge-router, reconciler, canvas-generator, and any protocol/types files) must remain
untouched at 332 tests.

### Step 3 — TypeScript typecheck

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec tsc --noEmit
```

Expected: exits `0`. Any line beginning with a file path followed by `error TS` is a
failure. pnpm script banners on success are normal.

---

## Part 2 — REPL Smoke Tests (developer — no webview required)

These verify runtime behaviour via Node.js against the compiled `dist/` output.
Run `pnpm build` first (once per session after any source change).

All snippets must be run from inside `packages/diagram`:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
```

---

### Tool 1 of 6 — `accordo_diagram_style_guide`

**What it does:** Pure lookup — no disk I/O. Returns the colour palette, a Mermaid
starter template, and a conventions list.

```bash
node --input-type=module << 'EOF'
import { styleGuideHandler } from "./dist/tools/diagram-tools.js";

const result = styleGuideHandler({});
console.log("ok:", result.ok);
console.log("palette.primary:", result.data.palette.primary);
console.log("palette keys:", Object.keys(result.data.palette).join(", "));
console.log("conventions count:", result.data.conventions.length);
console.log("starterTemplate first line:", result.data.starterTemplate.split("\n")[0]);
EOF
```

**Expected:**

```
ok: true
palette.primary: #4A90D9
palette keys: primary, secondary, success, warning, danger, neutral, background, border
conventions count: 6
starterTemplate first line: flowchart TD
```

---

### Tool 2 of 6 — `accordo_diagram_list`

**What it does:** Recursively finds all `.mmd` files in the workspace root, parses each,
and returns an array of `{ path, type, nodeCount }` entries.

```bash
node --input-type=module << 'EOF'
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listHandler } from "./dist/tools/diagram-tools.js";

const root = mkdtempSync(join(tmpdir(), "a14-list-"));
writeFileSync(join(root, "infra.mmd"), "flowchart TD\nA-->B\nA-->C\n");
writeFileSync(join(root, "notes.txt"), "not a mmd file");

const ctx = { workspaceRoot: root, getPanel: () => undefined };
const result = await listHandler({}, ctx);
console.log("ok:", result.ok);
console.log("count:", result.data.length);
console.log("path:", result.data[0].path);
console.log("type:", result.data[0].type);
console.log("nodeCount:", result.data[0].nodeCount);
EOF
```

**Expected:**

```
ok: true
count: 1
path: infra.mmd
type: flowchart
nodeCount: 3
```

---

### Tool 3 of 6 — `accordo_diagram_get`

**What it does:** Reads a `.mmd` file, parses its Mermaid source, and returns the
semantic graph (nodes, edges, clusters) together with the stored layout (or `null`
if no `.layout.json` exists yet).

```bash
node --input-type=module << 'EOF'
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getHandler } from "./dist/tools/diagram-tools.js";

const root = mkdtempSync(join(tmpdir(), "a14-get-"));
writeFileSync(join(root, "svc.mmd"), "flowchart TD\nAPI-->DB\nAPI-->Cache\n");

const ctx = { workspaceRoot: root, getPanel: () => undefined };
const result = await getHandler({ path: "svc.mmd" }, ctx);
console.log("ok:", result.ok);
console.log("type:", result.data.type);
console.log("nodeCount:", result.data.nodes.length);
console.log("edgeCount:", result.data.edges.length);
console.log("layout:", result.data.layout);          // null — no .layout.json written yet

// Error case: file not found
const miss = await getHandler({ path: "missing.mmd" }, ctx);
console.log("missing ok:", miss.ok);
console.log("missing errorCode:", miss.errorCode);

// Error case: path traversal
const trav = await getHandler({ path: "../../../etc/passwd" }, ctx);
console.log("traversal ok:", trav.ok);
console.log("traversal errorCode:", trav.errorCode);
EOF
```

**Expected:**

```
ok: true
type: flowchart
nodeCount: 3
edgeCount: 2
layout: null
missing ok: false
missing errorCode: FILE_NOT_FOUND
traversal ok: false
traversal errorCode: TRAVERSAL_DENIED
```

---

### Tool 4 of 6 — `accordo_diagram_create`

**What it does:** Validates Mermaid source, writes a new `.mmd` file, computes the
initial layout via dagre, and writes the companion `.layout.json`. Refuses to
overwrite an existing file unless `force: true` is passed.

```bash
node --input-type=module << 'EOF'
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHandler } from "./dist/tools/diagram-tools.js";

const root = mkdtempSync(join(tmpdir(), "a14-create-"));
const ctx = { workspaceRoot: root, getPanel: () => undefined };

// Happy path
const created = await createHandler(
  { path: "pipeline.mmd", content: "flowchart LR\nIngest-->Process\nProcess-->Store\n" },
  ctx,
);
console.log("ok:", created.ok);
console.log("nodeCount:", created.data.nodeCount);
console.log("type:", created.data.type);
console.log(".mmd exists:", existsSync(join(root, "pipeline.mmd")));
console.log(".layout.json exists:", existsSync(join(root, "pipeline.layout.json")));

// Duplicate without force → ALREADY_EXISTS
const dup = await createHandler(
  { path: "pipeline.mmd", content: "flowchart LR\nA-->B\n" },
  ctx,
);
console.log("dup ok:", dup.ok);
console.log("dup errorCode:", dup.errorCode);

// Overwrite with force:true → succeeds
const forced = await createHandler(
  { path: "pipeline.mmd", content: "flowchart LR\nX-->Y\n", force: true },
  ctx,
);
console.log("forced ok:", forced.ok);
console.log("forced nodeCount:", forced.data.nodeCount);

// Invalid Mermaid → PARSE_ERROR
const bad = await createHandler(
  { path: "bad.mmd", content: "this is not valid mermaid source at all\n" },
  ctx,
);
console.log("bad ok:", bad.ok);
console.log("bad errorCode:", bad.errorCode);
EOF
```

**Expected:**

```
ok: true
nodeCount: 3
type: flowchart
.mmd exists: true
.layout.json exists: true
dup ok: false
dup errorCode: ALREADY_EXISTS
forced ok: true
forced nodeCount: 2
bad ok: false
bad errorCode: PARSE_ERROR
```

---

### Tool 5 of 6 — `accordo_diagram_patch`

**What it does:** Reads the existing `.mmd` file and its companion `.layout.json`,
applies the new Mermaid source using the reconciler (which preserves node positions
for unchanged nodes and computes positions for new ones), and writes both files back.
Cleans `%% @rename:` annotations from the Mermaid source after applying them.

```bash
node --input-type=module << 'EOF'
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHandler, patchHandler } from "./dist/tools/diagram-tools.js";

const root = mkdtempSync(join(tmpdir(), "a14-patch-"));
const ctx = { workspaceRoot: root, getPanel: () => undefined };

// First create a diagram (writes .mmd + .layout.json)
await createHandler(
  { path: "flow.mmd", content: "flowchart TD\nA-->B\n" },
  ctx,
);

// Patch: add a new node C
const patch1 = await patchHandler(
  { path: "flow.mmd", content: "flowchart TD\nA-->B\nA-->C\n" },
  ctx,
);
console.log("ok:", patch1.ok);
console.log("patched:", patch1.data.patched);
console.log("nodesAdded:", patch1.data.changes.nodesAdded);
console.log("nodesRemoved:", patch1.data.changes.nodesRemoved);
console.log("edgesAdded:", patch1.data.changes.edgesAdded);

// Patch: rename A → Alpha using @rename annotation
const patch2 = await patchHandler(
  { path: "flow.mmd", content: "flowchart TD\n%% @rename: A -> Alpha\nA-->B\nA-->C\n" },
  ctx,
);
console.log("rename ok:", patch2.ok);
console.log("renamesApplied:", patch2.data.changes.renamesApplied);
console.log("mermaidCleaned defined:", patch2.data.mermaidCleaned !== undefined);

// Error: file not found
const miss = await patchHandler({ path: "ghost.mmd", content: "flowchart TD\nX-->Y\n" }, ctx);
console.log("missing errorCode:", miss.errorCode);
EOF
```

**Expected:**

```
ok: true
patched: true
nodesAdded: [ 'C' ]
nodesRemoved: []
edgesAdded: 1
rename ok: true
renamesApplied: [ 'A -> Alpha' ]
mermaidCleaned defined: true
missing errorCode: FILE_NOT_FOUND
```

---

### Tool 6 of 6 — `accordo_diagram_render`

**What it does:** Delegates to the active diagram panel (webview) to export an SVG or
PNG buffer and write it to the specified output path. Requires the panel to be open for
the exact `.mmd` file requested.

The panel is a VSCode WebviewPanel that only exists inside the Extension Development Host.
This smoke test therefore verifies the three pre-panel guard conditions that fire without
a running panel.

```bash
node --input-type=module << 'EOF'
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderHandler } from "./dist/tools/diagram-tools.js";

const root = mkdtempSync(join(tmpdir(), "a14-render-"));
writeFileSync(join(root, "arch.mmd"), "flowchart TD\nA-->B\n");

// Case 1: No panel open
const ctx1 = { workspaceRoot: root, getPanel: () => undefined };
const r1 = await renderHandler({ path: "arch.mmd", format: "svg" }, ctx1);
console.log("no panel ok:", r1.ok);
console.log("no panel errorCode:", r1.errorCode);

// Case 2: Panel open for a different file
const ctx2 = {
  workspaceRoot: root,
  getPanel: () => ({ mmdPath: join(root, "other.mmd"), requestExport: async () => Buffer.alloc(0) }),
};
const r2 = await renderHandler({ path: "arch.mmd", format: "png" }, ctx2);
console.log("mismatch ok:", r2.ok);
console.log("mismatch errorCode:", r2.errorCode);

// Case 3: Traversal denied on output_path
const r3 = await renderHandler(
  { path: "arch.mmd", format: "svg", output_path: "../../escape.svg" },
  ctx1,
);
console.log("traversal ok:", r3.ok);
console.log("traversal errorCode:", r3.errorCode);
EOF
```

**Expected:**

```
no panel ok: false
no panel errorCode: PANEL_NOT_OPEN
mismatch ok: false
mismatch errorCode: PANEL_MISMATCH
traversal ok: false
traversal errorCode: TRAVERSAL_DENIED
```

> **Note:** The render happy-path (panel open, export returns a buffer, file written to
> disk) is covered by DT-34..DT-37 in the automated test suite. Manual verification of
> the actual SVG/PNG output requires the Extension Development Host and a live webview
> panel — deferred to the A16/A17 testing guide.

---

## Part 3 — Final Check

### 3.1 Full rebuild + tests

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build && pnpm exec vitest run
```

Expected: build exits `0`, then all **377 tests pass** across **12 test files**.

### 3.2 TypeScript clean

```bash
pnpm exec tsc --noEmit
```

Expected: exits `0`, no `error TS` lines.

### 3.3 Problems panel

Open VS Code → **View → Problems** (or ⇧⌘M). Filter to `packages/diagram`. No red
errors should appear in:

- `src/tools/diagram-tools.ts`
- `src/parser/flowchart.ts`
- `src/__tests__/diagram-tools.test.ts`

### 3.4 Regression check — prior modules unaffected

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: 12 test files, 377 tests, 0 failures, 0 skipped.

---

## What A14 Delivers

| Tool | Handler | Key behaviour |
|---|---|---|
| `accordo_diagram_list` | `listHandler` | Recursively enumerates `.mmd` files; detects type + node count per file |
| `accordo_diagram_get` | `getHandler` | Parses source; returns nodes/edges/clusters + stored layout or `null` |
| `accordo_diagram_create` | `createHandler` | Validates → writes `.mmd` + `.layout.json`; refuses overwrite unless `force: true` |
| `accordo_diagram_patch` | `patchHandler` | Reconciles layout across source changes; strips `%% @rename:` annotations |
| `accordo_diagram_render` | `renderHandler` | Delegates export to active panel; guards path, panel presence, and panel match |
| `accordo_diagram_style_guide` | `styleGuideHandler` | Pure lookup — palette, starter template, and six conventions; no I/O |

All six tool definitions are exported from `createDiagramTools(ctx)` as an
`ExtensionToolDefinition[]` array. Registration with the Hub via the Bridge API is
done in A17 (`extension.ts`).
