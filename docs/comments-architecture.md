# Accordo — Comments Modality Architecture v1.0

**Status:** DRAFT
**Date:** 2026-03-03
**Scope:** Spatial commenting across all Accordo surfaces — code, diagrams, images, PDFs, markdown previews, slides
**Depends on:** Phase 1 completion (Hub + Bridge + Editor)

---

## 1. What Comments Are in Accordo

Comments are the **primary human-agent communication channel within the spatial context of the workspace**. The human points at something — a line of code, a node in a diagram, a region of an image, a paragraph in a document — and says what they want. The agent receives both the message and the exact context needed to act.

This is not annotation. This is task dispatch with spatial grounding.

The agent is an equal participant. It can create comments ("This function has a potential null dereference on line 42"), reply to comments ("Fixed — I added a guard clause"), and resolve them. The human can do the same. Both parties can point at anything in the workspace and start a conversation about it.

---

## 2. The Two-Surface Strategy

VSCode has two fundamentally different rendering contexts, and comments must work in both.

### 2.1 Text editors — VSCode native Comments API

For code files, markdown source, JSON, config files — any file opened in VSCode's built-in text editor — we use the **native Comments API** (`vscode.comments`). This gives us:

- Gutter icons (click "+" to comment on a line)
- Inline thread widget (author, body, reply, resolve)
- Comments panel (sidebar view listing all threads across files)
- Range tracking (gutter icons shift when lines are inserted above)
- Built-in Markdown rendering in comment bodies
- Custom actions via `package.json` menu contributions

We do not build a custom decoration-based comment renderer for text. The native API is mature, users understand it, and it handles the hard problems (widget layout, range decoration, keyboard navigation).

### 2.2 Visual surfaces — Comment SDK for webviews

For diagrams, images, PDFs, markdown previews, slides, and any other visual surface rendered in a VSCode webview, we provide the **Accordo Comment SDK** — a shared JavaScript library that every Accordo modality webview includes.

The SDK provides:
- **Comment pins** — small markers rendered at anchor coordinates on the surface
- **Click-to-comment** — user clicks surface → SDK captures normalized coordinates → opens a comment input
- **Pin interaction** — click a pin to expand the comment thread
- **postMessage bridge** — the SDK communicates with the extension host, which manages persistence and MCP tools

This is NOT a ghost overlay. It is a library that each webview includes. VSCode webviews are sandboxed iframes — you cannot overlay on top of them from outside. But since **Accordo controls all its modality webviews** (diagrams, image viewer, PDF viewer, markdown preview, slides), every Accordo surface can include the SDK.

```
┌─────────────────────────────────────────────────────────────┐
│  Text Editor (*.ts, *.py, *.md source)                      │
│  → VSCode native Comments API                               │
│  → Gutter icons, inline threads, Comments panel             │
├─────────────────────────────────────────────────────────────┤
│  Diagram Webview (*.mmd — Excalidraw canvas)                │
│  → Comment SDK embedded in webview                          │
│  → Pins at node coordinates                                 │
├─────────────────────────────────────────────────────────────┤
│  Image Viewer Webview (*.png, *.jpg, *.svg)                 │
│  → Comment SDK embedded in webview                          │
│  → Pins at normalized (x, y) coordinates                    │
├─────────────────────────────────────────────────────────────┤
│  PDF Viewer Webview (*.pdf)                                 │
│  → Comment SDK embedded in webview                          │
│  → Pins at (page, x, y) coordinates                        │
├─────────────────────────────────────────────────────────────┤
│  Markdown Preview Webview (*.md rendered)                   │
│  → Comment SDK embedded in webview                          │
│  → Pins at heading/paragraph anchors                        │
├─────────────────────────────────────────────────────────────┤
│  Slide Deck Webview (Slidev/reveal.js)                      │
│  → Comment SDK embedded in webview                          │
│  → Pins at (slide, x, y) coordinates                       │
└─────────────────────────────────────────────────────────────┘
```

**For third-party webviews we don't control:** Not supported. We can only comment on surfaces that include the SDK. This is an acceptable limitation — Accordo's value is in its own modality ecosystem.

---

## 3. Data Model

### 3.1 Comment anchor (where the comment points)

```typescript
type CommentAnchor =
  | {
      kind: "text";
      uri: string;                              // file URI
      range: { startLine: number; startChar: number; endLine: number; endChar: number };
      docVersion: number;                       // TextDocument.version at creation
    }
  | {
      kind: "surface";
      uri: string;                              // file URI of the underlying resource
      surfaceType: SurfaceType;
      coordinates: SurfaceCoordinates;
    }
  | {
      kind: "file";
      uri: string;                              // file-level comment, no specific location
    };

type SurfaceType =
  | "diagram"
  | "image"
  | "pdf"
  | "markdown-preview"
  | "slide"
  | "browser";

type SurfaceCoordinates =
  | { type: "normalized"; x: number; y: number }                         // 0..1 range
  | { type: "diagram-node"; nodeId: string }                             // Mermaid node ID
  | { type: "pdf-page"; page: number; x: number; y: number }            // page + normalized
  | { type: "slide"; slideIndex: number; x: number; y: number }         // slide + normalized
  | { type: "heading"; headingText: string; headingLevel: number };      // markdown heading anchor
```

Each coordinate type is specific to its surface. The comment extension doesn't need to understand all of them — the surface adapter (or Comment SDK instance) resolves coordinates to screen positions.

### 3.2 Comment

```typescript
interface AccordoComment {
  id: string;                                    // UUID
  threadId: string;                              // groups replies together
  createdAt: string;                             // ISO 8601
  author: CommentAuthor;
  body: string;                                  // Markdown
  anchor: CommentAnchor;
  intent?: CommentIntent;
  status: CommentStatus;
  resolutionNote?: string;                       // set when status → "resolved"

  context?: CommentContext;                      // captured at creation time
}

interface CommentAuthor {
  kind: "user" | "agent";
  name: string;
  agentId?: string;                              // MCP session or agent identifier
}

type CommentIntent = "fix" | "explain" | "refactor" | "review" | "design" | "question";

type CommentStatus = "open" | "resolved";

interface CommentContext {
  viewportSnap?: {
    before: string;                              // ~20 lines above, capped at 1KB
    selected?: string;                           // selected text at creation
    after: string;                               // ~20 lines below, capped at 1KB
  };
  diagnostics?: Array<{
    range: { startLine: number; endLine: number };
    message: string;
    severity: "error" | "warning" | "info" | "hint";
    source?: string;
  }>;
  git?: {
    branch?: string;
    commit?: string;
  };
  languageId?: string;
  surfaceMetadata?: Record<string, string>;      // surface-specific context
}
```

### 3.3 Comment thread

A thread is a group of comments sharing the same `threadId` and `anchor`. The first comment creates the thread; subsequent comments are replies.

```typescript
interface CommentThread {
  id: string;                                    // same as threadId
  anchor: CommentAnchor;
  comments: AccordoComment[];                    // ordered by createdAt
  status: CommentStatus;                         // derived: "resolved" if any comment resolves it
  createdAt: string;                             // first comment's timestamp
  lastActivity: string;                          // most recent comment's timestamp
}
```

### 3.4 Design decisions

**Why no `acked` or `stale` status?**

- `acked` adds lifecycle complexity without user value. The agent either acts on a comment or it doesn't. The MCP tool response already confirms receipt.
- `stale` is a display concern, not a data model concern. When the anchor range has been edited, the UI shows a visual indicator (dimmed pin, warning icon) but the comment remains `open`. The agent can still read and resolve it. Staleness doesn't change what the agent can do — it's a hint that the context may have shifted.

**Why no `deleted` status?**

Deletion is removal, not a state. When a comment is deleted, it's removed from the store and the thread. If all comments in a thread are deleted, the thread is removed.

**Why no `expiresAt`?**

Premature. Add TTL-based cleanup when there's evidence it's needed. For now, comments persist until explicitly resolved or deleted.

---

## 4. State Machine

```
                     user or agent creates
                            │
                            ▼
                        ┌───────┐
                        │ open  │
                        └───┬───┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        user resolves  agent resolves   deleted
              │             │             │
              ▼             ▼             ▼
          ┌───────────┐ ┌───────────┐  (removed)
          │ resolved  │ │ resolved  │
          │ (by user) │ │ (by agent)│
          └─────┬─────┘ └─────┬─────┘
                │             │
           user reopens  user reopens
                │             │
                ▼             ▼
            ┌───────┐
            │ open  │
            └───────┘
```

**Transition rules:**

| From | To | Who can trigger | How |
|---|---|---|---|
| — | `open` | user or agent | Create comment |
| `open` | `resolved` | user or agent | `comment.resolve` tool or UI action |
| `resolved` | `open` | user only | UI "Reopen" action (agent cannot reopen) |
| any | (deleted) | user or agent | `comment.delete` tool or UI action |

**Conflict rule:** If two agents try to resolve the same comment simultaneously, the first one wins (optimistic concurrency — check status before resolving, return error if already resolved). This is simple and correct because the Hub serializes tool calls through Bridge.

---

## 5. Persistence

### 5.1 Storage location

Comments are stored in a workspace-scoped JSON file:

```
.accordo/comments.json
```

This file is:
- Gitignored by default (comments are workspace-local, not shared across clones)
- Written on every mutation (create, reply, resolve, delete)
- Read on extension activation (restore all threads)

### 5.2 File format

```json
{
  "version": "1.0",
  "threads": [
    {
      "id": "uuid-thread-1",
      "anchor": { "kind": "text", "uri": "file:///project/src/auth.ts", "range": { "startLine": 42, "startChar": 0, "endLine": 42, "endChar": 0 }, "docVersion": 7 },
      "status": "open",
      "comments": [
        {
          "id": "uuid-comment-1",
          "threadId": "uuid-thread-1",
          "createdAt": "2026-03-03T10:30:00Z",
          "author": { "kind": "user", "name": "Developer" },
          "body": "This auth check doesn't handle expired tokens",
          "anchor": { "kind": "text", "uri": "file:///project/src/auth.ts", "range": { "startLine": 42, "startChar": 0, "endLine": 42, "endChar": 0 }, "docVersion": 7 },
          "intent": "fix",
          "status": "open",
          "context": {
            "viewportSnap": { "before": "...", "after": "..." },
            "languageId": "typescript",
            "git": { "branch": "main", "commit": "abc123" }
          }
        }
      ]
    }
  ]
}
```

### 5.3 Restore on activation

When the extension activates:

1. Read `.accordo/comments.json`
2. For each thread with `kind: "text"` anchor: create a `vscode.CommentThread` via the native Comments API
3. For each thread with `kind: "surface"` anchor: store in memory, render when the relevant webview opens
4. For each thread with `kind: "file"` anchor: create a file-level `vscode.CommentThread` (range = undefined)

### 5.4 Scale limits

- Maximum 500 threads per workspace (warn at 400, refuse new at 500)
- Maximum 50 comments per thread (refuse new at 50)
- Viewport snap context capped at 2KB per comment
- Total `.accordo/comments.json` size capped at 2MB

These limits prevent the comment store from becoming a performance problem. For a code review workflow, 500 threads is far more than any session needs.

### 5.5 Store encapsulation and future partitioning

**Encapsulation rule:** Neither the agent nor the human ever interacts with `.accordo/comments.json` directly. All access goes through the `CommentStore` API (for extension code) or MCP tools (for agents). The JSON file is an implementation detail.

This is a deliberate design constraint. The current single-file store is sufficient for Phase 2, but large projects with many participants will need partitioned storage — per-file, per-folder, or per-modality stores, possibly backed by SQLite or a remote service. By ensuring all access is mediated through the `CommentStore` interface, any future storage backend can be swapped without changing tools, UI, or agent behavior.

**Design for future partitioning (not implemented now):**
- The `CommentStore` constructor could accept a `StorageBackend` interface
- `StorageBackend` implementations: `JsonFileBackend` (current), `PartitionedBackend` (per-file JSON), `SqliteBackend`
- The store's query methods (`getThreadsForUri`, `listThreads`) already filter by URI — they work identically regardless of backend
- Scale limits (500 threads / workspace) would become per-partition limits in a partitioned backend

For now, the single JSON file is the only backend, but the `CommentStore` class is the sole owner of persistence logic.

---

## 6. MCP Tool Specifications

The comments extension registers these tools via `BridgeAPI.registerTools('accordo-comments', commentTools)`.

### Tool table

| Tool | Danger | Idempotent | Description |
|---|---|---|---|
| `accordo.comment.list` | safe | yes | List all comment threads, optionally filtered |
| `accordo.comment.get` | safe | yes | Get a specific thread with all comments |
| `accordo.comment.create` | moderate | no | Create a new comment (starts a thread) |
| `accordo.comment.reply` | moderate | no | Reply to an existing thread |
| `accordo.comment.resolve` | moderate | no | Resolve a thread with a resolution note |
| `accordo.comment.delete` | moderate | no | Delete a specific comment or entire thread |

### `accordo.comment.list`

```typescript
input: {
  uri?: string;              // filter by file URI (exact match)
  status?: "open" | "resolved";
  intent?: CommentIntent;
  anchorKind?: "text" | "surface" | "file";  // filter by anchor type
  limit?: number;            // default: 50, max: 200
  offset?: number;           // default: 0 — for pagination
}

output: {
  threads: Array<{
    id: string;
    anchor: CommentAnchor;
    status: CommentStatus;
    commentCount: number;
    lastActivity: string;
    firstComment: {
      author: CommentAuthor;
      body: string;           // first 200 chars
      intent?: CommentIntent;
    };
  }>;
  total: number;             // total matching (before limit/offset)
  hasMore: boolean;          // true if total > offset + limit
}
```

**Context-aware filtering:** The agent should prefer targeted queries over full-list scans. Typical patterns:
- `{ uri: "file:///project/src/auth.ts" }` — comments for the file the agent is about to edit
- `{ status: "open", intent: "fix" }` — actionable work items
- `{ anchorKind: "text", status: "open", limit: 10 }` — recent code comments only

**For the system prompt:** The agent doesn't need to call `comment.list` to know comments exist. The modality state (§7) includes a summary of open comments. The agent calls `comment.list` when it wants the full list or needs to drill into a specific file.

### `accordo.comment.get`

```typescript
input: {
  threadId: string;
}

output: {
  thread: CommentThread;     // full thread with all comments and context
}
```

### `accordo.comment.create`

```typescript
input: {
  uri: string;               // file URI
  anchor: {
    kind: "text";
    startLine: number;
    endLine?: number;        // default: same as startLine
  } | {
    kind: "surface";
    surfaceType: SurfaceType;
    coordinates: SurfaceCoordinates;
  } | {
    kind: "file";
  };
  body: string;              // Markdown
  intent?: CommentIntent;
}

output: {
  created: true;
  threadId: string;
  commentId: string;
}
```

When the agent creates a comment:
1. The extension builds the full `CommentAnchor` (resolving relative line numbers to absolute, capturing docVersion)
2. Context is captured automatically (viewport snap, diagnostics, git info)
3. The comment is persisted and rendered (native thread for text, SDK pin for surface)
4. If the file is not open, the comment is stored but not rendered until the file opens

### `accordo.comment.reply`

```typescript
input: {
  threadId: string;
  body: string;              // Markdown
}

output: {
  replied: true;
  commentId: string;
}
```

### `accordo.comment.resolve`

```typescript
input: {
  threadId: string;
  resolutionNote: string;    // required — agent must explain what it did
}

output: {
  resolved: true;
  threadId: string;
}
```

The `resolutionNote` is required. An agent cannot silently resolve a comment — it must say what it did. This is the trust-building mechanism.

**Concurrency guard:** If the thread is already resolved, returns an error: `"Thread already resolved"`.

### `accordo.comment.delete`

```typescript
input: {
  threadId: string;
  commentId?: string;        // if omitted, deletes entire thread
}

output: {
  deleted: true;
}
```

### 6.1 Rate limiting (normative)

The `comment.create` tool handler enforces a sliding-window rate limit:
- **Maximum 10 creates per minute** per agent session
- Exceeding the limit returns an error: `"Rate limit exceeded: max 10 comment creates per minute"`
- The window is per-agent (tracked by `agentId` from the invocation context)
- Reply, resolve, and delete are not rate-limited (they operate on existing threads)
- The rate limiter resets on extension deactivation

This prevents an agent from flooding the workspace with comments. The 500-thread hard cap (§5.4) is a separate, independent guard.

---

## 7. Modality State (System Prompt)

The comments extension publishes its state to the Hub via `BridgeAPI.publishState()`. This appears in the agent's system prompt at `GET /instructions`.

```typescript
bridge.publishState('accordo-comments', {
  isOpen: true,
  openThreadCount: 3,
  resolvedThreadCount: 12,
  summary: [
    { threadId: "abc", uri: "src/auth.ts", line: 42, intent: "fix", preview: "This auth check doesn't handle expired tokens" },
    { threadId: "def", uri: "src/api.ts", line: 108, intent: "review", preview: "Consider rate limiting this endpoint" },
    { threadId: "ghi", uri: "diagrams/arch.mmd", surfaceType: "diagram", nodeId: "auth", preview: "This service needs a fallback path" }
  ]
});
```

**Token budget:** The summary includes at most 10 open threads (most recent first), with body truncated to 80 chars. This fits comfortably within the 1500-token dynamic budget alongside other modality state.

The agent sees this in its system prompt and knows:
- There are 3 open comments to address
- Where each one is (file + line, or surface + coordinates)
- What the human wants (intent + preview)

The agent can then call `comment.get` for full context, or act directly based on the summary.

---

## 8. Comment SDK for Visual Surfaces

### 8.1 What it is

The Comment SDK is a ~500-line JavaScript library bundled into every Accordo modality webview. It provides the UI and communication layer for commenting on non-text surfaces.

### 8.2 SDK API (webview side)

```typescript
// Loaded in the webview via <script src="${sdkUri}"></script>

interface AccordoCommentSDK {
  // Initialize the SDK. Call once when the webview loads.
  init(options: {
    surfaceType: SurfaceType;
    // Convert a click event to surface coordinates.
    // Each surface implements this differently.
    coordinateResolver: (event: MouseEvent) => SurfaceCoordinates | null;
    // Convert stored coordinates to screen position for rendering pins.
    coordinateToScreen: (coords: SurfaceCoordinates) => { x: number; y: number } | null;
  }): void;

  // Load existing comments (called by extension host on webview load)
  loadThreads(threads: SdkThread[]): void;

  // Add a single thread (called when a new comment is created externally)
  addThread(thread: SdkThread): void;

  // Update thread status (called when resolved/deleted externally)
  updateThread(threadId: string, update: Partial<SdkThread>): void;

  // Remove a thread
  removeThread(threadId: string): void;
}

interface SdkThread {
  id: string;
  coordinates: SurfaceCoordinates;
  status: CommentStatus;
  comments: Array<{
    author: { kind: "user" | "agent"; name: string };
    body: string;
    createdAt: string;
  }>;
}
```

### 8.3 How the SDK works

**Rendering pins:**

The SDK maintains a list of threads. For each thread, it calls `coordinateToScreen(thread.coordinates)` to get a screen position, then renders a small circular pin at that position. Pins are color-coded:
- Blue: open comment from user
- Purple: open comment from agent
- Green: resolved
- Pins show a badge with the reply count

When the surface is scrolled, zoomed, or resized, the SDK re-calls `coordinateToScreen` for all pins to reposition them.

**Creating a comment:**

1. User holds Alt (or a configurable modifier) and clicks the surface
2. SDK captures the click event, calls `coordinateResolver(event)` → gets surface coordinates
3. SDK renders a comment input popover at the click position
4. User types their comment and submits
5. SDK sends a `postMessage` to the extension host:
   ```typescript
   { type: "comment:create", coordinates: SurfaceCoordinates, body: string }
   ```
6. Extension host creates the comment in the store, persists it, publishes to Hub

**Expanding a thread:**

1. User clicks a pin
2. SDK renders a thread popover showing all comments in the thread
3. User can reply or resolve from the popover
4. Actions send `postMessage` to extension host

**Communication protocol (SDK ↔ Extension host):**

```typescript
// Webview → Extension host
{ type: "comment:create",  coordinates: SurfaceCoordinates, body: string, intent?: CommentIntent }
{ type: "comment:reply",   threadId: string, body: string }
{ type: "comment:resolve", threadId: string, resolutionNote: string }
{ type: "comment:delete",  threadId: string, commentId?: string }

// Extension host → Webview
{ type: "comments:load",   threads: SdkThread[] }
{ type: "comments:add",    thread: SdkThread }
{ type: "comments:update", threadId: string, update: Partial<SdkThread> }
{ type: "comments:remove", threadId: string }
```

### 8.4 Per-surface coordinate resolvers

Each modality provides its own `coordinateResolver` and `coordinateToScreen` functions when initializing the SDK. These are the only surface-specific code.

**Diagram surface (Excalidraw):**
```typescript
coordinateResolver: (event) => {
  // Hit-test against Excalidraw elements
  const element = excalidrawAPI.getElementAtPosition(event.clientX, event.clientY);
  if (element && element.mermaidId) {
    return { type: "diagram-node", nodeId: element.mermaidId };
  }
  // Fallback to normalized canvas coordinates
  const canvasPos = excalidrawAPI.screenToCanvas(event.clientX, event.clientY);
  return { type: "normalized", x: canvasPos.x / canvasWidth, y: canvasPos.y / canvasHeight };
},

coordinateToScreen: (coords) => {
  if (coords.type === "diagram-node") {
    const element = findElementByMermaidId(coords.nodeId);
    if (!element) return null;
    return excalidrawAPI.canvasToScreen(element.x + element.width / 2, element.y - 20);
  }
  return excalidrawAPI.canvasToScreen(coords.x * canvasWidth, coords.y * canvasHeight);
}
```

**Image viewer:**
```typescript
coordinateResolver: (event) => {
  const rect = imageElement.getBoundingClientRect();
  return {
    type: "normalized",
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height
  };
},

coordinateToScreen: (coords) => {
  const rect = imageElement.getBoundingClientRect();
  return { x: rect.left + coords.x * rect.width, y: rect.top + coords.y * rect.height };
}
```

**PDF viewer:**
```typescript
coordinateResolver: (event) => {
  const page = getCurrentPage();
  const pageRect = getPageElement(page).getBoundingClientRect();
  return {
    type: "pdf-page",
    page,
    x: (event.clientX - pageRect.left) / pageRect.width,
    y: (event.clientY - pageRect.top) / pageRect.height
  };
},

coordinateToScreen: (coords) => {
  if (coords.type !== "pdf-page") return null;
  if (coords.page !== getCurrentPage()) return null; // pin hidden on other pages
  const pageRect = getPageElement(coords.page).getBoundingClientRect();
  return { x: pageRect.left + coords.x * pageRect.width, y: pageRect.top + coords.y * pageRect.height };
}
```

**Markdown preview:**
```typescript
coordinateResolver: (event) => {
  // Find the nearest heading above the click point
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let nearest = null;
  for (const h of headings) {
    if (h.getBoundingClientRect().top <= event.clientY) nearest = h;
  }
  if (nearest) {
    return {
      type: "heading",
      headingText: nearest.textContent,
      headingLevel: parseInt(nearest.tagName[1])
    };
  }
  // Fallback to normalized
  return { type: "normalized", x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
},

coordinateToScreen: (coords) => {
  if (coords.type === "heading") {
    const headings = document.querySelectorAll(`h${coords.headingLevel}`);
    for (const h of headings) {
      if (h.textContent === coords.headingText) {
        const rect = h.getBoundingClientRect();
        return { x: rect.right + 10, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }
  return { x: coords.x * window.innerWidth, y: coords.y * window.innerHeight };
}
```

**Slide deck:**
```typescript
coordinateResolver: (event) => {
  const slideIndex = getCurrentSlideIndex();
  const slideRect = getSlideElement().getBoundingClientRect();
  return {
    type: "slide",
    slideIndex,
    x: (event.clientX - slideRect.left) / slideRect.width,
    y: (event.clientY - slideRect.top) / slideRect.height
  };
}
```

### 8.5 SDK rendering

The SDK renders its UI using a lightweight, framework-free approach:

- **Pins**: Absolutely positioned `<div>` elements with CSS styling. No React, no framework.
- **Popovers**: A single shared popover element, repositioned on pin click. Contains comment list + reply input.
- **Styling**: The SDK injects a `<style>` block with CSS variables that respect the webview's VSCode theme (`var(--vscode-editor-foreground)`, etc.).

Total SDK size target: < 20KB minified (no dependencies).

---

## 9. Diff-Aware Staleness (Text Anchors)

For text comments, the anchor range may drift as the file is edited. The comments extension tracks this:

### 9.1 Line-shift adjustment

When `vscode.workspace.onDidChangeTextDocument` fires:

1. For each text-anchored thread in the changed document:
2. For each content change in the event:
   - If the change is **entirely above** the anchor range: shift the anchor's start/end lines by the delta (inserted lines - deleted lines)
   - If the change **overlaps** the anchor range: mark the thread as visually stale (dimmed pin, warning icon in gutter)
   - If the change is **entirely below** the anchor range: no change

3. Update the stored anchor with the shifted lines
4. Persist the change

### 9.2 Visual staleness indicator

A thread is "visually stale" when its anchor has been edited since the comment was created. This is a display concern:

- In the native Comments API: set `thread.label` to include a "⚠ Context may have changed" prefix
- In the Comments panel: stale threads show with a dimmed icon
- The comment's `context.viewportSnap` still holds the original context — the agent can compare it with the current code to understand what changed

Staleness does NOT change the comment's `status`. It remains `open`. The agent can still resolve it.

---

## 10. Integration with Accordo System

### 10.1 Extension manifest

```json
{
  "name": "accordo-comments",
  "displayName": "Accordo IDE Comments",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "extensionDependencies": ["accordo.accordo-bridge"],
  "contributes": {
    "commands": [
      { "command": "accordo.comments.new", "title": "Accordo: New Comment" },
      { "command": "accordo.comments.resolveThread", "title": "Resolve" },
      { "command": "accordo.comments.deleteThread", "title": "Delete Thread" },
      { "command": "accordo.comments.deleteComment", "title": "Delete Comment" },
      { "command": "accordo.comments.reopenThread", "title": "Reopen" }
    ],
    "menus": {
      "comments/commentThread/title": [
        {
          "command": "accordo.comments.resolveThread",
          "group": "navigation",
          "when": "commentController == accordo-comments && commentThread == open"
        },
        {
          "command": "accordo.comments.reopenThread",
          "group": "navigation",
          "when": "commentController == accordo-comments && commentThread == resolved"
        },
        {
          "command": "accordo.comments.deleteThread",
          "group": "navigation",
          "when": "commentController == accordo-comments"
        }
      ],
      "comments/commentThread/context": [
        {
          "command": "accordo.comments.reply",
          "group": "inline",
          "when": "commentController == accordo-comments && !commentThreadIsEmpty"
        },
        {
          "command": "accordo.comments.createNote",
          "group": "inline",
          "when": "commentController == accordo-comments && commentThreadIsEmpty"
        }
      ],
      "comments/comment/title": [
        {
          "command": "accordo.comments.deleteComment",
          "group": "group@2",
          "when": "commentController == accordo-comments"
        }
      ]
    }
  }
}
```

### 10.2 Activation contract

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const bridge = vscode.extensions.getExtension<BridgeAPI>(
    'accordo.accordo-bridge'
  )?.exports;
  if (!bridge) return; // Extension is inert — no tools, no state publishing, no commands.

  // Initialize comment store (persistence)
  const store = new CommentStore(context);
  await store.load();

  // Initialize native Comments API (text surfaces)
  const controller = vscode.comments.createCommentController(
    'accordo-comments',
    'Accordo Comments'
  );
  controller.commentingRangeProvider = {
    provideCommentingRanges(document) {
      return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
    }
  };
  context.subscriptions.push(controller);

  // Restore persisted text threads
  store.restoreTextThreads(controller);

  // Register MCP tools
  const toolDisposable = bridge.registerTools('accordo-comments', createCommentTools(store, controller));
  context.subscriptions.push(toolDisposable);

  // Register commands
  registerCommentCommands(context, store, controller);

  // Watch for text edits (diff-aware staleness)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => store.onDocumentChanged(e))
  );

  // Publish initial modality state
  publishCommentState(bridge, store);

  // Update modality state on any store change
  store.onChanged(() => publishCommentState(bridge, store));

  // Provide SDK integration for other Accordo webviews
  exportCommentAPI(context, store);
}
```

### 10.3 Inter-extension communication for Comment SDK

Other Accordo modality extensions (diagrams, slides, image viewer) need to interact with the comments extension to load/save surface comments. This is done via **VSCode commands** (which work across extensions regardless of host location).

The comments extension registers these internal commands:

```typescript
// Called by modality extensions to get comments for a surface
vscode.commands.registerCommand('accordo.comments.internal.getThreadsForUri',
  (uri: string) => store.getThreadsForUri(uri)
);

// Called by modality extensions when a comment is created from a webview
vscode.commands.registerCommand('accordo.comments.internal.createSurfaceComment',
  (params: { uri: string; anchor: CommentAnchor; body: string; intent?: CommentIntent }) =>
    store.createComment(params)
);

// Called by modality extensions when a comment is resolved from a webview
vscode.commands.registerCommand('accordo.comments.internal.resolveThread',
  (threadId: string, resolutionNote: string) =>
    store.resolveThread(threadId, resolutionNote)
);
```

A modality extension's webview panel bridges the Comment SDK ↔ extension host ↔ comments extension:

```
Webview (Comment SDK)
    │ postMessage: "comment:create"
    ▼
Modality Extension Host (e.g., accordo-diagram)
    │ vscode.commands.executeCommand('accordo.comments.internal.createSurfaceComment', ...)
    ▼
Comments Extension (accordo-comments)
    │ store.createComment(...)
    │ persist to .accordo/comments.json
    │ publishState to Hub
    ▼
Hub → Agent system prompt: "3 open comments"
```

---

## 11. Agent Workflows

### 11.1 Human creates comment → Agent resolves

```
1. Human clicks line 42, types: "This auth check doesn't handle expired tokens"
   → intent: "fix"

2. Comment stored, published to Hub modality state:
   summary: [{ threadId: "abc", uri: "src/auth.ts", line: 42, intent: "fix",
               preview: "This auth check doesn't handle expired tokens" }]

3. Agent sees in system prompt: 1 open comment on src/auth.ts:42 (intent: fix)

4. Agent calls comment.get("abc") → gets full thread with viewportSnap context

5. Agent reads surrounding code, understands the issue

6. Agent fixes the code (via editor tools or file edit)

7. Agent calls comment.resolve("abc", "Added token expiry check with refresh fallback")

8. Human sees the comment marked resolved with the agent's explanation
```

### 11.2 Agent creates comment → Human reviews

```
1. Agent analyzes code, finds a concern

2. Agent calls comment.create({
     uri: "src/api.ts",
     anchor: { kind: "text", startLine: 108 },
     body: "This endpoint has no rate limiting. Consider adding a throttle.",
     intent: "review"
   })

3. Human sees a new comment appear on line 108 with the agent's suggestion

4. Human reviews, agrees, and either:
   a. Implements the fix and resolves the comment
   b. Replies: "Not needed — this is an internal-only endpoint"
   c. Resolves with note: "Won't fix — internal only"
```

### 11.3 Agent comments on a diagram

```
1. Human has a diagram open (diagrams/arch.mmd)

2. Agent calls comment.create({
     uri: "diagrams/arch.mmd",
     anchor: {
       kind: "surface",
       surfaceType: "diagram",
       coordinates: { type: "diagram-node", nodeId: "auth" }
     },
     body: "This service should have a circuit breaker for the downstream DB call",
     intent: "design"
   })

3. If the diagram webview is open: a pin appears on the "auth" node
   If not: the comment is stored, pin appears when the diagram is opened

4. Human clicks the pin, reads the suggestion, replies or resolves
```

### 11.4 Batch review workflow

```
1. Agent calls comment.list({ status: "open" }) → sees all unresolved comments

2. Agent processes them in order:
   - For each: read context, determine if it can resolve, take action

3. Agent resolves the ones it can, replies to the ones that need human input

4. Modality state updates after each resolution:
   "3 open comments" → "2 open comments" → "1 open comment"

5. Human sees the progress in real time
```

---

## 12. Module Structure

```
packages/comments/
├── package.json
├── tsconfig.json
│
├── src/
│   ├── extension.ts                 # Activation, tool + command registration
│   ├── types.ts                     # All comment types (AccordoComment, CommentAnchor, etc.)
│   │
│   ├── store/
│   │   ├── comment-store.ts         # In-memory store + persistence to .accordo/comments.json
│   │   ├── comment-store.test.ts
│   │   ├── persistence.ts           # Read/write .accordo/comments.json
│   │   └── persistence.test.ts
│   │
│   ├── text/
│   │   ├── text-adapter.ts          # Native Comments API integration
│   │   ├── text-adapter.test.ts
│   │   ├── staleness.ts             # Diff-aware line tracking
│   │   └── staleness.test.ts
│   │
│   ├── context/
│   │   ├── context-capture.ts       # Viewport snap, diagnostics, git info
│   │   └── context-capture.test.ts
│   │
│   ├── tools/
│   │   ├── comment-tools.ts         # 6 MCP tool definitions + handlers
│   │   └── comment-tools.test.ts
│   │
│   └── sdk/
│       ├── comment-sdk.ts           # Comment SDK source (bundled for webview)
│       ├── comment-sdk.css          # SDK styles (VSCode theme-aware)
│       └── sdk-protocol.ts          # Shared message types (SDK ↔ host)
│
└── media/
    └── comment-sdk.min.js           # Pre-built SDK bundle for webview inclusion
```

---

## 13. Implementation Roadmap

### Phase 0 — Text comments (MVP)

- Types and data model
- CommentStore: in-memory + persistence to `.accordo/comments.json`
- Text adapter: native VSCode Comments API (create, reply, resolve, delete, reopen)
- Context capture: viewport snap, diagnostics, git info
- Diff-aware staleness with line-shift adjustment
- 6 MCP tools: `comment.list`, `.get`, `.create`, `.reply`, `.resolve`, `.delete`
- Modality state published to Hub (open thread summary in system prompt)
- Restore persisted threads on activation
- Menu contributions (resolve, delete, reopen actions)

**Deliverable: Human and agent can both create, reply to, and resolve comments on any code file. Comments survive reload. Agent sees open comments in system prompt.**

### Phase 1 — Comment SDK + first visual surface (diagrams)

- Comment SDK: pins, popovers, click-to-comment, postMessage bridge
- SDK theming (VSCode theme variables)
- Inter-extension command API for modality integration
- Diagram surface integration: coordinate resolver for Excalidraw canvas, node-anchored comments
- Image viewer surface: simple normalized-coordinate pins

**Deliverable: Comments work on diagram nodes and images in addition to code. SDK is reusable for any future webview surface.**

### Phase 2 — All visual surfaces

- PDF viewer surface: page-anchored comments
- Markdown preview surface: heading-anchored comments
- Slide deck surface: slide + position anchored comments
- SDK hardening: scroll/zoom tracking, multi-monitor, accessibility

### Phase 3 — Advanced

- TextQuote anchoring (content-based re-anchoring after edits)
- Threaded conversations with branching
- Comment notifications (agent creates comment → notification popup)
- Comment search across workspace
- Export comments to markdown (for PR descriptions, docs)

---

## 14. What Changes from the Original Architecture

| Original | v1.0 | Reason |
|---|---|---|
| Custom decoration-based text renderer | VSCode native Comments API | Native API handles gutter, widget, panel, range tracking. Building custom is reinventing worse. |
| Ghost overlay for webviews | Comment SDK library included per webview | Ghost overlay is infeasible — webviews are sandboxed iframes. SDK approach works for all Accordo-controlled surfaces. |
| `HubClient` module talks directly to Hub | Uses `BridgeAPI.registerTools()` + `BridgeAPI.publishState()` | Follows established Accordo extension pattern. No direct Hub communication. |
| `SurfaceAdapterRegistry` (abstract interface) | Per-surface coordinate resolvers (concrete functions) | Premature abstraction. Each surface is different. SDK with pluggable resolvers is simpler. |
| `diagnostics?: any[]` | Fully typed diagnostic array | Coding guidelines: never use `any` |
| 5 states (open, acked, resolved, stale, deleted) | 2 states (open, resolved) + visual staleness indicator | `acked` adds no value. `stale` is display, not data. `deleted` is removal. |
| No MCP tools defined | 6 tools fully specified | The agent had no way to interact with comments. Now it does. |
| No persistence model | `.accordo/comments.json` workspace file | Comments were lost on reload. Now they survive. |
| No modality state | Open thread summary in system prompt | Agent had no way to know comments existed without calling a tool. |
| No scale limits | 500 threads, 50 comments/thread, 2MB cap | Prevents unbounded growth. |
| Browser extension in scope | Deferred | Different product. Ship VSCode first. |
| No conflict handling | First-write-wins with status check | Simple, correct for single-Bridge architecture. |
| No inter-extension API | VSCode commands for modality integration | Other extensions need to load/save surface comments. |
| Vague auto-cleanup policy | Comments persist until resolved or deleted | No magic. Explicit lifecycle. |

---

## 15. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Native Comments API range tracking doesn't update `thread.range` back to extension | High | Implement own line-shift tracking via `onDidChangeTextDocument`. Store shifted ranges in CommentStore. |
| Native Comments API can't enumerate threads from controller | Medium | Track all threads in CommentStore's own `Map<string, CommentThread>`. Never rely on controller enumeration. |
| Comment SDK popover conflicts with webview's own UI | Medium | Use `z-index` layering, dismiss popover on outside click, respect surface's keyboard shortcuts. |
| Large number of surface pins causes performance issues | Low | Cap at 500 threads. Only render pins visible in current viewport (frustum culling in SDK). |
| Agent floods workspace with comments | Medium | 500 thread limit. Rate limit in tool handler: max 10 creates per minute per agent. |
| `.accordo/comments.json` merge conflicts in git | Low | File is gitignored by default. If user commits it, standard JSON merge applies. |

---

## 16. Strategic Position

Comments are the first modality because they are the **lowest-friction, highest-impact integration point** between human and agent.

Every other modality (diagrams, slides, code editing) benefits from comments. A diagram without comments is a picture. A diagram with comments is a conversation about architecture. Code without comments is code. Code with comments is a shared review session where the agent can point, explain, and fix.

The Comment SDK creates a **universal comment layer** across all Accordo surfaces. Any future modality — 3D model viewer, spreadsheet, whiteboard — includes the SDK and gets spatial comments for free. The comment store, MCP tools, and system prompt integration are shared.

This is not an annotation system. This is the communication protocol for human-agent collaboration with spatial grounding.
