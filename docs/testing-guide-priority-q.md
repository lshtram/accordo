# Testing Guide — Priority Q: Comments Panel Navigation: Focus to Surface

> **Module:** `packages/comments/src/panel/` (navigation router + panel commands)
> **What it does:** When a user clicks a comment in the VS Code Comments Panel, the system opens the correct surface (slide, text/MD preview, diagram, or browser tab) and navigates to the relevant location within that surface.

---

## Section 1 — Automated Tests

Run all automated tests for the comments package with:

```bash
pnpm test -- --run packages/comments
```

To run only the three navigation-focused test files:

```bash
# NavigationRouter — surface dispatch plan + Priority Q focus contracts
pnpm test -- --run packages/comments/src/panel/__tests__/navigation-router.test.ts

# NavigationRegistry integration — slide routing + adapter lifecycle
pnpm test -- --run packages/comments/src/panel/__tests__/navigation-registry-integration.test.ts

# PanelCommands — tree-item commands (navigate, resolve, delete, filter)
pnpm test -- --run packages/comments/src/panel/__tests__/panel-commands.test.ts
```

---

### `navigation-router.test.ts` — 53 tests

**What it verifies:**

| Test group | What is tested |
|---|---|
| `M45-NR` — NavigationRouter core | `navigateToThread` is a function; text anchors produce a `target: 'text'` plan; surface/markdown-preview anchors produce the correct preview command; slide anchors produce the slide focus command with fallback; browser and diagram anchors each produce their own focus commands; unknown surface types fall back gracefully |
| `Q-SURFACE-01` | The `SURFACE_FOCUS_COMMANDS` constant correctly maps every surface type to its canonical VS Code command (`markdownPreview → accordo_preview_internal_focusThread`, `slide → accordo.presentation.internal.focusThread`, `diagram → accordo_diagram_focusThread`, `browser → accordo_browser.focusThread`) |
| `Q-SLIDE-01` | Slide-surface dispatch plan: `target` is `'slide'`, primary command is the slide focus command, primary args are a 3-element tuple `[uri, threadId, blockId]` where `blockId` follows the `slide:{index}:{x}:{y}` pattern |
| `Q-SLIDE-02` | `buildSlideFocusArgs` returns a 3-element readonly tuple: `[string URI, threadId, blockId]` |
| `Q-MD-01` | Markdown-preview surface dispatch plan: `target` is `'markdown-preview'`, primary command is `accordo_preview_internal_focusThread`, primary args are `[uri, threadId, blockId]` |
| `Q-BROWSER-01` | Browser surface dispatch plan: `target` is `'browser'`, primary command is `accordo_browser.focusThread`, primary args are `[threadId]`, and the plan includes a `disconnectedMessage` for the user |
| `Q-DIAGRAM-01` | Diagram surface dispatch plan: `target` is `'diagram'`, primary command is `accordo_diagram_focusThread`, primary args are `[threadId, uri]`, and the plan includes a `disconnectedMessage` |
| `M45-NR-14` | A text anchor in a `.md` file that carries a `blockId` matching `slide:{index}:{x}:{y}` is routed to the slide surface — the slide hint takes precedence over the plain-text path |
| `Q-BROWSER-02` | `CommandBackedBrowserRelayHealthReader` is instantiable and its `readHealth()` method returns a promise resolving to `{ connected: boolean }` |
| `Q-ROUTE-01` | `navigateWithPlan` for a slide surface calls `executeCommand` with the slide focus command and all three args; for a browser surface it calls `executeCommand` with the browser focus command |
| `M45-NR-12` | When the browser relay health returns `connected: true`, the focus command fires and no message is shown; when it returns `connected: false`, the focus command is **not** called and an information message (the `disconnectedMessage`) is shown instead |

---

### `navigation-registry-integration.test.ts` — tests registry routing

**What it verifies:**

| Test group | What is tested |
|---|---|
| `REQ-NR-1.1` | `navigateToThread` accepts a `NavigationAdapterRegistry` parameter (checked by reading the source) |
| `REQ-NR-1.2` | `navigateToThread` for a slide surface calls `executeCommand` with the slide focus command and all three args |
| `REQ-NR-1.3` | `navigateToThread` calls the slide focus command even when a slide adapter is registered (uses `executeCommand` path rather than calling the adapter directly) |
| `REQ-NR-1.4` | When the primary focus command fails, `navigateToThread` falls back to `accordo_presentation_internal_goto` |
| `REQ-NR-1.5` | When both primary and fallback commands fail, a warning message is shown |
| `REQ-NR-2.1` | `createNavigationAdapterRegistry` — register/get roundtrip works correctly |
| `REQ-NR-2.2` | Registering a second adapter for the same `surfaceType` disposes the first (last-writer-wins) |
| `REQ-NR-2.3` | `unregister()` calls `dispose()` on the adapter and removes it |
| `REQ-NR-2.4` | `unregister()` for a non-existent surface type is a no-op (does not throw) |
| `REQ-NR-2.5` | `dispose()` disposes all registered adapters and clears the registry |
| `REQ-NR-2.6` | `get()` for an absent surface type returns `undefined` (never throws) |

---

### `panel-commands.test.ts` — 24 tests

**What it verifies:**

| Test group | What is tested |
|---|---|
| `M45-CMD-01` | `registerPanelCommands` returns an array of disposable objects |
| `M45-CMD-02` | The `accordo.commentsPanel.navigateToAnchor` handler acquires the navigation registry via `executeCommand('accordo_marp_internal_getNavigationRegistry')` and then calls `navigateToThread(thread, navEnv, registry)` |
| `M45-CMD-03` | `accordo.commentsPanel.resolve` shows an input box, calls `store.resolve` with the resolution note and author, and syncs the native comment controller; resolving an already-resolved thread shows an info message instead |
| `M45-CMD-04` | `accordo.commentsPanel.reopen` calls `store.reopen`; reopening an already-open thread shows an info message instead |
| `M45-CMD-05` | `accordo.commentsPanel.reply` navigates to the thread anchor with the acquired registry; gracefully handles being called with no argument |
| `M45-CMD-06` | `accordo.commentsPanel.delete` shows a confirmation dialog (`"Delete"` / `"Cancel"`); calls `store.delete` on confirm; does nothing on cancel |
| `M45-CMD-07` | `accordo.commentsPanel.refresh` fires `provider.refresh()` |
| `M45-CMD-08` | `accordo.commentsPanel.filterByStatus` sets the status filter and refreshes the tree |
| `M45-CMD-09` | `accordo.commentsPanel.filterByIntent` sets the intent filter |
| `M45-CMD-10` | `accordo.commentsPanel.clearFilters` clears all filters and refreshes |
| `M45-CMD-11` | After `resolve` the native comment controller is synced via `updateThread`; after `delete` it is synced via `removeThread` |
| `M45-CMD-12` | Commands that require a tree item argument no-op gracefully when called with no argument (show info: "Select a thread first") |
| `M45-CMD-13` | Author passed to all store mutations is always `{ kind: 'user', name: 'User' }` |
| `M45-CMD-14` | `accordo.commentsPanel.groupBy` shows a quick-pick and calls `filters.setGroupMode` |
| `M40-EXT-12` | `accordo.commentsPanel.deleteAllBrowserComments` shows a confirmation dialog (`"Delete All"` / `"Cancel"`); calls `store.deleteAllByModality('browser')` on confirm; shows an info message with the deleted count; refreshes the tree; does nothing on cancel |

---

## Section 2 — User Journey Tests

These scenarios describe real interactions from the perspective of a user. No technical knowledge is assumed.

---

### Scenario 1 — Click a comment on a Marp slide

**Setup:** You have a Marp presentation open (`deck.md`). A comment has been left on slide 3.

**Steps:**
1. Open the VS Code **Comments Panel** (View → Comments, or the icon in the Activity Bar).
2. Find the thread on slide 3 of `deck.md`.
3. Single-click the thread.

**What happens:**
- The deck presentation opens in a new tab (or focuses it if already open).
- The view jumps directly to **slide 3**.
- The pin/flag for that thread highlights on the slide for 2–3 seconds then fades.
- The cursor does **not** jump to any line in a text editor — it stays on the slide surface.

**What you see in the Comments Panel:**
- The thread is marked as "open" and shows the comment body.

---

### Scenario 2 — Click a comment on a plain `.md` text file

**Setup:** You have a Markdown file open (`README.md`). A comment has been left on line 42.

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the thread anchored to `README.md` at line 42.
3. Single-click the thread.

**What happens:**
- VS Code opens `README.md` in a text editor (or focuses it if already open).
- The cursor jumps to **line 42**, column 1.
- That line is briefly highlighted (standard VS Code "go to definition" highlight).
- The comment in the Comments Panel remains open.

**What you see in the Comments Panel:**
- The thread is selected; the comment body is visible.

---

### Scenario 3 — Click a comment on a diagram node

**Setup:** You have a Mermaid diagram file (`architecture.mmd`) open. A comment has been left on a specific node in the diagram.

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the thread anchored to `architecture.mmd` at a specific node ID (e.g. `node-42`).
3. Single-click the thread.

**What happens:**
- The diagram panel opens (or focuses if already open).
- The view pans/zooms to bring the relevant **node** into the centre of the canvas.
- The node is briefly highlighted.
- The comment in the Comments Panel stays open.

**What you see in the Comments Panel:**
- The thread shows the diagram filename and node ID.

---

### Scenario 4 — Click a browser-surface comment when the browser extension is connected

**Setup:** The Accordo Browser extension is installed and connected to the Hub. A comment exists on a web page (`https://example.com/page`).

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the thread pointing to `https://example.com/page`.
3. Single-click the thread.

**What happens:**
- The system checks whether the browser relay is connected (this is instantaneous).
- The relay confirms the connection.
- VS Code sends a `focusThread` command to the browser extension.
- The relevant browser tab is brought to the foreground and the comment pin on that page is highlighted.

**What you see in the Comments Panel:**
- The thread is selected and shows the URL as its anchor.

---

### Scenario 5 — Click a browser-surface comment when the browser extension is disconnected

**Setup:** The Accordo Browser extension is **not** running or is disconnected from the Hub. A comment exists on `https://example.com/page`.

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the thread pointing to `https://example.com/page`.
3. Single-click the thread.

**What happens:**
- The system probes the browser relay health — it responds `connected: false`.
- VS Code does **not** call the browser focus command (so no error is raised).
- A friendly **information message** appears at the bottom of the VS Code window:
  > "Browser relay is not connected. Open the Accordo Browser extension and refresh the page to enable comment navigation."
- No file opens; no error is shown.

**What you see in VS Code:**
- An information toast (blue bar, not red) — not a VS Code error notification.

---

### Scenario 6 — Click a comment on a `.md` file that carries a slide `blockId` hint

**Setup:** You have a file `deck.md` which is both a Marp presentation **and** can be opened as a plain text file. A comment was anchored to this file with a `blockId` of `slide:2:0.5:0.5` (i.e., slide 2 of the deck).

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the thread on `deck.md` with `blockId: "slide:2:0.5:0.5"`.
3. Single-click the thread.

**What happens:**
- The system detects the `slide:{index}:{x}:{y}` pattern in the `blockId`.
- The router selects the **slide surface** (not the plain text surface).
- The deck presentation opens (or focuses) and jumps to **slide 2**.
- The comment pin on slide 2 is highlighted.

**What you see in the Comments Panel:**
- The thread is selected.
- The router chose slide mode — it did **not** open the raw text of `deck.md`.

---

## Common Failure Modes

| Symptom | Likely cause |
|---|---|
| Clicking a browser comment shows a red VS Code error | Browser relay health probe threw; the graceful disconnected path was not reached — check the browser extension is running |
| Clicking a slide comment opens the raw `.md` text instead of the deck | The `blockId` on the anchor does not match the `slide:{index}:{x}:{y}` pattern; the router treated it as a plain text anchor |
| Clicking a diagram comment does nothing | The diagram panel extension is not active; no error is surfaced to avoid alarming the user |
| Comment panel commands (resolve, delete) have no effect | The `accordo.commentsPanel.*` commands are not registered; extension activation may have failed |
