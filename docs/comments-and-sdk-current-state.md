# Comments + Comment SDK Guide (Current Code State)

## Scope

This guide describes how comments work today across these packages:

- `@accordo/bridge-types`: canonical shared types
- `accordo-comments`: persistence, native VS Code integration, MCP tools
- `accordo-md-viewer`: markdown webview + bridge to comment store
- `@accordo/comment-sdk`: webview-side pin and popover UI

This is intentionally code-first. It documents what is implemented now.

## Canonical Data Structures

### 1) Anchor model (`@accordo/bridge-types`)

A thread/comment can be anchored in three ways via `CommentAnchor`:

- `CommentAnchorText`
- `CommentAnchorSurface`
- `CommentAnchorFile`

```ts
export type CommentAnchor =
  | CommentAnchorText
  | CommentAnchorSurface
  | CommentAnchorFile;

export interface CommentAnchorText {
  kind: "text";
  uri: string;
  range: { startLine: number; startChar: number; endLine: number; endChar: number };
  docVersion: number;
}

export interface CommentAnchorSurface {
  kind: "surface";
  uri: string;
  surfaceType: "diagram" | "image" | "pdf" | "markdown-preview" | "slide" | "browser";
  coordinates: SurfaceCoordinates;
}

export interface CommentAnchorFile {
  kind: "file";
  uri: string;
}
```

For markdown preview block pins, surface coordinates use `BlockCoordinates`:

```ts
export interface BlockCoordinates {
  type: "block";
  blockId: string;
  blockType: "heading" | "paragraph" | "list-item" | "code-block";
}
```

### 2) Comment/thread model (`@accordo/bridge-types`)

```ts
export interface AccordoComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user" | "agent"; name: string; agentId?: string };
  body: string;
  anchor: CommentAnchor;
  intent?: "fix" | "explain" | "refactor" | "review" | "design" | "question";
  status: "open" | "resolved";
  resolutionNote?: string;
  context?: CommentContext;
}

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  comments: AccordoComment[];
  status: "open" | "resolved";
  createdAt: string;
  lastActivity: string;
}
```

### 3) SDK-facing thread model (`@accordo/comment-sdk`)

The webview SDK does not receive full `CommentThread`. It receives `SdkThread`:

```ts
export interface SdkThread {
  id: string;
  blockId: string;
  status: "open" | "resolved";
  hasUnread: boolean;
  comments: Array<{
    id: string;
    author: { kind: "user" | "agent"; name: string };
    body: string;
    createdAt: string;
  }>;
}
```

## Storage and Source of Truth

## CommentStore is the source of truth

`accordo-comments/src/comment-store.ts` owns all persistent state.

- In-memory: `Map<string, CommentThread>`
- Persistence file: `{workspaceRoot}/.accordo/comments.json`
- On-disk type: `CommentStoreFile`

Current file shape:

```json
{
  "version": "1.0",
  "threads": [
    {
      "id": "...",
      "anchor": { "kind": "text|surface|file", "...": "..." },
      "comments": [
        {
          "id": "...",
          "threadId": "...",
          "createdAt": "2026-03-05T...Z",
          "author": { "kind": "user", "name": "You" },
          "body": "...",
          "anchor": { "kind": "..." },
          "status": "open"
        }
      ],
      "status": "open",
      "createdAt": "2026-03-05T...Z",
      "lastActivity": "2026-03-05T...Z"
    }
  ]
}
```

Notes:

- Writes happen on each mutation (`createThread`, `reply`, `resolve`, `reopen`, `delete`).
- `onDocumentChanged` can shift text-anchor lines and persists those shifts.
- Change notifications are URI-scoped via `onChanged(listener: (uri: string) => void)`.

## How Native VS Code Comments and SDK Comments Stay Unified

Both UIs operate on the same `CommentStore` instance.

### A) Text-side flow (native VS Code thread UI)

1. User adds/replies/resolves/deletes via VS Code comment UI.
2. `NativeComments` command handlers call `CommentStore`.
3. `CommentStore` persists and emits `onChanged(uri)`.
4. Native widgets update (`NativeComments.updateThread` / `removeThread`).
5. `PreviewBridge` (if a preview is open for that URI) receives change event and pushes fresh `comments:load` to SDK.

### B) Webview-side flow (SDK)

1. User Alt+clicks a markdown block with `data-block-id`.
2. SDK posts `comment:create` (or reply/resolve/reopen/delete) to host.
3. `PreviewBridge.handleMessage` translates and calls store adapter from `accordo-comments`.
4. Adapter creates/updates in `CommentStore`, persists, emits `onChanged(uri)`.
5. Native comments panel/gutter refreshes from same store thread.
6. `PreviewBridge` reloads SDK threads for that URI.

Result: one thread list, shared by both surfaces.

## Message Protocol (Webview <-> Host)

`@accordo/comment-sdk/src/types.ts` defines:

Webview -> host:

- `comment:create { blockId, body, intent? }`
- `comment:reply { threadId, body }`
- `comment:resolve { threadId, resolutionNote }`
- `comment:reopen { threadId }`
- `comment:delete { threadId, commentId? }`

Host -> webview:

- `comments:load { threads: SdkThread[] }`
- `comments:add { thread }`
- `comments:update { threadId, update }`
- `comments:remove { threadId }`

Current `md-viewer` implementation primarily uses `comments:load` for synchronization.

## Unified Anchor Strategy for Markdown Text + Viewer

## Preferred anchor for cross-surface parity

When creating from markdown preview, the system tries to store as `text` anchor (not surface) if line mapping exists.

How:

1. SDK gives `blockId`.
2. `PreviewBridge` uses `BlockIdResolver.blockIdToLine(blockId)`.
3. `accordo-comments` internal `getStore` adapter creates `CommentAnchorText` if `line` was resolved.
4. The same thread then appears naturally in native text comments and panel.

Current text anchor created from preview uses this range shape:

- `startLine = line`
- `endLine = line`
- `startChar = 0`
- `endChar = 0`
- `docVersion = 0`

## Fallback anchor

If `blockId -> line` cannot be resolved, adapter falls back to `CommentAnchorSurface` with:

- `surfaceType: "markdown-preview"`
- `coordinates: { type: "block", blockId, blockType }`

This fallback may appear in webview but not as a native text-line widget.

## Reverse mapping (text -> webview pin)

For text-anchored threads, `PreviewBridge.toSdkThread` maps `startLine -> blockId` via `BlockIdResolver.lineToBlockId`.

Current resolver behavior (important):

- Exact line match preferred.
- Otherwise uses nearest mapped block at or before the line.

This supports rendering pins for text-created threads inside the preview.

## Native VS Code Mapping Details

`NativeComments` creates one `vscode.CommentThread` per `CommentThread`.

- `text` anchor -> uses anchor range directly.
- non-text anchor -> currently passed with undefined range to `createCommentThread`.

The comments panel entries come from these native `vscode.CommentThread`/`vscode.Comment` objects, but content and lifecycle still come from `CommentStore`.

## Staleness and Document Edits

`CommentStore.onDocumentChanged`:

- Shifts text-anchor lines when edits are strictly above anchor.
- Marks thread stale when edit overlaps anchor range.
- Persists shifted anchors.

`NativeComments.markStale(threadId)` updates label to `Context may have changed`.

## Block IDs and SDK pin placement

Markdown renderer injects `data-block-id` via `block-id-plugin`.

Current block ID formats:

- heading: `heading:{level}:{slug}` with `:2`, `:3` suffix for collisions
- paragraph: `p:{index}`
- list item: `li:{listIdx}:{itemIdx}`
- fenced code: `pre:{index}`

SDK pin coordinate lookup in webview template:

- `document.querySelector('[data-block-id="' + blockId + '"]')`
- Pin placed at `{ x: rect.right, y: rect.top }`

SDK will ignore Alt+click if click target is not inside an element with `[data-block-id]`.

## Decisions and Deferred Items

The requirement docs were aligned to current implementation. Product decisions captured:

1. `defaultSurface` semantics are intentionally soft (activation-time behavior toggle), not a strict guarantee that VS Code will always open one surface.
2. Non-text anchors should remain visible in native VS Code Comments panel and be treated as first-class comments.
3. Persistence durability hardening (atomic write/rename strategy) is deferred.

Current code-vs-doc status: no known blocking discrepancies in the comments/SDK integration path.

## Practical Rules for Developers

- Treat `CommentStore` as the only source of truth.
- For markdown preview comments, always prefer `text` anchor creation when line mapping exists.
- Keep block ID format stable; it is part of cross-surface comment identity in preview.
- If protocol or anchor behavior changes, update both:
  - `@accordo/comment-sdk/src/types.ts`
  - `md-viewer/src/preview-bridge.ts` and `webview-template.ts`
- Keep requirements docs aligned with `bridge-types` first; other docs should derive from those shared types.
