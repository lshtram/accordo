# Bar Tools — E-6 Design

**Date:** 2026-03-31  
**Supersedes:** `docs/00-workplan/bar-tools-architecture.md` (archived to `docs/90-archive/`)  
**Related requirement:** `docs/20-requirements/requirements-editor.md` §4.27  
**Package:** `packages/editor` (VS Code extension — `vscode` imports permitted)  
**Existing implementation:** `packages/editor/src/tools/layout.ts`, `packages/editor/src/tools/bar.ts`

---

## 1. Requirements

### 1.1 Problem Statement

VS Code has three collapsible area containers — the Primary Sidebar (left), Bottom Panel,
and Auxiliary Bar (right sidebar). Agents need to control these areas with predictable
outcomes. Toggle semantics are unreliable because the agent cannot query current visibility
state. Explicit **open** and **close** actions with a state tracker solve this.

The initial design (archived `bar-tools-architecture.md`) used six separate tools (two per
area). After user review, the design is consolidated into **one combined tool** that is
simpler for agents to discover and use.

### 1.2 Tool: `accordo_layout_panel`

A single tool that controls all three VS Code area containers, and optionally opens a
specific view within an area.

| Property | Value |
|---|---|
| Name | `accordo_layout_panel` |
| Group | `layout` |
| Danger level | `safe` |
| Idempotent | `true` |
| Requires confirmation | `false` |
| Timeout class | fast (5s) |

### 1.3 Input Schema

```typescript
{
  type: "object",
  properties: {
    area: {
      type: "string",
      enum: ["sidebar", "panel", "rightBar"],
      description: "Which VS Code area to control: 'sidebar' (primary sidebar, left), 'panel' (bottom panel — terminal/output/problems), 'rightBar' (auxiliary bar, right sidebar)"
    },
        view: {
          type: "string",
          description: "Optional: specific view to open within the area. Only valid for 'sidebar' and 'panel' areas (not 'rightBar'). Sidebar views: 'explorer', 'search', 'git', 'debug', 'extensions'. Panel views: 'terminal', 'output', 'problems', 'debug-console'. If omitted, operates on the area container as a whole."
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

### 1.4 Semantics

| `area` | `view` | `action` | Behaviour |
|---|---|---|---|
| `sidebar` | *(omitted)* | `open` | Open/focus the sidebar container. No-op if already open. |
| `sidebar` | *(omitted)* | `close` | Close the sidebar container. No-op if already closed. |
| `sidebar` | `"explorer"` | `open` | Open sidebar + switch to Explorer view. |
| `sidebar` | `"explorer"` | `close` | Not applicable — returns error. Cannot close a view; close the area instead. |
| `panel` | `"terminal"` | `open` | Open bottom panel + switch to Terminal view. |
| `panel` | *(omitted)* | `close` | Close the bottom panel container. |
| `rightBar` | *(omitted)* | `open` | Open the auxiliary bar (right sidebar). |
| `rightBar` | *(omitted)* | `close` | Close the auxiliary bar. |

**Rule:** `view` + `action: "close"` is an error. You close the **area**, not individual
views. The `view` parameter is only meaningful with `action: "open"`.

### 1.5 Response Schema

#### Success (area-level operation):

```typescript
{
  area: "sidebar" | "panel" | "rightBar";
  action: "opened" | "closed";
  previousState: "unknown" | "open" | "closed";
  wasNoOp: boolean;
}
```

#### Success (view-level open):

```typescript
{
  area: "sidebar" | "panel" | "rightBar";
  action: "opened";
  view: string;         // the view that was opened
  previousState: "unknown" | "open" | "closed";
  wasNoOp: false;       // view opens always execute the command
}
```

#### Error:

```typescript
{
  error: string;
}
```

### 1.6 Error Conditions

| Condition | Error message |
|---|---|
| `area` missing or invalid | `"Argument 'area' must be one of: sidebar, panel, rightBar"` |
| `action` missing or invalid | `"Argument 'action' must be one of: open, close"` |
| `view` + `action: "close"` | `"Cannot close a specific view. Omit 'view' to close the area, or use action 'open' to switch to a view."` |
| `view` + `area: "rightBar"` | `"rightBar does not support the 'view' parameter. Use action 'open' or 'close' without specifying a view."` |
| Unknown `view` for the area | `"Unknown view '<view>' for area '<area>'. Known views: <list>"` |
| VS Code command fails | `"Command failed: <error message>"` |

### 1.7 Use Cases

1. **Agent wants maximum screen space for code review:**
   ```json
   { "area": "sidebar", "action": "close" }
   { "area": "panel", "action": "close" }
   ```

2. **Agent wants to show the terminal:**
   ```json
   { "area": "panel", "view": "terminal", "action": "open" }
   ```

3. **Agent wants to show the Git view:**
   ```json
   { "area": "sidebar", "view": "git", "action": "open" }
   ```

4. **Agent wants to open the right sidebar (auxiliary bar):**
   ```json
   { "area": "rightBar", "action": "open" }
   ```

### 1.8 Relationship to Existing `panel_toggle`

The existing `accordo_panel_toggle` tool (§4.14) is **unchanged** and continues to work.
It serves a different purpose — view-level toggle for legacy compatibility.

| Tool | Purpose | Granularity |
|---|---|---|
| `accordo_panel_toggle` | Toggle individual views (legacy, retained) | View-level, toggle semantics |
| `accordo_layout_panel` | Open/close area containers + open specific views | Area-level + view-level, explicit open/close |

Agents should prefer `accordo_layout_panel` for new workflows. `panel_toggle` remains for
backward compatibility and for agents already using it.

---

## 2. Architecture

### 2.1 State Tracker Design — `BarState`

```typescript
/** Visibility state for a VS Code area container. */
type AreaVisibility = "unknown" | "open" | "closed";

/** Area identifiers matching the tool's `area` parameter. */
type AreaId = "sidebar" | "panel" | "rightBar";

/** Module-level state tracker for the three area containers. */
interface BarState {
  sidebar: AreaVisibility;
  panel: AreaVisibility;
  rightBar: AreaVisibility;
}
```

**Initial state:** All areas start as `"unknown"` because VS Code provides no API to query
current visibility (when-clause context keys like `sideBarVisible` are not programmatically
accessible from extension code).

```typescript
const barState: BarState = {
  sidebar: "unknown",
  panel: "unknown",
  rightBar: "unknown",
};
```

**No persistence.** State resets to `"unknown"` on extension reload. The first open/close
call re-establishes known state.

**Concurrency:** VS Code MCP tool handlers in the extension host are serialized per MCP
session. No locking needed.

### 2.2 State Transitions

Each area follows identical transition rules:

| Current State | Action | Commands Executed | New State | `wasNoOp` |
|---|---|---|---|---|
| `unknown` | `open` | `focus*` | `open` | `false` |
| `unknown` | `close` | `focus*` (force open), then `close*` | `closed` | `false` |
| `open` | `open` | none (idempotent) | `open` | `true` |
| `open` | `close` | `close*` | `closed` | `false` |
| `closed` | `open` | `focus*` | `open` | `false` |
| `closed` | `close` | none (idempotent) | `closed` | `true` |

**The `unknown` → `close` transition** is the key design choice: we force open first, then
close. This ensures the state tracker is synchronized. Without this, calling close from
unknown might or might not change the actual state (the `close*` precondition would silently
fail if already closed), and we'd remain in `unknown`.

### 2.3 Command Map

#### 2.3.1 Area-Level Commands

```typescript
interface AreaCommands {
  readonly focus: string;   // opens if closed, focuses
  readonly close: string;   // closes if open, no-op if closed
}

const AREA_COMMANDS: Readonly<Record<AreaId, AreaCommands>> = {
  sidebar: {
    focus: "workbench.action.focusSideBar",
    close: "workbench.action.closeSidebar",
  },
  panel: {
    focus: "workbench.action.focusPanel",
    close: "workbench.action.closePanel",
  },
  rightBar: {
    focus: "workbench.action.focusAuxiliaryBar",
    close: "workbench.action.closeAuxiliaryBar",
  },
};
```

**Note on casing:** `closeSidebar` (lowercase b) vs `focusSideBar` (uppercase B) — this
inconsistency is in VS Code itself, not our code.

#### 2.3.2 View-Level Commands

```typescript
/** Which area a view belongs to, and the VS Code command to show it. */
interface ViewEntry {
  readonly command: string;
  readonly area: AreaId;
}

const VIEW_COMMANDS: Readonly<Record<string, ViewEntry>> = {
  // ── Sidebar views ──
  explorer:        { command: "workbench.view.explorer",                  area: "sidebar" },
  search:          { command: "workbench.view.search",                    area: "sidebar" },
  git:             { command: "workbench.view.scm",                       area: "sidebar" },
  debug:           { command: "workbench.view.debug",                     area: "sidebar" },
  extensions:      { command: "workbench.view.extensions",                area: "sidebar" },

  // ── Panel views ──
  terminal:        { command: "workbench.action.terminal.toggleTerminal", area: "panel" },
  output:          { command: "workbench.action.output.toggleOutput",     area: "panel" },
  problems:        { command: "workbench.actions.view.problems",          area: "panel" },
  "debug-console": { command: "workbench.debug.action.toggleRepl",        area: "panel" },
};
```

**Panel view toggle safety (focus-first pattern):**

Three of the four panel views (`terminal`, `output`, `debug-console`) use VS Code **toggle**
commands. These toggle commands have a dangerous property: if the panel is already visible
AND already showing the requested view, calling the toggle command will **hide** the panel —
the opposite of what `action: "open"` promises.

The fix: when opening a panel view, **always call `workbench.action.focusPanel` first** to
ensure the panel container is open and focused, THEN call the view-specific command. This
works because:

1. `focusPanel` is idempotent — if the panel is already open, it just focuses it (no-op
   visibility change). If it's closed, it opens it.
2. Once the panel is open and focused, the toggle commands for views within an already-open
   panel **switch to** that view rather than toggling the panel container's visibility.
3. The `problems` view uses `workbench.actions.view.problems` which is a show command (not
   a toggle), so it does not have this issue — but the focus-first pattern is harmless for
   it and keeps the logic uniform.

This pattern is NOT needed for sidebar views because their commands (`workbench.view.*`)
are show/focus commands — they always open and focus the view, never toggle.

The handler logic in §2.4 reflects this pattern.

The `rightBar` area has **no hardcoded views** — it's an empty secondary sidebar where
users drag views. Extensions can contribute views to it, but the set is unpredictable.
Area-level `open`/`close` works; **view-level operations are not supported for `rightBar`**.
Passing a `view` parameter with `area: "rightBar"` is an error (see §1.6).

### 2.4 Handler Logic

One handler function (`layoutPanelHandler`) replaces all six previous handler wrappers:

```
function layoutPanelHandler(args):
  1. Validate `area` ∈ {"sidebar", "panel", "rightBar"}
  2. Validate `action` ∈ {"open", "close"}
  3. If `view` is provided AND `action` = "close" → return error
  4. If `view` is provided AND `area` = "rightBar" → return error (§1.6)
  5. If `view` is provided:
     a. Look up view in VIEW_COMMANDS
     b. Verify view belongs to the requested area (or omit area validation — see note)
     c. If area = "panel" → call focusPanel first (toggle safety — see §2.3.2)
     d. Execute the view command
     e. Update barState[area] = "open"
     f. Return success with view field
  6. If `view` is omitted → area-level operation:
     a. Apply state transition (§2.2)
     b. Execute appropriate VS Code commands
     c. Update barState
     d. Return success
```

**View + area mismatch:** If the agent requests `{ area: "panel", view: "explorer" }`, that
is an error — explorer is a sidebar view. The handler validates this.

**rightBar + view rejection:** If the agent requests `{ area: "rightBar", view: "anything" }`,
the handler returns an error immediately (step 4). The `rightBar` area does not support
view-level operations — only area-level `open`/`close`.

**Panel view focus-first pattern (step 5c):** When opening a panel view, the handler calls
`workbench.action.focusPanel` before the view-specific command. This prevents the toggle
commands (`toggleTerminal`, `toggleOutput`, `toggleRepl`) from hiding the panel when it is
already visible and showing the requested view. See §2.3.2 for the full rationale.

### 2.5 View Extensibility Plan

#### 2.5.1 Current State: Hardcoded

The `VIEW_COMMANDS` map lists 9 well-known views. This covers all built-in VS Code views.

#### 2.5.2 The Gap

When a user installs a VS Code extension that adds a view (e.g., GitLens adds "GitLens"
views, Docker adds "Docker" view), the agent cannot open that view because we don't know
about it.

#### 2.5.3 VS Code API Limitations

- **No public API for view enumeration.** There is no `vscode.views.getAll()` or
  `vscode.viewContainers.list()`.
- **`vscode.commands.getCommands(true)`** returns all registered command IDs. Filtering for
  `workbench.view.*` and `workbench.panel.*` prefixes can discover *some* view commands,
  but: returns internal commands, lacks human-readable names, lacks area assignment, and
  extensions may use non-standard command patterns.

#### 2.5.4 Chosen Strategy: Free-String `view` + Graceful Failure (Option C+)

The `view` parameter accepts **any string**, not just the hardcoded enum. The handler:

1. **First checks the hardcoded map.** If found → use the known command and area.
2. **If not found** → attempt a heuristic: try executing `workbench.view.<view>` as a VS Code command.
   - If it succeeds → update state to `open`, return success with a note.
   - If it throws → return error `"Unknown view '<view>' for area '<area>'. Known views: <list>. If this is a third-party view, check the extension's documentation for the correct view ID."`.

**Why this is the best option:**

- **Option A (manifest file):** Adds operational complexity. Users/agents must maintain a
  JSON file. Unlikely to stay in sync.
- **Option B (VS Code API enumeration):** API doesn't exist. The `getCommands` heuristic
  is too fragile — it returns command IDs, not view IDs, and the mapping between them is
  not consistent.
- **Option C (free string, try it):** Pragmatic. Works immediately for well-known views.
  For third-party views, agents can experiment. Failure is graceful (error message, not crash).
- **Option D (startup discovery):** Combines A+B — run the heuristic at startup and cache
  results. Not worth the complexity today.

**Future enhancement path:** If demand grows, add an `accordo_layout_listViews` discovery
tool that calls `vscode.commands.getCommands(true)` and filters for known patterns. This
is **not** part of the current implementation scope.

#### 2.5.5 Schema Implication

The `view` property in the input schema uses `type: "string"` (no `enum` constraint).
The description lists known values as examples, not as an exhaustive set:

```typescript
view: {
  type: "string",
  description: "Optional: specific view to open within the area. Only valid for 'sidebar' and 'panel' areas (not 'rightBar'). Sidebar: 'explorer', 'search', 'git', 'debug', 'extensions'. Panel: 'terminal', 'output', 'problems', 'debug-console'. Other extension views may also work — try the view ID."
}
```

### 2.6 State Tracker and `panel_toggle` Interaction

The state tracker **only** tracks area-level operations via `accordo_layout_panel`. The
existing `accordo_panel_toggle` tool does NOT update the state tracker.

When `accordo_layout_panel` opens a view (`view` parameter provided), it sets the area
state to `open` (since opening a view implicitly opens the containing area).

When `panel_toggle` opens a sidebar view (e.g., explorer), the sidebar does open, but
`barState.sidebar` is not updated. This means `barState` may be stale until the next
`accordo_layout_panel` call on that area. This is acceptable:

- If state says `unknown` and sidebar is actually open, calling `close` still works
  (force-open-then-close is idempotent with open state).
- If state says `closed` but sidebar was opened by `panel_toggle`, calling `close` via
  `closeSidebar` command will work correctly (the precondition is met).

### 2.7 State Corruption by External Actions

If the user manually opens/closes an area (keyboard shortcuts, mouse), the state tracker
becomes stale. This is a known limitation:

- **Worst case:** A no-op (calling close on an already-closed area, or open on an already-open area).
- **Self-healing:** Any `open` or `close` call via this tool re-syncs state for that area.
- **Not dangerous:** No crash, no data loss, no side effects beyond a visual no-op.

---

## 3. Implementation Plan

### 3.1 Files to Create/Modify

| File | Action | Content |
|---|---|---|
| `packages/editor/src/tools/bar.ts` | **Rewrite** | Single handler + single tool definition + state tracker |
| `packages/editor/src/tools/layout.ts` | **Modify** | Update import (already imports `barTools` — shape changes from array-of-6 to array-of-1) |
| `docs/00-workplan/e-6-bar-tools.md` | **Create** | This document |
| `docs/00-workplan/bar-tools-architecture.md` | **Archive** | Move to `docs/90-archive/` |
| `docs/20-requirements/requirements-editor.md` | **Modify** | Replace §4.27–§4.32 (6 tools) with single §4.27 (`accordo_layout_panel`) |

### 3.2 Revised `bar.ts` Structure

```typescript
// bar.ts — revised outline

// Types
type AreaVisibility = "unknown" | "open" | "closed";
type AreaId = "sidebar" | "panel" | "rightBar";
interface BarState { sidebar: AreaVisibility; panel: AreaVisibility; rightBar: AreaVisibility; }
interface AreaCommands { readonly focus: string; readonly close: string; }
interface ViewEntry { readonly command: string; readonly area: AreaId; }

// State
const barState: BarState = { sidebar: "unknown", panel: "unknown", rightBar: "unknown" };
export function _resetBarState(): void { ... }
export function _getBarState(): Readonly<BarState> { ... }

// Command maps
const AREA_COMMANDS: Record<AreaId, AreaCommands> = { ... };
const VIEW_COMMANDS: Record<string, ViewEntry> = { ... };

// Handler
export async function layoutPanelHandler(
  args: Record<string, unknown>,
): Promise<LayoutPanelResponse | { error: string }> { ... }

// Tool definition
export const barTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_layout_panel",
    group: "layout",
    description: "Control VS Code area containers (sidebar, panel, right bar) — open, close, or open a specific view within an area.",
    inputSchema: { ... },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_layout_panel", layoutPanelHandler),
  },
];
```

### 3.3 TDD Approach

| Phase | Deliverable |
|---|---|
| A (Architect) | This document + compilable stubs in `bar.ts` + requirements update |
| B (Test Builder) | Failing tests in `bar.test.ts` |
| B2 (User checkpoint) | User approves test design |
| C (Developer) | Implementation — fill in handler logic, state tracker |
| D (Developer) | Iterate to green |
| D2 (Reviewer) | Code review checklist gate |
| D3 (PM) | Manual testing guide |
| E (User checkpoint) | User approves implementation |
| F (PM) | Commit |

### 3.4 Test Outline

#### 3.4.1 Input Validation Tests (6 tests)

| # | Test |
|---|---|
| 1 | Missing `area` → error |
| 2 | Invalid `area` value → error |
| 3 | Missing `action` → error |
| 4 | Invalid `action` value → error |
| 5 | `view` + `action: "close"` → error |
| 6 | `area: "rightBar"` + `view` → error: "rightBar does not support the 'view' parameter..." |

#### 3.4.2 Area-Level State Transition Tests (3 areas × 6 transitions = 18 tests, table-driven)

For each area (`sidebar`, `panel`, `rightBar`):

| # | Initial State | Action | Expected Commands | Final State | `wasNoOp` |
|---|---|---|---|---|---|
| 1 | `unknown` | `open` | `focus*` | `open` | `false` |
| 2 | `unknown` | `close` | `focus*`, `close*` | `closed` | `false` |
| 3 | `open` | `open` | none | `open` | `true` |
| 4 | `open` | `close` | `close*` | `closed` | `false` |
| 5 | `closed` | `open` | `focus*` | `open` | `false` |
| 6 | `closed` | `close` | none | `closed` | `true` |

#### 3.4.3 View-Level Open Tests (5 tests)

| # | Test |
|---|---|
| 1 | Open known sidebar view (e.g., `explorer`) → correct command executed, state = `open` |
| 2 | Open known panel view (e.g., `terminal`) → focusPanel called first, then view command, state = `open` |
| 3 | Open unknown view for area → heuristic attempted; if command fails → error |
| 4 | View belongs to different area than requested → error |
| 5 | Open panel view when panel is already open → focusPanel + view command (toggle safety) |

#### 3.4.4 Error Handling Tests (3 tests)

| # | Test |
|---|---|
| 1 | `executeCommand` rejects on `open` → `{ error: ... }`, state unchanged |
| 2 | `executeCommand` rejects on `close` → `{ error: ... }`, state unchanged |
| 3 | `executeCommand` rejects on `close` from `unknown` (first `focus*` fails) → error, state unchanged |

#### 3.4.5 Cross-Area Independence (2 tests)

| # | Test |
|---|---|
| 1 | Opening sidebar doesn't affect panel or rightBar state |
| 2 | `_resetBarState()` → all areas return to `unknown` |

#### 3.4.6 Response Shape Tests (2 tests)

| # | Test |
|---|---|
| 1 | Area-level success response has correct shape (all fields, correct types) |
| 2 | View-level success response includes `view` field |

**Total: ~36 tests** (6 validation + 18 state transitions + 5 view + 3 error + 2
independence + 2 shape). State transition tests should be parameterized (table-driven).

### 3.5 Estimated Effort

**Small-medium.** The consolidation into one tool simplifies the external surface (one tool
definition instead of six) while keeping the internal state machine identical. ~45 minutes
TDD cycle.

---

## Appendix A: Explanation — Two Audiences

### A.1 Non-Technical

**What problem does it solve?**

VS Code has three collapsible areas: a sidebar on the left, a panel on the bottom, and an
optional sidebar on the right. AI agents working in the IDE sometimes need to show or hide
these areas — for example, closing the sidebar to give more screen space to code, or
opening the bottom panel to show the terminal.

**What does it do?**

This module gives agents one simple command — `accordo_layout_panel` — that can open or
close any of the three areas, or open a specific view (like "explorer" or "terminal") within
an area. The agent says *which area*, *what action* (open or close), and optionally *which
view* — and the tool does exactly that.

**What can go wrong?**

If the user manually opens or closes one of these areas (e.g., via a keyboard shortcut),
the tool might briefly think the area is in a different state than it actually is. The worst
that happens is the next command does nothing (a harmless no-op), and the state re-syncs
on the next call. There is also a gap with third-party extension views — the tool knows
about the 9 built-in views, but if a new extension adds a view, the agent may need to
discover the view ID by trial.

**How do we know it works?**

We have ~36 automated tests that verify every combination: opening when already open,
closing when already closed, opening specific views, handling errors, and validating input.

### A.2 Technical

**Key design decisions:**

1. **One tool instead of six.** The original design had 6 separate tools (open/close for
   each of 3 areas). The user pushed back: one parameterized tool is easier for agents to
   discover and reduces the tool surface. The internal state machine is identical.

2. **Explicit open/close, no toggle.** Eliminates state uncertainty. The agent always knows
   the outcome of its action.

3. **Module-level state tracker.** Necessary because VS Code's when-clause context keys
   (`sideBarVisible`, etc.) are not queryable from extension code. The state tracker is
   the only way to achieve idempotent open/close semantics.

4. **Force-open-then-close for unknown→close.** Ensures deterministic state regardless of
   actual visibility. The alternative (just calling `close*`) might be a no-op if the area
   is already closed, leaving state as `unknown` forever.

5. **Free-string `view` with hardcoded fallback.** Known views use a verified command map.
   Unknown views attempt a heuristic (`workbench.view.<name>`). This is pragmatic: works
   for all built-in views, and third-party views can be tried without code changes.

6. **`view` + `close` is an error.** You close areas, not individual views. This avoids
   ambiguity about what "close the explorer view" would mean (hide it? close the sidebar?
   switch to a different view?).

**System integration:**

- Tool registers via `createLayoutTools()` in `layout.ts` → `BridgeAPI.registerTools()` →
  Hub receives `ToolRegistration[]` (no handlers) → MCP `tools/list` exposes it.
- Handler runs in the VS Code extension host with access to `vscode.commands.executeCommand()`.
- State tracker lives in module scope of `bar.ts` — reset on extension host restart.
- No cross-package changes needed (no `bridge-types` changes).
- `panel_toggle` (§4.14) continues to work independently — no coupling.

**Requirements gaps found and resolved:**

- `requirements-editor.md` §4.27–§4.32 (six separate tools) will be consolidated into a
  single §4.27 for `accordo_layout_panel`.
- The `workplan.md` E-6 entry needs updating to reflect the single-tool design.
