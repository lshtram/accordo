# @accordo/comment-sdk — Requirements Specification

**Package:** `@accordo/comment-sdk`  
**Type:** Pure JavaScript/CSS library (no VS Code dependency)  
**Version:** 0.1.0  
**Date:** 2025-01-01  
**Runtime target:** Browser (webview context inside VS Code custom editors)

---

## 1. Purpose

The Comment SDK is an embeddable JavaScript library that renders interactive comment pins on any visual surface rendered in a VS Code WebviewPanel. It communicates with the extension host via the VS Code `postMessage` protocol. The SDK is surface-agnostic — the host extension provides a function that maps logical coordinates (e.g., `blockId`, pixel position) to screen coordinates.

The SDK is loaded into the webview as a `<script>` tag. It has zero runtime dependencies; all rendering is done with plain DOM API and the bundled CSS.

---

## 2. Package Contract

### 2.1 Entry Point

```json
{
  "name": "@accordo/comment-sdk",
  "main": "./dist/sdk.js",
  "types": "./dist/sdk.d.ts",
  "type": "module"
}
```

### 2.2 Public API

```typescript
import {
  AccordoCommentSDK,
  // Types
  SdkThread,
  SdkComment,
  SdkInitOptions,
  SdkCallbacks,
  PinState,
  ScreenPosition,
  CoordinateToScreen,
  WebviewMessage,
  HostMessage,
} from "@accordo/comment-sdk";
```

All types are exported at the package root with no sub-path imports required.

---

## 3. Data Model

### 3.1 SdkThread

The slim comment thread model used by the SDK. Derived from `CommentThread` in `@accordo/bridge-types` but self-contained (no circular dependency).

```typescript
interface SdkThread {
  id: string;
  uri: string;
  blockId: string;           // Which block this thread is anchored to
  status: "open" | "resolved";
  comments: SdkComment[];
  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601
  hasUnread: boolean;         // true if updatedAt > loadedAt
}

interface SdkComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;          // ISO 8601
}
```

### 3.2 PinState

```typescript
type PinState = "open" | "updated" | "resolved";
```

| State | Meaning |
|---|---|
| `open` | Thread exists with no unread updates |
| `updated` | Thread has comments added since the preview was opened (`hasUnread: true`) |
| `resolved` | Thread is resolved |

### 3.3 ScreenPosition

```typescript
interface ScreenPosition {
  top: number;   // px from top of scroll container
  left: number;  // px from left of scroll container
}
```

### 3.4 CoordinateToScreen

```typescript
type CoordinateToScreen = (blockId: string) => ScreenPosition | null;
```

The host-provided function that converts a logical `blockId` to pixel coordinates for pin placement. Returns `null` if the block cannot be found in the current viewport.

---

## 4. Initialisation API

### 4.1 `SdkInitOptions`

```typescript
interface SdkInitOptions {
  /** DOM element to render comment pins inside. */
  container: HTMLElement;
  /** VS Code acquireVsCodeApi() result for postMessage. */
  vscode: VsCodeApi;
  /** Converts a blockId to a screen pixel position for pin placement. */
  coordinateToScreen: CoordinateToScreen;
  /** Callbacks fired by the SDK to notify the host page of events. */
  callbacks?: SdkCallbacks;
}
```

### 4.2 `SdkCallbacks`

```typescript
interface SdkCallbacks {
  /** Called after a new thread is successfully created. */
  onThreadCreated?: (thread: SdkThread) => void;
  /** Called after a reply is added to a thread. */
  onThreadReplied?: (thread: SdkThread) => void;
  /** Called after a thread is resolved. */
  onThreadResolved?: (thread: SdkThread) => void;
  /** Called after a thread or comment is deleted. */
  onThreadDeleted?: (threadId: string) => void;
}
```

### 4.3 `AccordoCommentSDK` class

```typescript
class AccordoCommentSDK {
  constructor(options: SdkInitOptions);

  /** Load or replace all threads for the current document. */
  loadThreads(threads: SdkThread[]): void;

  /** Add a single new thread (e.g., after host confirms creation). */
  addThread(thread: SdkThread): void;

  /** Update an existing thread in-place (status change, new comment). */
  updateThread(thread: SdkThread): void;

  /** Remove a thread from the display. */
  removeThread(threadId: string): void;

  /** Re-compute all pin screen positions (call on scroll/resize). */
  reposition(): void;

  /** Tear down all DOM nodes and event listeners. */
  dispose(): void;
}
```

---

## 5. postMessage Protocol

### 5.1 Webview → Host (`WebviewMessage`)

Messages initiated by the SDK to request store mutations in the extension host.

```typescript
type WebviewMessage =
  | { type: "comment:create"; uri: string; blockId: string; body: string }
  | { type: "comment:reply";  threadId: string; body: string }
  | { type: "comment:resolve"; threadId: string }
  | { type: "comment:delete"; threadId: string; commentId?: string };
```

### 5.2 Host → Webview (`HostMessage`)

Messages pushed by the extension host to update webview state.

```typescript
type HostMessage =
  | { type: "comments:load";   threads: SdkThread[] }
  | { type: "comments:add";    thread: SdkThread }
  | { type: "comments:update"; thread: SdkThread }
  | { type: "comments:remove"; threadId: string };
```

### 5.3 SDK Message Handling

| Requirement ID | Requirement |
|---|---|
| M41a-SDK-01 | SDK listens for `window.addEventListener("message", ...)` on init |
| M41a-SDK-02 | `comments:load` → replaces all displayed threads via `loadThreads()` |
| M41a-SDK-03 | `comments:add` → calls `addThread()` |
| M41a-SDK-04 | `comments:update` → calls `updateThread()` |
| M41a-SDK-05 | `comments:remove` → calls `removeThread()` |

---

## 6. Rendering Requirements

| Requirement ID | Requirement |
|---|---|
| M41a-SDK-06 | Pins are absolutely positioned DOM elements inside `container` |
| M41a-SDK-07 | Pin position is computed via `coordinateToScreen(thread.blockId)` |
| M41a-SDK-08 | Pin state class applied: `accordo-pin--open`, `accordo-pin--updated`, `accordo-pin--resolved` |
| M41a-SDK-09 | Clicking a pin opens a popover showing thread comments and a reply form |
| M41a-SDK-10 | Popover shows all comments in the thread in chronological order |
| M41a-SDK-11 | Reply form submits via `comment:reply` message on Enter or button click |
| M41a-SDK-12 | Resolve button sends `comment:resolve` message |
| M41a-SDK-13 | Delete button sends `comment:delete` message (thread-level) |
| M41a-SDK-14 | Clicking outside the popover closes it without sending any message |

---

## 7. CSS Architecture

The SDK ships a bundled `sdk.css` file that **must** be loaded into the webview alongside `sdk.js`. It uses VS Code CSS variable tokens for theme integration.

### 7.1 VS Code Theme Variables Used

```css
var(--vscode-editor-background)
var(--vscode-editor-foreground)
var(--vscode-focusBorder)
var(--vscode-badge-background)
var(--vscode-badge-foreground)
var(--vscode-button-background)
var(--vscode-button-foreground)
var(--vscode-inputValidation-errorBackground)
```

### 7.2 Pin Visual States

| Class | Visual |
|---|---|
| `.accordo-pin--open` | Filled circle, badge background colour |
| `.accordo-pin--updated` | Filled circle, warning/amber tint |
| `.accordo-pin--resolved` | Hollow circle, subdued foreground |

### 7.3 Popover Layout

- Fixed width 320 px
- Scrollable comment list, max-height 300 px
- Reply textarea + submit button at the bottom
- Resolve and Delete buttons in the header toolbar
- `z-index: 9999` to render above all page content

---

## 8. Constraints

| Constraint | Requirement |
|---|---|
| No VS Code imports | SDK must not import from `vscode`. It must work in any `window.acquireVsCodeApi()` environment. |
| No runtime deps | `package.json` must have zero `dependencies`. All rendering uses vanilla JS + DOM. |
| TypeScript strict | Compiled with `strict: true`. No `:any`. |
| CSS bundled | `sdk.css` ships in `dist/`. Consumers must include it in the webview HTML `<link>` tag. |
| Module format | ES module output (`"type": "module"`). |

---

## 9. Test Coverage Summary

| Requirement IDs | Description | Test file |
|---|---|---|
| M41a-SDK-01 → SDK-14 | Full `AccordoCommentSDK` class API | `src/__tests__/sdk.test.ts` |

Total: 37 tests across 14 requirement IDs.
