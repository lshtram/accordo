# accordo-comments — Custom Panel Requirements Specification

**Package:** `accordo-comments`  
**Type:** VS Code extension — comments panel replacement  
**Module range:** M45-PJ, M45-WVC, M45-WV, M45-NR, M45-CMD, M45-FLT, M45-EXT  
**Date:** 2026-05-02  
**Architecture references:**
- `docs/10-architecture/comments-panel-architecture.md`
- `docs/10-architecture/comments-panel-webview-contract.md`

---

## 1. Purpose

The custom Accordo Comments Panel is a **`vscode.WebviewView`-based** narrow sidebar panel that replaces the current extension-contributed TreeView as the primary navigation and triage surface for comment threads in the Accordo workspace.

**Why:**
- the built-in VS Code Comments panel cannot route surface comments correctly
- `TreeItem` layout is too constrained for the approved narrow-sidebar inline-conversation UX
- the product now requires file grouping and inline thread expansion inside a single panel

**Approved UX delta from the current TreeView panel:**
- clicking a **thread header/title toggles inline expansion/collapse**
- navigation is triggered by an explicit **Go** action, not by row selection

**Invariants:**
- `CommentStore` remains the single source of truth
- native `CommentController` gutter/widgets remain active and unchanged as a projection
- all existing command IDs remain unchanged
- reply/resolve/reopen/delete semantics remain unchanged
- no second detail pane, no editor-center split, no right pane
- panel behavior must remain keyboard reachable

---

## 2. Extension Manifest Contract

### 2.1 View container and view

The extension continues to contribute the same activity-bar container and the same panel view id:

- container id: `accordo-comments`
- panel view id: `accordo-comments-panel`

The implementation behind that view changes from TreeView registration to `registerWebviewViewProvider(...)`.

### 2.2 Commands

The following command ids remain unchanged and are still the authoritative panel actions:

- `accordo.commentsPanel.navigateToAnchor`
- `accordo.commentsPanel.resolve`
- `accordo.commentsPanel.reopen`
- `accordo.commentsPanel.reply`
- `accordo.commentsPanel.delete`
- `accordo.commentsPanel.refresh`
- `accordo.commentsPanel.filterByStatus`
- `accordo.commentsPanel.filterByIntent`
- `accordo.commentsPanel.clearFilters`
- `accordo.commentsPanel.groupBy`
- `accordo.commentsPanel.deleteAllBrowserComments`

### 2.3 Menu contributions

`view/title` toolbar contributions remain authoritative.

`view/item/context` contributions are no longer relied on for correctness because WebviewView rows are rendered inside webview DOM, not as VS Code tree items. Per-thread actions must therefore be reachable through:

- inline panel action controls
- keyboard focus + activation within the webview
- command palette invocation of the same command ids

---

## 3. Module Specifications

### 3.1 M45-PJ — CommentsPanelProjectionBuilder

**Primary file:** `src/panel/comments-webview-contract.ts` and follow-up builder module  
**Purpose:** produce a pure webview-facing projection from store threads + filters + ephemeral panel UI state.

| Requirement ID | Requirement |
|---|---|
| M45-PJ-01 | Panel projection is derived from `CommentStore` data plus `PanelFilters` plus ephemeral UI state only; it introduces no new persistence model |
| M45-PJ-02 | Projection supports `by-status`, `by-file`, and `by-activity` group modes |
| M45-PJ-03 | `by-file` renders one group per distinct file/URI label; groups are collapsible |
| M45-PJ-04 | Thread rows preserve current metadata semantics: status, stale marker, anchor label, intent, reply count, preview text, last-activity display |
| M45-PJ-05 | Expanded thread projection includes full inline conversation payload for all comments in the thread |
| M45-PJ-06 | Projection remains read-only; all mutations continue through existing commands/store APIs |
| M45-PJ-07 | Header click semantics are projection-aware: expanded/collapsed state is panel UI state, not store state |

### 3.2 M45-WVC — Webview Host↔Webview Contract

**Primary files:**
- `src/panel/comments-webview-contract.ts`
- `docs/10-architecture/comments-panel-webview-contract.md`

| Requirement ID | Requirement |
|---|---|
| M45-WVC-01 | Host→webview messages and webview→host messages use explicit discriminated unions |
| M45-WVC-02 | Contract distinguishes global command invocation from thread-scoped command invocation |
| M45-WVC-03 | Thread-scoped command invocation requires `threadId`; global command invocation must not require `threadId` |
| M45-WVC-04 | Thread header activation toggles inline expansion/collapse only; it must not implicitly navigate |
| M45-WVC-05 | Explicit Go action invokes `accordo.commentsPanel.navigateToAnchor` |
| M45-WVC-06 | Group toggle messages affect only ephemeral UI state; they do not mutate store data |
| M45-WVC-07 | Unknown message types, missing required fields, or invalid command scopes fail safely and must not mutate store state |
| M45-WVC-08 | Host error vocabulary is explicit and limited to documented codes/messages; the host may surface non-fatal panel errors back to the webview |
| M45-WVC-09 | Keyboard contract is explicit: group headers and thread headers are activatable by keyboard; inline actions are tabbable; command palette remains a complete fallback |
| M45-WVC-10 | Contract versioning/runtime-doc impact is documented: this is an internal VS Code webview contract, not a new MCP/public tool contract |

### 3.3 M45-WV — CommentsWebviewViewProvider

**Primary file:** `src/panel/comments-webview-provider.ts`

| Requirement ID | Requirement |
|---|---|
| M45-WV-01 | Exports `CommentsWebviewViewProvider` implementing `vscode.WebviewViewProvider` |
| M45-WV-02 | `resolveWebviewView(...)` configures the webview, loads initial HTML shell, and attaches the message listener |
| M45-WV-03 | On webview ready, host posts initial panel state built from current store/filter/UI state |
| M45-WV-04 | Store changes trigger panel state refresh through the webview provider |
| M45-WV-05 | Filter changes and panel command completions trigger panel state refresh through the same provider path |
| M45-WV-06 | Provider owns ephemeral UI state for expanded threads and collapsed groups |
| M45-WV-07 | Provider does not call store mutation APIs directly in response to rendering; mutations happen only through existing command handlers |
| M45-WV-08 | Message bridge never changes command ids or navigation semantics; it delegates to existing command registrations |

### 3.4 M45-NR — NavigationRouter

**Primary file:** `src/panel/navigation-router.ts`

| Requirement ID | Requirement |
|---|---|
| M45-NR-01 | Exports `async function navigateToThread(thread, env, registry?): Promise<void>` |
| M45-NR-02 | Text anchors open the text document at the anchored range and then execute `accordo_comments_internal_expandThread(threadId)` |
| M45-NR-03 | `surfaceType === "markdown-preview"` dispatches `accordo_preview_internal_focusThread(uri, threadId, blockId)` |
| M45-NR-04 | `surfaceType === "slide"` dispatches `accordo.presentation.internal.focusThread(uri, threadId, blockId)` using canonical slide block id derivation; `accordo_presentation_internal_goto` remains deferred fallback only |
| M45-NR-05 | `surfaceType === "browser"` dispatches `accordo_browser.focusThread(threadId)` |
| M45-NR-06 | `surfaceType === "diagram"` dispatches the diagram focus command for the thread |
| M45-NR-07 | File anchors open the file with `showTextDocument(uri)` |
| M45-NR-08 | Unknown/unrecognised surface targets fall back to `showTextDocument(anchor.uri)` when possible |
| M45-NR-09 | Navigation errors are caught and surfaced as warning messages; the router never throws to callers |
| M45-NR-10 | `NavigationEnv` remains the injectable abstraction over VS Code window/commands/delay/visibility helpers |
| M45-NR-11 | Routing remains command-plan-driven via `buildNavigationDispatchPlan(thread)` |
| M45-NR-12 | Browser disconnect messaging must probe browser health first to avoid false disconnected reports |
| M45-NR-13 | Surface focus command ids remain centralized in one mapping constant, not duplicated in branch logic |
| M45-NR-14 | Markdown text anchors must not steal slide-target navigation when slide hints are present |
| M45-NR-15 | Native comment focus actions must delegate to the same planner/router path |
| M45-NR-16 | User-authored and agent-authored slide threads must resolve to the same focus tuple `(uri, threadId, blockId)` |
| M45-NR-17 | Webview-originated Go actions and native comment focus actions must converge on the same navigation planner/router path |

### 3.5 M45-CMD — PanelCommands

**Primary file:** `src/panel/panel-commands.ts`

| Requirement ID | Requirement |
|---|---|
| M45-CMD-01 | Registers all existing panel command ids and returns disposables for extension subscriptions |
| M45-CMD-02 | `accordo.commentsPanel.navigateToAnchor` accepts a thread-context argument and delegates to `navigateToThread(...)` |
| M45-CMD-03 | `accordo.commentsPanel.resolve` prompts for a resolution note and calls `store.resolve(...)`; already-resolved threads show an info message |
| M45-CMD-04 | `accordo.commentsPanel.reopen` calls `store.reopen(...)`; already-open threads show an info message |
| M45-CMD-05 | `accordo.commentsPanel.reply` performs in-context navigation to the anchor surface and does not use a top-of-screen input box |
| M45-CMD-06 | `accordo.commentsPanel.delete` confirms destructive deletion before calling `store.delete(...)` |
| M45-CMD-07 | `accordo.commentsPanel.refresh` refreshes the panel presentation layer |
| M45-CMD-08 | `accordo.commentsPanel.filterByStatus` quick-picks `open`, `resolved`, or `all` and refreshes the panel |
| M45-CMD-09 | `accordo.commentsPanel.filterByIntent` quick-picks supported intents or `all` and refreshes the panel |
| M45-CMD-10 | `accordo.commentsPanel.clearFilters` clears filter state and refreshes the panel |
| M45-CMD-11 | Store-driven native reconciliation remains authoritative after every panel mutation; correctness must not depend on panel-local widget edits |
| M45-CMD-12 | No-arg command invocation fails gracefully with an info message instructing the user to select a thread first |
| M45-CMD-13 | User-authored mutations continue to use author `{ kind: "user", name: "User" }` |
| M45-CMD-14 | `accordo.commentsPanel.groupBy` quick-picks `by-status`, `by-file`, or `by-activity` and refreshes the panel |
| M45-CMD-15 | Panel commands must be invocable from command palette, inline webview actions, and any legacy tree-origin callers without changing argument semantics |
| M45-CMD-16 | `accordo.commentsPanel.navigateToAnchor` remains explicit navigation; row/header expansion is not a synonym for navigate |

### 3.6 M45-FLT — PanelFilters

**Primary file:** `src/panel/panel-filters.ts`

| Requirement ID | Requirement |
|---|---|
| M45-FLT-01 | Exports `class PanelFilters` |
| M45-FLT-02 | Constructor accepts `vscode.Memento` for persistence |
| M45-FLT-03 | Filter state shape remains `{ status?, intent?, authorKind?, surfaceType?, staleOnly?, groupMode? }` |
| M45-FLT-04 | `apply(threads, store?)` remains pure and must not mutate its input |
| M45-FLT-05 | `setStatus(...)` persists status filter state |
| M45-FLT-06 | `setIntent(...)` persists intent filter state |
| M45-FLT-07 | `setAuthorKind(...)` persists author-kind filter state |
| M45-FLT-08 | `setSurfaceType(...)` persists surface-type filter state |
| M45-FLT-09 | `setStaleOnly(...)` persists stale-only filter state |
| M45-FLT-10 | `clear()` resets filters to defaults while preserving valid group mode |
| M45-FLT-11 | `getSummary()` returns a human-readable active-filter summary or empty string |
| M45-FLT-12 | `isActive()` returns whether any non-default filter is active |
| M45-FLT-13 | Persisted filter state loads from `accordo.commentsPanel.filters` and invalid persisted values are discarded safely |
| M45-FLT-14 | `groupMode` getter defaults to `by-status` |
| M45-FLT-15 | `setGroupMode(...)` persists a valid grouping mode |

### 3.7 M45-EXT — Extension Integration

**Primary integration files:** `src/comments-bootstrap.ts`, `src/panel-bootstrap.ts`

| Requirement ID | Requirement |
|---|---|
| M45-EXT-01 | Panel wiring occurs after `CommentStore` and `NativeComments` are created |
| M45-EXT-02 | `PanelFilters` is created with `context.workspaceState` |
| M45-EXT-03 | A webview provider is created with store/filter/command bridge dependencies |
| M45-EXT-04 | `vscode.window.registerWebviewViewProvider('accordo-comments-panel', provider)` registers the panel |
| M45-EXT-05 | Existing command registrations remain the mutation/navigation authority |
| M45-EXT-06 | Webview message handling routes actions either to ephemeral UI-state updates or to existing command ids |
| M45-EXT-07 | No `TreeView.onDidChangeSelection` navigation path is required for correctness |
| M45-EXT-08 | Panel instantiates even without bridge/MCP availability |
| M45-EXT-09 | Package manifest still references the same `accordo-comments-panel` view id and the same command ids |

---

## 4. Non-Requirements

- no second detail pane
- no inline panel-owned reply composer as the authoritative reply path
- no new comments MCP tool family
- no alternate source of truth
- no bespoke panel↔widget sync protocol outside the canonical store→native reconcile path
- no drag-and-drop, unread tracking, explorer badges, or global comment search in this slice

---

## 5. Proof Plan / Test Coverage Summary

| Module / contract | Proof surface |
|---|---|
| M45-PJ projection derivation | unit |
| M45-WVC message contract, invalid-message handling, command-scope validation | unit |
| M45-WV provider registration, ready-message bootstrap, postMessage refresh path | package integration |
| M45-NR router parity from webview-originated Go action | unit + package integration |
| M45-CMD unchanged command semantics from panel bridge | package integration |
| M45-FLT persistence and filtering | unit |
| M45-EXT activation wiring with `registerWebviewViewProvider(...)` | package integration |
| Real panel rendering + message bridge + runtime command path | production-boundary proof |

### Mandatory production-boundary proof

At least one real VS Code extension-host proof must verify all of the following together:

1. `accordo-comments-panel` is registered through `registerWebviewViewProvider(...)`
2. the panel webview boots and sends/receives its ready/state bridge messages
3. clicking or keyboard-activating a thread header expands inline rather than navigating
4. clicking or keyboard-activating **Go** invokes the existing navigation command path
5. resolve/reopen/delete/reply from the panel still converge through `CommentStore` into native gutter/widget state

### Could mocked tests pass while real use still fail?

Yes — if CSP/bootstrap/postMessage wiring breaks, mocked unit tests could still pass. Therefore the real extension-host boundary proof above is required and cannot be replaced by mocks alone.
