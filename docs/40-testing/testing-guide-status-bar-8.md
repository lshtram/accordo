# Testing Guide — Bridge Status Bar (Backlog Item #8)

**Module:** Unified Accordo health indicator in `accordo-bridge`  
**Date:** 2026-03-28  
**Package:** `packages/bridge`  
**Backlog item:** #8 — Bridge status bar (SB-01/02/03)

---

## Section 1 — Automated Tests

### Run command

```bash
pnpm --filter accordo-bridge test
```

Expected: **334 tests pass** (7 test files).

### New tests added (9 in `status-bar.test.ts`)

| Test ID | File | What it verifies |
|---------|------|-----------------|
| SB-01 | `__tests__/status-bar.test.ts` | `createStatusBarItem` called with `Right` alignment and priority `100` on `activate()` |
| SB-02 | `__tests__/status-bar.test.ts` | Text is `$(check) Accordo` when WsClient is connected AND at least 1 tool registered |
| SB-03 | `__tests__/status-bar.test.ts` | Text is `$(error) Accordo` when WsClient state is `"disconnected"` |
| SB-04 | `__tests__/status-bar.test.ts` | Text is `$(warning) Accordo` when WsClient state is `"connecting"` |
| SB-04b | `__tests__/status-bar.test.ts` | Text is `$(warning) Accordo` when WsClient state is `"reconnecting"` |
| SB-05 | `__tests__/status-bar.test.ts` | `accordo.bridge.showStatus` command calls `showQuickPick` with title `"Accordo System Health"`, Hub line, and per-module lines (Browser, Comments, Voice, Diagrams) matching registered tools |
| SB-06 | `__tests__/status-bar.test.ts` | Status bar item is in `context.subscriptions` (disposed automatically on deactivate) |
| SB-06b | `__tests__/status-bar.test.ts` | Text is `$(warning) Accordo` when connected but zero tools (degraded state) |
| SB-06c | `__tests__/status-bar.test.ts` | `showStatus` command shows `"Disconnected"` Hub line when WsClient is disconnected |

All 9 tests confirmed green on 2026-03-28.

---

## Section 2 — User Journey Tests

These scenarios are written for a developer using VS Code with the Accordo Bridge extension loaded. They verify the feature end-to-end through the actual UI.

### Prerequisites

- VS Code open with the Accordo workspace
- `accordo-bridge` extension active (check via Extensions panel → search "Accordo Bridge")
- At least one modality extension also loaded (e.g. `accordo-editor`) so tools appear in the registry

---

### Journey 1 — Status bar item visible on startup

**Goal:** Confirm the status bar item appears and shows the correct initial state.

1. Open VS Code with the Accordo workspace.
2. Wait ~5 seconds for the bridge extension to activate and connect to Hub.
3. Look at the **bottom status bar on the right side**.
4. **Expected:** You see one of:
   - `✓ Accordo` (green checkmark) — Hub connected and tools registered
   - `⚠ Accordo` (warning triangle) — Hub connecting / no tools yet
   - `✗ Accordo` (red X) — Hub not running / disconnected

---

### Journey 2 — Connected state shows green checkmark

**Goal:** Confirm the happy path shows green.

1. Ensure Hub is running (run `node ~/.accordo/hub.pid` to check, or restart via Command Palette → `Accordo: Restart Hub`).
2. Wait for the extension to fully connect (~5 seconds after reload).
3. Look at the status bar.
4. **Expected:** `✓ Accordo` appears on the right side of the status bar.

---

### Journey 3 — Click to open health detail panel

**Goal:** Confirm clicking the status bar item opens the per-module health quick-pick.

1. With `✓ Accordo` or `⚠ Accordo` visible in the status bar, **click on it**.
2. A quick-pick dropdown appears at the top of the VS Code window, titled **"Accordo System Health"**.
3. **Expected content:**
   - First line shows Hub status: `✓ Hub   Connected · ws://localhost:3000 · <N> tools` (or `Disconnected` if not connected)
   - Additional lines for each registered modality — e.g. `✓ Comments   Registered (7 tools)`, `✓ Voice   Registered (4 tools)`, etc.
   - Only modalities that have tools registered appear.
4. Press `Escape` to dismiss — no side effects.

---

### Journey 4 — Disconnected state shows red X

**Goal:** Confirm the error state renders correctly when Hub is unreachable.

1. Stop the Hub process (or run with a wrong port so it can't connect).
2. Reload the VS Code window (`Ctrl+Shift+P` → `Developer: Reload Window`).
3. Watch the status bar during startup.
4. **Expected:** `✗ Accordo` appears (red X icon) when Bridge cannot connect to Hub.
5. Click the status bar item — the detail panel should show `✗ Hub   Disconnected`.

---

### Journey 5 — Reconnection updates the icon

**Goal:** Confirm the icon updates dynamically without a window reload.

1. Start with Hub running — status bar shows `✓ Accordo`.
2. Stop the Hub process (`kill $(cat ~/.accordo/hub.pid)` or force-kill from Activity Monitor).
3. **Expected:** Within a few seconds, the status bar changes to `✗ Accordo` (red X).
4. Restart Hub via Command Palette → `Accordo: Restart Hub`.
5. **Expected:** Within a few seconds, the status bar returns to `✓ Accordo` (green checkmark).

---

### Journey 6 — Command Palette also triggers health panel

**Goal:** Confirm the health panel is accessible without clicking the status bar.

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Type `Accordo: Show Bridge Status` and press Enter.
3. **Expected:** Same "Accordo System Health" quick-pick appears as when clicking the status bar item.
