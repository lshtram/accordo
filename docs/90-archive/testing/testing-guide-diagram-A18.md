# Testing Guide — A18: Diagram Comments Bridge

**Module:** A18  
**Package:** `packages/diagram`  
**Date:** 2026-03-16  
**Scope:** Host-side `DiagramCommentsBridge` + `DiagramPanel` wiring (host complete);
webview-side canvas integration (W-requirements — pending diag.2 webview work).  
**Automated tests added this session:** 19 (16 bridge + 3 panel wiring)  
**New test total:** 463 / `accordo-diagram`

---

## Part 1 — Automated Tests

These must be clean before any manual testing. Run from the repo root:

```bash
pnpm --filter accordo-diagram typecheck
```

Expected: exits `0` with no TypeScript errors.

```bash
pnpm --filter accordo-diagram test
```

Expected:

```
 Test Files  18 passed (18)
      Tests  463 passed (463)
```

Key test files for this module:

| File | Tests | Coverage |
|---|---|---|
| `src/__tests__/diagram-comments-bridge.test.ts` | 16 (A18-T01..T12) | Bridge constructor, all 5 message routes, loadThreadsForUri, onChanged reload, double-subscribe guard, null adapter, dispose |
| `src/__tests__/panel.test.ts` (AP-16..AP-18) | 3 | `getSurfaceAdapter` call, comment message routing, `comments:load` ordering after `host:load-scene` |

If any test fails, do not proceed to manual testing.

---

## Part 2 — Build and Launch

```bash
pnpm build
```

Press **F5** from the root workspace folder — this uses the **"Launch All Extensions (Extension Development Host)"** configuration and loads all four extensions together.

> Do **not** press F5 from inside a package sub-folder — that loads only one extension and the comments extension will be absent, making the bridge inert (null adapter path).

Wait ~3 seconds for activation. You should see:
- "Accordo Diagram" output channel in the EDH window.
- `accordo-comments` extension listed as active (`Extensions: Show Installed Extensions` → filter by "accordo").

---

## Part 3 — Host-Side Verification (already implemented)

These scenarios exercise code paths that exist today. They do **not** require webview-side canvas work.

---

### 3.1 Panel creates bridge and calls `getSurfaceAdapter`

**Setup:**
1. Create or open a `.mmd` file (e.g. `test.mmd`):
   ```
   flowchart TD
     A[Auth] --> B[API]
     B --> C[(Database)]
   ```
2. Run `accordo-diagram.open` via the Command Palette (or open via custom editor).

**What to check (Accordo Diagram output channel):**
Open **Output** → select **"Accordo Diagram"**.

Expected log lines in order:
```
DiagramPanel.create() — path: /…/test.mmd
DiagramPanel.create() — setup complete, waiting for canvas:ready from webview
```

There must be **no** `Error` or `executeCommand failed` lines. A missing or inactive `accordo-comments` extension will silently produce a null adapter (no crash — the bridge is inert). The comments features won't work but the panel will open normally.

**Diagnostic: check adapter acquisition specifically**  
If you want to confirm the command ran, add a temporary `console.log` in `_initCommentsBridge` (remove before commit). Alternatively rely on AP-16 (automated) which asserts the command is called with the correct `file://` URI.

---

### 3.2 `canvas:ready` triggers scene load then thread load (ordering)

**Setup:** Panel already open from 3.1.

**What to check (output channel):**  
After `canvas:ready` arrives the log sequence must be:
1. `canvas:ready received — calling _loadAndPost for: …`
2. `_loadAndPost() — host:load-scene posted with N elements`
3. _(bridge posts `comments:load` to webview after the promise resolves)_

There must be **no** `comments:load` line emitted _before_ `host:load-scene`. This ordering is enforced by the `.then()` chain (A18 fix, tested by AP-18).

---

### 3.3 Comment messages do not reach the "unhandled" default path

**Setup:** Panel open. Open DevTools for the EDH WebView (**Help → Toggle Developer Tools** in the EDH window, then find the Webview DevTools via the iframe).

**Test:** From DevTools console, inject a comment message directly into the extension host:

```javascript
// In webview DevTools console
const vscode = acquireVsCodeApi?.();  // may not be exposed; alternatively use the postMessage below
// OR: simulate from the background page — not easily done here.
```

> **Simpler alternative:** Run the test AP-17 (automated) which injects messages and asserts the "unhandled message type" log branch is never reached. For manual confirmation, watch the "Accordo Diagram" output channel while the webview side is implemented — no `unhandled message type: comment:*` lines should appear.

---

### 3.4 Panel dispose cleans up bridge subscription

**Setup:** Panel open with `accordo-comments` active.

1. Open a second `.mmd` file in a new panel.
2. Close the first panel (click the × on the tab).

**What to check:**
- No `Error: Cannot read properties of null` or similar in the output channel after close.
- Reopening the same file creates a fresh panel with a fresh bridge (check log: `DiagramPanel.create() — path: …` appears again).

---

## Part 4 — Full Feature Verification (requires webview integration)

> **Status:** The W-requirements below are **pending** — they require `webview.ts` to load the `@accordo/comment-sdk`, implement the canvas hit-test, and implement the custom inline input overlay. These tests form the **D3 manual acceptance checklist** and are required before the Phase F commit for A18.

---

### 4.1 Alt+click opens inline input overlay (A18-W01, A18-W02)

**Setup:**
1. Open a `.mmd` file with multiple nodes.
2. Confirm the `accordo-comments` extension is active.
3. Open the diagram panel.

**Steps:**
1. Hold **Alt** and click on a diagram node (e.g. the "Auth" box).

**Expected:**
- A small inline text-input overlay appears near the clicked node — **not** the SDK's default browser `prompt()` dialog.
- Overlay contains a text field and a submit button (or Enter to submit).
- Node pin icon does **not** appear yet (no thread exists).

**Expected NOT to happen:**
- No browser `prompt()` / `alert()` dialog.
- No error in DevTools console.

---

### 4.2 Hit-test accuracy (A18-W02)

**Setup:** Diagram with closely spaced nodes (e.g. `A --> B --> C` arranged in a row).

**Steps:**
1. Alt+click precisely on node A.
2. Submit a comment body.
3. Alt+click on node B.
4. Submit a different body.

**Expected:**
- Thread for node A is anchored to `node:A` in the Comments panel.
- Thread for node B is anchored to `node:B`.
- Clicking outside **any** node shows no overlay (or overlay appears only on actual elements).

---

### 4.3 Inline overlay — submit (A18-W05)

**Steps:**
1. Alt+click a node. Overlay appears.
2. Type "Why is this step here?".
3. Press Enter (or click Submit).

**Expected:**
- Overlay closes immediately.
- A new thread appears in the **Comments** panel (View → Comments).
- The thread shows the body "Why is this step here?" anchored to the `.mmd` file URI.
- A pin icon renders on the canvas at the correct node position.

---

### 4.4 Inline overlay — Escape and outside-click dismiss (A18-W05)

**Steps (Escape):**
1. Alt+click a node. Overlay appears.
2. Type some text.
3. Press **Escape**.

**Expected:** Overlay closes. No thread created. No message in DevTools Network/console.

**Steps (outside-click):**
1. Alt+click a node. Overlay appears.
2. Click somewhere else on the canvas (not on the overlay).

**Expected:** Same — overlay closes, no side-effect.

---

### 4.5 Thread load on canvas:ready — pins render correctly (A18-W03)

**Setup:** At least one comment thread already exists for the open `.mmd` file.

**Steps:**
1. Close the diagram panel.
2. Re-open the same `.mmd` file.

**Expected:**
- After `host:load-scene` arrives, the panel posts `comments:load` with the existing threads.
- Pin icons appear on the canvas at the correct node positions immediately after load (not flickering in later).

---

### 4.6 Pin stability — scroll, zoom, resize (A18-W04)

**Setup:** Diagram panel with at least one pinned comment thread.

| Test | Action | Expected |
|---|---|---|
| Scroll | Drag canvas left/right/up/down | Pin icon tracks the node — moves with it |
| Zoom in | Ctrl+scroll up in canvas | Pin icon stays anchored to the node; scales with zoom |
| Zoom out | Ctrl+scroll down | Same |
| Window resize | Drag VS Code window corner to resize | Pin icon repositions correctly after resize |

---

### 4.7 DPI scaling (A18-W04)

> **Requires OS-level scaling change.** If your display is at native 100 %, this test requires an external display set to a different scaling factor, or changing System Preferences → Displays → Resolution.

**Tests:**

| OS scaling | Action | Expected |
|---|---|---|
| 125 % | Open panel with a pinned thread | Pin correctly positioned on the node |
| 150 % | Same | Pin correctly positioned |
| 200 % | Same | Pin correctly positioned |

If pins appear offset (e.g. shifted up-left), the `coordinateToScreen` transform needs a `window.devicePixelRatio` correction (see `diag_arch_v4.2.md §25.2`).

---

### 4.8 Edge and cluster comments (A18-R13)

**Setup:** Diagram with at least one edge and one cluster:
```
flowchart TD
  subgraph system
    A[Auth] --> B[API]
  end
```

**Steps:**
1. Alt+click on the edge `A → B`. Submit a comment.
2. Alt+click on the cluster border "system". Submit a comment.

**Expected:**
- Edge thread anchor: `nodeId = "edge:A->B:0"` (visible in Comments panel hover or via DevTools).
- Cluster thread anchor: `nodeId = "cluster:system"`.
- Both pins render at correct positions.

---

### 4.9 Reply, resolve, reopen, delete (A18-R03..R06)

**Setup:** At least one existing thread with a pin on the canvas.

| Action | Steps | Expected |
|---|---|---|
| Reply | Click pin → Reply button → type body → Submit | New comment appears inside thread in Comments panel |
| Resolve | Thread menu → Resolve | Thread status changes to Resolved; pin may change appearance |
| Reopen | Resolved thread menu → Reopen | Thread back to Open; pin restored |
| Delete | Thread menu → Delete | Thread removed from Comments panel; pin disappears from canvas |

---

### 4.10 Orphaned thread — no pin (A18-R14)

**Setup:** A thread exists for node `node:auth`. Open the `.mmd` source and delete the `auth` node. Save.

**Expected:**
- The thread remains visible in the **Comments** panel.
- **No** pin appears on the canvas (the canvas ignores unknown block IDs).
- No crash or error.

---

## Part 5 — Regression Check

After all manual tests, re-run the automated suite to confirm no regressions were introduced:

```bash
pnpm --filter accordo-diagram test
```

Expected: `Tests  463 passed (463)`.

---

## D3 Checklist

_Copy this block into the workplan when marking A18 as Phase E ready._

- [ ] A18-W01: Alt+click a node — inline input overlay appears (not the SDK default dialog)
- [ ] A18-W01: Node pin is positioned correctly at 100 % editor zoom
- [ ] A18-W02: Hit-test correctly identifies the target element (correct blockId in thread anchor)
- [ ] A18-W05: Submitting overlay posts `comment:create`; thread appears in Comments panel anchored to the correct `.mmd` file URI
- [ ] A18-W05: Escape and outside-click dismiss overlay with no side-effect and no thread created
- [ ] A18-W03: Reloading panel (close + re-open) posts `comments:load` after `host:load-scene`; pins re-render
- [ ] A18-W04: Pin position survives canvas scroll
- [ ] A18-W04: Pin position survives Excalidraw zoom in / zoom out
- [ ] A18-W04: Pin position survives VS Code window resize
- [ ] A18-W04: Pin position correct at OS display scaling 125 %, 150 %, 200 %
- [ ] A18-R13: Edge comment `blockId` stored verbatim as `edge:{from}->{to}:{ordinal}`; cluster as `cluster:{id}`
- [ ] A18-R14: Orphaned thread (node deleted) visible in Comments panel with no canvas pin
