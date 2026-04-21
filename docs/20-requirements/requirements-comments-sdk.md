# @accordo/comment-sdk — Requirements Specification

**Package:** `@accordo/comment-sdk`  
**Type:** Browser-side SDK (webview context), no VS Code runtime dependency  
**Version:** 0.1.0  
**Date:** 2026-04-21  
**Runtime target:** Browser/webview consumers (`md-viewer`, `marp`, `diagram`, `browser-extension`)  

---

## 1. Purpose

`@accordo/comment-sdk` is the shared in-webview UI layer for comment pins/popovers. It is framework-free and host-agnostic.

The SDK owns DOM rendering and interaction behavior. The host owns persistence and transport.

---

## 2. Package Contract

`package.json` contract:

- JS entry: `./dist/sdk.js`
- Types: `./dist/sdk.d.ts`
- CSS export: `@accordo/comment-sdk/css` → `./src/sdk.css`

The SDK is consumed as an ES module. A browser-global wrapper (`sdk.browser.js`) is optional helper output via `scripts/bundle-browser.mjs` and is not the canonical package export surface.

---

## 3. Public API

```ts
class AccordoCommentSDK {
  init(opts: SdkInitOptions): void
  destroy(): void

  loadThreads(threads: SdkThread[]): void
  addThread(thread: SdkThread): void
  updateThread(threadId: string, update: Partial<SdkThread>): void
  removeThread(threadId: string): void
  reposition(): void

  openPopover(threadId: string): void
  resolvePinState(thread: SdkThread): PinState
}
```

Lifecycle is **constructor + init/destroy**:

1. `new AccordoCommentSDK()`
2. `sdk.init(opts)`
3. normal operations
4. `sdk.destroy()`

---

## 4. Data Model

```ts
interface SdkComment {
  id: string
  author: { kind: "user" | "agent"; name: string }
  body: string
  createdAt: string
}

interface SdkThread {
  id: string
  blockId: string
  status: "open" | "resolved"
  hasUnread: boolean
  comments: SdkComment[]
}

type PinState = "open" | "updated" | "resolved"

interface ScreenPosition { x: number; y: number }
type CoordinateToScreen = (blockId: string) => ScreenPosition | null
```

Notes:

- `SdkComment.author` is an object (`{ kind, name }`), not a string.
- `SdkThread` does not currently include `uri`, `createdAt`, or `updatedAt`.
- `ScreenPosition` uses `{ x, y }`, not `{ top, left }`.

---

## 5. Host Callback Contract

```ts
interface SdkCallbacks {
  onCreate(blockId: string, body: string, intent?: string): void
  onReply(threadId: string, body: string): void
  onResolve(threadId: string, resolutionNote: string): void
  onReopen(threadId: string): void
  onDelete(threadId: string, commentId?: string): void
}

interface SdkInitOptions {
  container: HTMLElement
  coordinateToScreen: CoordinateToScreen
  callbacks: SdkCallbacks
}
```

The SDK invokes callbacks for user actions; the host decides how to persist/forward them.

---

## 6. Message Type Shapes (for host wiring)

The SDK exports protocol types for host/webview integration contracts:

```ts
type WebviewMessage =
  | { type: "comment:create"; blockId: string; body: string; intent?: string }
  | { type: "comment:reply"; threadId: string; body: string }
  | { type: "comment:resolve"; threadId: string; resolutionNote: string }
  | { type: "comment:reopen"; threadId: string }
  | { type: "comment:delete"; threadId: string; commentId?: string }

type HostMessage =
  | { type: "comments:load"; threads: SdkThread[] }
  | { type: "comments:add"; thread: SdkThread }
  | { type: "comments:update"; threadId: string; update: Partial<SdkThread> }
  | { type: "comments:remove"; threadId: string }
  | { type: "comments:focus"; threadId: string }
```

---

## 7. Integration Boundary Ownership

`@accordo/comment-sdk` **does not** own host-message wiring (`window.addEventListener("message", ...)`) as a mandatory internal behavior.

Current model:

- SDK owns in-webview rendering + callbacks
- Consumers (`md-viewer`, `marp`, `diagram`, `browser-extension`) own host-message transport wiring and map host events to SDK method calls

---

## 8. Requirements

| ID | Requirement |
|---|---|
| M41-SDK-01 | `init()` creates SDK layer and registers interaction handlers |
| M41-SDK-02 | `loadThreads()` renders one pin per resolvable thread |
| M41-SDK-03 | `addThread()` adds one thread incrementally |
| M41-SDK-04 | `updateThread(threadId, update)` updates state/badge in place |
| M41-SDK-05 | `removeThread(threadId)` removes pin and thread mapping |
| M41-SDK-06 | Pin state classes are `accordo-pin--open`, `--updated`, `--resolved` |
| M41-SDK-07 | Alt+click creation flows through `onCreate` callback |
| M41-SDK-08 | Pin click opens popover with chronological comments |
| M41-SDK-09 | Open-thread popover supports reply/resolve/delete actions |
| M41-SDK-10 | Resolved-thread popover supports reopen/delete actions |
| M41-SDK-11 | Only one popover may be open at a time |
| M41-SDK-12 | Outside click closes active popover |
| M41-SDK-13 | `destroy()` tears down layer/listeners/internal state |
| M41-SDK-14 | `resolvePinState()` maps thread status/unread to visual state |

---

## 9. Test Coverage

- Test file: `packages/comment-sdk/src/__tests__/sdk.test.ts`
- Current suite size: **47 tests**
- Scope: lifecycle, thread operations, pin state classes, popover behaviors, callback invocation, and state mapping helpers
