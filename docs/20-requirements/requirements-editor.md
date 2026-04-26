# accordo-editor — Requirements Specification

**Package:** `accordo-editor`  
**Type:** VSCode extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-04-24

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

  const allTools: ExtensionToolDefinition[] = [
    ...editorTools,        // 11 editor tools
    ...terminalTools,      // 5 terminal tools
    ...vscodeCommandTools, // 2 generic VS Code command gateway tools
    ...createLayoutTools(() => bridge.getState()),  // 7 layout tools
  ];
  const disposable = bridge.registerTools('accordo.accordo-editor', allTools);
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

### 4.1 `accordo_editor_open`

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
{ opened: true, path: string, surface: "editor" | "preview" | "diagram" }
// surface indicates which editor type was used: "editor" (plain text), "preview" (markdown), "diagram" (mmd)
```

**Errors:**

| Condition | Error message |
|---|---|
| File not found | `"File not found: <resolved path>"` |
| Path resolves outside workspace | `"Path is outside workspace: <path>"` |

**Implementation:**
- Resolve path via `resolvePath(path)` utility
- `.md` files → `vscode.commands.executeCommand('vscode.openWith', uri, 'accordo.markdownPreview')` — opens in the Accordo Markdown Preview custom editor when md-viewer extension is installed; falls back to standard text editor otherwise. If `line`/`column` is provided, also calls `accordo_preview_internal_revealLine` with a 0-based line to align preview navigation. Returns `surface: "preview"`.
- `.mmd` files → `vscode.commands.executeCommand('accordo-diagram.open', uri)` — opens in the Accordo Diagram custom editor. Returns `surface: "diagram"`.
- All other files → `vscode.window.showTextDocument(uri, { selection: new Range(line-1, col-1, line-1, col-1) })`. Returns `surface: "editor"`.

---

### 4.2 `accordo_editor_close`

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
| Path provided but file not open (non-.mmd) | `"File is not open: <path>"` |
| Path provided but file not open (.mmd) | Falls back to closing the active editor — returns `{ closed: true }` |
| No path and no active editor | Returns `{ closed: true }` (always succeeds) |

**Implementation:**
- No path: `vscode.commands.executeCommand('workbench.action.closeActiveEditor')` — always succeeds
- Path provided:
  1. Search tabs by URI fsPath
  2. Fall back to label match (stripped path + `.mmd` suffix) — handles diagram webview panels
  3. If tab still not found:
     - `.mmd` files → `workbench.action.closeActiveEditor` (diagram webviews don't expose URI/label reliably)
     - All other files → return error
  4. `vscode.window.tabGroups.close(tab, false)` closes the tab

---

### 4.3 `accordo_editor_scroll`

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

### 4.4 `accordo_editor_highlight`

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

### 4.5 `accordo_editor_clearHighlights`

**Purpose:** Remove all highlights created by `accordo_editor_highlight`.

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

### 4.6 `accordo_editor_split`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. The replacement path is `accordo_vscode_command_execute` with `command: "workbench.action.splitEditorRight"` or `"workbench.action.splitEditorDown"`.

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

### 4.7 `accordo_editor_focus`

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

### 4.8 `accordo_editor_reveal`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. The replacement path is `accordo_vscode_command_execute` with `command: "revealInExplorer"` plus a JSON-safe path→`vscode.Uri` hydration adapter in the gateway runtime.

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

### 4.9 `accordo_terminal_open`

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

### 4.10 `accordo_terminal_run`

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

### 4.11 `accordo_terminal_focus`

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

### 4.12 `accordo_workspace_getTree` (de-scoped)

**Status:** Not implemented in the current editor extension.

This tool was part of an older workspace-surface proposal and is currently out of scope for `accordo-editor`.

---

### 4.13 `accordo_workspace_search` (de-scoped)

**Status:** Not implemented in the current editor extension.

This tool was part of an older workspace-surface proposal and is currently out of scope for `accordo-editor`.

---

### 4.14 `accordo_panel_toggle`

**Purpose:** Show or toggle visibility of a VSCode panel (sidebar views and bottom panel views).

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

**Design document:** `docs/20-requirements/requirements-editor.md` §4.14 and implementation in `packages/editor/src/tools/layout.ts`.

---

### 4.15 `accordo_layout_zen`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. The replacement path is `accordo_vscode_command_execute` with `command: "workbench.action.toggleZenMode"`.

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

### 4.16 `accordo_layout_fullscreen`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. The replacement path is `accordo_vscode_command_execute` with `command: "workbench.action.toggleFullScreen"`.

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

### 4.23 `accordo_layout_joinGroups`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. The replacement path is `accordo_vscode_command_execute` with `command: "workbench.action.joinAllGroups"`.

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

### 4.24 `accordo_layout_evenGroups`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. The replacement path is `accordo_vscode_command_execute` with `command: "workbench.action.evenEditorWidths"`.

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

### 4.25 `accordo_layout_state`

**Module ID:** M74-LS  
**Purpose:** Return the current live IDE layout state on demand — all open tabs (text files and webview panels), active file and cursor, editor groups, active terminal, and per-modality extension state. Solves the agent freshness gap: the `initialize`-time snapshot may be stale; this tool always returns current Bridge-local state.

**Architecture reference:** `docs/10-architecture/architecture.md` (state cache and tool registration flow)

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

### 4.26 `accordo_vscode_command_list`

**Module ID:** M75-VCG  
**Purpose:** Discover VS Code command IDs through a bounded MCP surface so agents can use long-tail editor functionality without adding a bespoke MCP wrapper for every command.

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
    query: {
      type: "string",
      description: "Optional case-insensitive substring filter against command IDs"
    },
    includeInternal: {
      type: "boolean",
      description: "When true, include internal/underscore-prefixed commands. Default: false"
    },
    offset: {
      type: "number",
      description: "0-based pagination offset. Default: 0"
    },
    limit: {
      type: "number",
      description: "Maximum results to return. Default: 100; capped by implementation"
    }
  },
  required: []
}
```

**Response (success):**

```typescript
{
  ok: true;
  auditId: string;
  commands: Array<{
    command: string;
    title?: string;
    source: "core" | "extension";
    internal: boolean;
    policy: {
      action: "allow" | "confirm" | "deny";
      riskClass: "low" | "moderate" | "high";
      requiresConfirmation: boolean;
      reason: string;
      matchedRuleId?: string;
      preferredTool?: string;
    };
  }>;
  totalCount: number;
  nextOffset?: number;
  truncated: boolean;
}
```

**Response (error):**

```typescript
{
  ok: false;
  auditId?: string;
  error: {
    code: "INVALID_ARGUMENT" | "AUDIT_WRITE_FAILED" | "NOT_IMPLEMENTED";
    message: string;
    retriable: boolean;
    details?: Record<string, unknown>;
  };
}
```

**Requirements:**

| ID | Requirement |
|---|---|
| M75-VCG-01 | Registers `accordo_vscode_command_list` as an MCP tool via `BridgeAPI.registerTools()` |
| M75-VCG-02 | Returns a bounded, paginated command list; the tool must never return the full catalog unbounded |
| M75-VCG-03 | `includeInternal: false` excludes internal/underscore-prefixed commands by default |
| M75-VCG-04 | Each listed command includes policy metadata (`allow` / `confirm` / `deny`) and risk classification |
| M75-VCG-05 | Commands that already have first-class Accordo MCP tools may expose `preferredTool` guidance |
| M75-VCG-06 | Listing is auditable and returns an `auditId` |
| M75-VCG-07 | Runtime description instructs agents to prefer existing first-class tools and treat internal commands as unstable |
| M75-VCG-07a | Extended gateway guidance is published through MCP-visible docs resources under `accordo://docs/tool-reference` and `accordo://docs/troubleshooting` (with a `vscode-command-gateway` section), not only repo-local docs |

**Implementation notes:**
- Command discovery source is `vscode.commands.getCommands(includeInternal)`
- Catalog output must be filtered/paged before returning over MCP
- Policy metadata is computed locally in the editor extension, not inferred by the agent

---

### 4.28 `accordo_vscode_command_execute`

**Module ID:** M75-VCG  
**Purpose:** Execute a guarded VS Code command with positional arguments through `vscode.commands.executeCommand`, while preserving safety policy, auditability, and compatibility with existing first-class Accordo tools.

| Property | Value |
|---|---|
| Danger level | moderate |
| Idempotent | no |
| Requires confirmation | no (tool-level); confirmation is command-policy-driven |
| Timeout class | fast (5s) unless extended by command implementation |

**Input Schema:**

```typescript
{
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "VS Code command ID to execute"
    },
    args: {
      type: "array",
      description: "Positional arguments passed to vscode.commands.executeCommand(command, ...args)"
    },
    confirmation: {
      type: "object",
      description: "Required only when policy action is 'confirm'",
      properties: {
        confirmed: { type: "boolean" },
        command: { type: "string" },
        reason: { type: "string" }
      },
      required: ["confirmed", "command"]
    }
  },
  required: ["command"]
}
```

**Response (success):**

```typescript
{
  ok: true;
  auditId: string;
  command: string;
  policy: {
    action: "allow" | "confirm" | "deny";
    riskClass: "low" | "moderate" | "high";
    requiresConfirmation: boolean;
    reason: string;
    matchedRuleId?: string;
    preferredTool?: string;
  };
  result:
    | { kind: "void" }
    | { kind: "json"; value: unknown }
    | { kind: "unsupported"; summary: string };
}
```

**Response (error):**

```typescript
{
  ok: false;
  auditId?: string;
  command?: string;
  policy?: {
    action: "allow" | "confirm" | "deny";
    riskClass: "low" | "moderate" | "high";
    requiresConfirmation: boolean;
    reason: string;
    matchedRuleId?: string;
    preferredTool?: string;
  };
  error: {
    code:
      | "INVALID_ARGUMENT"
      | "COMMAND_NOT_FOUND"
      | "POLICY_DENIED"
      | "POLICY_CONFIRMATION_REQUIRED"
      | "COMMAND_EXECUTION_FAILED"
      | "COMMAND_RESULT_NOT_SERIALIZABLE"
      | "AUDIT_WRITE_FAILED"
      | "NOT_IMPLEMENTED";
    message: string;
    retriable: boolean;
    details?: Record<string, unknown>;
  };
}
```

**Requirements:**

| ID | Requirement |
|---|---|
| M75-VCG-08 | Registers `accordo_vscode_command_execute` as an MCP tool via `BridgeAPI.registerTools()` |
| M75-VCG-09 | Executes commands by calling `vscode.commands.executeCommand(command, ...args)` |
| M75-VCG-10 | Evaluates a local safety policy before execution and classifies each command as `allow`, `confirm`, or `deny` |
| M75-VCG-11 | Commands in the `deny` class never execute and return structured `POLICY_DENIED` errors |
| M75-VCG-12 | Commands in the `confirm` class require explicit confirmation payload matching the command ID |
| M75-VCG-13 | Commands that duplicate first-class Accordo MCP tools (including `accordo_*` command IDs) are denied with `preferredTool` guidance |
| M75-VCG-14 | Raw command return values are normalized to JSON-safe envelopes before returning over MCP |
| M75-VCG-15 | Every execution attempt is audit-logged with command ID, normalized argument shape, policy decision, and outcome |
| M75-VCG-16 | Interactive/unstable command failures return structured error codes rather than opaque string-only failures |
| M75-VCG-17 | Gateway introduction alone does not imply blanket tool replacement; any wrapper retirement must be specified by a later migration module |
| M75-VCG-18 | Server instructions may summarize common gateway workflows, but they must point back to MCP-visible runtime docs rather than rely on repo-local skills alone |

**Implementation notes:**
- Define local abstractions for the command catalog, executor, safety policy, and audit sink inside the editor package
- Dynamic confirmation is enforced by policy/result contract, not by the Bridge's static per-tool confirmation flag
- Audit stores normalized argument shape/summary, not raw argument values
- Runtime docs must include migration examples and caveats for internal and interactive commands through tool descriptions plus MCP resources; repo-local skills are supplemental maintainer guidance only

---

### 4.29 Selected first-class tool migration/removal (`M76-VCGM`)

**Module ID:** M76-VCGM  
**Purpose:** Retire low-value first-class wrappers once the generic command gateway and runtime playbook provide a safe, documented replacement path.

**Scope of removal:**

| Removed MCP tool | Replacement path | Command policy expectation | Notes |
|---|---|---|---|
| `accordo_editor_split` | `accordo_vscode_command_execute("workbench.action.splitEditorRight")` / `("workbench.action.splitEditorDown")` | allow | direct command replacement |
| `accordo_editor_reveal` | `accordo_vscode_command_execute("revealInExplorer", [<hydrated-uri>])` | allow | requires JSON-safe path→URI hydration in gateway runtime |
| `accordo_editor_save` | `accordo_editor_open(path?)` → `accordo_vscode_command_execute("workbench.action.files.save")` | confirm | command acts on active editor only |
| `accordo_editor_saveAll` | `accordo_vscode_command_execute("workbench.action.files.saveAll")` | confirm | no pre-open step |
| `accordo_editor_format` | `accordo_editor_open(path?)` → `accordo_vscode_command_execute("editor.action.formatDocument")` | confirm | command acts on active editor only |
| `accordo_layout_zen` | `accordo_vscode_command_execute("workbench.action.toggleZenMode")` | allow | toggle; no deterministic read-after-write signal today |
| `accordo_layout_fullscreen` | `accordo_vscode_command_execute("workbench.action.toggleFullScreen")` | allow | toggle; no deterministic read-after-write signal today |
| `accordo_layout_joinGroups` | `accordo_vscode_command_execute("workbench.action.joinAllGroups")` | allow | idempotent effect remains expected |
| `accordo_layout_evenGroups` | `accordo_vscode_command_execute("workbench.action.evenEditorWidths")` | allow | no structured post-state available |

**Requirements:**

| ID | Requirement |
|---|---|
| M76-VCGM-01 | `accordo_editor_split`, `accordo_editor_reveal`, `accordo_editor_save`, `accordo_editor_saveAll`, and `accordo_editor_format` are removed from the registered MCP editor tool surface in the migration wave |
| M76-VCGM-02 | `accordo_layout_zen`, `accordo_layout_fullscreen`, `accordo_layout_joinGroups`, and `accordo_layout_evenGroups` are removed from the registered MCP layout tool surface in the migration wave |
| M76-VCGM-03 | The gateway playbook maps each removed editor/layout scenario to an exact VS Code command ID and required call sequence |
| M76-VCGM-04 | The gateway runtime supports a local JSON-safe argument hydration path for URI-bearing commands required by migrated scenarios (at minimum `revealInExplorer`) |
| M76-VCGM-05 | Migrated save/format flows document that path-targeted operations require an explicit focus/open step before command execution because the backing VS Code commands act on the active editor |
| M76-VCGM-06 | Gateway policy remains explicit for migrated commands: save/saveAll/format are confirm-class; split/reveal/zen/fullscreen/join/even remain allow-class unless policy is intentionally revised |
| M76-VCGM-07 | Runtime-visible guidance for migrated commands lives in MCP-visible layers first (tool descriptions, MCP docs resources, server instructions); repo-local skills are supplemental only |
| M76-VCGM-08 | After removal, gateway catalog metadata and docs no longer point the retired wrapper names as preferred first-class tools for those migrated command IDs |
| M76-VCGM-09 | Extension activation, registration, and shim wiring no longer count or register the retired wrappers |
| M76-VCGM-10 | The migration playbook explicitly documents that Zen/fullscreen remain write-only toggles with no deterministic native state probe in the current MCP surface |

---

### 4.27 `accordo_layout_panel`

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

### 4.17 `accordo_editor_save`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. Replacement is `accordo_vscode_command_execute` with `command: "workbench.action.files.save"`; if a specific path is requested, the caller must first focus that file via `accordo_editor_open`.

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

### 4.18 `accordo_editor_saveAll`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. The replacement path is `accordo_vscode_command_execute` with `command: "workbench.action.files.saveAll"`.

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

### 4.19 `accordo_editor_format`

**Retirement note (M76-VCGM):** Approved for removal from the MCP surface in the selected-tool migration wave. Replacement is `accordo_vscode_command_execute` with `command: "editor.action.formatDocument"`; if a specific path is requested, the caller must first focus that file via `accordo_editor_open`.

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

### 4.20 `accordo_diagnostics_list` (de-scoped)

**Status:** Not implemented in the current editor extension.

This diagnostics tool was part of an older proposal and is currently out of scope for `accordo-editor`.

---

### 4.21 `accordo_terminal_list`

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

### 4.22 `accordo_terminal_close`

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
   b. If workspace has exactly one root → resolve against that root
   c. If workspace has multiple roots → throw "Ambiguous relative path '<input>' — specify an absolute path in a multi-root workspace"
   d. Normalize separators to forward slashes

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
| Memory | < 15 MB |
| VSCode engine | >= 1.100.0 |
| Dependencies | Uses `vscode` API and workspace packages (`@accordo/bridge-types`, `@accordo/capabilities`). |

---

## 7. Testing Requirements

| Test Type | Coverage |
|---|---|
| Unit: resolvePath | relative, absolute, outside-workspace, Windows paths |
| Unit: wrapHandler | success, throw, non-serializable return |
| Unit: each tool handler | Happy path with mock VSCode API |
| Unit: input validation | Missing required fields, wrong types, out-of-range values |
| Integration: tool registration | activate → registerTools called → Bridge receives 25 tools |
| Integration: tool invocation | Bridge sends invoke → handler runs → result returned |
| Unit: terminal.list | Tracked IDs, untracked terminals, isActive flag |
| Unit: terminal.close | Happy path, already-closed terminal (stale map entry) |
| E2E: full round-trip | Agent calls tools/call → Hub → Bridge → Editor handler → result back to agent |
