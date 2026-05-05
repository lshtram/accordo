# accordo-comments — Requirements Specification

**Package:** `accordo-comments`  
**Type:** VSCode extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-04-21

---

## 1. Purpose

Accordo Comments is the spatial commenting engine for the Accordo IDE. It provides persistent, thread-based commentary anchored to locations in any Accordo surface (source files, diagrams, images, markdown previews, PDFs, slides, browser pages). Comments are stored as JSON on disk, projected into VS Code's native comment UI / Accordo Comments Panel, and exposed to AI agents as unified MCP tools via the Bridge.

---

## 2. Extension Manifest Contract

```json
{
  "name": "accordo-comments",
  "displayName": "Accordo IDE Comments",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "extensionDependencies": ["accordo.accordo-bridge"],
  "main": "./dist/extension.js"
}
```

### Contributed commands

| Command ID | Title | Menu context |
|---|---|---|
| `accordo.comments.new` | Accordo: New Comment | `comments/commentThread/context` |
| `accordo.comments.resolveThread` | Resolve | `comments/commentThread/title` (open threads) |
| `accordo.comments.deleteThread` | Delete Thread | `comments/commentThread/title` |
| `accordo.comments.deleteComment` | Delete Comment | `comments/comment/title` |
| `accordo.comments.reopenThread` | Reopen | `comments/commentThread/title` (resolved threads) |
| `accordo.comments.resolveFromComment` | Resolve Thread | `comments/comment/context` (open threads) |
| `accordo.comments.reopenFromComment` | Reopen Thread | `comments/comment/context` (resolved threads) |

---

## 3. Data Model

### 3.1 CommentThread

```typescript
interface CommentThread {
  /** UUID — stable across edits */
  id: string;
  /** Position anchor — text range, surface coordinate, or whole-file */
  anchor: CommentAnchor;
  /** Status of the thread */
  status: "open" | "resolved";
  /** Ordered list of comments */
  comments: AccordoComment[];
  /** ISO 8601 — when the thread was created */
  createdAt: string;
  /** ISO 8601 — last activity timestamp */
  lastActivity: string;
}

interface AccordoComment {
  id: string;
  threadId: string;
  body: string;
  author: { kind: "user" | "agent"; name: string; agentId?: string };
  createdAt: string;
  anchor: CommentAnchor;
  intent?: "fix" | "explain" | "refactor" | "review" | "design" | "question";
  status: "open" | "resolved";
  resolutionNote?: string;
  context?: CommentContext;
}
```

### 3.2 Storage

- Threads are persisted as a JSON file at `{workspaceRoot}/.accordo/comments.json`.
- Format: `{ "version": "1.0", "threads": CommentThread[] }`.
- File is created on first write; never throws if missing (treats as empty).
- Writes are done through `vscode.workspace.fs.writeFile` on each mutation.

---

## 4. Module Specifications

### M35 — bridge-types Additions (bridge-types package)

**Purpose:** Add comment-specific types to the shared `@accordo/bridge-types` package so all packages can import without circular dependencies.

| Requirement ID | Requirement |
|---|---|
| M35-BT-01 | `CommentAnchor` union (`text` \| `surface` \| `file`) and full comment/thread types exported from `@accordo/bridge-types` |
| M35-BT-02 | `SurfaceCoordinates` union includes `BlockCoordinates` for markdown-preview anchors |
| M35-BT-03 | `BlockCoordinates` — `{ type: "block"; blockId: string; blockType: ... }` |
| M35-BT-04 | All types re-exported from `index.ts`; no runtime code in bridge-types |

---

### M36 — CommentStore

**File:** `src/comment-store.ts`

**Purpose:** Thread-safe CRUD plus event emission for all comment data. Single source of truth for the extension.

| Requirement ID | Requirement |
|---|---|
| M36-CS-01 | `createThread(uri, anchor, body, author?)` creates a new thread with one comment; persists; fires `onChanged(uri)` |
| M36-CS-02 | `reply(threadId, body, author?)` appends a comment; persists; fires `onChanged(uri)` |
| M36-CS-03 | `resolve(threadId)` sets `status: "resolved"` + updates `lastActivity`; persists; fires `onChanged(uri)` |
| M36-CS-04 | `delete(threadId, commentId?)` — if `commentId` omitted, deletes thread; otherwise deletes single comment; persists; fires `onChanged(uri)` |
| M36-CS-05 | `getThreadsForUri(uri)` returns all threads (open + resolved) for the given URI |
| M36-CS-06 | `getAllThreads()` returns all threads across all URIs |
| M36-CS-07 | `getCounts()` returns `{ open, resolved }` counts |
| M36-CS-08 | `onChanged` — event emitter called with the affected URI string whenever state changes |
| M36-CS-09 | `load(workspaceRoot)` loads from disk; missing/corrupt file results in empty in-memory state |
| M36-CS-10 | All mutating methods are async and persist after each mutation |
| M36-CS-11 | `getWorkspaceRoot()` returns the workspace root path |
| M36-CS-12 | Persisted store data is validated at load time before entering runtime state; threads/comments with empty IDs, duplicate IDs, or mismatched `comment.threadId !== thread.id` are dropped with a validation report |
| M36-CS-13 | Mutation boundaries validate caller-supplied IDs before repository mutation so empty/whitespace thread/comment IDs never enter runtime state |

#### Validation contract (load-time and mutation boundaries)

- **Trim rule:** For validation purposes, `threadId` and `commentId` are trimmed first. `undefined` means "not caller-supplied" and is allowed where the schema marks the field optional; `""` or whitespace-only values are invalid.
- **Load-time duplicate precedence (M36-CS-12):** Validation walks persisted data in file order. **First retained occurrence wins; later duplicates are dropped.** This applies to duplicate thread IDs and duplicate comment IDs.
- **Load-time thread precedence:** A thread with an invalid/whitespace-only thread ID is dropped before comment-level validation. For a retained thread, comments are validated in array order.
- **Load-time comment precedence:** For each persisted comment, issue precedence is: `empty-comment-id` → `mismatched-comment-thread-id` → `duplicate-comment-id`. The first matching issue code is the one reported for that dropped comment.
- **Empty-thread-after-sanitization rule:** If all comments in a persisted thread are dropped during validation, the thread is dropped from runtime state as well; the validation report still contains the original per-item issues that caused the drop.
- **Validation report visibility:** The load path must retain a machine-checkable validation report surface so tests can assert which persisted items were retained vs dropped.

#### Mutation validation contract (M36-CS-13)

- **Stable error vocabulary:** Validation/domain failures at comment mutation boundaries MUST reject/throw an `Error` whose `message` is one of these stable codes: `invalid-thread-id`, `invalid-comment-id`, `duplicate-thread-id`, `duplicate-comment-id`, `thread-not-found`, `comment-not-found`, `thread-already-resolved`, `thread-not-resolved`.
- **Precedence rule:** When multiple failures could apply, validation errors win over lookup/state errors, and lookup/state errors win over downstream domain limits/persistence work.
- **`comment_create` precedence:** validate optional caller-supplied `threadId` first, then optional caller-supplied `commentId`, then reject duplicate `threadId`, then reject duplicate `commentId`; only after those checks may creation proceed.
- **`comment_reply` precedence:** validate `threadId`, then optional `commentId`, then check `thread-not-found`, then reject duplicate `commentId`; only then may reply/comment-limit logic proceed.
- **`comment_resolve` precedence:** validate `threadId`, then check `thread-not-found`, then `thread-already-resolved`.
- **`comment_reopen` precedence:** validate `threadId`, then check `thread-not-found`, then `thread-not-resolved`.
- **`comment_delete` precedence:** bulk forms (`all: true` or `deleteScope: { all: true }`) bypass per-thread ID validation. Otherwise validate `threadId`, then optional `commentId`, then check `thread-not-found`, then `comment-not-found` if deleting a single comment. A whitespace-only `commentId` is rejected as `invalid-comment-id`; it is **not** treated as "delete whole thread".

---

### M37 — NativeComments

**File:** `src/native-comments.ts`

**Purpose:** Project `CommentStore` threads into VS Code's `vscode.CommentController` so threads appear inline in editors.

| Requirement ID | Requirement |
|---|---|
| M37-NC-01 | Creates a `vscode.CommentController` with id `"accordo-comments"` on activation |
| M37-NC-02 | `restoreThreads(threads)` recreates widgets from persisted store threads on activation |
| M37-NC-03 | Each `CommentThread` → one `vscode.CommentThread`; text anchors map to exact VS Code ranges |
| M37-NC-04 | Each store comment is projected into a `vscode.Comment` with markdown body, author, label and timestamp |
| M37-NC-05 | Thread status `"resolved"` → `vscode.CommentThread.state = Resolved`, collapsed and read-only |
| M37-NC-06 | Thread status `"open"` → `vscode.CommentThread.state = Unresolved`, reply enabled |
| M37-NC-07 | `removeThread(threadId)` disposes the widget and removes it from internal mapping |
| M37-NC-08 | Provides command handlers (`resolve/reopen/delete`) that mutate `CommentStore` then update widgets |
| M37-NC-09 | Non-text anchors are created without a concrete text range; text anchors render at their exact range |
| M37-NC-10 | `CommentStore` is the only source of truth; native widget state is a disposable projection and must never be treated as authoritative data |
| M37-NC-11 | `reconcile(storeThreads)` disposes widgets whose IDs are absent from the store, creates widgets missing from the widget map, updates widgets whose comments/status/range changed, and never creates duplicate widgets for an existing thread ID |
| M37-NC-12 | Activation wires one store-driven reconciliation path (`store.onChanged` → native projection reconcile) so MCP tools, native commands, panel commands, startup prune/restore, and other store mutations converge through the same sync path |
| M37-NC-13 | Text-document staleness/range shifts are propagated to native widgets through reconciliation or an equivalent exact projection update driven from store state |
| M37-NC-14 | Exposes an internal sync diagnostic surface returning store thread IDs, native widget IDs, missing-widget IDs, orphan-widget IDs, and an `inSync` boolean for tests/debugging |

---

### M38 — CommentTools (MCP tools)

**File:** `src/comment-tools.ts`

**Purpose:** Expose cross-modality thread CRUD as unified MCP tools so agents can read, create, and manage comment threads across text and surface modalities using one API.

| Requirement ID | Requirement |
|---|---|
| M38-CT-01 | Tool `comment_list` — list thread summaries with filters/pagination and optional modality scope; no filters, or `status: "all"`, returns open and resolved threads |
| M38-CT-02 | Tool `comment_get` — get one thread by `threadId` |
| M38-CT-03 | Tool `comment_create` — create a thread with modality-specific anchor |
| M38-CT-04 | Tool `comment_reply` — append a reply to a thread |
| M38-CT-05 | Tool `comment_resolve` — resolve a thread with `resolutionNote` |
| M38-CT-06 | Tool `comment_reopen` — reopen a resolved thread |
| M38-CT-07 | Tool `comment_delete` — delete a thread, a single comment, a scoped modality cleanup, or every thread with `all: true` |
| M38-CT-08 | All tools return structured JSON matching the CommentThread data model |
| M38-CT-09 | Tools are registered via `bridge.registerTools('accordo-comments', tools)` |
| M38-CT-10 | `comment_sync_version` exposes store version and thread count for sync drift detection |
| M38-CT-11 | Browser comments MUST be reachable through the same unified tools (no separate public `accordo_browser_*` tool family after migration) |

#### Canonical MCP tool inventory (8 tools)

- `comment_list`
- `comment_get`
- `comment_create`
- `comment_reply`
- `comment_resolve`
- `comment_reopen`
- `comment_delete`
- `comment_sync_version`

> `comment_list` is summary-only. The optional `detail` flag is deprecated and
> ignored for compatibility. Use `comment_get({ threadId })` for full
> `CommentThread` payloads.

#### Tool Schema: `comment_list`

```typescript
// Input
{
  scope?: {
    modality?: "text" | "markdown-preview" | "diagram" | "slide" | "image" | "pdf" | "browser";
    uri?: string;
    url?: string;
  };
  uri?: string;
  status?: "open" | "resolved" | "all";
  intent?: "fix" | "explain" | "refactor" | "review" | "design" | "question";
  anchorKind?: "text" | "surface" | "file";
  updatedSince?: string;
  lastAuthor?: "user" | "agent";
  limit?: number;
  offset?: number;
}
// Output
{ threads: ThreadSummary[]; total: number; hasMore: boolean }
```

#### Tool Schema: `comment_get`

```typescript
// Input
{
  threadId: string;
}
// Output
{ success: true; thread: CommentThread }
```

#### Tool Schema: `comment_create`

```typescript
// Input
{
  scope: {
    modality: "text" | "markdown-preview" | "diagram" | "slide" | "image" | "pdf" | "browser";
    uri?: string;
    url?: string;
  };
  uri?: string;
  anchor:
    | { kind: "text"; startLine: number; endLine?: number }
    | { kind: "file" }
    | { kind: "surface"; surfaceType: string; coordinates: Record<string, unknown> }
    | { kind: "browser"; anchorKey?: string };
  body: string;
  intent?: "fix" | "explain" | "refactor" | "review" | "design" | "question";
  threadId?: string;   // optional caller-supplied ID for cross-surface parity
  commentId?: string;  // optional caller-supplied first-comment ID
  context?: Record<string, unknown>; // optional surfaceMetadata, diagnostics, etc.
  authorKind?: "user" | "agent";
  authorName?: string;
  agentId?: string;
}
// Output
{ success: true; created: true; threadId: string; commentId: string }
```

> **Enhanced anchor keys (Page Understanding):** When `kind` is `"browser"`, `anchorKey`
> accepts both the existing `tagName:siblingIndex:textFingerprint` format (e.g.
> `"button:3:submit"`) and the new strategy-prefixed format (e.g. `"id:submit-btn"`,
> `"data-testid:login-form"`, `"css:main>div>button"`). Strategy-prefixed keys are
> produced by `accordo_browser_inspect_element` and offer higher re-anchor stability. See
> `docs/design/page-understanding-architecture.md` §5 for the full anchor strategy
> hierarchy.

#### Tool Schema: `comment_reply`

```typescript
// Input
{ threadId: string; body: string; commentId?: string; authorKind?: "user" | "agent"; authorName?: string; agentId?: string }
// Output
{ success: true; replied: true; commentId: string }
```

> `commentId` is optional. When provided (e.g. by browser-extension relay), the store
> uses the caller-supplied ID instead of generating a new one, ensuring cross-origin
> ID parity between the browser local store and the Hub/VS Code CommentStore.
>
> Validation contract: if `commentId` is supplied here, whitespace-only values reject with
> `invalid-comment-id`; duplicate IDs reject with `duplicate-comment-id`; omitted values are
> generated by the store.

#### Tool Schema: `comment_resolve`

```typescript
// Input
{ threadId: string; resolutionNote: string; agentId?: string }
// Output
{ success: true; resolved: true; threadId: string }
```

#### Tool Schema: `comment_reopen`

```typescript
// Input
{ threadId: string; agentId?: string }
// Output
{ success: true; reopened: true; threadId: string }
```

#### Tool Schema: `comment_delete`

```typescript
// Input
{
  threadId?: string;
  commentId?: string;
  all?: true;
  deleteScope?: {
    modality?: "text" | "markdown-preview" | "diagram" | "slide" | "image" | "pdf" | "browser";
    all: true;
  };
}
// Output
{ success: true; deleted: true; deletedCount?: number }
```

Use `all: true` or `deleteScope: { all: true }` to delete every thread across modalities.
Use `deleteScope: { modality, all: true }` to bulk-delete one modality; browser cleanup uses `modality: "browser"`.

#### Observable mutation error behavior (tool/runtime surface)

- `comment_create`, `comment_reply`, `comment_resolve`, `comment_reopen`, and `comment_delete` surface the stable validation/domain codes above without remapping them to tool-specific wording.
- Internal command adapters and other package-internal mutation entrypoints MUST preserve the same observable error codes so unit tests and package-integration tests can assert identical behavior across MCP and VS Code command boundaries.

---

### M39 — StateContribution

**File:** `src/state-contribution.ts`

**Purpose:** Publish comment state from the CommentStore into the Bridge state cache so the Hub can include comment context in the MCP system prompt.

| Requirement ID | Requirement |
|---|---|
| M39-SC-01 | Calls `bridge.publishState('accordo-comments', stateSnapshot)` whenever store changes |
| M39-SC-02 | State snapshot includes `{ isOpen, openThreadCount, resolvedThreadCount, summary[] }` |
| M39-SC-03 | `summary` includes up to 10 most-recently-active open threads |
| M39-SC-04 | Subscribes to `CommentStore.onChanged`; publishes on every change |
| M39-SC-05 | Pushes initial state on activation (before first change event) |
| M39-SC-06 | Publishes under extension id `"accordo-comments"` |

---

### M40 — extension.ts (entry)

**File:** `src/extension.ts`

**Purpose:** Wire all modules together; register with Bridge; handle command contributions.

| Requirement ID | Requirement |
|---|---|
| M40-EXT-01 | Resolves `BridgeAPI` from `accordo.accordo-bridge` extension exports |
| M40-EXT-02 | If Bridge unavailable, extension still provides native comments; MCP tools/state publishing are disabled |
| M40-EXT-03 | Creates `CommentStore` with workspace root |
| M40-EXT-04 | Creates `NativeComments` and wires it to `CommentStore` |
| M40-EXT-05 | Creates `CommentTools` and registers them with Bridge |
| M40-EXT-06 | Creates `StateContribution` and wires it to `CommentStore` + Bridge |
| M40-EXT-07 | Registers all VS Code command handlers (`accordo.comments.*`) |
| M40-EXT-08 | All disposables pushed to `context.subscriptions` |
| M40-EXT-09 | Exposes internal commands for inter-extension calls from `accordo-md-viewer`, including `accordo_comments_internal_getStore` |
| M40-EXT-10 | `deactivate()` exported (empty implementation) |
| M40-EXT-11 | Exposes `accordo_comments_internal_getSurfaceAdapter` — a generalized surface adapter command for any surface modality (slides, diagrams, browser, etc.) |
| M40-EXT-12 | Registers panel action command `accordo.commentsPanel.deleteAllBrowserComments` that removes all browser-surface threads after confirmation |
| M40-EXT-13 | Browser-surface threads are included in `CommentsTreeProvider` source so they appear in the shared Accordo Comments Panel |
| M40-EXT-14 | Registers `accordo_comments_internal_getSyncState` for diagnostics/tests; the command reports store/native projection drift without mutating state |

---

## 5. Internal Command Protocol

`accordo-comments` exposes internal VS Code commands for consumption by other Accordo extensions.

### 5.1 Existing commands (markdown-preview-specific)

| Command | Arguments | Returns |
|---|---|---|
| `accordo_comments_internal_getStore` | none | store adapter `{ createThread, reply, resolve, reopen, delete, getThreadsForUri, onChanged }` — markdown-preview-specific (takes `blockId` + optional `line`) |
| `accordo_comments_internal_getThreadsForUri` | `uri: string` | `CommentThread[]` |
| `accordo_comments_internal_createSurfaceComment` | `{ uri, anchor, body, intent? }` | `CreateCommentResult` |
| `accordo_comments_internal_resolveThread` | `threadId: string` | `void` |
| `accordo_comments_internal_getSyncState` | none | `{ storeThreadIds, nativeWidgetIds, missingWidgetIds, orphanWidgetIds, inSync }` |

### 5.2 Generalized Surface Adapter (new — M40-EXT-11)

| Command | Arguments | Returns |
|---|---|---|
| `accordo_comments_internal_getSurfaceAdapter` | none | `SurfaceCommentAdapter` (see below) |

The generalized adapter allows **any surface modality** (slides, Excalidraw, browser extension, and additional surfaces) to create comment threads with full anchor control. Unlike `getStore`, which constructs anchors internally from `blockId`, this adapter lets the caller provide the complete `CommentAnchor`.

```ts
interface SurfaceCommentAdapter {
  createThread(args: {
    uri: string;
    anchor: CommentAnchor;     // caller constructs the full anchor
    body: string;
    intent?: string;
  }): Promise<CommentThread>;
  reply(args: { threadId: string; body: string }): Promise<void>;
  resolve(args: { threadId: string; resolutionNote?: string }): Promise<void>;
  reopen(args: { threadId: string }): Promise<void>;
  delete(args: { threadId: string; commentId?: string }): Promise<void>;
  getThreadsForUri(uri: string): CommentThread[];
  onChanged(listener: (uri: string) => void): { dispose(): void };
}
```

**Modality anchor examples:**

| Surface | surfaceType | Coordinates |
|---|---|---|
| Markdown preview | `"markdown-preview"` | `BlockCoordinates { type: "block", blockId, blockType }` |
| Slides | `"slide"` | `SlideCoordinates { type: "slide", slideIndex, x, y }` |
| Excalidraw (Phase 5) | `"diagram"` | `DiagramNodeCoordinates { type: "diagram-node", nodeId }` |
| Browser | `"browser"` | `NormalizedCoordinates { type: "normalized", x, y }` |

These are `vscode.commands.executeCommand` invocations — not MCP tools.

### 5.3 Backwards compatibility

The existing `getStore` command remains unchanged. `md-viewer` continues to use it. The new `getSurfaceAdapter` is additive — no existing consumers are affected.

---

## 6. Test Coverage Summary

| Module | Test file | Req IDs covered |
|---|---|---|
| CommentStore | `src/__tests__/comment-store.test.ts` | M36-CS-01 → M36-CS-13 |
| NativeComments | `src/__tests__/native-comments.test.ts` | M37-NC-01 → M37-NC-14 |
| CommentTools | `src/__tests__/comment-tools.test.ts` | M38-CT-01 → M38-CT-11 |
| StateContribution | `src/__tests__/state-contribution.test.ts` | M39-SC-01 → M39-SC-06 |
| extension (entry) | `src/__tests__/extension.test.ts` | M40-EXT-01 → M40-EXT-14 |

---

## 7. Non-Requirements (explicitly out of scope)

- **No webview rendering** — `accordo-comments` never creates webviews. Rich visual rendering is handled by host surface extensions (`accordo-md-viewer`, `accordo-marp`, `accordo-diagram`, browser extension UI).
- **No markdown parsing** — parsing and block-ID injection belongs to `accordo-md-viewer`.
- **No dependency on `@accordo/comment-sdk`** — the SDK is a webview library; the VS Code host never loads it.
