# accordo-diagram — Requirements Specification

**Package:** `accordo-diagram`  
**Type:** VS Code extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-03-15

---

## 1. Purpose

Accordo Diagram renders Mermaid diagram files (`.mmd`) inside a VS Code webview using Excalidraw as the canvas engine. Agents can create, patch, and style diagrams via MCP tools; users can interact with the canvas directly. Comment threads can be pinned to diagram nodes, edges, and clusters.

**Architecture reference:** `docs/diag_arch_v4.2.md`  
**Workplan (status + open items):** `docs/diag_workplan.md`

---

## 2. diag.1 Tooling Requirements (A1–A17, implemented)

diag.1 was implemented before this requirements document was created. The stable requirement IDs are anchored in the test files (`DT-*`, `AP-*`, `EX-*`, etc.). See `docs/diag_workplan.md §DONE` for module-by-module status and test counts.

---

## 3. Module A18 — Diagram Comments Bridge

**New file:** `packages/diagram/src/comments/diagram-comments-bridge.ts`  
**Test file:** `packages/diagram/src/__tests__/diagram-comments-bridge.test.ts`  
**Architecture reference:** `docs/diag_arch_v4.2.md §25`  
**Pattern:** Matches `M44-CBR` (slidev) — pure consumer of `SurfaceCommentAdapter`

### 3.1 Extension host requirements

| ID | Requirement |
|---|---|
| A18-R01 | `DiagramPanel` calls `vscode.commands.executeCommand('accordo_comments_internal_getSurfaceAdapter', mmdUri)` during panel creation and passes the result to the `DiagramCommentsBridge` constructor; bridge has no `vscode` import and is VS Code-agnostic (testable without a vscode mock) |
| A18-R02 | Bridge routes `comment:create` → builds `CommentAnchorSurface` (`{ kind:'surface', uri:mmdUri, surfaceType:'diagram', coordinates:{ type:'diagram-node', nodeId:blockId } }`) and calls `adapter.createThread({ uri:mmdUri, anchor, body, intent? })`; `mmdUri` is panel-owned (not supplied by the webview) |
| A18-R03 | Bridge routes `comment:reply` → `adapter.reply({ threadId, body })` |
| A18-R04 | Bridge routes `comment:resolve` → `adapter.resolve({ threadId })` |
| A18-R05 | Bridge routes `comment:reopen` → `adapter.reopen({ threadId })` |
| A18-R06 | Bridge routes `comment:delete` → `adapter.delete({ threadId })` |
| A18-R07 | `DiagramCommentsBridge.loadThreadsForUri(mmdUri)` calls `adapter.getThreadsForUri(mmdUri)`, posts `{ type:'comments:load', threads }` to webview, and subscribes to `adapter.onChanged` for future updates |
| A18-R08 | `adapter.onChanged` fires → bridge calls `adapter.getThreadsForUri(mmdUri)` and re-posts `{ type:'comments:load', threads }` (full reload; `SurfaceCommentAdapter` has no per-thread add/update events) |
| A18-R09 | `comment:create` webview message must include `body: string` (user-entered text); the webview collects the body via SDK UI before posting — bridge does not default or invent a body |
| A18-R09b | When the webview Alt+click hit-test identifies a target element, it opens a custom inline input overlay (not the SDK's built-in input, which requires `[data-block-id]` DOM elements). On submit the overlay posts `comment:create`; on Escape or outside-click the overlay is dismissed with no side-effect. |
| A18-R10 | Unknown inbound message type → no adapter call, no error thrown |
| A18-R11 | `getSurfaceAdapter` returns `undefined` (comments extension not loaded) → `DiagramCommentsBridge` is inert; all messages silently ignored, no crash |
| A18-R12 | `dispose()` cleans up: `onChanged` subscription disposed, no further messages forwarded |
| A18-R13 | All diagram element types (node, edge, cluster) use `{ type:'diagram-node', nodeId:blockId }` — the full blockId string (e.g. `"edge:auth->api:0"`) is stored verbatim as `nodeId`; no new bridge-types coordinate types are needed |
| A18-R14 | Orphaned threads (node deleted from diagram) remain visible in Comments panel; no canvas pin rendered (canvas ignores unknown block IDs) |
| A18-R15 | No changes to `@accordo/comment-sdk`, `packages/comments/`, or `packages/bridge/` |

### 3.2 Webview requirements (manual acceptance — D3 checklist)

| ID | Requirement |
|---|---|
| A18-W01 | `webview.ts` calls `sdk.init()` with canvas-aware `coordinateToScreen` that resolves block IDs via `IdMap` + Excalidraw `getSceneElements()` / `getAppState()` scroll+zoom+container-offset transform |
| A18-W02 | Webview intercepts `Alt+click` on canvas; performs bounding-box hit-test against scene elements; maps hit to `blockId` via `IdMap.excalidrawToMermaid` |
| A18-W03 | On receiving `comments:load` from panel, webview calls `sdk.loadThreads(threads)` |
| A18-W04 | Pin icons appear at correct canvas positions after scroll, zoom, and VS Code window resize |
| A18-W05 | After a successful hit-test (A18-W02), webview opens a custom inline text-input overlay positioned near the hit element. On submit: overlay closes, `comment:create { blockId, body }` is posted to host. On Escape or click-outside: overlay closes, no message sent. |

### 3.3 Protocol additions (`protocol.ts`)

```typescript
// Webview → host (new inbound messages)
// Note: no surfaceUri — host bridge uses the panel-owned mmdUri (same model as Slidev M44-CBR)
type CommentCreateMessage  = { type: 'comment:create';  blockId: string; body: string; intent?: string };
type CommentReplyMessage   = { type: 'comment:reply';   threadId: string; body: string };
type CommentResolveMessage = { type: 'comment:resolve'; threadId: string };
type CommentReopenMessage  = { type: 'comment:reopen';  threadId: string };
type CommentDeleteMessage  = { type: 'comment:delete';  threadId: string };

// Host → webview (full-reload only — SurfaceCommentAdapter has no per-thread add/update events)
type CommentsLoadMessage   = { type: 'comments:load';   threads: CommentThread[] };
```

### 3.4 Block ID codec

```
node:{mermaidId}              → "node:auth", "node:api", "node:db"
edge:{from}->{to}:{ordinal}   → "edge:auth->api:0", "edge:api->db:0"
cluster:{clusterId}           → "cluster:system", "cluster:infra"
```

All three are encoded as `DiagramNodeCoordinates { type: 'diagram-node', nodeId: blockId }` — the full blockId string is stored as `nodeId`.

### 3.5 Unit test plan

Tests mock `vscode.commands.executeCommand` and `SurfaceCommentAdapter`. Canvas context (`webview.ts`) is not unit-testable; W01–W04 are verified via the D3 checklist.

| ID | Test description |
|---|---|
| A18-T01 | Constructor calls `getSurfaceAdapter`; stores adapter reference |
| A18-T02 | `comment:create` message → `adapter.createThread()` called with correct anchor (`kind:'surface'`, `surfaceType:'diagram'`, `nodeId:blockId`) and `body` |
| A18-T03 | `comment:reply` message → `adapter.reply({ threadId, body })` |
| A18-T04 | `comment:resolve` message → `adapter.resolve({ threadId })` |
| A18-T05 | `comment:reopen` message → `adapter.reopen({ threadId })` |
| A18-T06 | `comment:delete` message → `adapter.delete({ threadId })` |
| A18-T07 | `loadThreadsForUri(mmdUri)` posts `{ type:'comments:load', threads }` immediately from `adapter.getThreadsForUri()` |
| A18-T08 | `adapter.onChanged` fires → bridge re-posts `{ type:'comments:load', threads }` (full reload) |
| A18-T09 | Calling `loadThreadsForUri` a second time replaces the prior `onChanged` subscription (no double-subscribe) |
| A18-T10 | Unknown message type received → no adapter call, no throw |
| A18-T11 | `getSurfaceAdapter` returns `undefined` → all messages silently ignored |
| A18-T12 | `dispose()` → `onChanged` subscription disposed; no further events forwarded |

### 3.6 D3 manual acceptance checklist

Before Phase F commit, manually verify all of the following:

- [ ] A18-W01: Alt+click a node — inline input overlay appears (not the SDK default dialog)
- [ ] A18-W01: Node pin is positioned correctly at 100 % editor zoom
- [ ] A18-W02: Hit-test correctly identifies the target element
- [ ] A18-W05: Submitting overlay posts `comment:create` with correct `blockId` and non-empty `body`; thread appears in Comments panel anchored to the correct `.mmd` file URI
- [ ] A18-W05: Escape and outside-click dismiss overlay with no side-effect
- [ ] A18-W03: Reloading Comments panel calls `sdk.loadThreads(threads)` correctly (pins re-render)
- [ ] A18-W04: Pin position survives canvas scroll (drag the canvas)
- [ ] A18-W04: Pin position survives Excalidraw zoom in / zoom out
- [ ] A18-W04: Pin position survives VS Code window resize
- [ ] A18-W04: Pin position correct at OS display scaling 125 %, 150 %, 200 % (§25.2 DPI caution)

---

## 4. Deferred / Future Modules

See `docs/diag_workplan.md §diag.2 — Remaining Modules` for the full backlog (topology tools, additional parsers, undo/redo, etc.).
