# Testing Guide — E-6: Bar Tools (`accordo_layout_panel`)

**Module:** `packages/editor/src/tools/bar.ts`  
**Tool:** `accordo_layout_panel({ area, view?, action })`  
**Date:** 2026-03-31  
**Test suite:** `packages/editor/src/__tests__/bar.test.ts` — 55 tests, all passing

---

## Section 1 — Automated Tests

### Command
```bash
cd packages/editor && pnpm test
```
All 344 tests in the editor package pass. The E-6 bar tools tests are in `bar.test.ts`.

To run only the bar tools tests:
```bash
cd packages/editor && pnpm vitest run src/__tests__/bar.test.ts
```

### Test Groups

| Group | Tests | What it verifies |
|---|---|---|
| Tool registration | 10 | `accordo_layout_panel` tool registered with correct name, schema, dangerLevel, idempotent flag |
| Input validation | 6 | Missing/invalid `area`, missing/invalid `action`, `view+close` rejected, rightBar+view rejected |
| State transitions (sidebar) | 6 | All 6 transitions: unknown→open, unknown→close, open→open, open→close, closed→open, closed→close |
| State transitions (panel) | 6 | Same 6 transitions for panel area |
| State transitions (rightBar) | 6 | Same 6 transitions for rightBar area |
| View-level open | 5 | Sidebar views (explorer) and panel views (terminal, output, debug-console) use correct commands; focus-first pattern for panel |
| Unknown view heuristic | 1 | Unknown view falls back to `workbench.view.<name>` heuristic |
| Error handling | 3 | executeCommand rejection propagated as `{ error }`, state unchanged on failure |
| Cross-area independence | 2 | Sidebar state changes don't affect panel/rightBar; `_resetBarState()` resets all |
| Response shape | 2 | Area-level response has `{ area, action, previousState, wasNoOp }`; view-level adds `view` |
| Layout test count | 1 | Total tool count correct (7 tools in layout module) |

### Expected output
```
 ✓ src/__tests__/bar.test.ts (55 tests) 34ms
 Test Files  8 passed (8)
      Tests  344 passed (344)
```

---

## Section 2 — User Journey Tests

This tool has no user-visible UI of its own — it controls VS Code's built-in panel containers. These journeys describe how an agent uses the tool to accomplish tasks a user would recognize.

### Journey 1 — Agent closes sidebar to give more code space

**Scenario:** User is doing a code review and needs maximum editor space. Agent closes the sidebar.

1. Agent calls `accordo_layout_panel({ area: "sidebar", action: "close" })`
2. VS Code sidebar closes (or is already closed — idempotent)
3. Response: `{ area: "sidebar", action: "closed", previousState: "...", wasNoOp: false }`

**Expected result:** Sidebar is not visible. No error.

### Journey 2 — Agent opens terminal to show build output

**Scenario:** User's build is running. Agent opens the terminal panel and switches to the Terminal view.

1. Agent calls `accordo_layout_panel({ area: "panel", view: "terminal", action: "open" })`
2. VS Code bottom panel opens (if closed), then Terminal view is shown
3. Response: `{ area: "panel", action: "opened", view: "terminal", previousState: "...", wasNoOp: false }`

**Expected result:** Bottom panel visible, Terminal tab active. No error.

### Journey 3 — Agent tries to close a specific view (invalid)

**Scenario:** Agent tries to "close the explorer view" — but you can't close a view, only the area.

1. Agent calls `accordo_layout_panel({ area: "sidebar", view: "explorer", action: "close" })`
2. Response: `{ error: "Cannot close a specific view..." }`

**Expected result:** Error returned. Sidebar state unchanged.

### Journey 4 — Agent opens right sidebar

**Scenario:** Agent needs to show GitLens data. Opens the auxiliary bar (right sidebar).

1. Agent calls `accordo_layout_panel({ area: "rightBar", action: "open" })`
2. VS Code auxiliary bar opens
3. Response: `{ area: "rightBar", action: "opened", previousState: "...", wasNoOp: false }`

**Expected result:** Right sidebar visible. No error.

### Journey 5 — Agent opens Git view in sidebar

**Scenario:** User wants to see source control. Agent switches to the Git view.

1. Agent calls `accordo_layout_panel({ area: "sidebar", view: "git", action: "open" })`
2. Sidebar opens (if closed), Git view shown
3. Response: `{ area: "sidebar", action: "opened", view: "git", previousState: "...", wasNoOp: false }`

**Expected result:** Sidebar visible, Git Source Control view active.

---

## Section 3 — Final Check

### Build and type check
```bash
cd packages/editor && pnpm tsc --noEmit
```
Expected: no errors.

### Test
```bash
cd packages/editor && pnpm test
```
Expected: 344 tests pass (all files).

### Lint
```bash
cd packages/editor && pnpm eslint src/tools/bar.ts
```
Expected: no warnings, no errors.

### Manual smoke test (requires live VS Code)
1. Open VS Code with the Accordo extension running
2. Run MCP tool `accordo_layout_panel` with `{ area: "sidebar", action: "open" }`
3. Sidebar should appear
4. Run `{ area: "sidebar", action: "close" }` — sidebar should close

---

## Section 4 — Deployed E2E Verification

### MCP tool registration check

On a running Accordo IDE session:

1. Call `tools/list` on the MCP endpoint
2. Confirm `accordo_layout_panel` appears in the tool list with correct schema:
   - `area`: enum `["sidebar", "panel", "rightBar"]`
   - `view`: string (optional)
   - `action`: enum `["open", "close"]`
3. Call `accordo_layout_panel` with `{ area: "panel", view: "terminal", action: "open" }`
4. Confirm VS Code bottom panel opens and Terminal view is active

### Residual risk

- VS Code commands used (`workbench.action.focusSideBar`, `workbench.action.closeSidebar`, `workbench.action.focusPanel`, `workbench.action.closePanel`, `workbench.action.focusAuxiliaryBar`, `workbench.action.closeAuxiliaryBar`, `workbench.view.explorer`, `workbench.action.terminal.toggleTerminal`, etc.) are built-in VS Code commands. They are stable across VS Code versions.
- State tracker (`BarState`) is module-level and resets to `"unknown"` on extension reload. This is documented and intentional.
- Third-party extension views (e.g., GitLens) are discovered via the free-string heuristic — they work if the extension registers `workbench.view.<name>` commands. Graceful degradation if they don't.

**E2E status:** Live E2E requires a running VS Code with the Accordo extension installed and an active MCP session. The automated test suite (55 tests) covers all behavior with mocked VS Code commands. E2E verification should be run manually before first production use on a new VS Code instance.
