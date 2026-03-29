# Testing Guide — Accordo Diagram (diag.1 end-to-end)

**Date:** 2026-03-13  
**Package:** `packages/diagram/` (`accordo-diagram`)  
**Automated tests:** 424/424 passing  
**Scope:** Full system verification — extension activation, webview panel, all 6 MCP tools, file-watcher refresh, node-drag persistence, export, and error recovery.

---

## 0. Overview

The diagram modality provides:

| Feature | How you trigger it | What happens |
|---|---|---|
| Open a diagram panel | Command Palette: **Accordo: Open Diagram** | Excalidraw canvas opens in a new tab |
| Canvas refreshes when you edit text | Save a `.mmd` file in the VS Code text editor | Canvas redraws with a toast |
| Node-drag saves automatically | Drag any node in the canvas | `.layout.json` updated on disk |
| MCP: list all diagrams | Agent calls `accordo_diagram_list` | Returns path + type + node count |
| MCP: read a diagram | Agent calls `accordo_diagram_get` | Returns parsed graph + layout |
| MCP: create a diagram | Agent calls `accordo_diagram_create` | Writes `.mmd` + `.layout.json`; refreshes open panel |
| MCP: patch a diagram | Agent calls `accordo_diagram_patch` | Reconciles layout; canvas redraws |
| MCP: render to SVG/PNG | Agent calls `accordo_diagram_render` | Writes export to disk (requires open panel) |
| MCP: style guide | Agent calls `accordo_diagram_style_guide` | Returns palette + template + conventions |

> **Key constraint:** `accordo_diagram_render` requires the target diagram's panel to be open in VS Code. It delegates the actual Excalidraw export to the live canvas. All other tools are purely file-based and work without a panel.

---

## 1. Automated Tests Gate

Run this first. Do not proceed to manual testing if any tests fail.

```bash
cd /Users/Shared/dev/accordo
pnpm --filter accordo-diagram test
```

Expected output:

```
Tests  424 passed (424)
```

---

## 2. Build and Launch

### 2.1 Add diagram to launch config

> **Note:** `accordo-diagram` is not yet wired into `.vscode/launch.json`. For this test session you need to add it manually.

Open [.vscode/launch.json](.vscode/launch.json) and add this line to the `args` array, after the `voice` entry:

```json
"--extensionDevelopmentPath=${workspaceFolder}/packages/diagram",
```

Also add to `outFiles`:

```json
"${workspaceFolder}/packages/diagram/dist/**/*.js",
```

### 2.2 Build

```bash
pnpm build
```

Confirm the `packages/diagram/dist/` folder exists and contains:

- `dist/extension.js` — host entry point
- `dist/webview/webview.bundle.js` — Excalidraw webview bundle (~2.5 MB)

### 2.3 Create a test diagram file

In the workspace root, create a file `test-diagrams/arch.mmd`:

```
flowchart TD
  A[Client] --> B{API Gateway}
  B -- auth --> C[Auth Service]
  B -- data --> D[Data Service]
  C --> E[(User DB)]
  D --> F[(Data DB)]
```

### 2.4 Launch Extension Development Host

Press **F5** (or **Run → Start Debugging**) with the configuration **"Launch Bridge + Editor + Voice (Extension Development Host)"**.

Wait for the EDH window to fully load (~3–5 seconds).

---

## 3. Extension Activation

### 3.1 Bridge present — nominal path

| # | Action | Expected |
|---|--------|----------|
| 3.1 | Open **View → Output** in the EDH | Output channel drop-down exists |
| 3.2 | Select **"Accordo Diagram"** channel | Channel exists |
| 3.3 | Confirm no warning lines in the channel output | No "accordo-bridge not installed" message |
| 3.4 | Open any terminal; run the command below | Response JSON contains `accordo_diagram_list`, `accordo_diagram_get`, `accordo_diagram_create`, `accordo_diagram_patch`, `accordo_diagram_render`, `accordo_diagram_style_guide` |

```bash
TOKEN=$(cat ~/.accordo/token) && curl -s -X POST http://localhost:$(cat ~/.accordo/hub.port)/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

> **Note:** The hub uses dynamic port selection — it tries 3000 first but falls back to an incremental port if 3000 is occupied. The actual port is always written to `~/.accordo/hub.port`. There is no `/tools` HTTP endpoint; use the MCP `tools/list` method via `/mcp` instead.

### 3.2 Bridge absent — fallback path (optional destructive test)

> Skip this if you do not want to launch a second EDH session.

1. Launch an **independent** EDH instance **without** `--extensionDevelopmentPath` for bridge.
2. Open **View → Output → Accordo Diagram**.
3. **Expected:** Log line contains `"accordo-bridge not installed or not active"`.
4. Run the `tools/list` MCP call above — the 6 diagram tool names are **absent**.

---

## 4. Opening a Diagram Panel

### 4.1 Via Command Palette with explicit file

| # | Action | Expected |
|---|--------|----------|
| 4.1 | In EDH: **Ctrl+Shift+P → "Accordo: Open Diagram"** | File picker opens (filters for `.mmd` files) |
| 4.2 | Select `test-diagrams/arch.mmd` | A new webview tab opens, titled `arch.mmd` |
| 4.3 | Confirm the Excalidraw canvas renders inside the tab | 6 nodes visible: Client, API Gateway, Auth Service, Data Service, User DB, Data DB |
| 4.4 | Confirm edges between nodes are drawn | 5 arrows connecting the nodes |
| 4.5 | Confirm the panel is NOT blank / white / showing an error overlay | No error overlay visible |

### 4.2 Via active `.mmd` editor

| # | Action | Expected |
|---|--------|----------|
| 4.6 | In EDH: open `test-diagrams/arch.mmd` as a text file (**Ctrl+P → arch.mmd**) | The file opens in a normal text editor tab |
| 4.7 | Run **Accordo: Open Diagram** (Command Palette) with no argument | Opens the panel for the already-active `.mmd` editor — no file picker shown |
| 4.8 | Run **Accordo: Open Diagram** a second time with the panel already open | No new panel appears — command is idempotent |

---

## 5. File-Watcher Auto-Refresh

The panel watches its `.mmd` file on disk. When you save a text edit, the canvas redraws.

### 5.1 Add a node

| # | Action | Expected |
|---|--------|----------|
| 5.1 | In EDH: open `arch.mmd` as text; leave the diagram panel open side-by-side | Both tabs visible |
| 5.2 | Add a new line at the end: `D --> G[Cache]` and save (**⌘S**) | Within 1 second: canvas refreshes; a new node "Cache" appears |
| 5.3 | Confirm a toast notification appears briefly in the canvas | Toast text contains "Updated" or a similar acknowledgement |
| 5.4 | Confirm the previously placed nodes have NOT moved (layout preserved) | Existing 6 nodes remain at their original positions |

### 5.2 Rename a node label

| # | Action | Expected |
|---|--------|----------|
| 5.5 | Change `A[Client]` to `A[Browser]` and save | Canvas redraws; "Browser" node is visible instead of "Client" |
| 5.6 | Node position is preserved for `A` | Browswer node is at the same position as the old Client node |

### 5.3 Introduce a syntax error

| # | Action | Expected |
|---|--------|----------|
| 5.7 | Add a malformed line: `BROKEN ~~~` and save | Canvas does NOT change. A red error overlay appears with a parse error message |
| 5.8 | Fix the syntax (delete the broken line) and save | Error overlay clears; canvas shows the valid diagram |

---

## 6. Node Drag Persistence

Dragging a node in the Excalidraw canvas saves the new position to `.layout.json` on disk. The Mermaid source is **not** modified.

| # | Action | Expected |
|---|--------|----------|
| 6.1 | In the panel, drag the "Auth Service" node to a different position | Node moves immediately in canvas |
| 6.2 | In VS Code Explorer, open `test-diagrams/arch.layout.json` | File exists (created alongside `arch.mmd`) |
| 6.3 | Verify `arch.layout.json` contains updated `x`/`y` for the `C` node | `"C": { "x": <new-x>, "y": <new-y>, ... }` |
| 6.4 | In the text editor, make a trivial change to `arch.mmd` (add/remove a space) and save | Canvas refreshes but the dragged node stays at the new position (layout preserved) |
| 6.5 | Confirm `arch.mmd` still contains original Mermaid text | No `@rename` annotations or other injected text |

---

## 7. MCP Tool Tests (Agent-Callable)

Run these by calling the tools directly via MCP (Copilot chat, Claude, or `curl`). If you have Copilot with the Accordo MCP server, you can paste the tool call directly into chat.

Alternatively, use the Hub's REST API:

```bash
BASE=http://localhost:$(cat ~/.accordo/hub.port)
TOKEN=$(cat ~/.accordo/token)
```

For each tool call below, the `curl` form is shown. You can also use Copilot chat to invoke the tool by name.

---

### 7.1 `accordo_diagram_list`

**What it does:** Scans the workspace for all `.mmd` files and returns each one's relative path, diagram type, and node count.

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"accordo_diagram_list","arguments":{}}' | jq .
```

**Expected result:**
- `ok: true`
- `data` array containing at minimum one entry for `test-diagrams/arch.mmd`
- Entry has `type: "flowchart"` and `nodeCount: 7` (after adding the Cache node in §5.1)

**Failure scenario to verify:**  
If the workspace has no `.mmd` files: response is `ok: true` with an empty `data` array.

---

### 7.2 `accordo_diagram_get`

**What it does:** Parses a `.mmd` file and returns its full semantic graph (nodes, edges, clusters) plus the contents of its `.layout.json`.

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"accordo_diagram_get","arguments":{"path":"test-diagrams/arch.mmd"}}' | jq .
```

**Expected result:**
- `ok: true`
- `data.source` — the full raw Mermaid text
- `data.type` — `"flowchart"`
- `data.nodes` — array of 7 node objects (A–G), each with `id`, `label`, `shape`
- `data.edges` — array of edge objects
- `data.layout` — non-null object with `version: "1.0"` and node positions

**Failure case — file not found:**

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"accordo_diagram_get","arguments":{"path":"test-diagrams/missing.mmd"}}' | jq .
```

Expected: `ok: false`, `errorCode: "FILE_NOT_FOUND"`.

**Failure case — path traversal:**

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"accordo_diagram_get","arguments":{"path":"../../etc/passwd"}}' | jq .
```

Expected: `ok: false`, `errorCode: "TRAVERSAL_DENIED"`.

---

### 7.3 `accordo_diagram_create`

**What it does:** Creates a new `.mmd` file and computes its initial layout. Fails if the file already exists (unless `force: true`).

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "accordo_diagram_create",
    "arguments": {
      "path": "test-diagrams/pipeline.mmd",
      "content": "flowchart LR\n  Src[Source] --> Parse --> Validate --> Emit[Output]"
    }
  }' | jq .
```

**Expected result:**
- `ok: true`
- `data.created: true`
- `data.path: "test-diagrams/pipeline.mmd"`
- `data.layoutPath: "test-diagrams/pipeline.layout.json"`
- `data.type: "flowchart"`
- `data.nodeCount: 4`
- Both files exist on disk in Explorer

**Already-exists guard:**

Run the same command again without `force`:

Expected: `ok: false`, `errorCode: "ALREADY_EXISTS"`.

Run with `"force": true`:

Expected: `ok: true`, `data.created: true` — file is overwritten.

**Invalid Mermaid guard:**

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "accordo_diagram_create",
    "arguments": {
      "path": "test-diagrams/bad.mmd",
      "content": "GARBAGE ~~~ NOT VALID"
    }
  }' | jq .
```

Expected: `ok: false`, `errorCode: "PARSE_ERROR"`. Disk is not touched — `bad.mmd` is NOT created.

---

### 7.4 `accordo_diagram_patch`

**What it does:** Rewrites a `.mmd` file to new content and reconciles its layout (preserving positions for unchanged nodes; placing new nodes automatically).

First, open `test-diagrams/pipeline.mmd` as a diagram panel (§4) and leave it open. Then:

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "accordo_diagram_patch",
    "arguments": {
      "path": "test-diagrams/pipeline.mmd",
      "content": "flowchart LR\n  Src[Source] --> Parse --> Validate --> Transform --> Emit[Output]"
    }
  }' | jq .
```

**Expected result:**
- `ok: true`
- `data.patched: true`
- `data.changes` — array listing added node `Transform`
- Canvas panel for `pipeline.mmd` **automatically refreshes** — "Transform" node appears

**Layout preservation check:**
- Previously dragged nodes (Src, Parse, etc.) remain at their positions
- Only `Transform` is auto-placed in available space

**Invalid Mermaid guard:**

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "accordo_diagram_patch",
    "arguments": {
      "path": "test-diagrams/pipeline.mmd",
      "content": "GARBAGE"
    }
  }' | jq .
```

Expected: `ok: false`, `errorCode: "PARSE_ERROR"`. File is **not** modified on disk.

---

### 7.5 `accordo_diagram_render`

**What it does:** Exports the currently open diagram panel to SVG or PNG and writes the file to disk.

> **Precondition:** The panel for `test-diagrams/arch.mmd` must be open and visible (see §4).

#### SVG export

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "accordo_diagram_render",
    "arguments": {
      "path": "test-diagrams/arch.mmd",
      "format": "svg"
    }
  }' | jq .
```

**Expected result:**
- `ok: true`
- `data.rendered: true`
- `data.format: "svg"`
- `data.output_path: "test-diagrams/arch.svg"`
- `data.bytes` — positive integer (typically 10,000–100,000)
- File `test-diagrams/arch.svg` exists on disk and opens correctly in a browser

#### PNG export with custom output path

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "accordo_diagram_render",
    "arguments": {
      "path": "test-diagrams/arch.mmd",
      "format": "png",
      "output_path": "test-diagrams/exports/arch-export.png"
    }
  }' | jq .
```

Expected: `ok: true`, `data.output_path: "test-diagrams/exports/arch-export.png"`.

#### No panel open

Close the `arch.mmd` diagram panel first, then run the SVG export again.

Expected: `ok: false`, `errorCode: "PANEL_NOT_OPEN"`.

> **Known limitation (non-blocking follow-up):** With multiple panels open, `renderHandler` queries `getPanel()` which returns the most recently opened panel. If that is a different diagram than the one requested, you'll get `errorCode: "PANEL_MISMATCH"`. The fix (evolving `getPanel(path)` to path-keyed lookup) is scheduled for a follow-up commit.

---

### 7.6 `accordo_diagram_style_guide`

**What it does:** Returns the Accordo diagram colour palette, a starter Mermaid template, and diagram conventions. Pure lookup — no I/O.

```bash
curl -s -X POST $BASE/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"accordo_diagram_style_guide","arguments":{}}' | jq .
```

**Expected result:**
- `ok: true`
- `data.palette` — object with keys `primary`, `secondary`, `success`, `warning`, `danger`, `neutral`, `background`, `border`; values are hex colour strings
- `data.starterTemplate` — multi-line string beginning with `"flowchart TD"`
- `data.conventions` — array of 6 strings (PascalCase IDs, preferred direction, `@rename` annotation usage, etc.)

---

## 8. Full End-to-End Scenario: Agent Builds a Diagram, Human Reviews

This scenario exercises the entire diag.1 data flow in one cohesive sequence.

### Step 1 — Agent creates

Ask Copilot (or send via MCP directly):

> "Create a Mermaid flowchart at `test-diagrams/system.mmd` showing three microservices: Frontend, Backend, and Database, where Frontend talks to Backend and Backend talks to Database."

The agent should call `accordo_diagram_create` with something like:

```
flowchart TD
  Frontend --> Backend
  Backend --> Database
```

**Verify:**
- `ok: true` response
- `test-diagrams/system.mmd` and `test-diagrams/system.layout.json` exist on disk

### Step 2 — Human opens the panel

Run **Accordo: Open Diagram**, select `system.mmd`. Confirm:
- 3 nodes visible: Frontend, Backend, Database
- 2 directed arrows connecting them

### Step 3 — Human drags a node

Drag **Backend** to a custom position. Verify `system.layout.json` updates on disk.

### Step 4 — Agent patches

Ask Copilot:

> "Add a Redis cache between Frontend and Backend in `test-diagrams/system.mmd`."

Agent calls `accordo_diagram_patch` with:

```
flowchart TD
  Frontend --> Cache[Redis Cache]
  Cache --> Backend
  Backend --> Database
```

**Verify:**
- `ok: true` response; `changes` includes the new `Cache` node
- Panel refreshes automatically — "Redis Cache" node appears in the canvas
- **Backend** node remains at the position you dragged it to (reconciler preserved layout)

### Step 5 — Agent renders

Ask Copilot:

> "Export `test-diagrams/system.mmd` to SVG."

Agent calls `accordo_diagram_render` with `format: "svg"`. **Verify:**
- `ok: true`; `test-diagrams/system.svg` exists on disk
- Open the SVG in a browser — all 4 nodes and edges are visible

### Step 6 — Agent queries the style guide

Ask Copilot:

> "What colour palette should I use for Accordo diagrams?"

Agent calls `accordo_diagram_style_guide`. **Verify:**
- Agent quotes the `primary: "#4A90D9"` colour and the PascalCase node ID convention

---

## 9. Error Recovery and Edge Cases

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 9.1 | Panel disposed mid-export | Trigger a render; immediately close the panel tab | `requestExport` rejects with `PanelDisposedError`; tool returns `ok: false` or throws. Canvas is gone; no crash. |
| 9.2 | `arch.mmd` deleted on disk while panel is open | Delete the file from file explorer | Panel does not crash. On next save-triggered refresh, a graceful error is logged or shown as an overlay. |
| 9.3 | Workspace has no `.mmd` files | Run `accordo_diagram_list` in an empty workspace | `ok: true`, `data: []` |
| 9.4 | Create two panels for two different `.mmd` files | Open `arch.mmd` panel; then open `pipeline.mmd` panel | Both panels coexist without interfering |
| 9.5 | Re-open a panel for the same file | With `arch.mmd` panel open, run the open command again for `arch.mmd` | No duplicate panel — existing panel receives focus |
| 9.6 | Extension deactivates cleanly | Close the EDH window | No error messages in the Development Host console; output channel closed cleanly |

---

## 10. Output Channel Log Reference

Open **View → Output → Accordo Diagram** during any session. The following log lines confirm correct operation:

| Log line | When it appears | Meaning |
|---|---|---|
| *(no log on successful activation)* | Bridge present and tools registered | Normal path — the channel is created but not noisy |
| `accordo-bridge not installed or not active — accordo-diagram tools will not be registered.` | Bridge extension absent or not yet activated | Extension is inert; no crash |
| *(any vscode error in the JS console)* | Panel crash | Check `Help → Toggle Developer Tools` in the EDH window for the webview iframe errors |

To enable verbose webview logging during debugging, open the EDH's **Developer Tools** (Help → Toggle Developer Tools) and check the Console tab — the webview posts detailed messages from `webview.ts`.

---

## 11. Known Issues and Non-Blocking Limitations

| # | Issue | Impact | Planned fix |
|---|---|---|---|
| 11.1 | `getPanel()` returns most-recently-opened panel (zero-arg) | `accordo_diagram_render` returns `PANEL_MISMATCH` if the active panel is not the most recently opened one | Next commit: evolve to `getPanel(path: string)` |
| 11.2 | `accordo-diagram` not yet in `.vscode/launch.json` | Must be added manually before first F5 test | Wire into launch config as part of next commit or a dedicated config PR |
| 11.3 | File watcher for disk changes by external tools (e.g. `git checkout`) triggers refresh without user action | Generally desirable; can cause flicker on large bulk changes | Debounce already in place (500 ms); no fix needed |

---

## 12. Summary Checklist

Use this as a sign-off checklist before marking diag.1 complete:

- [ ] `pnpm --filter accordo-diagram test` → 424/424 ✅
- [ ] Extension activates; **Accordo Diagram** output channel appears
- [ ] 6 diagram tools visible in hub tool list
- [ ] `accordo_diagram_list` returns correct entries
- [ ] `accordo_diagram_get` returns parsed graph + layout
- [ ] `accordo_diagram_create` writes `.mmd` + `.layout.json`
- [ ] `accordo_diagram_patch` reconciles layout; panel refreshes
- [ ] `accordo_diagram_render` exports SVG + PNG (panel must be open)
- [ ] `accordo_diagram_style_guide` returns palette + template + conventions
- [ ] **Accordo: Open Diagram** command opens Excalidraw panel
- [ ] File-save triggers canvas refresh with toast
- [ ] Syntax error shows error overlay; fix clears it
- [ ] Node drag persists to `.layout.json`
- [ ] Panel is idempotent (re-open same file reuses existing panel)
- [ ] Both panels coexist when two different files are open
- [ ] Bridge absent → warning in output channel; no crash
- [ ] EDH closes without errors or warnings in console
