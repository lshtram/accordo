# Testing Guide — Comments Webview Panel Replacement

**Scope:** `M45-PJ`, `M45-WVC`, `M45-WV`, `M45-NR`, `M45-CMD`, `M45-FLT`, `M45-EXT`  
**Package:** `accordo-comments`  
**Authoritative for:** WebviewView-era production-boundary proof

---

## 1. Automated package checks

Run:

1. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-comments test`
2. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-comments typecheck`
3. `pnpm --dir "/home/liorshtram/projects/accordo" --filter accordo-comments build`

These must pass before the runtime proof below.

---

## 2. Production-boundary proof: WebviewView registration and runtime behavior

### 2.1 Setup

1. Build the relevant extensions.
2. Launch the Extension Development Host with the Accordo workspace.
3. Open a workspace containing at least:
   - one text file
   - one markdown file or other supported surface-backed file
4. Ensure the **Accordo Comments** activity-bar container is visible.

### 2.2 RegisterWebviewViewProvider proof

1. Open **Accordo Comments**.
2. Verify the panel renders as a custom webview surface, not as a legacy TreeView row list.

Expected:
- view id is still `accordo-comments-panel`
- panel opens successfully via the activity bar
- the rendered surface supports rich inline layout rather than TreeItem-only label/description rows

### 2.3 Ready/state bootstrap proof

1. Open the panel in a fresh session.
2. Create or load at least one existing thread.

Expected:
- webview becomes ready without blank/error state
- initial panel state appears automatically without requiring manual refresh
- group counts, thread rows, and inline metadata match current store state

### 2.4 Thread-header expansion proof: mouse

1. Click a collapsed thread header/title once.
2. Click the same header/title again.

Expected:
- first click expands inline conversation in place
- second click collapses it
- neither click navigates away from the current panel by itself
- no text editor, preview, browser, or slide surface is opened by header-toggle alone

### 2.5 Thread-header expansion proof: keyboard

1. Focus the panel with keyboard only.
2. Tab or otherwise move focus to a thread header/title.
3. Press Enter or Space to toggle expansion.
4. Press Enter or Space again to collapse.

Expected:
- keyboard activation has the same effect as mouse activation
- expansion/collapse occurs without navigation
- focus remains usable after rerender

### 2.6 Explicit Go navigation proof

1. Expand a thread.
2. Activate the inline **Go** action with mouse.
3. Repeat with keyboard focus on the **Go** action.

Expected:
- **Go** triggers navigation through the existing `accordo.commentsPanel.navigateToAnchor` path
- text anchors open and reveal their file/range
- surface anchors route through the existing router command path
- header expansion and Go navigation remain distinct behaviors

### 2.7 Mutation convergence proof

1. From the expanded panel thread, trigger **Resolve**.
2. Reopen the same thread.
3. Trigger **Reply** from the panel.
4. Trigger **Delete** on a thread.

Expected:
- each action follows the existing command/store behavior
- panel updates after the mutation
- native gutter/comment widget state converges to match the store result
- correctness comes from the canonical store-driven reconcile path, not panel-only edits

### 2.8 Filter/group proof

1. Use toolbar actions for `groupBy`, `filterByStatus`, `filterByIntent`, and `clearFilters`.
2. Reload the window.

Expected:
- grouping and filters update the webview state correctly
- persisted filter/group settings survive reload
- file sections remain collapsible in `by-file` mode

---

## 4. Hard constraints and residual risk

The automated unit test suite (`comments-webview-message-handler.test.ts`) exercises the production message handler seam with mocked dependencies. These tests verify dispatch, validation, and error-code logic but are bounded by the unit-test execution model.

### Hard constraints (cannot be validated in this phase)

1. **WebviewView lifecycle timing.** VS Code resolves webview views asynchronously after activation. The `resolveWebviewView` callback fires once; the initial `panel:ready` round-trip depends on VS Code scheduling. No unit test can replicate the event-loop timing of `webviewView.webview.postMessage` inside `resolveWebviewView`. This is validated only in a real Extension Development Host session.

2. **Browser relay / native widget convergence end-to-end.** The mutation convergence proof (2.7) requires the full data path: panel command → CommentStore mutation → store.onChanged → NativeComments.reconcile → VS Code CommentWidget. Unit tests mock all four layers. The end-to-end correctness of this path (particularly the `comment-widget ↔ Accordo thread` identity map) requires an integration environment.

3. **Concurrent document change and staleness.** The staleness tracking (`createStalenessTracker`) responds to `workspace.onDidChangeTextDocument`. Its behavior under rapid file saves, large content changes, and concurrent edits cannot be reproduced in a unit test environment.

4. **MCP bridge state propagation.** Comments created through the MCP bridge (from external agents) flow into `CommentStore` via a different entry point than native widget replies. Ensuring the webview panel reflects these comments without requiring a panel reopen depends on the `store.onChanged` subscription established at activation. This cannot be unit-tested in isolation.

### Residual risk

- **WebviewView registration is exercised in `activation-path.test.ts`** via `M45-EXT-04: activation calls registerWebviewViewProvider and NOT createTreeView`. This ensures the correct registration API is called, but does not prove the webview actually renders in the activity bar without errors.
- **Ready bootstrap is exercised by `comments-webview-provider.test.ts`** which calls `resolveWebviewView` with a mock WebviewView. This proves the provider plumbing works but not the VS Code scheduling path.
- **Navigation convergence** is exercised by `navigation-router.test.ts` (56 tests) with mocked NavigationEnv, confirming dispatch plan construction and surface routing logic. The actual VS Code `showTextDocument` / `executeCommand` side-effects are not exercised.

### Mitigations in place

- The `panel-shared-helpers.ts` deduplication ensures `createPanelNavigationEnv`, `registerNewCommentCommand`, and `createStalenessTracker` are shared between webview and tree wiring, reducing divergence risk.
- The `comments-webview-html-renderer.ts` refactor into `comments-webview-html-fragments.ts` makes HTML generation independently testable.
- The contract validation tests added in Phase D2 (`invalid-command-scope` cross-direction assertions) cover both invalid-scope directions at assertion level with real production code paths.

### Recommended runtime proof sequence

1. Run `./scripts/start-session.sh` with the Accordo workspace
2. Open **Accordo Comments** from the activity bar — verify rich webview surface renders
3. Create a comment via inline widget, verify it appears in the panel
4. Expand a thread, toggle it, verify no navigation
5. Click **Go**, verify navigation to correct file/line
6. Resolve/reopen a thread, verify native widget state converges
7. Reload the window, verify filter/group persistence

---

## 5. Pass/fail bar

This guide is not satisfied unless all of the following are true in a real extension-host run:

- `registerWebviewViewProvider(...)` is the active registration path
- the webview boots and receives initial state
- thread-header expansion works by mouse and keyboard without navigation
- explicit **Go** navigation uses the existing command/router path
- resolve/reopen/reply/delete converge into native gutter/widget state
