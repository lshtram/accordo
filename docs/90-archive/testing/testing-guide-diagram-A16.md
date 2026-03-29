# Testing Guide — A16: Webview Frontend (`webview/html.ts`, `scene-adapter.ts`, `message-handler.ts`, panel wiring)

**Module:** A16 — Webview HTML builder, scene adapter, message handler, `panel.ts` wiring  
**Package:** `packages/diagram`  
**Date:** 2026-03-13  
**Scope:** Three new pure Node.js modules (`html.ts`, `scene-adapter.ts`, `message-handler.ts`) and the updated `panel.ts` host-side wiring. The Excalidraw canvas browser bundle (`webview.ts`) is wired but not built yet — Part 3 covers the full visual integration test once A17 (extension.ts) is also complete.

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

Expected output (last four lines):

```
 Test Files  16 passed (16)
      Tests  414 passed (414)
```

All 414 tests must pass. The three A16-specific files are:

| File | Tests | IDs |
|---|---|---|
| `src/__tests__/html.test.ts` | 6 | WH-01..WH-06 |
| `src/__tests__/scene-adapter.test.ts` | 6 | FONT_FAMILY_MAP structural + SA-01..SA-05 |
| `src/__tests__/message-handler.test.ts` | 9 | WF-01..WF-09 |

To run the A16 tests in isolation with verbose output:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec vitest run --reporter=verbose \
  src/__tests__/html.test.ts \
  src/__tests__/scene-adapter.test.ts \
  src/__tests__/message-handler.test.ts
```

Expected verbose output:

```
 ✓ src/__tests__/html.test.ts (6 tests)
   ✓ getWebviewHtml (6)
     ✓ WH-01: output contains <!DOCTYPE html>
     ✓ WH-02: CSP meta tag contains nonce-{nonce}
     ✓ WH-03: CSP meta tag contains cspSource
     ✓ WH-04: contains <div id="excalidraw-root">
     ✓ WH-05: <script> tag has nonce attribute and bundleUri src
     ✓ WH-06: style-src contains 'unsafe-inline'

 ✓ src/__tests__/scene-adapter.test.ts (6 tests)
   ✓ FONT_FAMILY_MAP (1)
     ✓ contains Excalifont → 1 for the pinned Excalidraw version
   ✓ toExcalidrawPayload (5)
     ✓ SA-01: id, type, x, y, width, height pass through unchanged
     ✓ SA-02: mermaidId absent from top level; present in customData.mermaidId
     ✓ SA-03: fontFamily 'Excalifont' → fontFamily: 1 (FONT_FAMILY_MAP value)
     ✓ SA-04: unknown fontFamily string falls back to 1
     ✓ SA-05: arrow passes through points, startBinding, endBinding; customData.mermaidId set

 ✓ src/__tests__/message-handler.test.ts (9 tests)
   ✓ applyHostMessage (6)
     ✓ WF-01: host:load-scene calls api.updateScene with elements and appState
     ✓ WF-02: host:load-scene calls ui.clearErrorOverlay()
     ✓ WF-03: host:request-export svg → calls exportToSvg and posts canvas:export-ready
     ✓ WF-04: host:request-export png → calls exportToBlob and posts canvas:export-ready
     ✓ WF-05: host:toast calls ui.showToast(message)
     ✓ WF-06: host:error-overlay calls ui.showErrorOverlay(message)
   ✓ detectNodeMutations (3)
     ✓ WF-07: x/y changed → { type:'moved', nodeId, x, y }
     ✓ WF-08: width/height changed → { type:'resized', nodeId, w, h }
     ✓ WF-09: element with empty customData.mermaidId is skipped
```

### Step 3 — TypeScript typecheck

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec tsc --noEmit
```

Expected: exits `0` with no output. Any `error TS` line is a failure.

### Step 4 — Banned pattern scan

```bash
cd /Users/Shared/dev/accordo/packages/diagram
grep -rn ": any" src/ && echo "FAIL: found :any" || echo "ok: no :any"
grep -rn "console\.log" src/ && echo "FAIL: found console.log" || echo "ok: no console.log"
grep -rn "TODO\|FIXME" src/ && echo "WARN: unresolved markers" || echo "ok: no TODO/FIXME"
```

Expected: all three print the `ok:` line.

---

## Part 2 — Pre-Integration Checks (no VS Code required)

These verify runtime correctness of the new A16 sub-components independently of
the VS Code extension host.

### 2.1 HTML builder — inspect the generated document

`getWebviewHtml` is called by `panel.ts` during `create()` to set `webview.html`.
Verify the structure of the output with a direct Node.js call:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
import { getWebviewHtml } from "./dist/webview/html.js";

const html = getWebviewHtml({
  nonce: "abc123testnoncevalue",
  cspSource: "vscode-webview://test",
  bundleUri: "vscode-resource://dist/webview/webview.bundle.js",
});

const checks = [
  ["DOCTYPE present",           html.includes("<!DOCTYPE html>")],
  ["nonce in CSP",              html.includes("nonce-abc123testnoncevalue")],
  ["cspSource in CSP",          html.includes("vscode-webview://test")],
  ["excalidraw-root div",       html.includes('id="excalidraw-root"')],
  ["script src is bundleUri",   html.includes('src="vscode-resource://dist/webview/webview.bundle.js"')],
  ["script nonce present",      html.includes('nonce="abc123testnoncevalue"')],
  ["unsafe-inline in style-src",html.includes("'unsafe-inline'")],
];

let allOk = true;
for (const [label, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
EOF
```

Expected: all 7 lines print `✓`.

### 2.2 Scene adapter — verify element conversion

`toExcalidrawPayload` converts the output of `generateCanvas()` before `panel.ts`
posts `host:load-scene`. Verify the full conversion pipeline:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
import { parseMermaid } from "./dist/parser/adapter.js";
import { computeInitialLayout } from "./dist/layout/auto-layout.js";
import { generateCanvas } from "./dist/canvas/canvas-generator.js";
import { toExcalidrawPayload, FONT_FAMILY_MAP } from "./dist/webview/scene-adapter.js";

const parsed = await parseMermaid("flowchart TD\nA-->B\n");
if (!parsed.valid) { console.error("parse failed"); process.exit(1); }

const layout = computeInitialLayout(parsed.diagram);
const scene = generateCanvas(parsed.diagram, layout);
const apiElements = toExcalidrawPayload(scene.elements);

console.log("input element count:", scene.elements.length);
console.log("output element count:", apiElements.length);

const allHaveCustomData = apiElements.every(el => el.customData && typeof el.customData.mermaidId === "string");
console.log("all have customData.mermaidId:", allHaveCustomData);

const noneHaveTopLevelMermaidId = apiElements.every(el => !("mermaidId" in el));
console.log("none have top-level mermaidId:", noneHaveTopLevelMermaidId);

const allHaveNumericFontFamily = apiElements.every(el => typeof el.fontFamily === "number");
console.log("all fontFamily are numeric:", allHaveNumericFontFamily);

console.log("FONT_FAMILY_MAP Excalifont value:", FONT_FAMILY_MAP["Excalifont"]);
EOF
```

Expected:

```
input element count: 3
output element count: 3
all have customData.mermaidId: true
none have top-level mermaidId: true
all fontFamily are numeric: true
FONT_FAMILY_MAP Excalifont value: 1
```

(2 nodes → 2 rectangles, 1 edge → 1 arrow = 3 elements)

### 2.3 Message handler — applyHostMessage sync paths

Verify the synchronous dispatch cases work correctly. This uses inline fakes
(the same pattern used by the automated tests):

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
import { applyHostMessage, detectNodeMutations } from "./dist/webview/message-handler.js";

// Fake API and UI
const apiCalls = [];
const uiCalls = [];
const api = {
  updateScene: (opts) => apiCalls.push({ name: "updateScene", opts }),
  getSceneElements: () => [],
  getAppState: () => ({}),
};
const ui = {
  postMessage: (msg) => uiCalls.push({ name: "postMessage", msg }),
  showToast: (m) => uiCalls.push({ name: "showToast", m }),
  showErrorOverlay: (m) => uiCalls.push({ name: "showErrorOverlay", m }),
  clearErrorOverlay: () => uiCalls.push({ name: "clearErrorOverlay" }),
};
const exportFns = {
  exportToSvg: async () => "<svg />",
  exportToBlob: async () => "base64==",
};

// Test 1: host:load-scene
await applyHostMessage({ type: "host:load-scene", elements: [], appState: { zoom: 1 } }, api, ui, exportFns);
const updateCalled = apiCalls.some(c => c.name === "updateScene");
const clearCalled = uiCalls.some(c => c.name === "clearErrorOverlay");
console.log("host:load-scene → updateScene called:", updateCalled);
console.log("host:load-scene → clearErrorOverlay called:", clearCalled);

// Test 2: host:toast
apiCalls.length = 0; uiCalls.length = 0;
await applyHostMessage({ type: "host:toast", message: "hello" }, api, ui, exportFns);
const toastCalled = uiCalls.some(c => c.name === "showToast" && c.m === "hello");
console.log("host:toast → showToast called with message:", toastCalled);

// Test 3: host:error-overlay
apiCalls.length = 0; uiCalls.length = 0;
await applyHostMessage({ type: "host:error-overlay", message: "parse error on line 3" }, api, ui, exportFns);
const errorCalled = uiCalls.some(c => c.name === "showErrorOverlay");
console.log("host:error-overlay → showErrorOverlay called:", errorCalled);

// Test 4: detectNodeMutations — moved
const prev = [{ id: "1", type: "rectangle", x: 0, y: 0, width: 100, height: 50, roughness: 1, fontFamily: 1, customData: { mermaidId: "auth" } }];
const next = [{ ...prev[0], x: 200, y: 300 }];
const mutations = detectNodeMutations(prev, next);
console.log("detectNodeMutations moved:", JSON.stringify(mutations));
EOF
```

Expected:

```
host:load-scene → updateScene called: true
host:load-scene → clearErrorOverlay called: true
host:toast → showToast called with message: true
host:error-overlay → showErrorOverlay called: true
detectNodeMutations moved: [{"type":"moved","nodeId":"auth","x":200,"y":300}]
```

### 2.4 Message handler — export path (async)

Verify `host:request-export` calls the injected export function and posts the result:

```bash
cd /Users/Shared/dev/accordo/packages/diagram
node --input-type=module << 'EOF'
import { applyHostMessage } from "./dist/webview/message-handler.js";

const posted = [];
const api = {
  updateScene: () => {},
  getSceneElements: () => [],
  getAppState: () => ({}),
};
const ui = {
  postMessage: (msg) => posted.push(msg),
  showToast: () => {},
  showErrorOverlay: () => {},
  clearErrorOverlay: () => {},
};

// SVG export
await applyHostMessage(
  { type: "host:request-export", format: "svg" },
  api,
  ui,
  { exportToSvg: async () => "<svg>test</svg>", exportToBlob: async () => "blob" },
);
console.log("svg export-ready type:", posted[0]?.type);
console.log("svg format:", posted[0]?.format);
console.log("svg data:", posted[0]?.data);

// PNG export
posted.length = 0;
await applyHostMessage(
  { type: "host:request-export", format: "png" },
  api,
  ui,
  { exportToSvg: async () => "", exportToBlob: async () => "pngdata==" },
);
console.log("png export-ready type:", posted[0]?.type);
console.log("png format:", posted[0]?.format);
console.log("png data:", posted[0]?.data);
EOF
```

Expected:

```
svg export-ready type: canvas:export-ready
svg format: svg
svg data: <svg>test</svg>
png export-ready type: canvas:export-ready
png format: png
png data: pngdata==
```

---

## Part 3 — Integration Tests (requires A16 webview bundle + A17 extension.ts)

These tests are the integration scenarios originally listed in the A15 testing guide
(Part 3). They are runnable once `webview.ts` is bundled (via `pnpm build:webview`)
and A17 activates the extension.

### Prerequisites

Before running any integration test:

1. Build the full extension:
   ```bash
   cd /Users/Shared/dev/accordo/packages/diagram
   pnpm build
   ```
2. Open VS Code and launch the Extension Development Host via `F5` (or Run → Start Debugging) using the `accordo-diagram` launch configuration.
3. In the Extension Development Host window, open a workspace folder containing `.mmd` files.

### Test I-1 — Open a diagram in the Excalidraw panel

**Setup:** Have a file `arch.mmd` in your workspace with content:
```
flowchart TD
  api["API Gateway"]
  auth["Auth Service"]
  db[(Database)]
  api --> auth
  auth --> db
```

**Steps:**
1. Right-click `arch.mmd` in the Explorer panel.
2. Select **Accordo: Open Diagram**.

**What you should see in VS Code:**
- A new webview panel opens beside the editor with title `arch`.
- The panel shows the Excalidraw canvas with 3 nodes (`api`, `auth`, `db`) and 2 arrows.
- `arch.layout.json` is created next to `arch.mmd` with positions for all 3 nodes.

### Test I-2 — Auto-refresh on save

**Setup:** `arch.mmd` is open in the Excalidraw panel (from I-1).

**Steps:**
1. Open `arch.mmd` in the VS Code text editor.
2. Add a new node after `db`:
   ```
   cache[(Redis)]
   db --> cache
   ```
3. Save the file (Cmd+S / Ctrl+S).

**What you should see in VS Code:**
- Within ~500ms of saving, the Excalidraw panel refreshes.
- The canvas now shows 4 nodes: `api`, `auth`, `db`, `cache`.
- The new `cache` node appears auto-placed near `db`.
- Existing node positions for `api`, `auth`, `db` are preserved.

### Test I-3 — Error overlay on invalid Mermaid

**Setup:** `arch.mmd` is open in the Excalidraw panel.

**Steps:**
1. Open `arch.mmd` in the text editor.
2. Break the syntax by adding an incomplete edge: `api -->|JW` (no closing `|`).
3. Save.

**What you should see in VS Code:**
- The Excalidraw panel shows a persistent error overlay covering the canvas.
- The overlay text includes the parse error message (typically a line number).
- The canvas still shows the last valid scene underneath (not blank).

**Recovery:**
1. Fix the syntax (remove the broken line) and save.
2. The error overlay disappears and the canvas refreshes to the current valid state.

### Test I-4 — Agent moves a node via MCP tool

**Setup:** Hub and Bridge are running. `arch.mmd` is open in the panel.

**Steps:**
1. Read the initial position of node `api` from `arch.layout.json`.
2. Run the MCP tool call (replace `<SESSION>` and path as appropriate):
   ```bash
   curl -s -X POST http://localhost:3000/messages?sessionId=<SESSION> \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/call",
       "params": {
         "name": "accordo_diagram_move_node",
         "arguments": {
           "path": "arch.mmd",
           "node_id": "api",
           "x": 400,
           "y": 400
         }
       }
     }'
   ```

**What you should see in VS Code:**
- The `api` node moves to the new position on the canvas within ~100ms.
- `arch.layout.json` is updated with `"x": 400, "y": 400` for `api`.

**What you should see in the response:**
```json
{"result":{"content":[{"type":"text","text":"{\"moved\":true,\"node_id\":\"api\",\"position\":{\"x\":400,\"y\":400}}"}]}}
```

### Test I-5 — Export as SVG

**Setup:** `arch.mmd` is open in the panel.

**Steps:**
1. Run:
   ```bash
   curl -s -X POST http://localhost:3000/messages?sessionId=<SESSION> \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{
       "jsonrpc": "2.0",
       "id": 2,
       "method": "tools/call",
       "params": {
         "name": "accordo_diagram_render",
         "arguments": {
           "path": "arch.mmd",
           "format": "svg"
         }
       }
     }'
   ```

**What you should see in VS Code:**
- A file `arch.svg` is created in the same directory as `arch.mmd`.
- The SVG file contains all nodes and edges from the diagram, with the current layout positions.

**What you should see in the response:**
```json
{"result":{"content":[{"type":"text","text":"{\"rendered\":true,\"output_path\":\"arch.svg\",\"format\":\"svg\"}"}]}}
```

### Test I-6 — Canvas drag updates layout.json

**Setup:** `arch.mmd` is open in the panel.

**Steps:**
1. In the Excalidraw canvas, click and drag the `auth` node to a new position (e.g., top-right of the canvas).
2. Release the drag.

**What you should see in VS Code:**
- `arch.layout.json` is updated with the new `x`/`y` values for the `auth` node within ~200ms.
- No other nodes are affected (their positions in `layout.json` are unchanged).

### Test I-7 — Export with webview closed (expected error)

**Setup:** Close the Excalidraw panel for `arch.mmd`.

**Steps:**
1. Run the render tool (same curl as I-5 but with the panel closed).

**What you should see in the response:**
```json
{"result":{"content":[{"type":"text","text":"{\"error\":\"Canvas export requires the diagram to be open in the webview. Use accordo_diagram_open to open it first.\"}"}]}}
```

---

## Part 4 — Final Check

After completing all integration tests above, run these three checks to confirm the
system is in a clean state:

### Step 1 — Confirm build is still clean

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm build
```

Expected: exits `0`.

### Step 2 — Confirm tests still pass

```bash
cd /Users/Shared/dev/accordo/packages/diagram
pnpm exec vitest run
```

Expected:
```
 Test Files  16 passed (16)
      Tests  414 passed (414)
```

### Step 3 — Check VS Code Problems panel

In the Extension Development Host window:
- Open **View → Problems** (Cmd+Shift+M / Ctrl+Shift+M).
- Confirm **0 errors, 0 warnings** in files under `packages/diagram/src/`.
