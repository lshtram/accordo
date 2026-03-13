# Testing Guide — A15: DiagramPanel (`webview/panel.ts`)

**Module:** A15 — `webview/panel.ts`
**Package:** `packages/diagram`
**Date:** 2026-03-13
**Scope:** `DiagramPanel` class — VSCode webview panel lifecycle, canvas-only design,
file-watcher auto-refresh, layout patch on canvas drag/resize, export handshake,
toast/error-overlay messaging, and disposal. All error types exported from this module.

> **Integration note:** `DiagramPanel` requires VS Code extension host context at
> import time (it depends on the `vscode` module). Full end-to-end testing via VS Code
> launcher is only possible once A16 (webview frontend) and A17 (extension.ts) are
> complete. Part 2 of this guide provides verified _pre-integration_ checks. Part 3
> covers the full integration scenarios to run after those modules land.

---

## Part 1 — Automated Tests

Run these three checks every time the module changes. All must be clean before
proceeding to any other verification step.

### Step 1 — Build the package

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build
```

Expected: exits `0` with no output other than the pnpm banner. Any lines beginning
with a file path followed by `error TS` are failures.

### Step 2 — Run the full test suite

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec vitest run
```

Expected output (last three lines):

```
 Test Files  13 passed (13)
      Tests  392 passed (392)
```

All 392 tests must pass. The A15-specific file is `src/__tests__/panel.test.ts`
(15 tests, AP-01..AP-15). The prior 12 files (types, parser, layout-store,
auto-layout, edge-identity, placement, shape-map, edge-router, reconciler,
canvas-generator, protocol, and diagram-tools) must remain untouched at 377 tests.

To run A15 tests in isolation with verbose output:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec vitest run --reporter=verbose src/__tests__/panel.test.ts
```

Expected verbose output:

```
 ✓ src/__tests__/panel.test.ts (15 tests)
   ✓ DiagramPanel.create() (3)
     ✓ AP-01: returns a DiagramPanel with the correct mmdPath
     ✓ AP-02: calls vscode.window.createWebviewPanel with the correct viewType and title
     ✓ AP-03: posts host:load-scene to the webview on creation
   ✓ DiagramPanel.refresh() (3)
     ✓ AP-04: re-reads the .mmd file and posts a fresh host:load-scene
     ✓ AP-05: rejects with PanelFileNotFoundError when .mmd file does not exist
     ✓ AP-06: uses auto-layout when no layout.json exists, still produces a valid scene
   ✓ DiagramPanel.notify() (1)
     ✓ AP-07: posts { type: 'host:toast', message } to the webview
   ✓ DiagramPanel.requestExport() (4)
     ✓ AP-08: posts { type: 'host:request-export', format } to the webview
     ✓ AP-09: resolves with a Buffer when webview posts canvas:export-ready
     ✓ AP-10: rejects with ExportBusyError when a second export is requested while one is in flight
     ✓ AP-11: rejects with PanelDisposedError when panel is disposed while export is pending
   ✓ Canvas message dispatch (2)
     ✓ AP-12: canvas:node-moved writes updated layout.json with new position
     ✓ AP-13: canvas:node-resized writes updated layout.json with new dimensions
   ✓ DiagramPanel.dispose() (2)
     ✓ AP-14: calls dispose() on the underlying VS Code webview panel
     ✓ AP-15: all mutating methods reject/throw with PanelDisposedError after dispose()
```

### Step 3 — TypeScript typecheck

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec tsc --noEmit
```

Expected: exits `0` with no output (other than the pnpm banner). Any `error TS` line
is a failure.

### Step 4 — Banned pattern scan

```bash
cd /Users/Shared/dev/accordo/packages/diagram
grep -rn ": any" src/ && echo "FAIL: found :any" || echo "ok: no :any"
grep -rn "console\.log" src/ && echo "FAIL: found console.log" || echo "ok: no console.log"
grep -rn "TODO\|FIXME" src/ && echo "WARN: unresolved markers" || echo "ok: no TODO/FIXME"
```

Expected: all three print the `ok:` line. No `FAIL:` lines.

---

## Part 2 — Pre-Integration Checks (no VS Code required)

These verify runtime correctness of the sub-components used by `DiagramPanel`
independently of the VS Code extension host.

### 2.1 Parser sub-component — real Mermaid parse

`parseMermaid` is used by `_loadAndPost`. Verify it returns a valid diagram for the
unlabeled fixture format used by all A15 tests:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
import { parseMermaid } from "./dist/parser/adapter.js";
const result = await parseMermaid("flowchart TD\nA-->B\n");
console.log("valid:", result.valid);
console.log("type:", result.valid ? result.diagram.type : "n/a");
console.log("edgeCount:", result.valid ? result.diagram.edges.length : "n/a");
console.log("from/to:", result.valid ? result.diagram.edges.map(e => `${e.from}->${e.to}`).join(", ") : "n/a");
EOF
```

Expected:

```
valid: true
type: flowchart
edgeCount: 1
from/to: A->B
```

> **DOMPurify note:** Bracket-labeled Mermaid nodes (`A[Start]`) trigger
> `DOMPurify.addHook()` which fails in Node.js (no DOM). All A15 unit tests use
> unlabeled fixtures (`A-->B`). The integration tests in Part 3 (full VS Code
> context) can use any valid Mermaid syntax.

### 2.2 Layout auto-layout sub-component

`computeInitialLayout` is called by `_loadAndPost` when no `layout.json` exists.
This is the path exercised by AP-03 and AP-06:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
import { parseMermaid } from "./dist/parser/adapter.js";
import { computeInitialLayout } from "./dist/layout/auto-layout.js";

const parsed = await parseMermaid("flowchart TD\nA-->B\nB-->C\n");
if (!parsed.valid) { console.error("parse failed"); process.exit(1); }

const layout = computeInitialLayout(parsed.diagram);
console.log("nodes in layout:", Object.keys(layout.nodes).length);
console.log("all have x/y:", Object.values(layout.nodes).every(n => typeof n.x === "number" && typeof n.y === "number"));
console.log("unplaced empty:", layout.unplaced.length === 0);
EOF
```

Expected:

```
nodes in layout: 3
all have x/y: true
unplaced empty: true
```

### 2.3 Canvas generator sub-component

`generateCanvas` converts the parsed diagram + layout into Excalidraw elements.
This is what `_loadAndPost` posts as `host:load-scene`:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
import { parseMermaid } from "./dist/parser/adapter.js";
import { computeInitialLayout } from "./dist/layout/auto-layout.js";
import { generateCanvas } from "./dist/canvas/canvas-generator.js";

const parsed = await parseMermaid("flowchart TD\nA-->B\nB-->C\n");
if (!parsed.valid) { console.error("parse failed"); process.exit(1); }

const layout = computeInitialLayout(parsed.diagram);
const scene = generateCanvas(parsed.diagram, layout);

console.log("elements count:", scene.elements.length);
console.log("no unplaced:", scene.layout.unplaced.length === 0);
console.log("element types:", [...new Set(scene.elements.map(e => e.type))].join(", "));
EOF
```

Expected:

```
elements count: 5
no unplaced: true
element types: rectangle, arrow
```

(3 nodes → 3 rectangles, 2 edges → 2 arrows)

### 2.4 Protocol type shapes

Verify the compiled protocol exports have the correct discriminant `type` strings
(these are the values `DiagramPanel` posts to the webview):

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
// protocol.ts only imports types, no vscode dependency at runtime
import "./dist/webview/protocol.js";
console.log("protocol module loads cleanly");
EOF
```

Expected:

```
protocol module loads cleanly
```

---

## Part 3 — Integration Tests (requires A16 + A17)

Run these scenarios once the webview frontend (A16) and extension entry (A17) are
complete and the full extension is loaded via the VS Code Extension Development Host.

### Prerequisites

1. Build the entire workspace:

   ```bash
   cd /Users/Shared/dev/accordo
   pnpm build
   ```

2. Press **F5** from the repo root — this launches the Extension Development Host with
   the Bridge, Editor, and Diagram extensions loaded together.
3. A new VS Code window opens. Confirm **"Accordo Diagram"** appears in the status bar
   (or the Accordo panel shows no activation error).
4. Create a sample diagram file in the EDH workspace:

   ```bash
   cat > /tmp/test-diagram.mmd << 'EOF'
   flowchart TD
     Start --> Parse
     Parse --> Layout
     Layout --> Render
     Render --> End
   EOF
   ```

---

### Test I1 — Panel creation via command

**Goal:** Opening a `.mmd` file via the Accordo Diagram command shows the Excalidraw
canvas panel.

| # | Action | Expected |
|---|--------|----------|
| I1.1 | Open Command Palette (`Cmd+Shift+P`) → type **"Accordo: Open Diagram"** and select it | File picker or active-editor detection opens |
| I1.2 | Navigate to `/tmp/test-diagram.mmd` | A new editor pane opens showing the Excalidraw canvas |
| I1.3 | Confirm the panel title matches the filename without extension | Title bar shows `"test-diagram"` |
| I1.4 | Confirm 4 nodes and 4 edges are visible on the canvas | `Start`, `Parse`, `Layout`, `Render`, `End` with connecting arrows |

---

### Test I2 — File watcher auto-refresh

**Goal:** Editing and saving the `.mmd` file in VS Code's text editor refreshes the
canvas automatically (AP-04 covered in unit tests; this verifies end-to-end wiring).

| # | Action | Expected |
|---|--------|----------|
| I2.1 | With the panel open, open `/tmp/test-diagram.mmd` in a text editor tab (`Cmd+P`) | Text editor opens alongside the canvas panel |
| I2.2 | Add a new node: append `Render --> Cleanup` to the file and save (`Cmd+S`) | Canvas panel updates within ~1 second; new `Cleanup` node appears |
| I2.3 | Confirm existing node positions are preserved (they should not jump) | `Start`, `Parse`, `Layout`, `Render`, `End` stay in the same locations |
| I2.4 | Save the file again without changes | Canvas does not re-animate unnecessarily |

---

### Test I3 — Canvas drag updates layout.json

**Goal:** Dragging a node on the Excalidraw canvas persists its new position to
`layout.json` (AP-12 covered in unit tests; this verifies the full round-trip).

| # | Action | Expected |
|---|--------|----------|
| I3.1 | Drag the `Start` node to a new position on the canvas | Node moves smoothly |
| I3.2 | In a terminal, read the layout file: <br>`cat /tmp/test-diagram.layout.json \| python3 -m json.tool \| grep -A3 '"Start"'` | Shows updated `x`, `y` values reflecting the drag destination |
| I3.3 | Close and re-open the panel | `Start` node still appears at the dragged position |

---

### Test I4 — Toast notification

**Goal:** `panel.notify()` displays a transient toast in the Excalidraw canvas.

| # | Action | Expected |
|---|--------|----------|
| I4.1 | Via an agent MCP call to `accordo_diagram_patch` (any valid patch) | A toast appears briefly at the bottom of the canvas: `"Updated by agent"` |
| I4.2 | Toast auto-dismisses after ~2 seconds | No permanent overlay remains |

---

### Test I5 — Parse error shows overlay

**Goal:** A syntax error in the `.mmd` file shows a persistent `host:error-overlay`
on the canvas, not a bare JS error.

| # | Action | Expected |
|---|--------|----------|
| I5.1 | Edit `/tmp/test-diagram.mmd` to introduce a syntax error: replace `flowchart TD` with `flowchart` and save | Canvas shows a red/amber overlay with the parse error message |
| I5.2 | Confirm the overlay covers the canvas (not just a notification) | Excalidraw canvas is obscured by the error message |
| I5.3 | Fix the syntax error and save | Overlay clears; canvas refreshes with the corrected diagram |

---

### Test I6 — Export

**Goal:** `panel.requestExport()` round-trips correctly through the webview.

| # | Action | Expected |
|---|--------|----------|
| I6.1 | Via Command Palette, run **"Accordo: Export Diagram as SVG"** | Panel posts `host:request-export` to the webview |
| I6.2 | Webview returns canvas data | A save dialog appears; choose a location |
| I6.3 | Open the saved `.svg` file | Valid SVG content renders correctly in a browser or preview |
| I6.4 | Attempt to export again immediately before the first completes | Second attempt shows an error: `"An export is already in progress"` (ExportBusyError) |

---

### Test I7 — Disposal on panel close

**Goal:** Closing the panel disposes all resources; reopening starts fresh.

| # | Action | Expected |
|---|--------|----------|
| I7.1 | Close the Excalidraw panel tab (click ×) | Panel closes without errors or warnings in the Debug Console |
| I7.2 | Open the same `.mmd` via the command again | Canvas re-renders correctly from the current file + saved layout |
| I7.3 | Confirm the file watcher is reinstated | Edit + save `.mmd` triggers refresh again (repeat I2.2) |

---

## Part 4 — Final Checklist

Run before committing after any change to `panel.ts`:

| Item | Command | Expected |
|---|---|---|
| Full test suite | `pnpm --filter accordo-diagram exec vitest run` | `Tests 392 passed (392)` |
| TypeScript check | `pnpm --filter accordo-diagram exec tsc --noEmit` | no output (exit 0) |
| No `: any` | `grep -rn ": any" packages/diagram/src/` | no output |
| No `console.log` | `grep -rn "console\.log" packages/diagram/src/` | no output |
| Build clean | `pnpm --filter accordo-diagram build` | no errors |

All five must be clean. If any fail, fix before committing.
