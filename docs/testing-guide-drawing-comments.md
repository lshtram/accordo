# Testing Guide — drawing-comments

**Module:** `accordo-drawing` comment parity  
**TDD Phase:** D3 — automated and manual verification  
**Created:** 2026-05-06

---

## 1. Automated Verification

Run these from the Drawing package:

```bash
cd packages/drawing
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

What they verify:

- `DRW-C01` / `DRW-C02`: managed Drawing entities produce compatible comment block IDs (`node:*`, `edge:*`, `cluster:*`) and only active primary managed targets are commentable.
- `DRW-C03` / `DRW-C04`: edge hit-testing, edge midpoint placement, and viewport-to-screen pin positioning apply pan/zoom consistently.
- `DRW-C05` / `DRW-C06`: `DrawingCommentsBridge` routes create/reply/resolve/reopen/delete through `SurfaceCommentAdapter`, converts store `CommentThread[]` to canonical `SdkThread[]`, refreshes on matching URI changes, ignores foreign URI changes, and disposes subscriptions.
- `DRW-C07`: Drawing registers the compatibility focus command `accordo_diagram_focusThread` and forwards canonical `comments:focus` to the panel webview.
- `DRW-C08`: the custom-editor lifecycle constructs, uses, and disposes the comment bridge.
- `DRW-C09`: package identity proof covers dependency on `accordo.accordo-comments`, and provider runtime proof covers acquiring `accordo_comments_internal_getSurfaceAdapter` before loading surface threads.
- Webview controller tests verify canonical `@accordo/comment-sdk` host messages (`comments:load`, `comments:focus`) and SDK callbacks (`comment:create`, `comment:reply`, `comment:resolve`, `comment:reopen`, `comment:delete`).
- Packaging boundary tests verify canonical comment SDK CSS is copied into `dist/webview/comment-sdk.css` and webview HTML loads that artifact path.

Expected current result:

- `pnpm test`: 29 files / 150 tests passing.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build`: clean.

---

## 2. Manual / User-Facing Verification

These steps must be run in a live VS Code extension host because package tests cannot host the real VS Code webview renderer or human Comments panel click path.

### 2.1 Open a drawing and verify comment pins

1. Start/reload the Accordo development VS Code window.
2. Open a `.mmd` drawing through `accordo_editor_open` or the VS Code explorer.
3. Create two comments via MCP `comment_create` using the drawing `.mmd` URI:
   - node anchor: `coordinates: { type: "diagram-node", nodeId: "node:<existing-node-id>" }`
   - edge anchor: `coordinates: { type: "diagram-node", nodeId: "edge:<existing-edge-id>" }`
4. Verify visible pins appear on the node shape and edge polyline.

### 2.2 Verify viewport tracking

1. With node and edge pins visible, pan the Excalidraw canvas.
2. Zoom in and out.
3. Verify pins remain attached to the same node/edge targets and do not drift.

### 2.3 Verify comment lifecycle sync

1. Use the visible pin/popover or MCP tools to reply to a drawing thread.
2. Resolve the thread.
3. Reopen the thread.
4. Delete the thread.
5. Verify the open drawing panel updates without closing/reopening the drawing.

### 2.4 Verify Comments panel focus path

1. Open the Accordo Comments panel.
2. Select/click a drawing comment thread.
3. If the drawing panel is closed, verify Drawing opens the correct custom editor.
4. Verify the target thread popover opens via the `comments:focus` path.

---

## 3. Known Residual Risk Before Manual Check

Automated tests prove the host/provider/webview-controller boundaries and the canonical comment SDK protocol. The final visual behavior depends on the real VS Code webview and Excalidraw runtime, so visible pins, popover focus, and pan/zoom feel must be confirmed manually before Phase E approval.
