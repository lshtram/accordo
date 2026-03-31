# Bar Tools Architecture — Explicit Open/Close for VS Code Areas

**Date:** 2026-03-31  
**Supersedes:** `docs/00-workplan/panel-toggle-architecture.md` §4.5 (area-level controls were out-of-scope there)  
**Related requirement:** `docs/20-requirements/requirements-editor.md` §4.14 (current `panel_toggle`)  
**Package:** `packages/editor` (VS Code extension — `vscode` imports permitted)  
**Existing implementation:** `packages/editor/src/tools/layout.ts`

---

## 1. Problem Statement

The current `accordo_panel_toggle` tool (§4.14) operates at the **view level** — it shows
or toggles individual views (explorer, terminal, problems, etc.). But it provides **no way
to control the three VS Code area containers** themselves:

| Area | Description | Current tool support |
|---|---|---|
| Primary Sidebar (left) | Contains Explorer, Search, Git, Debug, Extensions | None (views only) |
| Bottom Panel | Contains Terminal, Output, Problems, Debug Console | None (views only) |
| Auxiliary Bar (right) | Secondary sidebar — user can drag views here | None at all |

Agents need explicit **open** and **close** commands for these areas — not toggles. Toggles
are unpredictable because the agent cannot query current visibility state (VS Code has no
programmatic API for when-clause context keys like `sideBarVisible`, `panelVisible`,
`auxiliaryBarVisible`).

### Why not toggles?

Toggle semantics create uncertainty: the agent calls "toggle sidebar" but doesn't know
whether the sidebar ended up open or closed. With explicit open/close + a state tracker,
the agent always knows the outcome:
- `sidebar.open` → sidebar is open (idempotent if already open)
- `sidebar.close` → sidebar is closed (idempotent if already closed)

---

## 2. VS Code Command Inventory

### 2.1 Primary Sidebar

| Semantics | Command ID | Behaviour |
|---|---|---|
| Open + Focus | `workbench.action.focusSideBar` | Opens sidebar if closed, focuses it |
| Close | `workbench.action.closeSidebar` | Precondition: `SideBarVisibleContext` — no-op if already closed |
| Toggle | `workbench.action.toggleSidebarVisibility` | Flips state |
| Show view | `workbench.view.explorer`, `workbench.view.search`, etc. | Opens sidebar + switches to view |

### 2.2 Bottom Panel

| Semantics | Command ID | Behaviour |
|---|---|---|
| Open + Focus | `workbench.action.focusPanel` | Opens panel if closed, focuses it |
| Close | `workbench.action.closePanel` | Precondition: `PanelVisibleContext` — no-op if already closed |
| Toggle | `workbench.action.togglePanel` | Flips state |
| Show view | `workbench.actions.view.problems`, etc. | Opens panel + switches to view |

### 2.3 Auxiliary Bar (Right Sidebar)

| Semantics | Command ID | Behaviour |
|---|---|---|
| Open + Focus | `workbench.action.focusAuxiliaryBar` | Opens aux bar if closed, focuses it |
| Close | `workbench.action.closeAuxiliaryBar` | Precondition: `AuxiliaryBarVisibleContext` — no-op if already closed |
| Toggle | `workbench.action.toggleAuxiliaryBar` | Flips state |

**Note:** There is no `workbench.action.openAuxiliaryBar` — confirmed by VS Code source
code search. `focusAuxiliaryBar` is the canonical "open" command.

### 2.4 Key Insight — Close Command Preconditions

The `close*` commands have a `ContextKeyExpr` precondition that checks whether the area
is visible. When the area is already closed, the precondition fails silently — the command
becomes a no-op. This means:

- Calling `closeSidebar` when the sidebar is already closed → **safe no-op**
- Calling `focusSideBar` when the sidebar is already open → **safe no-op** (stays open, receives focus)

This natural idempotency simplifies our state machine.

---

## 3. State Tracker Design

### 3.1 State Model

```typescript
/** Visibility state for a VS Code area container. */
type AreaVisibility = "unknown" | "open" | "closed";

/** Module-level state tracker for the three area containers. */
interface BarState {
  sidebar: AreaVisibility;
  bottomPanel: AreaVisibility;
  auxiliaryBar: AreaVisibility;
}
```

### 3.2 Initial State

All areas start as `"unknown"` because VS Code provides no API to query initial visibility:

```typescript
const barState: BarState = {
  sidebar: "unknown",
  bottomPanel: "unknown",
  auxiliaryBar: "unknown",
};
```

### 3.3 Transition Rules

Each area has identical transition logic. The rules account for the `unknown` initial state:

| Current State | Action | Commands Executed | New State |
|---|---|---|---|
| `unknown` | `open` | `focus*` | `open` |
| `unknown` | `close` | `focus*` (force open), then `close*` | `closed` |
| `open` | `open` | none (idempotent no-op) | `open` |
| `open` | `close` | `close*` | `closed` |
| `closed` | `open` | `focus*` | `open` |
| `closed` | `close` | none (idempotent no-op) | `closed` |

**The `unknown` → `close` transition** is the key design choice: we force open first, then
close. This ensures the state tracker is synchronized. Without this, calling close from
unknown might or might not change the actual state (the `close*` precondition would silently
fail if already closed), and we'd remain in `unknown`.

Alternatively, we could use the toggle command for `unknown` → `close`, but that assumes
the area is currently open — if it's actually closed, toggle would open it (wrong outcome).
The force-open-then-close approach is deterministic regardless of actual state.

### 3.4 No Persistence

State resets to `"unknown"` on:
- Extension reload / VS Code window reload
- Extension host crash and restart

This is acceptable. The first `open` or `close` call after a reload will establish known
state. No storage API is needed.

### 3.5 Concurrency Model

VS Code MCP tool handlers in the extension host are **serialized per MCP session** — one
handler runs at a time. No concurrent state mutations are possible. No locking needed.

### 3.6 State Corruption by External Actions

If the user manually opens/closes a sidebar via keyboard shortcuts or mouse, our state
tracker becomes stale. This is a known limitation:

- **Mitigation:** The force-open-then-close pattern for `unknown` works correctly even with
  stale state in most cases. If state says `open` but user has closed it, calling `close`
  via `close*` command will be a no-op (precondition fails). The state will be wrong until
  the next `open` call which will re-sync.
- **Acceptable:** Agents typically don't mix with manual user actions on the same area.
  If they do, the worst case is a no-op, not a crash.

### 3.7 Implementation — State Functions

```typescript
/** Area identifiers as used in the state tracker. */
type AreaId = "sidebar" | "bottomPanel" | "auxiliaryBar";

/** Command pair for each area: the open (focus) and close commands. */
interface AreaCommands {
  readonly focus: string;   // opens if closed, focuses
  readonly close: string;   // closes if open, no-op if closed
}

const AREA_COMMANDS: Readonly<Record<AreaId, AreaCommands>> = {
  sidebar: {
    focus: "workbench.action.focusSideBar",
    close: "workbench.action.closeSidebar",
  },
  bottomPanel: {
    focus: "workbench.action.focusPanel",
    close: "workbench.action.closePanel",
  },
  auxiliaryBar: {
    focus: "workbench.action.focusAuxiliaryBar",
    close: "workbench.action.closeAuxiliaryBar",
  },
};
```

---

## 4. Tool Definitions

Six new tools, two per area (open + close). All belong to the `"layout"` group.

### 4.1 Tool Naming Convention

Following the existing pattern `accordo_<category>_<action>`:

| Tool name | Category | Action |
|---|---|---|
| `accordo_sidebar_open` | sidebar | open |
| `accordo_sidebar_close` | sidebar | close |
| `accordo_panel_open` | panel | open |
| `accordo_panel_close` | panel | close |
| `accordo_auxiliaryBar_open` | auxiliaryBar | open |
| `accordo_auxiliaryBar_close` | auxiliaryBar | close |

### 4.2 Input Schemas

All six tools take **no input parameters** — they operate on the area container, not on
individual views:

```typescript
{
  type: "object",
  properties: {},
  required: []
}
```

The existing `accordo_panel_toggle` continues to handle **view-level** operations (open
explorer, toggle terminal, etc.). The new bar tools handle **area-level** operations.

### 4.3 Response Schema

#### Success response:

```typescript
{
  area: AreaId;         // "sidebar" | "bottomPanel" | "auxiliaryBar"
  action: "opened" | "closed";
  previousState: AreaVisibility;  // state before this call
  wasNoOp: boolean;     // true if state was already the target state
}
```

#### Error response:

```typescript
{
  error: string;
}
```

### 4.4 Tool Properties

| Property | Value (all 6 tools) | Rationale |
|---|---|---|
| Danger level | `safe` | UI layout change only |
| Idempotent | `true` | Opening when open = no-op; closing when closed = no-op |
| Requires confirmation | `false` | No destructive effect |
| Group | `"layout"` | Consistent with existing layout tools |

### 4.5 Tool Descriptions

| Tool | Description |
|---|---|
| `accordo_sidebar_open` | Open the primary sidebar (left pane). No-op if already open. |
| `accordo_sidebar_close` | Close the primary sidebar (left pane). No-op if already closed. |
| `accordo_panel_open` | Open the bottom panel (terminal/output/problems area). No-op if already open. |
| `accordo_panel_close` | Close the bottom panel (terminal/output/problems area). No-op if already closed. |
| `accordo_auxiliaryBar_open` | Open the auxiliary bar (right sidebar). No-op if already open. |
| `accordo_auxiliaryBar_close` | Close the auxiliary bar (right sidebar). No-op if already closed. |

---

## 5. Relationship to Existing `panel_toggle`

### 5.1 No Breaking Change

The existing `accordo_panel_toggle` tool (§4.14) is **unchanged** and continues to work.
It serves a different purpose:

| Tool | Purpose | Granularity |
|---|---|---|
| `accordo_panel_toggle` | Show/toggle individual views (explorer, terminal, etc.) | View-level |
| `accordo_sidebar_open/close` | Open/close the entire sidebar container | Area-level |
| `accordo_panel_open/close` | Open/close the entire bottom panel container | Area-level |
| `accordo_auxiliaryBar_open/close` | Open/close the entire auxiliary bar container | Area-level |

### 5.2 Interaction Semantics

- `accordo_sidebar_open` + `accordo_panel_toggle({ panel: "explorer" })` → sidebar is open
  AND explorer view is active. The `panel_toggle` call implicitly opens the sidebar too
  (via `workbench.view.explorer`), but `sidebar_open` sets the state tracker.

- `accordo_sidebar_close` after `accordo_panel_toggle({ panel: "explorer" })` → sidebar
  closes. State tracker updated. Next `panel_toggle({ panel: "explorer" })` will re-open it.

- `accordo_panel_close` + `accordo_panel_toggle({ panel: "terminal" })` → bottom panel
  re-opens (toggle terminal opens it). State tracker may be stale until next area-level call.
  This is acceptable — `panel_toggle` is view-level and doesn't interact with the state tracker.

### 5.3 State Tracker Scope

The state tracker **only** tracks area-level operations (the 6 new tools). The existing
`panel_toggle` tool does NOT update the state tracker — it would require tracking which
area each view belongs to and inferring visibility, which adds complexity for little benefit.

---

## 6. Dynamic View Manifest

### 6.1 Gap: No VS Code API for View Enumeration

VS Code does **not** expose a public API to enumerate registered views or view containers
at runtime. There is no equivalent of:

```typescript
// ❌ Does not exist
vscode.views.getAll();
vscode.viewContainers.list();
```

### 6.2 Heuristic Approach (Optional Enhancement)

`vscode.commands.getCommands(true)` returns all registered command IDs. These can be
filtered to discover view-related commands:

```typescript
const allCommands = await vscode.commands.getCommands(true);
const viewCommands = allCommands.filter(
  cmd => cmd.startsWith("workbench.view.") ||
         cmd.startsWith("workbench.panel.")
);
```

**Limitations:**
- Returns command IDs, not human-readable names or area assignments.
- Includes internal commands not meant for users.
- Fragile — depends on VS Code's internal naming convention.
- Extensions may register views with non-standard command patterns.

### 6.3 Recommendation

**Use a hardcoded well-known view list** (the current `PANEL_COMMANDS` map in
`panel_toggle`) as the primary approach. The heuristic enumeration is not worth the
fragility for the bar tools use case.

If needed in the future, a `accordo_layout_listViews` discovery tool could be added
that calls `vscode.commands.getCommands()` and filters for known patterns. This is
**not** part of the current design.

---

## 7. Handler Design

### 7.1 Generic Handler Pattern

All six tools share the same logic, parameterized by area ID and desired action:

```typescript
type BarAction = "open" | "close";

async function barHandler(
  areaId: AreaId,
  action: BarAction,
): Promise<BarToolResponse | { error: string }> {
  const cmds = AREA_COMMANDS[areaId];
  const prev = barState[areaId];

  // ── Idempotent no-ops ──
  if (prev === action) {                    // "open" when open, "closed" when closed
    // Note: AreaVisibility uses "open"/"closed", action uses "open"/"close"
    // Compare with appropriate mapping
  }
  if (prev === "open" && action === "open") {
    return { area: areaId, action: "opened", previousState: prev, wasNoOp: true };
  }
  if (prev === "closed" && action === "close") {
    return { area: areaId, action: "closed", previousState: prev, wasNoOp: true };
  }

  // ── Perform the action ──
  if (action === "open") {
    await vscode.commands.executeCommand(cmds.focus);
    barState[areaId] = "open";
    return { area: areaId, action: "opened", previousState: prev, wasNoOp: false };
  }

  // action === "close"
  if (prev === "unknown") {
    // Force open first to ensure consistent state, then close
    await vscode.commands.executeCommand(cmds.focus);
    await vscode.commands.executeCommand(cmds.close);
  } else {
    // prev === "open"
    await vscode.commands.executeCommand(cmds.close);
  }
  barState[areaId] = "closed";
  return { area: areaId, action: "closed", previousState: prev, wasNoOp: false };
}
```

### 7.2 Handler Wrappers

Each tool gets a thin wrapper that calls the generic handler:

```typescript
export async function sidebarOpenHandler(
  _args: Record<string, unknown>,
): Promise<BarToolResponse | { error: string }> {
  return barHandler("sidebar", "open");
}

export async function sidebarCloseHandler(
  _args: Record<string, unknown>,
): Promise<BarToolResponse | { error: string }> {
  return barHandler("sidebar", "close");
}

// ... etc for panel and auxiliaryBar
```

### 7.3 Error Handling

The `wrapHandler` utility (from `util.ts`) already catches thrown errors and returns
`{ error: string }`. The bar handlers should also use `try/catch` internally for command
execution failures (consistent with existing handlers in `layout.ts`):

```typescript
try {
  await vscode.commands.executeCommand(cmds.focus);
} catch (err) {
  return { error: errorMessage(err) };
}
```

### 7.4 Tool Registration

The six new tools integrate into `createLayoutTools()`:

```typescript
export function createLayoutTools(getState: () => IDEState): ExtensionToolDefinition[] {
  return [
    ...layoutTools,        // existing 5 tools (panel_toggle, zen, fullscreen, etc.)
    ...barTools,           // NEW: 6 bar tools
    {
      name: "accordo_layout_state",
      // ... existing state tool
    },
  ];
}
```

Where `barTools` is defined as an `ExtensionToolDefinition[]` constant, similar to how
`layoutTools` is defined today.

---

## 8. File Structure

### 8.1 New File

| File | Purpose |
|---|---|
| `packages/editor/src/tools/bar.ts` | State tracker + 6 handlers + 6 tool definitions |

### 8.2 Modified Files

| File | Change |
|---|---|
| `packages/editor/src/tools/layout.ts` | Import and include `barTools` in `createLayoutTools()` |

### 8.3 Test File

| File | Purpose |
|---|---|
| `packages/editor/src/__tests__/bar.test.ts` | Unit tests for all 6 handlers + state tracker |

### 8.4 Rationale for Separate File

The bar tools introduce a new concept (module-level state tracker) that is distinct from
the existing panel_toggle pattern (stateless command dispatch). Keeping them in a separate
file (`bar.ts`) avoids bloating `layout.ts` and keeps the state tracker's scope clear.

The integration point is `createLayoutTools()` in `layout.ts`, which imports the bar tool
definitions.

---

## 9. State Tracker Testability

### 9.1 State Reset for Tests

The module-level `barState` needs to be resettable for tests. Options:

**Option A — Exported reset function (preferred):**

```typescript
/** @internal — for testing only */
export function _resetBarState(): void {
  barState.sidebar = "unknown";
  barState.bottomPanel = "unknown";
  barState.auxiliaryBar = "unknown";
}
```

**Option B — Factory function:**

Create a `createBarTools(deps)` factory that takes dependencies (including state) as
parameters. This is more testable but adds indirection.

**Recommendation:** Option A. The underscore prefix + `@internal` jsdoc convention matches
the project's style for test-only exports. The state is simple enough that a reset function
is sufficient.

### 9.2 Mock Requirements

Tests need the existing VS Code mock (`packages/editor/src/__tests__/mocks/vscode.ts`)
with `vscode.commands.executeCommand` stubbed. No new mock facilities needed — the existing
pattern from `panel-toggle.test.ts` applies directly.

---

## 10. Test Plan Outline

### 10.1 State Transition Tests (per area × 3 areas = 18 tests)

For each area (sidebar, bottomPanel, auxiliaryBar):

| # | Test | Initial State | Action | Expected Calls | Expected State | wasNoOp |
|---|---|---|---|---|---|---|
| 1 | Open from unknown | `unknown` | `open` | `focus*` | `open` | `false` |
| 2 | Close from unknown | `unknown` | `close` | `focus*`, `close*` | `closed` | `false` |
| 3 | Open from open | `open` | `open` | none | `open` | `true` |
| 4 | Close from open | `open` | `close` | `close*` | `closed` | `false` |
| 5 | Open from closed | `closed` | `open` | `focus*` | `open` | `false` |
| 6 | Close from closed | `closed` | `close` | none | `closed` | `true` |

### 10.2 Error Handling Tests (3 tests)

| # | Test | Scenario | Expected |
|---|---|---|---|
| 7 | Command rejection on open | `executeCommand` rejects | `{ error: ... }` |
| 8 | Command rejection on close | `executeCommand` rejects | `{ error: ... }` |
| 9 | Command rejection on close from unknown | First `focus*` rejects | `{ error: ... }`, state unchanged |

### 10.3 Cross-Area Independence (2 tests)

| # | Test | Scenario |
|---|---|---|
| 10 | Opening sidebar doesn't affect panel state | Open sidebar → panel still unknown |
| 11 | State reset clears all areas | `_resetBarState()` → all unknown |

### 10.4 Response Shape Tests (2 tests)

| # | Test | Scenario |
|---|---|---|
| 12 | Success response has correct shape | All fields present with correct types |
| 13 | No-op response has correct shape | `wasNoOp: true`, correct `previousState` |

**Total: ~23 tests** (18 state transitions + 3 error + 2 independence).

Many of the 18 state transition tests can be parameterized (table-driven) since the
logic is identical across all three areas.

---

## 11. Requirements Update Needed

A new requirements section (e.g., §4.27–§4.32 or a grouped §4.XX) should be added to
`requirements-editor.md` covering the six bar tools. This is **not done in this architecture
document** — it will be part of the TDD Phase A deliverable.

Key requirement IDs to define:

| ID | Tool | Description |
|---|---|---|
| `§4.27` | `accordo_sidebar_open` | Open the primary sidebar |
| `§4.28` | `accordo_sidebar_close` | Close the primary sidebar |
| `§4.29` | `accordo_panel_open` | Open the bottom panel |
| `§4.30` | `accordo_panel_close` | Close the bottom panel |
| `§4.31` | `accordo_auxiliaryBar_open` | Open the auxiliary bar |
| `§4.32` | `accordo_auxiliaryBar_close` | Close the auxiliary bar |

---

## 12. Implementation Plan (Phase A → TDD)

### 12.1 Files to Create

| File | Phase | Content |
|---|---|---|
| `packages/editor/src/tools/bar.ts` | A (stubs) | Types, state, handlers (stub), tool definitions |
| `packages/editor/src/__tests__/bar.test.ts` | B | 23 failing tests |

### 12.2 Files to Modify

| File | Phase | Change |
|---|---|---|
| `packages/editor/src/tools/layout.ts` | A | Import `barTools`, include in `createLayoutTools()` |
| `docs/20-requirements/requirements-editor.md` | A | Add §4.27–§4.32 |
| `docs/00-workplan/workplan.md` | A | Add bar tools item to execution queue |

### 12.3 TDD Phases

| Phase | Deliverable |
|---|---|
| A (Architect) | This document + requirements update + compilable stubs + `bar.ts` + integration in `layout.ts` |
| B (Test Builder) | Failing tests (23 tests) in `bar.test.ts` |
| B2 (User checkpoint) | User approves test design |
| C (Developer) | Implementation — fill in handler logic, state tracker |
| D (Developer) | Iterate to green, D2 review checklist |
| D3 (PM) | Manual testing guide |
| E (User checkpoint) | User approves implementation |
| F (PM) | Commit |

### 12.4 Estimated Effort

**Small-medium.** The state tracker adds a design concept but the implementation is
straightforward — a module-level object, a generic handler function, and six thin wrappers.
~45 minutes TDD cycle.

---

## 13. Open Questions

### 13.1 Should `panel_toggle` update the bar state tracker?

**Current answer: No.** View-level commands like `workbench.view.explorer` implicitly open
the sidebar, but tracking this would couple `panel_toggle` to the state tracker and add
complexity. If an agent needs reliable sidebar state, they should call `sidebar_open`
explicitly. The bar tools and `panel_toggle` operate at different levels of abstraction.

### 13.2 Should the bar state be included in `accordo_layout_state`?

**Proposed: Yes, in a future enhancement.** The `layoutStateHandler` returns `IDEState`
from the Bridge's `StatePublisher`. The bar state could be added to `IDEState` as:

```typescript
interface IDEState {
  // ... existing fields
  barVisibility?: BarState;  // optional for backward compatibility
}
```

This would let agents query the bar state without calling open/close. However, this
requires `IDEState` changes in `bridge-types`, which is a cross-package change. Defer
to a follow-up task.

### 13.3 What about the `workbench.action.closeSidebar` casing?

The VS Code command is `closeSidebar` (capital B), not `closeSideBar` (capital B). This
is confirmed in the VS Code source code. The `focus` command is `focusSideBar` (capital B).
The inconsistency is in VS Code itself, not our code.

### 13.4 Should we add `accordo_sidebar_toggle` etc. as well?

**No.** The whole point of this redesign is to move away from toggle semantics. Agents should
use explicit open/close. The existing `panel_toggle` (view-level) retains its name because
some of its underlying VS Code commands are genuine toggles (terminal, output).

### 13.5 Auxiliary bar: are there common views to document?

The auxiliary bar has no fixed views — it's an empty secondary sidebar where users drag
views. Extensions can contribute views to it via `package.json` contributions. Common
third-party uses include GitHub Copilot Chat, testing sidebars, and AI panels. We document
that it exists and can be opened/closed, but don't enumerate its contents.

---

## 14. Explanation — Two Audiences

### 14.1 Non-Technical

**What problem does it solve?**

VS Code has three collapsible areas: a sidebar on the left, a panel on the bottom, and
an optional sidebar on the right. AI agents working in the IDE sometimes need to show or
hide these areas — for example, closing the sidebar to give more screen space to code, or
opening the bottom panel to show terminal output.

**What does it do?**

This module gives agents six simple commands: "open sidebar", "close sidebar", "open bottom
panel", "close bottom panel", "open right sidebar", "close right sidebar". Each command
does exactly what it says — no guessing, no surprises.

**What can go wrong?**

If the user manually opens or closes one of these areas (e.g., via a keyboard shortcut),
the module might briefly think the area is in a different state than it actually is. The
worst that happens is the next command does nothing (a harmless no-op), and the state
re-syncs on the next call.

**How do we know it works?**

We have ~23 automated tests that verify every combination: opening when already open,
closing when already closed, opening from an unknown initial state, handling errors, etc.

### 14.2 Technical

**Key design decisions:**

1. **Explicit open/close over toggle** — eliminates state uncertainty. The agent always
   knows the outcome of its action.

2. **Module-level state tracker** — necessary because VS Code's when-clause context keys
   (`sideBarVisible`, etc.) are not queryable from extension code. The state tracker is
   the only way to achieve idempotent open/close semantics.

3. **Force-open-then-close for unknown→close** — ensures deterministic state regardless
   of actual visibility. The alternative (just calling `close*`) might be a no-op if the
   area is already closed, leaving state as `unknown` forever.

4. **Separate file from layout.ts** — the state tracker is a new concept not present in
   the existing stateless layout tools. Separation keeps responsibilities clear.

5. **No coupling to panel_toggle** — the state tracker only tracks area-level operations.
   View-level operations (`panel_toggle`) implicitly open areas but don't update the tracker.
   This simplifies the design at the cost of possible state staleness, which is acceptable
   given the idempotent command semantics.

**System integration:**

- Tools register via `createLayoutTools()` in `layout.ts` → `BridgeAPI.registerTools()` →
  Hub receives `ToolRegistration[]` (no handlers) → MCP `tools/list` exposes them.
- Handlers run in the VS Code extension host with access to `vscode.commands.executeCommand()`.
- State tracker lives in module scope of `bar.ts` — reset on extension host restart.
- No cross-package changes needed (no `bridge-types` changes for the initial implementation).

**Requirements gaps found:**

- `requirements-editor.md` has no sections for area-level open/close tools. Sections
  §4.27–§4.32 need to be added before proceeding to Phase B (test writing).
- The `workplan.md` execution queue needs a new item for bar tools (E-6 or similar).
