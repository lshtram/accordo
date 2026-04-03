# Panel Toggle Architecture — E-4 Design Document

**Date:** 2026-03-31  
**Workplan item:** E-4 — extend `panel_toggle` to support bottom panels (terminal/output/problems)  
**Current requirement:** `docs/20-requirements/requirements-editor.md` §4.14  
**Current implementation:** `packages/editor/src/tools/layout.ts` lines 15–44

---

## 1. Problem Statement

The `accordo_panel_toggle` tool currently supports only the **primary sidebar** (left pane):
`explorer`, `search`, `git`, `debug`, `extensions`. Agents cannot toggle bottom-panel views
(Terminal, Output, Problems, Debug Console) or manage panel areas as a whole. During live
MCP testing (2026-03-30), this was identified as a gap — agents need to show/hide the
terminal panel, view Problems output, and manage IDE layout for effective collaboration.

---

## 2. VS Code Panel Architecture

VS Code has **three distinct panel containers**, each with its own toggle command and
visibility state:

### 2.1 Primary Sidebar (Left)

| What | Value |
|---|---|
| Toggle visibility | `workbench.action.toggleSidebarVisibility` |
| When-clause (visible) | `sideBarVisible` |
| When-clause (focused) | `sideBarFocus` |
| When-clause (active view) | `activeViewlet == '<container-id>'` |

**View containers and their focus/show commands:**

| Panel name | Container ID | Show command |
|---|---|---|
| Explorer | `workbench.view.explorer` | `workbench.view.explorer` |
| Search | `workbench.view.search` | `workbench.view.search` |
| Source Control | `workbench.view.scm` | `workbench.view.scm` |
| Run & Debug | `workbench.view.debug` | `workbench.view.debug` |
| Extensions | `workbench.view.extensions` | `workbench.view.extensions` |

> **Note:** These commands _show and focus_ the view — they are **not** toggles. Calling
> `workbench.view.explorer` when Explorer is already visible keeps it visible. The current
> tool name `panel_toggle` is semantically inaccurate — it _shows_ panels, it doesn't toggle them.

### 2.2 Bottom Panel

| What | Value |
|---|---|
| Toggle visibility | `workbench.action.togglePanel` |
| When-clause (visible) | `panelVisible` |
| When-clause (focused) | `panelFocus` |
| When-clause (active view) | `activePanel == '<container-id>'` |

**View containers and their commands:**

| Panel name | Container ID | Toggle/Show command | Type |
|---|---|---|---|
| Problems | `workbench.panel.markers` | `workbench.actions.view.problems` | show/focus |
| Output | `workbench.panel.output` | `workbench.action.output.toggleOutput` | toggle |
| Debug Console | `workbench.panel.repl` | `workbench.debug.action.toggleRepl` | toggle |
| Terminal | `terminal` | `workbench.action.terminal.toggleTerminal` | toggle |
| Comments | `workbench.panel.comments` | `workbench.action.focusCommentsPanel` | show/focus |

### 2.3 Secondary Sidebar (Right / Auxiliary Bar)

| What | Value |
|---|---|
| Toggle visibility | `workbench.action.toggleAuxiliaryBar` |
| When-clause (visible) | `auxiliaryBarVisible` |
| When-clause (focused) | `auxiliaryBarFocus` |
| When-clause (active view) | `activeAuxiliary == '<container-id>'` |

No fixed views — users drag views here. Not relevant for the E-4 scope.

---

## 3. Gap Analysis

### 3.1 Current State

```typescript
const PANEL_COMMANDS: Record<string, string> = {
  explorer:   "workbench.view.explorer",
  search:     "workbench.view.search",
  git:        "workbench.view.scm",
  debug:      "workbench.view.debug",
  extensions: "workbench.view.extensions",
};
```

- **Only left sidebar views** — no bottom panel at all.
- **Show-only semantics** — commands focus/show, never hide. The tool says "toggle" but always returns `{ visible: true }`.
- **No area-level control** — cannot toggle the entire bottom panel or sidebar as a unit.
- **No visibility detection** — response always claims `visible: true` regardless of actual state.

### 3.2 Desired State (E-4 + Improvements)

| Capability | Priority | Status |
|---|---|---|
| Toggle bottom panels: terminal, output, problems | **E-4 (MEDIUM)** | Missing |
| Toggle bottom panels: debug console, comments | Nice-to-have | Missing |
| Toggle entire areas: sidebar, panel, auxiliary bar | Nice-to-have | Missing |
| Accurate visibility state in response | Nice-to-have | Not possible (see §4) |

### 3.3 API Limitation: No Programmatic Visibility Query

**Critical finding:** VS Code when-clause context keys (`sideBarVisible`, `panelVisible`,
`activePanel`, etc.) are **not programmatically queryable** from extension code. They are
internal to the workbench and only accessible in `when` clauses in `package.json`
contributions (menus, keybindings).

There is **no public API** to do:
```typescript
// ❌ This does NOT exist
const isTerminalVisible = vscode.workspace.getConfiguration("sideBarVisible");
const activePanel = vscode.commands.executeCommand("getContextKeyValue", "activePanel");
```

**Implications:**
- The tool **cannot** reliably report current visibility state.
- Using "toggle" commands means the tool doesn't know whether it opened or closed the panel.
- Using "show/focus" commands is **idempotent and predictable**: calling it always results in the panel being visible.

**Recommended approach:** For the primary use case (agents want to see/use a panel),
**show/focus** semantics are better than toggle semantics. The tool should:
1. For **individual views** (explorer, terminal, problems, etc.): use show/focus commands → always opens.
2. For **area-level toggles** (sidebar, panel): use toggle commands → behaviour is "flip current state."
3. Always document in the response that visibility state is best-effort.

---

## 4. Proposed Design — Updated `panel_toggle`

### 4.1 Expanded Panel Map

```typescript
/** Commands organized by category for the panel_toggle tool. */
const PANEL_COMMANDS: Record<string, { command: string; area: "sidebar" | "panel" }> = {
  // ── Primary sidebar views (show/focus) ──
  explorer:      { command: "workbench.view.explorer",    area: "sidebar" },
  search:        { command: "workbench.view.search",      area: "sidebar" },
  git:           { command: "workbench.view.scm",         area: "sidebar" },
  debug:         { command: "workbench.view.debug",       area: "sidebar" },
  extensions:    { command: "workbench.view.extensions",  area: "sidebar" },

  // ── Bottom panel views (toggle or show/focus) ──
  terminal:      { command: "workbench.action.terminal.toggleTerminal",  area: "panel" },
  output:        { command: "workbench.action.output.toggleOutput",      area: "panel" },
  problems:      { command: "workbench.actions.view.problems",           area: "panel" },
  "debug-console": { command: "workbench.debug.action.toggleRepl",      area: "panel" },
};
```

### 4.2 Updated Input Schema

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

### 4.3 Updated Handler

```typescript
export async function panelToggleHandler(
  args: Record<string, unknown>,
): Promise<{ panel: string; area: string } | { error: string }> {
  try {
    const panel = args["panel"];
    if (typeof panel !== "string" || !panel) {
      return { error: "Argument 'panel' must be a non-empty string" };
    }

    const entry = PANEL_COMMANDS[panel];
    if (!entry) {
      return {
        error: `Unknown panel '${panel}'. Valid panels: ${Object.keys(PANEL_COMMANDS).join(", ")}`,
      };
    }

    await vscode.commands.executeCommand(entry.command);
    return { panel, area: entry.area };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
```

**Key change:** Response no longer claims `visible: true` since the tool cannot detect
actual state. Returns `{ panel, area }` to confirm which panel and area were acted on.

### 4.4 Breaking Change Assessment

| Change | Breaking? | Impact |
|---|---|---|
| New enum values in `panel` | **No** — additive | Agents sending old values still work |
| Response shape: `{ visible: true, panel }` → `{ panel, area }` | **Soft break** | `visible` field removed. Agents checking `result.visible` get `undefined` instead of `true`. Acceptable: field was always inaccurate anyway. |
| Tool description update | **No** | MCP description regenerates automatically |

**Recommendation:** Accept the soft break. The `visible: true` field was misleading and
no known agent code relies on it for control flow.

### 4.5 What's NOT in Scope

1. **Area-level toggles** (`workbench.action.togglePanel`, `workbench.action.toggleSidebarVisibility`).
   These could be added later as a separate parameter or separate tool. Not needed for E-4.

2. **Secondary sidebar** (`workbench.action.toggleAuxiliaryBar`). No agent use case identified yet.

3. **Visibility state detection.** No VS Code API exists. Would require heuristics
   (e.g., intercepting focus events) that are fragile and not worth the complexity.

---

## 5. Requirements Update

The following changes to `docs/20-requirements/requirements-editor.md` §4.14 are needed:

### 5.1 Updated §4.14

**Purpose:** Show or toggle visibility of a VSCode panel (sidebar views and bottom panel views).

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
- Sidebar view commands (explorer, search, etc.) **show/focus** the view — they are idempotent.
- Bottom panel commands (terminal, output, debug-console) **toggle** visibility — calling
  them when visible hides the panel.
- `problems` uses a show/focus command — it opens the Problems panel but does not toggle it.
- The tool cannot detect current visibility state due to VS Code API limitations.

---

## 6. Implementation Plan (Phase A → TDD)

### 6.1 Files to Modify

| File | Change |
|---|---|
| `packages/editor/src/tools/layout.ts` | Expand `PANEL_COMMANDS`, update handler and response type |
| `docs/20-requirements/requirements-editor.md` §4.14 | Update spec per §5 above |

### 6.2 Files to Add (Tests)

| File | Purpose |
|---|---|
| `packages/editor/src/__tests__/panel-toggle.test.ts` | Unit tests for expanded handler |

### 6.3 TDD Phases

| Phase | Deliverable |
|---|---|
| A (Architect) | This document + updated requirements + interface stubs |
| B (Test Builder) | Failing tests covering all 9 panel values, invalid input, error handling |
| B2 (User checkpoint) | User approves test design |
| C (Developer) | Implementation — update `PANEL_COMMANDS` and handler |
| D (Developer) | Iterate to green, D2 review checklist |
| D3 (PM) | Manual testing guide |
| E (User checkpoint) | User approves implementation |
| F (PM) | Commit |

### 6.4 Test Plan Outline

1. **Valid sidebar panels:** `explorer`, `search`, `git`, `debug`, `extensions` — each calls correct command, returns `{ panel, area: "sidebar" }`.
2. **Valid bottom panels:** `terminal`, `output`, `problems`, `debug-console` — each calls correct command, returns `{ panel, area: "panel" }`.
3. **Invalid panel name** → returns `{ error }` with helpful message listing valid panels.
4. **Missing panel argument** → returns `{ error }`.
5. **Command execution failure** → returns `{ error }` wrapping the thrown error.

### 6.5 Estimated Effort

Small — approximately 30 minutes of TDD cycle time. The change is a map expansion +
response type tweak, with no new architectural patterns needed.

---

## 7. Open Questions

1. **Should `comments` be included?** `workbench.action.focusCommentsPanel` would add a
   10th panel. Deferring unless agents request it.

2. **Should area-level toggles be a separate tool?** E.g., `accordo_layout_togglePanel`
   to toggle the entire bottom panel without specifying a view. Could be useful but adds
   surface area. Recommend deferring to a future enhancement.

3. **E-3 interaction:** The markdown preview toggle (E-3) is a different kind of panel —
   it opens in the editor area, not a sidebar/panel area. It should NOT be added to
   `panel_toggle` but rather as a separate tool (`accordo_editor_preview` or similar).
