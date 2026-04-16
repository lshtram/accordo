# Marp Slide Comments — Phase A Design

**Date:** 2026-04-16  
**Status:** Phase A — design only, no implementation  
**Scope:** Wire Comment SDK into the Marp webview for real comment creation, viewing, and focus routing

---

## 1. Problem

The Marp webview HTML (`presentation-provider.ts → buildWebviewHtml`) renders slides but does **not** initialize the Comment SDK. The host-side `PresentationCommentsBridge` correctly translates `comment:*` messages and pushes `comments:load`, but the webview never sends or receives these messages because:

1. The Comment SDK JS/CSS is not loaded in the webview HTML.
2. No `sdk.init()` call exists — no Alt+click handler, no pin rendering.
3. No `comments:load` / `comments:focus` message handler exists in the webview script.
4. The `comments:focus` panel-to-webview path (from NavigationRouter) has no registered command.

---

## 2. Design Decisions

### D1: Reuse Comment SDK exactly as md-viewer does

The md-viewer webview-template.ts is the canonical pattern:
- Load `sdk.js` + `sdk.css` via `<script>`/`<link>` with nonce
- Call `sdk.init({ container, coordinateToScreen, callbacks })` 
- Wire `callbacks` to `vscode.postMessage({ type: 'comment:create', ... })`
- Handle `comments:load`, `comments:add`, `comments:update`, `comments:remove`, `comments:focus` from host

Marp follows this pattern identically. No new SDK features needed.

### D2: Extract `buildMarpWebviewHtml` into a separate module

Currently `buildWebviewHtml` is a function in `presentation-provider.ts` that returns a giant HTML string with inline `<script>`. Adding Comment SDK wiring would make this even larger.

**New file: `src/marp-webview-html.ts`**
- Exports `buildMarpWebviewHtml(opts: MarpWebviewHtmlOptions): string`
- Options include: `renderResult`, `nonce`, `cspSource`, `sdkJsUri`, `sdkCssUri` (all optional SDK URIs — when absent, comments are disabled)
- The inline `<script>` includes the SDK init + message handlers (same pattern as md-viewer)
- `presentation-provider.ts` calls this function instead of its current inline `buildWebviewHtml`

The old `buildWebviewHtml` in `presentation-provider.ts` is replaced (not kept alongside).

### D3: `coordinateToScreen` for slides

Slides use `blockId = "slide:{slideIndex}:{x}:{y}"` (from `encodeBlockId`). The webview `coordinateToScreen` function:
1. Parses the blockId to extract `slideIndex`, `x`, `y`
2. Finds the active `<svg data-marpit-svg>` element
3. Maps normalized `(x, y)` coordinates (0–1 range) to pixel positions within the SVG bounding rect
4. Returns `null` if the slide is not the currently visible one

Alt+click handler: captures click position relative to the active slide SVG, normalizes to 0–1, calls `encodeBlockId` to produce the blockId, then invokes `callbacks.onCreate`.

### D4: PresentationCommentsBridge — keep as-is

The existing `PresentationCommentsBridge` is correct and complete:
- `handleWebviewMessage` → forwards `comment:*` to the adapter
- `loadThreadsForUri` → subscribes to store changes, pushes `comments:load`
- `buildAnchor` → constructs `CommentAnchorSurface` from blockId

No changes needed. The bridge already handles `comments:focus` forwarding via `sender.postMessage`.

### D5: Focus routing — register `accordo.presentation.internal.focusThread` command

The comments-panel-architecture.md §3.2 says slide focus goes through:
```
accordo.presentation.open(deckUri) → settling → accordo.presentation.goto(slideIndex)
```

This is insufficient for thread-level focus (opening the popover). Add:

**New VS Code command: `accordo.presentation.internal.focusThread`**
- Registered in `extension.ts`
- Parameters: `(uri: string, threadId: string, blockId: string)`
- Implementation: ensures deck is open → navigates to the correct slide (parsed from blockId) → posts `{ type: 'comments:focus', threadId, blockId }` to the webview

Update the NavigationRouter routing table to use this command for `surfaceType: "slide"`.

### D6: No Slidev dead code

There is no `accordo-slidev` package in this repo. The only Slidev references are:
- Documentation comparisons in requirements-marp.md §1.1 (keep — explains "why Marp")
- Engine gate in `extension.ts` (`if (engineSetting === "slidev") return`) — keep for forward-compat
- Test assertions that namespace is "accordo-marp" not "accordo-slidev" — keep

No duplicate comment architecture exists. The single path is: Comment SDK (webview) → postMessage → PresentationCommentsBridge (host) → SurfaceCommentAdapter → CommentStore.

### D7: CSP update

The webview CSP must allow loading the SDK script and stylesheet. Add the SDK URIs to the `script-src` and `style-src` directives (same pattern as md-viewer).

---

## 3. File Plan

| File | Action | Responsibility |
|---|---|---|
| `src/marp-webview-html.ts` | **NEW** | `buildMarpWebviewHtml(opts)` — HTML template with Comment SDK init, slide nav, message handlers |
| `src/presentation-provider.ts` | **MODIFY** | Replace inline `buildWebviewHtml` with call to `marp-webview-html.ts`; pass SDK URIs from extension context; call `commentsBridge.loadThreadsForUri()` after webview ready; handle `comments:focus` forwarding |
| `src/extension.ts` | **MODIFY** | Register `accordo.presentation.internal.focusThread` command; resolve SDK asset URIs from `@accordo/comment-sdk` |
| `src/presentation-comments-bridge.ts` | **NO CHANGE** | Already correct |
| `src/types.ts` | **NO CHANGE** | No new types here — `MarpWebviewHtmlOptions` lives in `marp-webview-html.ts` |

### Dependencies

- `@accordo/comment-sdk` — already a workspace dependency (used by bridge-types import chain); needs to be added to `package.json` if not already there for the webview JS/CSS assets.

---

## 4. Interface Sketch

```typescript
// src/marp-webview-html.ts

export interface MarpWebviewHtmlOptions {
  renderResult: MarpRenderResult;
  nonce: string;
  cspSource: string;
  /** When provided, Comment SDK is initialized in the webview */
  sdkJsUri?: string;
  sdkCssUri?: string;
}

export function buildMarpWebviewHtml(opts: MarpWebviewHtmlOptions): string;
```

```typescript
// extension.ts — new command registration (sketch)

// accordo.presentation.internal.focusThread
// (uri: string, threadId: string, blockId: string) => void
```

---

## 5. Message Flow

### Comment Creation (user Alt+clicks slide)
```
Webview: Alt+click → coordinateToScreen → sdk.onCreate callback
  → vscode.postMessage({ type: 'comment:create', blockId, body })
Host: PresentationProvider.handleWebviewMessage
  → PresentationCommentsBridge.handleWebviewMessage
  → SurfaceCommentAdapter.createThread(anchor)
  → CommentStore persists
  → onChanged fires → PresentationCommentsBridge pushes comments:load
Webview: sdk.loadThreads(threads) → pin rendered
```

### Comment Viewing (deck opened)
```
Host: PresentationProvider.open()
  → commentsBridge.loadThreadsForUri(deckUri)
  → adapter.getThreadsForUri → sender.postMessage({ type: 'comments:load', threads })
Webview: sdk.loadThreads(threads) → pins rendered for current slide
```

### Focus from Panel
```
Panel: user clicks thread → NavigationRouter
  → executeCommand('accordo.presentation.internal.focusThread', uri, threadId, blockId)
Host: command handler → ensure deck open → parse slideIndex from blockId → goto(slideIndex)
  → webview.postMessage({ type: 'comments:focus', threadId, blockId })
Webview: scroll to slide (already there via goto) → sdk.openPopover(threadId)
```

---

## 6. What This Does NOT Include

- No new Comment SDK features (the SDK is sufficient as-is)
- No changes to `PresentationCommentsBridge` (already correct)
- No Slidev package or duplicate architecture
- No changes to the comment store, panel, or MCP tools
