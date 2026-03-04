# accordo-comments — Requirements Specification

**Package:** `accordo-comments`  
**Type:** VSCode extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2025-01-01

---

## 1. Purpose

Accordo Comments is the spatial commenting engine for the Accordo IDE. It provides persistent, thread-based commentary anchored to locations in any Accordo surface (source files, diagrams, images, markdown previews, PDFs, slides). Comments are stored as JSON on disk, projected into VS Code's native comment UI, and exposed to AI agents as MCP tools via the Bridge.

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
  /** Absolute file URI (file:///...) */
  uri: string;
  /** Position anchor — line-based for code, block-id for surfaces */
  anchor: LineAnchor | BlockAnchor;
  /** Status of the thread */
  status: "open" | "resolved";
  /** Ordered list of comments */
  comments: Comment[];
  /** ISO 8601 — when the thread was created */
  createdAt: string;
  /** ISO 8601 — last modification timestamp */
  updatedAt: string;
}

interface Comment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

interface LineAnchor {
  kind: "line";
  line: number;     // 0-based
  character: number; // 0-based column
}

interface BlockAnchor {
  kind: "block";
  blockId: string;  // data-block-id attribute value
}
```

### 3.2 Storage

- Threads are persisted as a JSON file at `{workspaceRoot}/.accordo/comments.json`.
- Format: `{ "version": 1, "threads": CommentThread[] }`.
- File is created on first write; never throws if missing (treats as empty).
- All writes are atomic (write to temp file, then rename).

---

## 4. Module Specifications

### M35 — bridge-types Additions (bridge-types package)

**Purpose:** Add comment-specific types to the shared `@accordo/bridge-types` package so all packages can import without circular dependencies.

| Requirement ID | Requirement |
|---|---|
| M35-BT-01 | `CommentThread`, `Comment`, `LineAnchor`, `BlockAnchor` interfaces exported from `@accordo/bridge-types` |
| M35-BT-02 | `SurfaceCoordinates` union exported: `LineCoordinates \| BlockCoordinates \| ImageCoordinates \| DiagramCoordinates \| SlideCoordinates` |
| M35-BT-03 | `BlockCoordinates` — `{ kind: "block"; blockId: string }` |
| M35-BT-04 | All types re-exported from `index.ts`; no runtime code in bridge-types |

---

### M36 — CommentStore

**File:** `src/comment-store.ts`

**Purpose:** Thread-safe CRUD plus event emission for all comment data. Single source of truth for the extension.

| Requirement ID | Requirement |
|---|---|
| M36-CS-01 | `createThread(uri, anchor, body, author?)` creates a new thread with one comment; persists; fires `onChanged(uri)` |
| M36-CS-02 | `reply(threadId, body, author?)` appends a comment; persists; fires `onChanged(uri)` |
| M36-CS-03 | `resolve(threadId)` sets `status: "resolved"` + updates `updatedAt`; persists; fires `onChanged(uri)` |
| M36-CS-04 | `delete(threadId, commentId?)` — if `commentId` omitted, deletes thread; otherwise deletes single comment; persists; fires `onChanged(uri)` |
| M36-CS-05 | `getThreadsForUri(uri)` returns all threads (open + resolved) for the given URI |
| M36-CS-06 | `getAllThreads()` returns all threads across all URIs |
| M36-CS-07 | `getOpenThreadCount()` returns count of threads with `status: "open"` |
| M36-CS-08 | `onChanged` — event emitter called with the affected URI string whenever state changes |
| M36-CS-09 | Loads from disk on construction; no-ops if file is missing/corrupt |
| M36-CS-10 | All mutating methods are async with sequential serialized writes (no concurrent write races) |
| M36-CS-11 | `getWorkspaceRoot()` returns the workspace root path |

---

### M37 — NativeComments

**File:** `src/native-comments.ts`

**Purpose:** Project `CommentStore` threads into VS Code's `vscode.CommentController` so threads appear inline in editors.

| Requirement ID | Requirement |
|---|---|
| M37-NC-01 | Creates a `vscode.CommentController` with id `"accordo-comments"` on activation |
| M37-NC-02 | `refresh(uri)` — clears existing comment threads for URI and re-creates them from store |
| M37-NC-03 | Each `CommentThread` → one `vscode.CommentThread` at the correct line range |
| M37-NC-04 | Each `Comment` in the thread → a `vscode.Comment` with body, author, and timestamp label |
| M37-NC-05 | Thread status `"resolved"` → `vscode.CommentThread.state = Closed` |
| M37-NC-06 | Thread status `"open"` → `vscode.CommentThread.state = Open` |
| M37-NC-07 | `dispose()` disposes the `CommentController` and all active comment threads |
| M37-NC-08 | Subscribes to `CommentStore.onChanged`; calls `refresh(uri)` on each change |
| M37-NC-09 | `BlockAnchor` threads are skipped (no native controller line gutter placement) |

---

### M38 — CommentTools (MCP tools)

**File:** `src/comment-tools.ts`

**Purpose:** Expose thread CRUD as MCP tools so agents can read, create, and manage comment threads.

| Requirement ID | Requirement |
|---|---|
| M38-CT-01 | Tool `accordo.comments.listForUri` — lists all threads for a file URI |
| M38-CT-02 | Tool `accordo.comments.create` — creates a thread with body, URI, and anchor |
| M38-CT-03 | Tool `accordo.comments.reply` — appends a reply to a thread |
| M38-CT-04 | Tool `accordo.comments.resolve` — resolves a thread |
| M38-CT-05 | Tool `accordo.comments.delete` — deletes a thread or a single comment |
| M38-CT-06 | Tool `accordo.comments.listAll` — returns all threads across the workspace |
| M38-CT-07 | All tools return structured JSON matching the CommentThread data model |
| M38-CT-08 | Tools are registered via `bridge.registerTools('accordo-comments', tools)` |
| M38-CT-09 | Tool input schemas include `uri: string`, `threadId: string`, `body: string` as appropriate |

#### Tool Schema: `accordo.comments.listForUri`

```typescript
// Input
{ uri: string }
// Output
{ threads: CommentThread[] }
```

#### Tool Schema: `accordo.comments.create`

```typescript
// Input
{
  uri: string;
  body: string;
  anchor: LineAnchor | BlockAnchor;
  author?: string;
}
// Output
{ thread: CommentThread }
```

#### Tool Schema: `accordo.comments.reply`

```typescript
// Input
{ threadId: string; body: string; author?: string }
// Output
{ thread: CommentThread }
```

#### Tool Schema: `accordo.comments.resolve`

```typescript
// Input
{ threadId: string }
// Output
{ thread: CommentThread }
```

#### Tool Schema: `accordo.comments.delete`

```typescript
// Input
{ threadId: string; commentId?: string }
// Output
{ ok: true }
```

#### Tool Schema: `accordo.comments.listAll`

```typescript
// Input (none)
// Output
{ threads: CommentThread[]; totalOpen: number }
```

---

### M39 — StateContribution

**File:** `src/state-contribution.ts`

**Purpose:** Publish comment state from the CommentStore into the Bridge state cache so the Hub can include comment context in the MCP system prompt.

| Requirement ID | Requirement |
|---|---|
| M39-SC-01 | Calls `bridge.contributeState('comments', stateSnapshot)` whenever store changes |
| M39-SC-02 | State snapshot includes: `{ openThreadCount, recentThreads: CommentThread[] }` |
| M39-SC-03 | `recentThreads` includes up to 10 most-recently-updated open threads |
| M39-SC-04 | Subscribes to `CommentStore.onChanged`; updates Bridge state on every change |
| M39-SC-05 | Pushes initial state on activation (before first change event) |
| M39-SC-06 | Contributes a state key of `"comments"` |

---

### M40 — extension.ts (entry)

**File:** `src/extension.ts`

**Purpose:** Wire all modules together; register with Bridge; handle command contributions.

| Requirement ID | Requirement |
|---|---|
| M40-EXT-01 | Resolves `BridgeAPI` from `accordo.accordo-bridge` extension exports |
| M40-EXT-02 | If Bridge unavailable, extension is inert — no error thrown |
| M40-EXT-03 | Creates `CommentStore` with workspace root |
| M40-EXT-04 | Creates `NativeComments` and wires it to `CommentStore` |
| M40-EXT-05 | Creates `CommentTools` and registers them with Bridge |
| M40-EXT-06 | Creates `StateContribution` and wires it to `CommentStore` + Bridge |
| M40-EXT-07 | Registers all VS Code command handlers (`accordo.comments.*`) |
| M40-EXT-08 | All disposables pushed to `context.subscriptions` |
| M40-EXT-09 | Exposes internal commands for inter-extension calls from `accordo-md-viewer`: `accordo.comments.internal.getThreadsForUri`, `accordo.comments.internal.createSurfaceComment`, `accordo.comments.internal.resolveThread` |
| M40-EXT-10 | `deactivate()` exported (empty implementation) |

---

## 5. Internal Command Protocol

`accordo-comments` exposes internal VS Code commands for consumption by `accordo-md-viewer`:

| Command | Arguments | Returns |
|---|---|---|
| `accordo.comments.internal.getThreadsForUri` | `uri: string` | `CommentThread[]` |
| `accordo.comments.internal.createSurfaceComment` | `{ uri, blockId, body, author? }` | `CommentThread` |
| `accordo.comments.internal.resolveThread` | `threadId: string` | `CommentThread` |

These are `vscode.commands.executeCommand` invocations — not MCP tools.

---

## 6. Test Coverage Summary

| Module | Test file | Req IDs covered |
|---|---|---|
| CommentStore | `src/__tests__/comment-store.test.ts` | M36-CS-01 → M36-CS-11 |
| NativeComments | `src/__tests__/native-comments.test.ts` | M37-NC-01 → M37-NC-09 |
| CommentTools | `src/__tests__/comment-tools.test.ts` | M38-CT-01 → M38-CT-09 |
| StateContribution | `src/__tests__/state-contribution.test.ts` | M39-SC-01 → M39-SC-06 |
| extension (entry) | `src/__tests__/extension.test.ts` | M40-EXT-01 → M40-EXT-10 |

---

## 7. Non-Requirements (explicitly out of scope)

- **No webview rendering** — `accordo-comments` never creates webviews. All richvisual rendering is handled by `accordo-md-viewer`.
- **No markdown parsing** — parsing and block-ID injection belongs to `accordo-md-viewer`.
- **No dependency on `@accordo/comment-sdk`** — the SDK is a webview library; the VS Code host never loads it.
