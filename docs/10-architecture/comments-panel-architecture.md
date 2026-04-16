# Accordo — Custom Comments Panel Architecture v1.0

**Status:** FINAL  
**Date:** 2026-03-06  
**Scope:** Custom `vscode.TreeView` sidebar panel to replace the built-in VS Code Comments panel as the primary navigation and triage surface for `accordo-comments`.  
**Depends on:** Phase 2 completion (accordo-comments M35–M40-EXT-11), Phase 3 (accordo-slidev M44)  
**References:**
- `docs/30-development/patterns.md` P-12 — root-cause analysis of native Comments panel limitations
- `docs/10-architecture/architecture.md` §12.4 — architectural decision record
- `docs/00-workplan/workplan.md` deferred backlog item #7
- `docs/20-requirements/requirements-comments-panel.md` — module specifications and requirement IDs

---

## 1. Problem Statement

The built-in VS Code Comments panel (`workbench.panel.comments`) has three hard blockers that prevent it from serving as the primary control surface for the Accordo comments workflow.

### 1.1 No extensible context menu

The built-in panel does **not** honour `view/item/context` menu contributions from extensions. That contribution point only works on extension-contributed `TreeView` instances (see `docs/30-development/patterns.md` P-12). The only action available in the built-in panel is VS Code's own "Reply" entry, and only when `widget.canReply` is truthy.

This means the primary actions — resolve, reopen, delete, navigate-to-surface — cannot be placed in the panel right-click menu. Users must hunt for them in the inline gutter widget or command palette.

### 1.2 Navigation is text-editor-only

When a user clicks a thread in the built-in Comments panel, VS Code routes to `editor.revealRange`. For text anchors, this works. For surface-anchored threads (slides, markdown preview blocks), it opens the source `.md` or `.deck.md` file in a plain text editor — not the webview the comment was created in. There is no API hook to intercept or redirect this navigation.

**Confirmed failure case (2026-03-06):** Clicking a `surfaceType: "slide"` comment in the built-in panel opens the `.deck.md` file in markdown preview instead of the running Slidev `WebviewPanel`. The `slideIndex` coordinate is silently ignored.

### 1.3 No access to the `focusInPreview` workaround

The `accordo.comments.focusInPreview` command (registered in `native-comments.ts`) implements three-tier navigation — live webview first, text fallback second, `openWith` third. But the built-in panel cannot invoke this command on item click. There is no click-intercept hook in the `CommentController` API.

### 1.4 Consequence

The native Comments panel cannot be made into the unified control surface required for a human-agent collaboration workflow spanning text files, markdown previews, and slide decks. **A custom `vscode.TreeView` panel is required.**

---

## 2. Solution Overview

Replace the built-in Comments panel as the primary navigation/triage surface with a custom `vscode.TreeView` panel in the Accordo activity bar sidebar. The panel is:

- **Presentation-layer only.** `CommentStore` remains the single source of truth. The panel reads from the store and delegates all mutations to it. No new persistence model.
- **Additive.** The native `CommentController` (gutter icons, inline thread widgets) is kept unchanged. The two-surface strategy (native API for text, Comment SDK for webviews) is preserved. The custom panel is a third navigation surface that wraps the existing data.
- **Within the existing package.** The panel is implemented in `accordo-comments` with direct access to `CommentStore` and `NativeComments`. No inter-extension IPC overhead.
- **Phase 1: TreeView only.** A rich `TreeView` with full context menus, filter state, and anchor-aware navigation. A `WebviewView` detail pane with markdown rendering is deferred to Phase 2.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Accordo Activity Bar Sidebar                                        │
│                                                                      │
│  ┌── Accordo Comments ─────────────────────────────────────────┐    │
│  │  🔍  filter chip: open  [×]           [↻ refresh]  [⋯]      │    │
│  │                                                              │    │
│  │  ▶ Open (3)                                                  │    │
│  │    🔴 line 42 · auth.ts · 🔧 fix · 👤 2m ago  (1)           │    │
│  │    🔴 Slide 4 · arch.deck.md · 🎨 design · 🤖 1h ago  (2)  │    │
│  │    ⚠  heading: Intro · README.md · 👀 review · 👤 3h  (1) │    │
│  │                                                              │    │
│  │  ▶ Resolved (12)                                             │    │
│  │    ✅ line 108 · api.ts · 🔧 fix · 🤖 1d ago  (3)           │    │
│  │    ...                                                       │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Architecture

The panel consists of five components, all living in `packages/comments/src/`:

```
packages/comments/src/
├── extension.ts                     (existing — add CommentsPanel wiring)
├── comment-store.ts                 (existing — unchanged)
├── native-comments.ts               (existing — unchanged)
│
├── panel/
│   ├── comments-tree-provider.ts    ← M45-TP  TreeDataProvider + CommentTreeItem
│   ├── navigation-router.ts         ← M45-NR  anchor-aware navigation dispatch
│   ├── panel-commands.ts            ← M45-CMD resolve/reopen/reply/delete/navigate
│   ├── panel-filters.ts             ← M45-FLT filter state, quick picks, persistence
│   └── __tests__/
│       ├── comments-tree-provider.test.ts
│       ├── navigation-router.test.ts
│       ├── panel-commands.test.ts
│       └── panel-filters.test.ts
```

Extension integration lives in `extension.ts` (M45-EXT), not in a separate file.

### 3.1 CommentsTreeProvider (M45-TP)

Implements `vscode.TreeDataProvider<CommentTreeItem>`.

**Data source:** `store.getAllThreads()` — always reads fresh from the store.

**Grouping (two-level tree):**
- Level 0: Group header items — `"Open (N)"` and `"Resolved (N)"`. Group headers are `TreeItem` with `collapsibleState: Collapsed` (Resolved) or `Expanded` (Open).
- Level 1: `CommentTreeItem` instances — one per `CommentThread`, sorted by `lastActivity` descending within their group.

**Refresh cycle:** Subscribes to `store.onChanged(uri)`. On every notification, fires `this._onDidChangeTreeData.fire(undefined)` (full tree refresh). This is acceptable at 500-thread scale — `getAllThreads()` is an in-memory read, not I/O.

**Filter integration:** Before building tree items, passes the full thread list through `PanelFilters.apply(threads, activeFilters)`. The filtered result is what's rendered.

**`CommentTreeItem` fields:**

| Field | Value |
|---|---|
| `label` | Anchor label (§3.5) + optional ⚠ stale prefix |
| `description` | `"<filename> · <intent emoji>"` e.g. `"auth.ts · 🔧"` |
| `tooltip` | First comment body preview (≤200 chars) + author + timestamp |
| `iconPath` | `$(comment-unresolved)` for open; `$(pass)` for resolved |
| `contextValue` | `"accordo-thread-open"` / `"accordo-thread-resolved"` / `"accordo-thread-stale"` |
| `resourceUri` | File URI (for default file icon decoration; optional) |
| `command` | `accordo.commentsPanel.navigateToAnchor` with `[thread]` arg — fires on single click |

### 3.2 NavigationRouter (M45-NR)

Pure async function module. No class, no state. Takes a `CommentThread` and executes the correct VS Code command to surface the thread's anchor.

**Routing table:**

| `anchor.kind` | `coordinates.type` / `surfaceType` | Action |
|---|---|---|
| `text` | n/a | `showTextDocument(uri, { selection: anchorRange, preserveFocus: false })` |
| `surface` | `markdown-preview` | `executeCommand('accordo.preview.internal.focusThread', uri, threadId, blockId)` |
| `surface` | `slide` | `executeCommand('accordo.presentation.internal.focusThread', uri, threadId, blockId)` — opens deck if needed, navigates to slide, posts `comments:focus` to webview |
| `surface` | `browser` | `executeCommand('accordo.browser.focusThread', threadId)` — no-op if not registered |
| `surface` | `diagram` | `executeCommand('accordo.diagram.focusThread', threadId)` — no-op if not registered (reserved for Phase 5) |
| `file` | n/a | `showTextDocument(uri)` without range |
| any | unknown | fallback to `showTextDocument(uri)` |

**Error contract:** All navigation errors are caught. On failure, `vscode.window.showWarningMessage('Could not navigate to thread: <message>')`. The function never throws.

**"Surface not open" handling:** For slide navigation, the router delegates entirely to `accordo.presentation.internal.focusThread` (contributed by `accordo-marp`). That command owns the full sequencing: open deck if needed → navigate to slide → post `comments:focus` to webview. The router does not perform its own open/settling logic for slides.

**Dependency note:** `accordo-marp` contributes `accordo.presentation.internal.focusThread` as a VS Code command. If the command is not registered (extension not active), the router catches the error and shows a warning message.

### 3.3 PanelCommands (M45-CMD)

Registers VS Code commands. Each command receives a `CommentTreeItem` from the tree context menu (or directly from `tree.onDidChangeSelection`).

**Commands:**

| Command ID | Trigger | Behavior |
|---|---|---|
| `accordo.commentsPanel.navigateToAnchor` | Tree item click (single) | Calls `NavigationRouter.navigateToThread(item.thread)` |
| `accordo.commentsPanel.resolve` | Context menu (open threads) | `showInputBox` for resolution note → `store.resolve()` |
| `accordo.commentsPanel.reopen` | Context menu (resolved threads) | `store.reopen()` |
| `accordo.commentsPanel.reply` | Context menu (all threads) | `showInputBox` for body → `store.reply()` |
| `accordo.commentsPanel.delete` | Context menu (all threads) | `showWarningMessage` confirm dialog → `store.delete()` |
| `accordo.commentsPanel.refresh` | View title toolbar | `provider._onDidChangeTreeData.fire()` |
| `accordo.commentsPanel.filterByStatus` | View title toolbar | `showQuickPick(['open', 'resolved', 'all'])` → `filters.setStatus()` |
| `accordo.commentsPanel.filterByIntent` | View title toolbar | `showQuickPick([...intents])` → `filters.setIntent()` |
| `accordo.commentsPanel.clearFilters` | View title toolbar | `filters.clear()` |

**Store sync:** After every mutation, `PanelCommands` calls both `store.X()` (which fires `onChanged`) AND updates the `NativeComments` widget via the same pattern used in `SurfaceCommentAdapter` (see [`extension.ts` getSurfaceAdapter](../../packages/comments/src/extension.ts)). This ensures gutter widgets stay in sync.

**Idempotency:** Commands that operate on already-resolved/already-open threads show `showInformationMessage` with the current state rather than throwing.

### 3.4 PanelFilters (M45-FLT)

Manages active filter state. Persisted in `context.workspaceState` so filter choices survive VSCode reload.

**Filter state shape:**

```typescript
interface CommentPanelFilters {
  status?: "open" | "resolved";          // undefined = show all
  intent?: CommentIntent;                // undefined = all intents
  authorKind?: "user" | "agent";        // undefined = all authors
  surfaceType?: SurfaceType;             // undefined = all surfaces
  staleOnly?: boolean;                   // false by default
}
```

**`apply(threads, filters)` — pure function, no side effects:**

```typescript
function applyFilters(threads: CommentThread[], f: CommentPanelFilters): CommentThread[] {
  return threads.filter(t => {
    if (f.status && t.status !== f.status) return false;
    if (f.intent) {
      const firstIntent = t.comments[0]?.intent;
      if (firstIntent !== f.intent) return false;
    }
    if (f.authorKind) {
      const lastAuthor = t.comments.at(-1)?.author.kind;
      if (lastAuthor !== f.authorKind) return false;
    }
    if (f.surfaceType && t.anchor.kind === "surface") {
      if ((t.anchor as CommentAnchorSurface).surfaceType !== f.surfaceType) return false;
    }
    if (f.staleOnly && !store.isThreadStale(t.id)) return false;
    return true;
  });
}
```

**View description:** When any filter is active, `CommentsTreeProvider.description` is set to a human-readable summary (e.g., `"Showing: open, fix intent"`). When no filters active, description is empty.

### 3.5 Anchor Label Derivation

The anchor label is the key piece of display information that tells the user *where* a comment was placed. Derived in `CommentsTreeProvider.getAnchorLabel(anchor: CommentAnchor): string`:

| Anchor kind | Coordinates type | Label |
|---|---|---|
| `text` | n/a | `"line {startLine + 1}"` (1-indexed for display) |
| `surface` | `slide` | `"Slide {slideIndex + 1}"` (1-indexed) |
| `surface` | `heading` | `"§ {headingText}"` (truncated to 40 chars) |
| `surface` | `block` | `"block: {blockId}"` (blockId truncated to 30 chars) |
| `surface` | `normalized` | `"({x%}, {y%})"` (percentages) |
| `surface` | `diagram-node` | `"node: {nodeId}"` |
| `surface` | `pdf-page` | `"p{page} ({x%}, {y%})"` |
| `file` | n/a | `"(file-level)"` |

---

## 4. Extension Manifest Changes

The following additions are made to `packages/comments/package.json`:

### 4.1 View Container (reuse existing or create new)

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

If an Accordo activity bar container already exists (e.g., from `accordo-bridge` or `accordo-editor`), the view should be added to that container instead.

### 4.2 View

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

### 4.3 Commands

```json
"commands": [
  { "command": "accordo.commentsPanel.navigateToAnchor",  "title": "Go to Anchor",     "icon": "$(go-to-file)" },
  { "command": "accordo.commentsPanel.resolve",           "title": "Resolve Thread",    "icon": "$(pass)" },
  { "command": "accordo.commentsPanel.reopen",            "title": "Reopen Thread",     "icon": "$(debug-restart)" },
  { "command": "accordo.commentsPanel.reply",             "title": "Reply",             "icon": "$(reply)" },
  { "command": "accordo.commentsPanel.delete",            "title": "Delete Thread",     "icon": "$(trash)" },
  { "command": "accordo.commentsPanel.refresh",           "title": "Refresh",           "icon": "$(refresh)" },
  { "command": "accordo.commentsPanel.filterByStatus",    "title": "Filter by Status",  "icon": "$(filter)" },
  { "command": "accordo.commentsPanel.filterByIntent",    "title": "Filter by Intent",  "icon": "$(tag)" },
  { "command": "accordo.commentsPanel.clearFilters",      "title": "Clear Filters",     "icon": "$(clear-all)" }
]
```

### 4.4 Menus

```json
"menus": {
  "view/title": [
    { "command": "accordo.commentsPanel.refresh",        "when": "view == accordo-comments-panel", "group": "navigation" },
    { "command": "accordo.commentsPanel.filterByStatus", "when": "view == accordo-comments-panel", "group": "navigation" },
    { "command": "accordo.commentsPanel.filterByIntent", "when": "view == accordo-comments-panel", "group": "navigation" },
    { "command": "accordo.commentsPanel.clearFilters",   "when": "view == accordo-comments-panel", "group": "navigation" }
  ],
  "view/item/context": [
    { "command": "accordo.commentsPanel.navigateToAnchor", "when": "view == accordo-comments-panel && viewItem =~ /accordo-thread/", "group": "1_navigate@1" },
    { "command": "accordo.commentsPanel.reply",            "when": "view == accordo-comments-panel && viewItem =~ /accordo-thread/", "group": "2_actions@1" },
    { "command": "accordo.commentsPanel.resolve",          "when": "view == accordo-comments-panel && viewItem == accordo-thread-open || view == accordo-comments-panel && viewItem == accordo-thread-stale", "group": "2_actions@2" },
    { "command": "accordo.commentsPanel.reopen",           "when": "view == accordo-comments-panel && viewItem == accordo-thread-resolved", "group": "2_actions@2" },
    { "command": "accordo.commentsPanel.delete",           "when": "view == accordo-comments-panel && viewItem =~ /accordo-thread/", "group": "3_destructive@1" }
  ]
}
```

---

## 5. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     CommentStore                                │
│  getAllThreads()  isThreadStale(id)  onChanged(→uri)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ onChanged fires on any mutation
                            ▼
              ┌─────────────────────────┐
              │  CommentsTreeProvider   │
              │  - applyFilters()       │
              │  - buildGroupHeaders()  │
              │  - buildTreeItems()     │
              │  - fires onDidChange    │
              └────────────┬────────────┘
                           │ getChildren / getTreeItem
                           ▼
              ┌─────────────────────────┐
              │   vscode.TreeView       │
              │  "accordo-comments-     │
              │   panel"                │
              └─────┬──────────┬────────┘
                    │          │
          item click│          │ context menu
                    ▼          ▼
        ┌───────────────┐  ┌────────────────────┐
        │ Navigation    │  │  PanelCommands      │
        │ Router        │  │  resolve/reopen/    │
        │               │  │  reply/delete       │
        │ routes by     │  │                     │
        │ anchor.kind   │  │  → store.resolve()  │
        └───────────────┘  │  → store.reply()    │
              │            │  → store.reopen()   │
              │            │  → store.delete()   │
              │            └──────────┬──────────┘
              │                       │
              │  commands:            │ store mutation
              │  - showTextDocument   │ → onChanged
              │  - presentation.open  │ → tree refresh
              │  - presentation.goto  │
              │  - preview.focusThread│
              ▼                       ▼
         Surface opens          Store persists
         + thread focused       + native widget synced
```

---

## 6. Coexistence with Native Comments API

The native `vscode.CommentController` (`accordo-comments`) remains fully active:

- **Gutter "+" icon** on all text lines → create new thread → stored → tree shows it
- **Inline thread widget** in text editor → resolve/reopen/delete buttons → store mutates → tree refreshes
- **Comment SDK pins** in webview surfaces → popover actions → store mutates → tree refreshes

The tree panel is additive. It provides navigation and triage that the built-in panel cannot. It does not replace the gutter or inline widget.

The built-in VS Code Comments panel (`workbench.panel.comments`) remains visible but secondary. We cannot hide it via the extension API. Users who prefer the custom sidebar will use it; the built-in panel continues to work for text-only comments.

---

## 7. Phase 2: WebviewView Detail Pane (Deferred)

Phase 1 delivers the TreeView list. Phase 2 adds an optional side panel that shows the full thread conversation when a tree item is selected.

**Design (not implemented in Phase 1):**

```
┌─ Sidebar (TreeView) ─────┐  ┌─ Detail Pane (WebviewView) ───────────┐
│  ▶ Open (3)              │  │  🔴 auth.ts — line 42                  │
│    🔴 line 42 · auth.ts  │◀─│  ─────────────────────────────────     │
│    🔴 Slide 4 · arch…    │  │  👤 Developer · 2 min ago              │
│    ⚠  § Intro · README   │  │  This auth check doesn't handle        │
│                          │  │  expired tokens.                       │
│  ▶ Resolved (12)         │  │                                        │
│    ✅ line 108 · api.ts  │  │  🤖 Agent · 1 min ago                 │
│                          │  │  Added token expiry check with         │
│                          │  │  refresh fallback.                     │
│                          │  │  ─────────────────────────────────     │
│                          │  │  [Reply...]  [Resolve ✅] [Delete 🗑] │
└──────────────────────────┘  └────────────────────────────────────────┘
```

**Implementation note:** The detail pane is a `vscode.WebviewView` registered via `window.registerWebviewViewProvider('accordo-thread-detail', provider)`. It renders thread comments as markdown (reusing the Comment SDK popover HTML patterns). The pane updates via `TreeView.onDidChangeSelection`. This requires an additional `M46-DETAIL` module and is not part of Session 9.

---

## 8. Performance Considerations

At the 500-thread cap:

- `getAllThreads()` is a synchronous in-memory read — negligible cost
- `applyFilters()` is a simple array filter — O(n) over 500 threads, < 1ms
- `getAnchorLabel()` is a pure string derivation — no I/O
- Tree refresh fires on every `onChanged` (every store mutation). Each mutation fires at most once per operation. No debouncing needed at this scale.
- `isThreadStale(id)` is a Map lookup — O(1)

If thread count ever exceeds 500 (store currently refuses new threads at the cap), the tree will need `getChildren` with lazy loading for the Resolved group. Not necessary for Phase 1.

---

## 9. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| `view/item/context` `when` clause regex doesn't match `contextValue` correctly | High | Test `contextValue` strings in integration test; use `=~` regex operator in `when` for partial match |
| `accordo.presentation.open` doesn't exist when slidev is not installed | Medium | Wrap in try/catch; show `showWarningMessage('Slidev extension not active')` |
| 500ms settling delay for slide navigation is too short on slow machines | Medium | Make delay configurable via `context.workspaceState`; document workaround; increase to 800ms if reports come in |
| Filter state in `workspaceState` becomes stale across workspace changes | Low | Always validate persisted filter values against current allowed values on load; reset invalid fields to `undefined` |
| Native Comments panel and custom panel show conflicting state briefly | Low | Both read from same `CommentStore`; any mutation fires `onChanged` which updates both. Race window is sub-millisecond. |
| `TreeView.onDidChangeSelection` fires on programmatic selection | Low | Guard navigation command against programmatic selection using a flag set during tree refresh |

---

## 10. Module Summary

| Module | File | Req doc section |
|---|---|---|
| M45-TP | `panel/comments-tree-provider.ts` | requirements-comments-panel.md §3.1 |
| M45-NR | `panel/navigation-router.ts` | requirements-comments-panel.md §3.2 |
| M45-CMD | `panel/panel-commands.ts` | requirements-comments-panel.md §3.3 |
| M45-FLT | `panel/panel-filters.ts` | requirements-comments-panel.md §3.4 |
| M45-EXT | `extension.ts` (additions) | requirements-comments-panel.md §3.5 |

**Test count target:** ~55 tests (11–13 per module). All existing 197 `accordo-comments` tests must stay green.

**Prerequisite fix (before TDD start):** Apply `fix(comment-sdk): badge selector mismatch in updateThread` — change `.accordo-pin-badge` → `.accordo-pin__badge` in `packages/comment-sdk/src/sdk.ts`.

---

## 11. Strategic Note

The `NavigationRouter` is more than a panel detail. It is the **canonical cross-surface jump mechanism** for all Accordo surfaces. Every future modality — Phase 5 diagrams, Phase 6 browser — needs to expose a `focusThread` command. The router's routing table is the integration contract: each modality registers its command, and the router dispatches to it by `surfaceType`.

This means the custom panel delivers two things, not one: the panel UI, and the navigation infrastructure that all future phases depend on.
