# accordo-comments — Custom Panel Requirements Specification

**Package:** `accordo-comments` (additions)  
**Type:** VSCode extension — new panel module  
**Session:** 9  
**Module range:** M45-TP, M45-NR, M45-CMD, M45-FLT, M45-EXT  
**Date:** 2026-03-06  
**Architecture reference:** `docs/comments-panel-architecture.md`

---

## 1. Purpose

The custom Accordo Comments Panel is a `vscode.TreeView`-based sidebar panel that replaces the built-in VS Code Comments panel as the primary navigation and triage surface for comment threads in the Accordo workspace.

**Why:** The built-in Comments panel (a) does not support `view/item/context` menus from extensions, (b) navigates via `editor.revealRange` which cannot open webview surfaces, and (c) provides no click-intercept hook. See `docs/patterns.md` P-12 and `docs/comments-panel-architecture.md` §1 for full root-cause analysis.

**Scope of Session 9:**
- Phase 1: `TreeView` list with full context menus, filter state, anchor-aware navigation.
- Phase 2 (deferred M46): `WebviewView` detail pane with full conversation + markdown rendering.

**Invariants:**
- `CommentStore` remains the single source of truth. Panel is read-only presentation layer.
- Native `CommentController` (gutter icons, inline widgets) is **not** modified. Two-surface strategy preserved.
- All new code lives in `packages/comments/src/panel/`.
- Accessibility: every action reachable by keyboard (command palette) as well as context menu.

**Cross-package dependency for Session 9:**
- Slide navigation from panel requires a VS Code command in `accordo-slidev` that accepts a target slide index.
- Acceptable command IDs: `accordo.presentation.goto` (preferred) or `accordo.presentation.internal.goto`.
- If neither command exists at runtime, router behavior is: open deck + show informational warning (no throw).

---

## 2. Extension Manifest Contract

The following are added to `packages/comments/package.json`. Existing contributions are unchanged.

### 2.1 View Container

```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "accordo-comments-container",
      "title": "Accordo Comments",
      "icon": "$(comment-discussion)"
    }
  ]
}
```

### 2.2 View

```json
"views": {
  "accordo-comments-container": [
    {
      "id": "accordo-comments-panel",
      "name": "Comments",
      "contextualTitle": "Accordo Comments"
    }
  ]
}
```

### 2.3 Commands

| Command ID | Title | Icon |
|---|---|---|
| `accordo.commentsPanel.navigateToAnchor` | Go to Anchor | `$(go-to-file)` |
| `accordo.commentsPanel.resolve` | Resolve Thread | `$(pass)` |
| `accordo.commentsPanel.reopen` | Reopen Thread | `$(debug-restart)` |
| `accordo.commentsPanel.reply` | Reply | `$(reply)` |
| `accordo.commentsPanel.delete` | Delete Thread | `$(trash)` |
| `accordo.commentsPanel.refresh` | Refresh | `$(refresh)` |
| `accordo.commentsPanel.filterByStatus` | Filter by Status | `$(filter)` |
| `accordo.commentsPanel.filterByIntent` | Filter by Intent | `$(tag)` |
| `accordo.commentsPanel.clearFilters` | Clear Filters | `$(clear-all)` |
| `accordo.commentsPanel.groupBy` | Group By… | `$(list-tree)` |

### 2.4 Menus

```jsonc
"menus": {
  // View toolbar buttons
  "view/title": [
    { "command": "accordo.commentsPanel.refresh",        "when": "view == accordo-comments-panel", "group": "navigation" },
    { "command": "accordo.commentsPanel.filterByStatus", "when": "view == accordo-comments-panel", "group": "navigation" },
    { "command": "accordo.commentsPanel.filterByIntent", "when": "view == accordo-comments-panel", "group": "navigation" },
    { "command": "accordo.commentsPanel.clearFilters",   "when": "view == accordo-comments-panel", "group": "navigation" }
  ],
  // Right-click context menus on tree items
  "view/item/context": [
    { "command": "accordo.commentsPanel.navigateToAnchor",
      "when": "view == accordo-comments-panel && viewItem =~ /accordo-thread/",
      "group": "1_navigate@1" },
    { "command": "accordo.commentsPanel.reply",
      "when": "view == accordo-comments-panel && viewItem =~ /accordo-thread/",
      "group": "2_actions@1" },
    { "command": "accordo.commentsPanel.resolve",
      "when": "view == accordo-comments-panel && (viewItem == accordo-thread-open || viewItem == accordo-thread-stale)",
      "group": "2_actions@2" },
    { "command": "accordo.commentsPanel.reopen",
      "when": "view == accordo-comments-panel && viewItem == accordo-thread-resolved",
      "group": "2_actions@2" },
    { "command": "accordo.commentsPanel.delete",
      "when": "view == accordo-comments-panel && viewItem =~ /accordo-thread/",
      "group": "3_destructive@1" }
  ]
}
```

---

## 3. Module Specifications

---

### M45-TP — CommentsTreeProvider

**File:** `src/panel/comments-tree-provider.ts`  
**Test file:** `src/panel/__tests__/comments-tree-provider.test.ts`

**Purpose:** Implements `vscode.TreeDataProvider<CommentTreeItem>`. Provides two-level tree: group headers at root, thread items grouped under Open/Resolved.

| Requirement ID | Requirement |
|---|---|
| M45-TP-01 | Exports `class CommentsTreeProvider` implementing `vscode.TreeDataProvider<CommentTreeItem>` |
| M45-TP-02 | Constructor accepts `CommentStore` and `PanelFilters` injected dependencies |
| M45-TP-03 | `getTreeItem(element: CommentTreeItem)` returns the element unchanged (items pre-constructed in `getChildren`) |
| M45-TP-04 | `getChildren(element?)`: root returns two group-header `CommentTreeItem` instances (`Open` and `Resolved`); each group header's children are filtered + sorted thread items |
| M45-TP-05 | Thread items within each group sorted by `lastActivity` descending (most recent first) |
| M45-TP-06 | Subscribes to `store.onChanged(uri)` in constructor; fires `this._onDidChangeTreeData.fire(undefined)` on every notification |
| M45-TP-07 | Thread item `label` = anchor label (from `getAnchorLabel(anchor)`) prefixed with `"⚠ "` if `store.isThreadStale(id)` |
| M45-TP-08 | Thread item `description` = basename of anchor URI + `" · "` + intent emoji (or empty string if no intent) |
| M45-TP-09 | Thread item `contextValue` = `"accordo-thread-open"` for open non-stale, `"accordo-thread-stale"` for open+stale, `"accordo-thread-resolved"` for resolved |
| M45-TP-10 | Thread item `iconPath` = `new ThemeIcon("comment-unresolved")` for open/stale; `new ThemeIcon("pass")` for resolved |
| M45-TP-11 | Thread item `tooltip` = first comment body truncated to 200 chars + `"\n— "` + author name + `" · "` + relative timestamp |
| M45-TP-12 | Thread item `command` = `{ command: "accordo.commentsPanel.navigateToAnchor", title: "Go to Anchor", arguments: [thread] }` so single click triggers navigation |
| M45-TP-13 | Group header `label` = `"Open (N)"` / `"Resolved (N)"` where N is filtered count. Open group `collapsibleState = Expanded`; Resolved group `collapsibleState = Collapsed` |
| M45-TP-14 | When active filters reduce count to 0 for a group, that group's header still appears with count 0 (it is not hidden) |
| M45-TP-15 | `getAnchorLabel(anchor: CommentAnchor): string` — pure function, exported separately; derives human-readable label per the table in architecture §3.5 |
| M45-TP-16 | `dispose()` method disposes the `onChanged` store subscription |

**Intent emoji mapping:**

| Intent | Emoji |
|---|---|
| `fix` | 🔧 |
| `review` | 👀 |
| `design` | 🎨 |
| `question` | ❓ |
| `explain` | 💡 |
| `refactor` | ♻️ |
| (none / undefined) | (empty) |

---

### M45-NR — NavigationRouter

**File:** `src/panel/navigation-router.ts`  
**Test file:** `src/panel/__tests__/navigation-router.test.ts`

**Purpose:** Pure async function that routes to the correct VS Code surface for a given `CommentThread`, dispatching by anchor kind and surface type.

| Requirement ID | Requirement |
|---|---|
| M45-NR-01 | Exports `async function navigateToThread(thread: CommentThread, vscodeEnv?: NavigationEnv): Promise<void>` |
| M45-NR-02 | `anchor.kind === "text"` → calls `vscode.window.showTextDocument(uri, { selection: new vscode.Range(startLine, 0, endLine, 0), preserveFocus: false, preview: false })`. **Smart viewer**: if `env.findOpenViewForUri(uri)` returns `"markdown-preview"` first route via preview command instead. |
| M45-NR-03 | `anchor.kind === "surface"` + `surfaceType === "markdown-preview"` → `vscode.commands.executeCommand('accordo_preview_internal_focusThread', uri, thread.id, coords.blockId)` |
| M45-NR-04 | `anchor.kind === "surface"` + `surfaceType === "slide"` → first executes `accordo_presentation_goto` with `(uri, coords.slideIndex)`; if deck not yet open executes `accordo.presentation.open` first then waits 500ms before navigating; if goto command unavailable shows info warning |
| M45-NR-05 | `anchor.kind === "surface"` + `surfaceType === "browser"` → executes `accordo.browser.focusThread` with `thread.id`; if command is not registered (throws), silently swallows the error and shows `showInformationMessage('Browser extension not connected')` |
| M45-NR-06 | `anchor.kind === "surface"` + `surfaceType === "diagram"` → executes `accordo.diagram.focusThread` with `thread.id`; same graceful fallback as M45-NR-05 |
| M45-NR-07 | `anchor.kind === "file"` → smart viewer: same logic as M45-NR-11 applied to the file URI |
| M45-NR-08 | Any unrecognised `surfaceType` falls back to `showTextDocument(anchor.uri)` |
| M45-NR-09 | All navigation errors (command not found, file not found) are caught; on failure shows `vscode.window.showWarningMessage('Could not navigate to thread: <message>')` |
| M45-NR-10 | `NavigationEnv` interface — injectable abstraction over `vscode.window`, `vscode.commands`, and `setTimeout` — allows unit testing without real VS Code |
| M45-NR-11 | **Smart viewer selection**: before opening any file, check `env.findOpenViewForUri(uri)` which returns `"text" \| "markdown-preview" \| "slide" \| null`. If `"markdown-preview"` → route via `accordo_preview_internal_focusThread`. If `"slide"` → route via `accordo_presentation_goto`. If `"text"` or `null` → use `showTextDocument`. If file is not open (`null`) and the URI is `.md`, attempt accordo-preview first (command `accordo.preview.open`); if unavailable fall back to `showTextDocument`. If URI is a presentation deck (`.deck.md` or slidev convention), attempt `accordo.presentation.open` first. |

**`NavigationEnv` interface (for testability):**

```typescript
interface NavigationEnv {
  showTextDocument(uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Thenable<vscode.TextEditor>;
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  showWarningMessage(message: string): Thenable<string | undefined>;
  showInformationMessage(message: string): Thenable<string | undefined>;
  delay(ms: number): Promise<void>;
}
```

Default implementation uses real `vscode` APIs. Tests inject a mock env.

---

### M45-CMD — PanelCommands

**File:** `src/panel/panel-commands.ts`  
**Test file:** `src/panel/__tests__/panel-commands.test.ts`

**Purpose:** Registers all VS Code commands for the custom panel. Each command receives a `CommentTreeItem` from the tree context menu, extracts the `CommentThread`, and delegates to `CommentStore`.

| Requirement ID | Requirement |
|---|---|
| M45-CMD-01 | Exports `function registerPanelCommands(context, store, nc, router, filters): vscode.Disposable[]` — returns all disposables for push to `context.subscriptions` |
| M45-CMD-02 | `accordo.commentsPanel.navigateToAnchor` — receives `CommentTreeItem` or `CommentThread` arg; calls `router.navigateToThread(thread)` |
| M45-CMD-03 | `accordo.commentsPanel.resolve` — `showInputBox({ prompt: "Resolution note" })`; if non-empty calls `store.resolve({ threadId, resolutionNote, author })`; if already resolved shows info message |
| M45-CMD-04 | `accordo.commentsPanel.reopen` — calls `store.reopen(threadId, author)`; if already open shows info message |
| M45-CMD-05 | `accordo.commentsPanel.reply` — `showInputBox({ prompt: "Reply" })`; if non-empty calls `store.reply({ threadId, body, author })` |
| M45-CMD-06 | `accordo.commentsPanel.delete` — `showWarningMessage("Delete thread and all replies?", "Delete", "Cancel")`; on "Delete" calls `store.delete({ threadId })`; on "Cancel" no-ops |
| M45-CMD-07 | `accordo.commentsPanel.refresh` — fires `provider.refresh()` (calls `_onDidChangeTreeData.fire(undefined)`) |
| M45-CMD-08 | `accordo.commentsPanel.filterByStatus` — `showQuickPick(["open", "resolved", "all"])`; on selection calls `filters.setStatus()` then `provider.refresh()` |
| M45-CMD-09 | `accordo.commentsPanel.filterByIntent` — `showQuickPick([...all intents, "all"])`; on selection calls `filters.setIntent()` then `provider.refresh()` |
| M45-CMD-10 | `accordo.commentsPanel.clearFilters` — calls `filters.clear()` then `provider.refresh()` |
| M45-CMD-11 | After every `store` mutation, the `NativeComments` instance (`nc`) is updated to sync gutter widgets: `nc.updateThread(thread)` / `nc.removeThread(threadId)`. This mirrors the pattern in `SurfaceCommentAdapter` in `extension.ts` |
| M45-CMD-12 | All commands no-op gracefully when called with no argument (e.g., from command palette with no tree selection) — shows `showInformationMessage('Select a thread in the Comments panel first')` |
| M45-CMD-13 | Author passed to store mutations is always `{ kind: "user", name: "User" }` (consistent with existing store caller pattern in `native-comments.ts` / `extension.ts`) |
| M45-CMD-14 | `accordo.commentsPanel.groupBy` — `showQuickPick(["by-status", "by-file", "by-activity"])` with descriptive labels; on selection calls `filters.setGroupMode(mode)` then `provider.refresh()` |

---

### M45-FLT — PanelFilters

**File:** `src/panel/panel-filters.ts`  
**Test file:** `src/panel/__tests__/panel-filters.test.ts`

**Purpose:** Manages active filter state. Provides `apply(threads)` method for `CommentsTreeProvider`. Persists filter state across VSCode sessions.

| Requirement ID | Requirement |
|---|---|
| M45-FLT-01 | Exports `class PanelFilters` |
| M45-FLT-02 | Constructor accepts `vscode.Memento` (workspace state) for persistence |
| M45-FLT-03 | Internal state shape: `{ status?: "open" \| "resolved"; intent?: CommentIntent; authorKind?: "user" \| "agent"; surfaceType?: SurfaceType; staleOnly?: boolean }` |
| M45-FLT-04 | `apply(threads: CommentThread[]): CommentThread[]` — pure filter function; returns filtered array without mutating input |
| M45-FLT-05 | `setStatus(value: "open" \| "resolved" \| undefined)` — sets status filter; persists to `workspaceState` |
| M45-FLT-06 | `setIntent(value: CommentIntent \| undefined)` — sets intent filter; persists to `workspaceState` |
| M45-FLT-07 | `setAuthorKind(value: "user" \| "agent" \| undefined)` — sets author filter; persists to `workspaceState` |
| M45-FLT-08 | `setSurfaceType(value: SurfaceType \| undefined)` — sets surface type filter; persists to `workspaceState` |
| M45-FLT-09 | `setStaleOnly(value: boolean)` — sets stale-only filter; persists to `workspaceState` |
| M45-FLT-10 | `clear()` — resets all filter fields to `undefined` / `false`; persists to `workspaceState` |
| M45-FLT-11 | `getSummary(): string` — returns human-readable active filter description (e.g. `"open, fix intent"`) or empty string when no filters active |
| M45-FLT-12 | `isActive(): boolean` — returns `true` if any filter field is non-default |
| M45-FLT-13 | On construction, loads persisted filter state from `workspaceState` under key `"accordo.commentsPanel.filters"`; validates each field against allowed values; unknown/invalid values reset to `undefined` |
| M45-FLT-14 | `get groupMode(): GroupMode` — returns current group mode; defaults to `"by-status"` |
| M45-FLT-15 | `setGroupMode(value: GroupMode)` — sets group mode; persists to `workspaceState`; invalid values loaded from storage fall back to `"by-status"` |

**Filter persistence key:** `"accordo.commentsPanel.filters"`

**`apply()` logic (normative):**

```typescript
apply(threads: CommentThread[]): CommentThread[] {
  return threads.filter(t => {
    if (this.status && t.status !== this.status) return false;
    if (this.intent && t.comments[0]?.intent !== this.intent) return false;
    if (this.authorKind && t.comments.at(-1)?.author.kind !== this.authorKind) return false;
    if (this.surfaceType) {
      if (t.anchor.kind !== "surface") return false;
      if ((t.anchor as CommentAnchorSurface).surfaceType !== this.surfaceType) return false;
    }
    if (this.staleOnly && !this.isThreadStale(t.id)) return false;
    return true;
  });
}
```

Note: `staleOnly` filtering requires access to `store.isThreadStale(id)`. Pass `store` to `apply()` as a second parameter: `apply(threads, store?)`.

---

### M45-EXT — Extension Integration

**File:** `src/extension.ts` (additions to existing file)

**Purpose:** Wire the custom panel components into the extension activation lifecycle. Register the `TreeView`, all panel commands, and connect to the existing `CommentStore` and `NativeComments` instances.

| Requirement ID | Requirement |
|---|---|
| M45-EXT-01 | `CommentsPanel` is instantiated in `activate()` after `CommentStore` and `NativeComments` are created |
| M45-EXT-02 | `PanelFilters` created with `context.workspaceState` |
| M45-EXT-03 | `CommentsTreeProvider` created with `store` and `filters` |
| M45-EXT-04 | `vscode.window.createTreeView('accordo-comments-panel', { treeDataProvider: provider, showCollapseAll: true })` called to register the tree |
| M45-EXT-05 | `NavigationRouter` default env wrapping real `vscode` APIs created and passed to command registrations |
| M45-EXT-06 | `registerPanelCommands(context, store, nc, router, filters, provider)` called; all returned disposables pushed to `context.subscriptions` |
| M45-EXT-07 | `TreeView.onDidChangeSelection` handler registered: on selection change, fires `accordo.commentsPanel.navigateToAnchor` with the selected item (single-click navigation) |
| M45-EXT-08 | Tree disposable and provider disposable pushed to `context.subscriptions` |
| M45-EXT-09 | Panel is instantiated regardless of whether the Bridge is available (graceful degradation — same as M40-EXT-02). Panel works as a navigation and triage UI even without MCP tools active. |
| M45-EXT-10 | `package.json` manifest additions (§2.1–2.4) are in place; view `"accordo-comments-panel"` is correctly referenced in both `views` contribution and `menus.view/item/context` |

---

## 4. Non-Requirements (Phase 1 — explicitly out of scope)

- **No WebviewView detail pane.** Full thread conversation with markdown rendering is Phase 2 (M46). See architecture §7.
- **No inline editing in tree.** Replies via `showInputBox` only. Rich text editing deferred.
- **No drag-and-drop** thread reordering.
- **No unread tracking.** Requires a session/user identity concept not currently in the store.
- **No comment search.** Global text search across comment bodies deferred to Phase 3.
- **No bulk actions.** Resolve-all / delete-all deferred.
- **No thread badges on file explorer nodes.** Annotation of the Explorer via `FileDecorationProvider` deferred.
- **No notifications** when agent creates a comment. Deferred to Phase 3 (see architecture §13 comments-architecture.md).
- **No changes to MCP tools.** The panel is presentation only; `accordo.comment.*` tools are unchanged.
- **No changes to `CommentStore`** API or data model.
- **No changes to `NativeComments`** or the `CommentController`. Two-surface strategy is preserved.

---

## 5. Prerequisite Fix

Before TDD for M45 begins, apply the following bug fix to `@accordo/comment-sdk`:

**File:** `packages/comment-sdk/src/sdk.ts`  
**Bug:** `updateThread()` queries `.accordo-pin-badge` but the badge element is created with class `accordo-pin__badge`. Count badges never update on reply.  
**Fix:** Change `.accordo-pin-badge` → `.accordo-pin__badge` (two occurrences in `updateThread()`).  
**Commit:** `fix(comment-sdk): badge selector mismatch in updateThread`

---

## 6. Test Coverage Summary

| Module | Test file | Requirement IDs covered | Approx. test count |
|---|---|---|---|
| M45-TP CommentsTreeProvider | `panel/__tests__/comments-tree-provider.test.ts` | M45-TP-01 → M45-TP-24 | 27 |
| M45-NR NavigationRouter | `panel/__tests__/navigation-router.test.ts` | M45-NR-01 → M45-NR-11 | 11 |
| M45-CMD PanelCommands | `panel/__tests__/panel-commands.test.ts` | M45-CMD-01 → M45-CMD-14 | 18 |
| M45-FLT PanelFilters | `panel/__tests__/panel-filters.test.ts` | M45-FLT-01 → M45-FLT-15 | 21 |
| M45-EXT Extension Integration | `__tests__/extension.test.ts` (additions) | M45-EXT-01 → M45-EXT-10 | 10 |
| **Total** | | | **~87** |

All 197 existing `accordo-comments` tests must remain green after M45 implementation. Test command: `pnpm --filter accordo-comments test 2>&1 | tail -15`.
