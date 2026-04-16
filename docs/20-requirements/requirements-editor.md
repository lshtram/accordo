# accordo-editor — Requirements Specification

**Package:** `accordo-editor`  
**Type:** VSCode extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-03-02

---

## 1. Purpose

Exposes VSCode's built-in editor, terminal, and workspace capabilities as MCP tools. This is the foundational modality — the agent's ability to see, navigate, and manipulate the workspace.

---

## 2. Extension Manifest Contract

```json
{
  "name": "accordo-editor",
  "displayName": "Accordo IDE Editor Tools",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "extensionDependencies": ["accordo.accordo-bridge"]
}
```

---

## 3. Activation Contract

```typescript
export async function activate(context: vscode.ExtensionContext) {
  const bridge = vscode.extensions.getExtension<BridgeAPI>('accordo.accordo-bridge')?.exports;
  if (!bridge) {
    // Bridge not installed — extension is inert. No error thrown.
    return;
  }

  const disposable = bridge.registerTools('accordo-editor', editorTools);
  context.subscriptions.push(disposable);
}
```

- If Bridge is not installed, the extension silently does nothing.
- If Bridge is installed but not yet activated, VSCode handles the activation order via `extensionDependencies`.
- The extension has no `contributes.commands`  — all functionality is via MCP tools.

---

## 4. Tool Specifications

Each tool below is defined with its full interface contract: input schema, response schema, error conditions, and implementation notes.

---

### 4.1 `accordo.editor.open`

**Purpose:** Open a file in the editor, optionally scrolling to a specific line/column.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path, relative to workspace root or absolute"
    },
    line: {
      type: "number",
      description: "Line number to scroll to (1-based). Default: 1"
    },
    column: {
      type: "number",
      description: "Column number to place cursor (1-based). Default: 1"
    }
  },
  required: ["path"]
}
```

**Response:**

```typescript
{ opened: true, path: string }  // absolute path of opened file
```

**Errors:**

| Condition | Error message |
|---|---|
| File not found | `"File not found: <resolved path>"` |
| Path resolves outside workspace | `"Path is outside workspace: <path>"` |

**Implementation:**
- Resolve path via `resolvePath(path)` utility
- `vscode.window.showTextDocument(uri, { selection: new Range(line-1, col-1, line-1, col-1) })`

---

### 4.2 `accordo.editor.close`

**Purpose:** Close a specific editor tab, or the active editor if no path given.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path to close. If omitted, closes the active editor."
    }
  },
  required: []
}
```

**Response:**

```typescript
{ closed: true }
```

**Errors:**

| Condition | Error message |
|---|---|
| Non-.mmd file not open | `"File is not open: <path>"` |
| .mmd file not open | Falls back to closing the active editor — returns `{ closed: true }` |
| No path and no active editor | Returns `{ closed: true }` (always succeeds) |

**Implementation:**
- No path: `vscode.commands.executeCommand('workbench.action.closeActiveEditor')` — always succeeds
- Path provided:
  1. Search tabs by URI fsPath
  2. Fall back to label match (stripped path + `.mmd` suffix) — handles diagram webview panels
  3. If tab still not found:
     - `.mmd` files → `workbench.action.closeActiveEditor` (diagram webviews don't expose URI/label reliably)
     - All other files → return error

---

### 4.3 `accordo.editor.scroll`

**Purpose:** Scroll the active editor viewport.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | no |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    direction: {
      type: "string",
      enum: ["up", "down"],
      description: "Scroll direction"
    },
    by: {
      type: "string",
      enum: ["line", "page"],
      description: "Scroll unit. Default: page"
    }
  },
  required: ["direction"]
}
```

**Response:**

```typescript
{ line: number }  // new visible start line after scroll
```

**Errors:**

| Condition | Error message |
|---|---|
| No active editor | `"No active editor"` |

**Implementation:**
- `vscode.commands.executeCommand('editorScroll', { to: direction, by: by, value: 1 })`
- Read new `visibleRanges[0].start.line` for response

---

### 4.4 `accordo.editor.highlight`

**Purpose:** Apply a colored highlight decoration to a range of lines.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path containing the lines to highlight"
    },
    startLine: {
      type: "number",
      description: "First line to highlight (1-based, inclusive)"
    },
    endLine: {
      type: "number",
      description: "Last line to highlight (1-based, inclusive)"
    },
    color: {
      type: "string",
      description: "Highlight background color. Default: 'rgba(255,255,0,0.3)'"
    }
  },
  required: ["path", "startLine", "endLine"]
}
```

**Response:**

```typescript
{ highlighted: true, decorationId: string }
```

**Errors:**

| Condition | Error message |
|---|---|
| File not open | `"File is not open: <path>. Open it first."` |
| startLine > endLine | `"startLine must be <= endLine"` |
| Line out of range | `"Line <n> is out of range (file has <total> lines)"` |

**Implementation:**
- `vscode.window.createTextEditorDecorationType({ backgroundColor: color })`
- Store decoration type keyed by a generated `decorationId`
- Apply via `editor.setDecorations(type, [range])`

---

### 4.5 `accordo.editor.clearHighlights`

**Purpose:** Remove all highlights created by `accordo.editor.highlight`.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {},
  required: []
}
```

**Response:**

```typescript
{ cleared: true, count: number }  // number of decorations removed
```

**Input Schema (with optional decorationId):**

```typescript
{
  type: "object",
  properties: {
    decorationId: {
      type: "string",
      description: "If provided, clear only this specific decoration. If omitted, clear all decorations."
    }
  },
  required: []
}
```

**Errors:**

| Condition | Error message |
|---|---|
| `decorationId` provided but not found | `"Decoration not found: <id>"` |

**Implementation:**
- If `decorationId` provided: look up by ID, call `.dispose()`, remove from store.
- If no `decorationId`: iterate all stored decoration types, call `.dispose()` on each, clear store.

---

### 4.6 `accordo.editor.split`

**Purpose:** Split the editor pane in a given direction.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | no |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    direction: {
      type: "string",
      enum: ["right", "down"],
      description: "Direction to split"
    }
  },
  required: ["direction"]
}
```

**Response:**

```typescript
{ groups: number }  // total number of editor groups after split
```

**Implementation:**
- `right`: `vscode.commands.executeCommand('workbench.action.splitEditorRight')`
- `down`: `vscode.commands.executeCommand('workbench.action.splitEditorDown')`
- Read `vscode.window.tabGroups.all.length` for response

---

### 4.7 `accordo.editor.focus`

**Purpose:** Focus a specific editor group by number.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    group: {
      type: "number",
      description: "Editor group number (1-based, left-to-right/top-to-bottom)"
    }
  },
  required: ["group"]
}
```

**Response:**

```typescript
{ focused: true, group: number }
```

**Errors:**

| Condition | Error message |
|---|---|
| Group does not exist | `"Editor group <n> does not exist (max: <total>)"` |

**Implementation:**
- Map group number to VSCode command: `workbench.action.focusFirstEditorGroup` through `focusNinthEditorGroup`

---

### 4.8 `accordo.editor.reveal`

**Purpose:** Reveal a file in the Explorer sidebar without opening it in the editor.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path to reveal in Explorer"
    }
  },
  required: ["path"]
}
```

**Response:**

```typescript
{ revealed: true, path: string }
```

**Errors:**

| Condition | Error message |
|---|---|
| File not found | `"File not found: <resolved path>"` |

**Implementation:**
- `vscode.commands.executeCommand('revealInExplorer', uri)`

---

### 4.9 `accordo.terminal.open`

**Purpose:** Create and show a new terminal instance.

| Property | Value |
|---|---|
| Danger level | moderate |
| Idempotent | no |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Terminal display name. Default: 'Accordo'"
    },
    cwd: {
      type: "string",
      description: "Working directory. Default: workspace root"
    }
  },
  required: []
}
```

**Response:**

```typescript
{ terminalId: string, name: string }  // accordo-assigned stable ID (not OS process ID)
```

**Implementation:**
- Generate a sequential stable ID: `"accordo-terminal-<n>"` (e.g. `"accordo-terminal-1"`).
- `vscode.window.createTerminal({ name, cwd: resolvedCwd })`
- `terminal.show()`
- Store `accordoTerminalId → vscode.Terminal` in the terminal map (see §5.3).
- Return the stable `terminalId`. Do **not** use `terminal.processId` — it is a `Thenable<number | undefined>` that may resolve to `undefined` before the shell starts.

---

### 4.10 `accordo.terminal.run`

**Purpose:** Execute a shell command in a terminal.

| Property | Value |
|---|---|
| Danger level | **destructive** |
| Idempotent | no |
| Requires confirmation | **yes** |
| Timeout class | interactive (30s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "Shell command to execute"
    },
    terminalId: {
      type: "string",
      description: "Terminal to use (stable ID from terminal.open). If omitted, uses active terminal or creates one."
    }
  },
  required: ["command"]
}
```

**Response:**

```typescript
{ sent: true, terminalId: string }
```

**Errors:**

| Condition | Error message |
|---|---|
| terminalId not found | `"Terminal <id> not found"` |
| No terminals exist and no terminalId | Creates a new terminal, then runs the command |

**Implementation:**
- Find terminal by `accordoTerminalId` in the terminal map (see §5.3)
- `terminal.sendText(command, true)` — the `true` appends newline
- `terminal.show()`
- Note: This tool sends the command but does NOT wait for output. The agent observes results through other means (file changes, etc.) or through future terminal output tools.

**Security note:** This is the most dangerous Phase 1 tool. Default confirmation behavior shows a `vscode.window.showWarningMessage` with the command text.

---

### 4.11 `accordo.terminal.focus`

**Purpose:** Focus the terminal panel (make it visible and active).

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {},
  required: []
}
```

**Response:**

```typescript
{ focused: true }
```

**Implementation:**
- `vscode.commands.executeCommand('workbench.action.terminal.focus')`

---

### 4.12 `accordo.workspace.getTree`

**Purpose:** Return the workspace file tree as a structured object.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | interactive (30s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    depth: {
      type: "number",
      description: "Max directory depth to traverse. Default: 3"
    },
    path: {
      type: "string",
      description: "Subdirectory to start from. Default: workspace root"
    }
  },
  required: []
}
```

**Response:**

```typescript
{
  tree: TreeNode[]
}

interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];   // only for directories
}
```

**Constraints:**
- Max total nodes: 1000. Truncate with a `{ name: "... (truncated)", type: "file" }` sentinel.
- Respects VSCode `files.exclude` settings and `.gitignore`.

**Implementation:**
- `vscode.workspace.fs.readDirectory()` recursively
- Filter through `vscode.workspace.getConfiguration('files').get('exclude')` patterns
- Read `.gitignore` via a lightweight parser or use glob patterns

---

### 4.13 `accordo.workspace.search`

**Purpose:** Full-text search across workspace files.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | interactive (30s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search text or regex pattern"
    },
    include: {
      type: "string",
      description: "Glob pattern for files to include. Default: '**/*'"
    },
    maxResults: {
      type: "number",
      description: "Maximum results to return. Default: 50"
    }
  },
  required: ["query"]
}
```

**Response:**

```typescript
{
  results: SearchMatch[]
}

interface SearchMatch {
  path: string;        // relative to workspace
  line: number;        // 1-based
  column: number;      // 1-based
  text: string;        // the matching line, trimmed to 200 chars max
}
```

**Implementation:**
- `vscode.workspace.findTextInFiles(new TextSearchQuery(query), { include, maxResults })`
- Collect results, format, return

---

### 4.14 `accordo.panel.toggle`

**Purpose:** Show or toggle visibility of a VSCode panel (sidebar views and bottom panel views).

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes (sidebar views); no (bottom panel views toggle) |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    panel: {
      type: "string",
      enum: [
        "explorer", "search", "git", "debug", "extensions",
        "terminal", "output", "problems", "debug-console"
      ],
      description: "Panel to toggle"
    }
  },
  required: ["panel"]
}
```

**Response:**

```typescript
{ panel: string, area: "sidebar" | "panel" }
// or
{ error: string }
```

**Implementation — command mapping:**

| Panel | VSCode Command | Area |
|---|---|---|
| explorer | `workbench.view.explorer` | sidebar |
| search | `workbench.view.search` | sidebar |
| git | `workbench.view.scm` | sidebar |
| debug | `workbench.view.debug` | sidebar |
| extensions | `workbench.view.extensions` | sidebar |
| terminal | `workbench.action.terminal.toggleTerminal` | panel |
| output | `workbench.action.output.toggleOutput` | panel |
| problems | `workbench.actions.view.problems` | panel |
| debug-console | `workbench.debug.action.toggleRepl` | panel |

**Behaviour notes:**
- Sidebar view commands (explorer, search, etc.) **show/focus** the view — idempotent.
- Bottom panel commands (terminal, output, debug-console) **toggle** visibility.
- `problems` uses a show/focus command — opens the Problems panel but does not toggle.
- The tool cannot detect current visibility state due to VS Code API limitations.

**Design document:** `docs/00-workplan/panel-toggle-architecture.md`

---

### 4.15 `accordo.layout.zen`

**Purpose:** Toggle Zen Mode (distraction-free fullscreen editing).

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | no |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {},
  required: []
}
```

**Response:**

```typescript
{ active: true }
```

**Implementation:**
- `vscode.commands.executeCommand('workbench.action.toggleZenMode')`

---

### 4.16 `accordo.layout.fullscreen`

**Purpose:** Toggle fullscreen mode.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | no |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {},
  required: []
}
```

**Response:**

```typescript
{ active: true }
```

**Implementation:**
- `vscode.commands.executeCommand('workbench.action.toggleFullScreen')`

---

### 4.23 `accordo.layout.joinGroups`

**Purpose:** Collapse all editor splits — merge all groups into one.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{ type: "object", properties: {}, required: [] }
```

**Response:**

```typescript
{ groups: number }  // always 1 after join
```

**Implementation:**
- `vscode.commands.executeCommand('workbench.action.joinAllGroups')`

---

### 4.24 `accordo.layout.evenGroups`

**Purpose:** Equalise the width and height of all editor groups so each pane takes the same space.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{ type: "object", properties: {}, required: [] }
```

**Response:**

```typescript
{ equalized: true }
```

**Implementation:**
- `vscode.commands.executeCommand('workbench.action.evenEditorWidths')`

---

### 4.25 `accordo.layout.state`

**Module ID:** M74-LS  
**Purpose:** Return the current live IDE layout state on demand — all open tabs (text files and webview panels), active file and cursor, editor groups, active terminal, and per-modality extension state. Solves the agent freshness gap: the `initialize`-time snapshot may be stale; this tool always returns current Bridge-local state.

**Architecture reference:** `docs/layout-state-architecture.md` §4

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{ type: "object", properties: {}, required: [] }
```

**Response (success):**

```typescript
{
  ok: true;
  state: IDEState;  // full current Bridge-local IDEState including openTabs
}
```

**Response (error):**

```typescript
{ ok: false; error: string }
```

**Requirements:**

| ID | Requirement |
|---|---|
| M74-LS-01 | `accordo_layout_state` is registered as an MCP tool via `BridgeAPI.registerTools()` on activation |
| M74-LS-02 | Returns `{ ok: true, state }` where `state` is the current `IDEState` snapshot from `BridgeAPI.getState()` |
| M74-LS-03 | `state.openTabs` is present and contains all open tabs (text + webview) as `OpenTab[]` |
| M74-LS-04 | `state.modalities` contains the latest per-extension published state |
| M74-LS-05 | Returns `{ ok: false, error }` if `getState()` throws |
| M74-LS-06 | Handler latency is < 5 ms (local in-memory read — no I/O, no network) |
| M74-LS-07 | Tool description instructs agents to call this at the start of any task involving panels, files, or visual layout |

**Implementation:**
- Add `getState(): IDEState` to the local `BridgeAPI` interface in `accordo-editor/src/extension.ts`
- Refactor `layoutTools` static array → `createLayoutTools(getState: () => IDEState)` factory in `packages/editor/src/tools/layout.ts`
- Add `layoutStateHandler` + tool definition inside the factory
- Update `extension.ts` to call `createLayoutTools(() => bridge.getState())`
- Add `accordo_layout_state` entry to `accordo_script_discover` catalog in `packages/script/src/tools/script-discover.ts` (⚠️ **Superseded** — script module removed 2026-04-16; the discover mechanism is no longer available)

---

### 4.27 `accordo.layout.panel`

**Module ID:** E-6  
**Purpose:** Control VS Code area containers (primary sidebar, bottom panel, auxiliary bar) with explicit open/close semantics and an optional view parameter. Replaces the original 6-tool design (sidebar.open/close, panel.open/close, auxiliaryBar.open/close) with a single combined tool.

**Architecture reference:** `docs/00-workplan/e-6-bar-tools.md`

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    area: {
      type: "string",
      enum: ["sidebar", "panel", "rightBar"],
      description: "Which VS Code area to control"
    },
    view: {
      type: "string",
      description: "Optional: specific view to open within the area. Only valid with action 'open'."
    },
    action: {
      type: "string",
      enum: ["open", "close"],
      description: "Action to perform: 'open' or 'close'. No toggle."
    }
  },
  required: ["area", "action"]
}
```

**Response (area-level):**

```typescript
{ area: string, action: "opened" | "closed", previousState: "unknown" | "open" | "closed", wasNoOp: boolean }
```

**Response (view-level open):**

```typescript
{ area: string, action: "opened", view: string, previousState: "unknown" | "open" | "closed", wasNoOp: false }
```

**Errors:**

| Condition | Error message |
|---|---|
| `area` missing or invalid | `"Argument 'area' must be one of: sidebar, panel, rightBar"` |
| `action` missing or invalid | `"Argument 'action' must be one of: open, close"` |
| `view` + `action: "close"` | `"Cannot close a specific view. Omit 'view' to close the area, or use action 'open' to switch to a view."` |
| Unknown `view` for the area | `"Unknown view '<view>' for area '<area>'. Known views: <list>"` |
| VS Code command fails | `"Command failed: <error message>"` |

**Requirements:**

| ID | Requirement |
|---|---|
| E-6-01 | `accordo_layout_panel` is registered as a single MCP tool via `BridgeAPI.registerTools()` |
| E-6-02 | Module-level `BarState` tracker with `{ sidebar, panel, rightBar }` each `"unknown" \| "open" \| "closed"` |
| E-6-03 | State starts as `"unknown"` for all areas; resets on extension reload |
| E-6-04 | `unknown → close` transitions through `focus*` then `close*` to ensure deterministic state |
| E-6-05 | `open → open` and `closed → close` are idempotent no-ops |
| E-6-06 | `view` parameter opens a specific view and implicitly opens the containing area |
| E-6-07 | `view` + `action: "close"` returns an error |
| E-6-08 | View-area mismatch (e.g., `area: "panel", view: "explorer"`) returns an error |
| E-6-09 | Unknown views attempt heuristic `workbench.view.<view>` command; graceful error on failure |
| E-6-10 | `rightBar` has no hardcoded views; area-level open/close only |

**Implementation:**

- File: `packages/editor/src/tools/bar.ts`
- Single handler function `layoutPanelHandler(args)` replaces 6 previous handler wrappers
- Exports `barTools: ExtensionToolDefinition[]` (array of 1 tool)
- Imported and spread by `createLayoutTools()` in `packages/editor/src/tools/layout.ts`
- State tracker and command maps are module-level constants

---

### 4.17 `accordo.editor.save`

**Purpose:** Save a specific file, or the active editor if no path given.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path to save. If omitted, saves the active editor."
    }
  },
  required: []
}
```

**Response:**

```typescript
{ saved: true, path: string }  // absolute path of the saved file
```

**Errors:**

| Condition | Error message |
|---|---|
| No active editor and no path given | `"No active editor to save"` |
| File not open | `"File is not open: <path>"` |

**Implementation:**
- If path given: find the matching `TextDocument` in `vscode.workspace.textDocuments`, call `document.save()`.
- If no path: `vscode.commands.executeCommand('workbench.action.files.save')`, then read `activeTextEditor.document.uri.fsPath` for the response path.

---

### 4.18 `accordo.editor.saveAll`

**Purpose:** Save all modified (unsaved) editors.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {},
  required: []
}
```

**Response:**

```typescript
{ saved: true, count: number }  // number of documents that were saved
```

**Implementation:**
- Count dirty documents: `vscode.workspace.textDocuments.filter(d => d.isDirty)`.
- `vscode.commands.executeCommand('workbench.action.files.saveAll')`.
- Return the pre-save dirty count.

---

### 4.19 `accordo.editor.format`

**Purpose:** Run the configured formatter on the active document (or a specific file's editor).

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path whose editor should be formatted. If omitted, formats the active editor."
    }
  },
  required: []
}
```

**Response:**

```typescript
{ formatted: true, path: string }
```

**Errors:**

| Condition | Error message |
|---|---|
| No active editor and no path given | `"No active editor to format"` |
| File not open in an editor | `"File is not open: <path>. Open it first."` |

**Implementation:**
- If path given: find matching `TextEditor` in `vscode.window.visibleTextEditors`.
- Focus it, then `vscode.commands.executeCommand('editor.action.formatDocument')`.
- Return absolute path from the editor's document URI.

---

### 4.20 `accordo.diagnostics.list`

**Purpose:** Return current diagnostics (errors, warnings, hints) from the Language Server across all files or a specific file.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Limit diagnostics to this file. If omitted, returns diagnostics for all open files."
    },
    severity: {
      type: "string",
      enum: ["error", "warning", "information", "hint"],
      description: "Filter by minimum severity. Default: all severities."
    }
  },
  required: []
}
```

**Response:**

```typescript
{
  diagnostics: DiagnosticItem[]
}

interface DiagnosticItem {
  path: string;       // absolute file path
  line: number;       // 1-based
  column: number;     // 1-based
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  source?: string;    // e.g. "ts", "eslint", "pylint"
  code?: string;      // diagnostic code if present
}
```

**Constraints:**
- Maximum 500 diagnostics returned. Truncate with a final sentinel item: `{ path: "", line: 0, column: 0, severity: "hint", message: "... (truncated, total: <n>)" }`.
- Severity enum mapping: `vscode.DiagnosticSeverity.Error → "error"`, `Warning → "warning"`, `Information → "information"`, `Hint → "hint"`.

**Implementation:**
- `vscode.languages.getDiagnostics()` → returns `[Uri, Diagnostic[]][]` for all files.
- If `path` given: `vscode.languages.getDiagnostics(uri)` for just that file.
- Map severity enum, offset line/column (VSCode is 0-based → return 1-based).
- Filter by severity if given.

---

### 4.21 `accordo.terminal.list`

**Purpose:** List all currently open terminal instances with their stable accordo IDs.

| Property | Value |
|---|---|
| Danger level | safe |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {},
  required: []
}
```

**Response:**

```typescript
{
  terminals: TerminalInfo[]
}

interface TerminalInfo {
  terminalId: string;   // stable accordo ID, or "(untracked)" for terminals not opened by accordo
  name: string;         // VSCode display name
  isActive: boolean;    // true if this is vscode.window.activeTerminal
}
```

**Implementation:**
- Iterate `vscode.window.terminals`.
- For each, look up the stable ID from the reverse-lookup of `terminalMap` (see §5.3). If not found (terminal was opened by the user, not accordo), use `"(untracked)"`.
- Mark `isActive` by comparing with `vscode.window.activeTerminal`.

---

### 4.22 `accordo.terminal.close`

**Purpose:** Close a specific terminal by its stable accordo ID.

| Property | Value |
|---|---|
| Danger level | moderate |
| Idempotent | yes |
| Requires confirmation | no |
| Timeout class | fast (5s) |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    terminalId: {
      type: "string",
      description: "Stable accordo terminal ID (from terminal.open or terminal.list)"
    }
  },
  required: ["terminalId"]
}
```

**Response:**

```typescript
{ closed: true, terminalId: string }
```

**Errors:**

| Condition | Error message |
|---|---|
| terminalId not found | `"Terminal <id> not found"` |

**Implementation:**
- Look up terminal by `accordoTerminalId` in the terminal map (see §5.3).
- `terminal.dispose()`.
- Remove from `terminalMap`. (The `onDidCloseTerminal` event will also fire and clean up; either path is safe.)

---

## 5. Shared Utilities

### 5.1 `resolvePath(input: string, context?: { workspaceFolders: string[] }): string`

Multi-root aware. Workspace folders come from `vscode.workspace.workspaceFolders`.

```
1. If input is absolute:
   a. Normalize separators to forward slashes
   b. Verify it falls within at least one workspace folder
      (throw "Path is outside workspace: <path>" if not, unless allowExternal flag set)
   c. Return normalized absolute path

2. If input is relative:
   a. Collect all workspace folder root paths
   b. Attempt to resolve against each root in order
   c. If exactly one root produces an existing (or creatable) path → return it
   d. If multiple roots could match → throw "Ambiguous relative path '<input>': matches
      <folderA> and <folderB>. Use an absolute path."
   e. If no root matches but single-root workspace → resolve against that root
   f. Normalize separators to forward slashes

3. No symlink resolution (use paths as-is)
```

Tools that return paths always return absolute paths, never relative.

### 5.2 `wrapHandler(name, handler): handler`

Error-wrapping utility applied to every tool handler:

```
1. Try: result = await handler(args)
2. If result is not JSON-serializable → throw
3. Return result
4. Catch: return { error: err.message }
```

All handlers MUST return JSON-serializable values. The wrapper ensures no unhandled rejections escape.

### 5.3 Terminal ID Map

```typescript
// Maintained by accordo-editor extension state
const terminalMap = new Map<string, vscode.Terminal>();
let terminalCounter = 0;

function createTerminalId(): string {
  return `accordo-terminal-${++terminalCounter}`;
}

function getTerminal(id: string): vscode.Terminal | undefined {
  const t = terminalMap.get(id);
  // Verify the terminal is still alive (not closed by the user)
  if (t && vscode.window.terminals.includes(t)) return t;
  if (t) terminalMap.delete(id); // stale entry cleanup
  return undefined;
}

/** Reverse-lookup: given a vscode.Terminal, return its stable accordo ID (or undefined). */
function getTerminalId(terminal: vscode.Terminal): string | undefined {
  for (const [id, t] of terminalMap) {
    if (t === terminal) return id;
  }
  return undefined;
}
```

**Lifecycle:** When a terminal is closed by the user (`vscode.window.onDidCloseTerminal`), its entry is removed from the map. The counter is never reset (IDs are unique for the lifetime of the extension host session).

---

## 6. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Extension activation time | < 200ms (no heavy work — just registerTools) |
| Tool handler latency (typical) | < 100ms for editor/layout tools |
| getTree latency (depth=3) | < 2s |
| search latency (50 results) | < 5s |
| Memory | < 15 MB |
| VSCode engine | >= 1.100.0 |
| Dependencies | Zero npm dependencies. Uses only `vscode` API + `@accordo/bridge-types`. |

---

## 7. Testing Requirements

| Test Type | Coverage |
|---|---|
| Unit: resolvePath | relative, absolute, outside-workspace, Windows paths |
| Unit: wrapHandler | success, throw, non-serializable return |
| Unit: each tool handler | Happy path with mock VSCode API |
| Unit: input validation | Missing required fields, wrong types, out-of-range values |
| Integration: tool registration | activate → registerTools called → Bridge receives 24 tools |
| Integration: tool invocation | Bridge sends invoke → handler runs → result returned |
| Integration: getTree truncation | Workspace with >1000 files → truncated correctly |
| Unit: diagnostics.list | Severity filter, path filter, 0-based→1-based offset, truncation at 500 |
| Unit: terminal.list | Tracked IDs, untracked terminals, isActive flag |
| Unit: terminal.close | Happy path, already-closed terminal (stale map entry) |
| E2E: full round-trip | Agent calls tools/call → Hub → Bridge → Editor handler → result back to agent |
