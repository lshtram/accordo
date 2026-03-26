# accordo-comments — Requirements Specification

**Package:** `accordo-comments`  
**Type:** VSCode extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2025-01-01

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

---

### M38 — CommentTools (MCP tools)

**File:** `src/comment-tools.ts`

**Purpose:** Expose cross-modality thread CRUD as unified MCP tools so agents can read, create, and manage comment threads across text and surface modalities using one API.

| Requirement ID | Requirement |
|---|---|
| M38-CT-01 | Tool `accordo_comment_list` — list thread summaries with filters/pagination and optional modality scope |
| M38-CT-02 | Tool `accordo_comment_get` — get one thread by `threadId` |
| M38-CT-03 | Tool `accordo_comment_create` — create a thread with modality-specific anchor |
| M38-CT-04 | Tool `accordo_comment_reply` — append a reply to a thread |
| M38-CT-05 | Tool `accordo_comment_resolve` — resolve a thread with `resolutionNote` |
| M38-CT-06 | Tool `accordo_comment_reopen` — reopen a resolved thread |
| M38-CT-07 | Tool `accordo_comment_delete` — delete a thread, a single comment, or a scoped browser cleanup |
| M38-CT-08 | All tools return structured JSON matching the CommentThread data model |
| M38-CT-09 | Tools are registered via `bridge.registerTools('accordo-comments', tools)` |
| M38-CT-10 | `accordo_comments_discover` exposes schemas/metadata for the comments tool group |
| M38-CT-11 | Browser comments MUST be reachable through the same unified tools (no separate public `accordo_browser_*` tool family after migration) |

#### Tool Schema: `accordo_comment_list`

```typescript
// Input
{
  scope?: {
    modality?: "text" | "markdown-preview" | "diagram" | "slide" | "image" | "pdf" | "browser";
    uri?: string;
    url?: string;
  };
  uri?: string;
  status?: "open" | "resolved";
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

#### Tool Schema: `accordo_comment_get`

```typescript
// Input
{
  threadId: string;
}
// Output
{ thread: CommentThread }
```

#### Tool Schema: `accordo_comment_create`

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
}
// Output
{ created: true; threadId: string; commentId: string }
```

> **Enhanced anchor keys (Page Understanding):** When `kind` is `"browser"`, `anchorKey`
> accepts both the existing `tagName:siblingIndex:textFingerprint` format (e.g.
> `"button:3:submit"`) and the new strategy-prefixed format (e.g. `"id:submit-btn"`,
> `"data-testid:login-form"`, `"css:main>div>button"`). Strategy-prefixed keys are
> produced by `browser_inspect_element` and offer higher re-anchor stability. See
> `docs/design/page-understanding-architecture.md` §5 for the full anchor strategy
> hierarchy.

#### Tool Schema: `accordo_comment_reply`

```typescript
// Input
{ threadId: string; body: string; commentId?: string }
// Output
{ replied: true; commentId: string }
```

> `commentId` is optional. When provided (e.g. by browser-extension relay), the store
> uses the caller-supplied ID instead of generating a new one, ensuring cross-origin
> ID parity between the browser local store and the Hub/VS Code CommentStore.

#### Tool Schema: `accordo_comment_resolve`

```typescript
// Input
{ threadId: string; resolutionNote: string }
// Output
{ resolved: true; threadId: string }
```

#### Tool Schema: `accordo_comment_reopen`

```typescript
// Input
{ threadId: string }
// Output
{ reopened: true; threadId: string }
```

#### Tool Schema: `accordo_comment_delete`

```typescript
// Input
{
  threadId?: string;
  commentId?: string;
  deleteScope?: {
    modality: "browser";
    all: true;
  };
}
// Output
{ deleted: true; deletedCount?: number }
```

`deleteScope: { modality: "browser", all: true }` is reserved for bulk browser cleanup and is the backend path used by the Comments Panel "Delete All Browser Comments" action.

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
| M40-EXT-09 | Exposes internal commands for inter-extension calls from `accordo-md-viewer`, including `accordo.comments.internal.getStore` |
| M40-EXT-10 | `deactivate()` exported (empty implementation) |
| M40-EXT-11 | Exposes `accordo.comments.internal.getSurfaceAdapter` — a generalized surface adapter command for any surface modality (slides, diagrams, browser, etc.) |
| M40-EXT-12 | Registers panel action command `accordo.commentsPanel.deleteAllBrowserComments` that removes all browser-surface threads after confirmation |
| M40-EXT-13 | Browser-surface threads are included in `CommentsTreeProvider` source so they appear in the shared Accordo Comments Panel |

---

## 5. Internal Command Protocol

`accordo-comments` exposes internal VS Code commands for consumption by other Accordo extensions.

### 5.1 Existing commands (markdown-preview-specific)

| Command | Arguments | Returns |
|---|---|---|
| `accordo.comments.internal.getStore` | none | store adapter `{ createThread, reply, resolve, reopen, delete, getThreadsForUri, onChanged }` — markdown-preview-specific (takes `blockId` + optional `line`) |
| `accordo.comments.internal.getThreadsForUri` | `uri: string` | `CommentThread[]` |
| `accordo.comments.internal.createSurfaceComment` | `{ uri, anchor, body, intent? }` | `CreateCommentResult` |
| `accordo.comments.internal.resolveThread` | `threadId: string` | `void` |

### 5.2 Generalized Surface Adapter (new — M40-EXT-11)

| Command | Arguments | Returns |
|---|---|---|
| `accordo.comments.internal.getSurfaceAdapter` | none | `SurfaceCommentAdapter` (see below) |

The generalized adapter allows **any surface modality** (slides, Excalidraw, browser extension, future surfaces) to create comment threads with full anchor control. Unlike `getStore`, which constructs anchors internally from `blockId`, this adapter lets the caller provide the complete `CommentAnchor`.

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
| Browser (future) | `"browser"` | `NormalizedCoordinates { type: "normalized", x, y }` |

These are `vscode.commands.executeCommand` invocations — not MCP tools.

### 5.3 Backwards compatibility

The existing `getStore` command remains unchanged. `md-viewer` continues to use it. The new `getSurfaceAdapter` is additive — no existing consumers are affected.

---

## 6. Test Coverage Summary

| Module | Test file | Req IDs covered |
|---|---|---|
| CommentStore | `src/__tests__/comment-store.test.ts` | M36-CS-01 → M36-CS-11 |
| NativeComments | `src/__tests__/native-comments.test.ts` | M37-NC-01 → M37-NC-09 |
| CommentTools | `src/__tests__/comment-tools.test.ts` | M38-CT-01 → M38-CT-11 |
| StateContribution | `src/__tests__/state-contribution.test.ts` | M39-SC-01 → M39-SC-06 |
| extension (entry) | `src/__tests__/extension.test.ts` | M40-EXT-01 → M40-EXT-13 |

---

## 7. Non-Requirements (explicitly out of scope)

- **No webview rendering** — `accordo-comments` never creates webviews. All richvisual rendering is handled by `accordo-md-viewer`.
- **No markdown parsing** — parsing and block-ID injection belongs to `accordo-md-viewer`.
- **No dependency on `@accordo/comment-sdk`** — the SDK is a webview library; the VS Code host never loads it.
