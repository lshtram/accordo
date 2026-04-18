# Accordo — Presentation Modality Architecture v1.1

**Status:** HISTORICAL (Slidev-era)  
**Date:** 2026-03-05  
**Scope:** Phase 3 presentations modality (`accordo-slidev`)

> **This document describes the Slidev-era architecture.** It is retained for historical reference. The active presentation engine is **Marp**, documented in [`marp-architecture.md`](marp-architecture.md). The `accordo-slidev` package is not currently available in this workspace.

---

## 1. Goal

Enable an agent to prepare, present, and discuss high-quality technical presentations inside VS Code, with:

1. **Comments mode** — async, thread-based collaboration on slides via Comment SDK.
2. **Agent slide control** — agent navigates and controls the deck via MCP tools.
3. **Narration text generation** — agent produces per-slide narration text (voice playback deferred to Phase 4 `accordo-voice`).

The modality must fit the existing Accordo control plane:

- Hub remains editor-agnostic.
- Bridge remains the only VS Code-specific integration layer.
- Presentation extension registers tools and publishes modality state through Bridge.

---

## 2. Framework Decision (ADR-01)

### Decision

Use **Slidev as the primary authoring and rendering engine** for Phase 3, wrapped by an internal `PresentationRuntimeAdapter` interface so we can swap runtimes later if needed.

### Why Slidev for this project

- Markdown-first authoring is agent-friendly (agents already write markdown/code well).
- Built on Vite and reveal.js, with mature navigation semantics.
- Strong code-slide support for walkthroughs and technical comparisons.
- Easy to run inside a webview where Comment SDK can be embedded alongside.

### Is Slidev "the best" choice?

For Accordo's current goals, it is the best **pragmatic default**, not an irreversible lock-in.  
If requirements later shift toward design-heavy, non-technical decks, we should consider a second adapter (for example Marp/reveal-only).

### Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Slidev | Best technical authoring model, strong code support, reveal-compatible navigation | More moving parts than raw reveal | **Chosen** |
| Raw reveal.js | Smallest runtime surface | Requires building authoring/tooling from scratch | Not chosen now |
| Marp | Very simple markdown slides | Weaker advanced runtime/control surface for interactive agent sessions | Not chosen now |

---

## 3. Runtime Integration Decision (ADR-02)

### Decision

Run **Slidev as an embedded dev server** (`npx slidev --port <N>`), hosted in the webview via an iframe pointing to `localhost:<N>`.

### Rationale

Slidev is a full Vite dev server with HMR. It cannot be injected as a static `<script>` asset into a webview. Two integration styles were considered:

| Approach | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| Embedded dev server | Start `slidev --port <N>` as child process; webview loads `localhost:<N>` in an iframe | Live HMR, existing Slidev WebSocket API for navigation, consistent with other Slidev VS Code extensions | Requires port management and CSP iframe-src | **Chosen** |
| Static export | Pre-render slides to static HTML, inject into webview | Simpler CSP story | Loses HMR, requires re-export on edit, no Slidev API for navigation control | Not chosen |

### How it works

1. `PresentationProvider.open(deckUri)` spawns `npx slidev <deckUri> --port <N> --remote false`.
2. Port `<N>` is chosen dynamically (pick free port, or configurable).
3. The webview HTML contains an `<iframe>` pointing at the Slidev server's URL, wrapped via `vscode.env.asExternalUri(Uri.parse("http://localhost:<N>"))` for remote safety.
4. The `PresentationRuntimeAdapter` polls the Slidev REST endpoint (`GET http://localhost:<N>/json`) for reliable current-slide state (iframe URL tracking is unreliable; this endpoint is the authoritative source).
5. Comment SDK runs as an overlay injected into the webview alongside the iframe (not inside the Slidev iframe itself, to avoid CSP conflicts with Slidev's own policies).
6. On `dispose()`, the Slidev child process is killed.

---

## 4. System Overview

```
Agent (MCP client)
  -> Hub (tool registry, state, prompt)
  -> Bridge (routes invoke to extension handlers)
  -> accordo-slidev (VS Code extension)
      - Presentation tools (MCP)
      - Narration text generation tool
      - Presentation session state
      - WebviewPanel provider + Slidev runtime adapter
      - Comments bridge (to accordo-comments via generalized surface adapter)
  -> WebviewPanel
      - <iframe src="localhost:N">   (Slidev dev server)
      - Comment SDK overlay           (pins on slide regions)
```

---

## 5. Components

### 5.1 `accordo-slidev` extension

- `extension.ts`: activation, dependency checks, registration.
- `presentation-provider.ts`: opens and manages WebviewPanel; spawns/kills Slidev process.
- `runtime-adapter.ts`: runtime-neutral interface for `listSlides/getCurrent/goto/next/prev`.
- `slidev-adapter.ts`: Slidev-specific implementation of runtime adapter (talks to Slidev server).
- `presentation-tools.ts`: MCP tools and discover tool.
- `presentation-state.ts`: in-memory session state and Bridge `publishState`.
- `presentation-comments-bridge.ts`: Comment SDK message bridge using generalized surface adapter.

### 5.2 Dependencies and boundaries

- Depends on `accordo-bridge` for tools/state registration.
- Depends on `accordo-comments` for thread persistence via the **generalized surface adapter** (`accordo.comments.internal.getSurfaceAdapter`).
- No dependency on `accordo-voice` (deferred to Phase 4).
- No Hub package changes required for base routing behavior.

---

## 6. MCP Tool Surface

Tools are grouped as `presentation`; only `accordo.presentation.discover` is prompt-visible by default.

- `accordo.presentation.discover`
- `accordo.presentation.open`
- `accordo.presentation.close`
- `accordo.presentation.listSlides`
- `accordo.presentation.getCurrent`
- `accordo.presentation.goto`
- `accordo.presentation.next`
- `accordo.presentation.prev`
- `accordo.presentation.generateNarration`

Tool naming follows existing `accordo.<group>.<action>` conventions.

### Tool danger levels

- Navigation/read tools (`listSlides`, `getCurrent`, `goto`, `next`, `prev`): `safe`, `requiresConfirmation: false`
- Session management (`open`, `close`): `moderate`, `requiresConfirmation: false`
- Narration generation (`generateNarration`): `safe`, `requiresConfirmation: false`

---

## 7. Comments Integration — Generalized Surface Adapter

### 7.1 Problem

The current `accordo.comments.internal.getStore` command returns an adapter shaped specifically for markdown previews: it takes `{ blockId, body, intent, line? }` and builds `block` or `text` anchors internally. This shape does not generalise to slides (`slideIndex + x,y`), Excalidraw diagrams (`nodeId`), or browser surfaces (`normalized x,y`).

### 7.2 Design

Introduce a **generalized surface adapter** command alongside the existing `getStore`:

```
accordo.comments.internal.getSurfaceAdapter
```

The adapter accepts a full `CommentAnchor` and delegates anchor construction to the caller (each modality knows its own anchor shape). The adapter interface:

```ts
interface SurfaceCommentAdapter {
  createThread(args: {
    uri: string;
    anchor: CommentAnchor;        // caller provides the full anchor
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

### 7.3 Modality anchor mapping

Each surface consumer constructs its own anchor:

| Surface | surfaceType | coordinates type | Example |
|---|---|---|---|
| Markdown preview | `"markdown-preview"` | `BlockCoordinates` | `{ type: "block", blockId: "heading:2:intro", blockType: "heading" }` |
| Slides | `"slide"` | `SlideCoordinates` | `{ type: "slide", slideIndex: 3, x: 0.5, y: 0.3 }` |
| Excalidraw (Phase 5) | `"diagram"` | `DiagramNodeCoordinates` | `{ type: "diagram-node", nodeId: "abc123" }` |
| Browser (future) | `"browser"` | `NormalizedCoordinates` | `{ type: "normalized", x: 0.7, y: 0.2 }` |

### 7.4 SDK anchor abstraction

The Comment SDK uses `blockId: string` as its pin anchor — **this type stays unchanged**.

Slide surfaces encode the pin location as an opaque string in `blockId` following this convention:

```
blockId = "slide:{slideIndex}:{x}:{y}"
```

Where `x` and `y` are 0–1 floats to 4 decimal places (fraction of the slide width/height). Example: `"slide:3:0.5000:0.3000"`.

The mapping between this opaque string and `SlideCoordinates` is handled by `presentation-comments-bridge.ts`, not by the SDK. Existing `md-viewer` consumers are unaffected (`blockId` format unchanged for markdown previews).

### 7.5 Backwards compatibility

The existing `getStore` command remains unchanged for `md-viewer`. The new `getSurfaceAdapter` is additive. When `md-viewer` is next refactored, it can optionally migrate to `getSurfaceAdapter` (not required now).

---

## 8. Session Model

- **One presentation session at a time.** Opening a new deck closes the previous session (kills the Slidev process and disposes the webview).
- Closing the webview panel ends the session and resets state to `{ isOpen: false, deckUri: null, ... }`.
- Calling `open` on the same URI that is already active refocuses the existing panel (no restart).

---

## 9. Modality State Contribution

`accordo-slidev` publishes to `modalities["accordo-slidev"]`:

```ts
{
  isOpen: boolean;
  deckUri: string | null;
  currentSlide: number;
  totalSlides: number;
  narrationAvailable: boolean;    // true when generateNarration has been called at least once
}
```

### State publication wiring

`PresentationState` subscribes to:
- Runtime adapter `slideChanged` events → updates `currentSlide`.
- WebviewPanel `onDidDispose` → resets to closed state.
- `open`/`close` tool handlers → updates `isOpen`, `deckUri`, `totalSlides`.
- `generateNarration` tool handler → sets `narrationAvailable`.

Every state transition calls `bridge.publishState("accordo-slidev", state)`.

---

## 10. Remote and Webview Constraints

- Extension remains `extensionKind: ["workspace"]` to stay consistent with Accordo modalities.
- The Slidev dev server runs on `localhost`; its URL must be wrapped with `vscode.env.asExternalUri()` for SSH/devcontainer/Codespaces support.
- The webview CSP must allow `frame-src` for the Slidev localhost origin.
- Communication with the comments extension uses internal VS Code commands for cross-host safety.

---

## 11. Security and Safety

- No handler functions cross Bridge/Hub boundaries.
- Navigation tools default to `safe`.
- No execution of arbitrary shell/code from slide content (Slidev runs in its own sandbox).
- Webview CSP: nonce-based script policy; `frame-src` restricted to the Slidev localhost origin.
- The Slidev process is started with `--remote false` to prevent external network access.

---

## 12. Testing Strategy

- Unit tests for runtime adapter, tool handlers, and state publishing.
- Unit tests for comments bridge message translation using the generalized surface adapter.
- Unit tests for narration text generation output format.
- Smoke tests for:
  - open deck → spawn Slidev process → webview loads
  - navigate slides → slideChanged events fire
  - comment roundtrip (SDK → bridge → store → push back)
  - close deck → process killed → state reset

---

## 13. Affected Packages

- New: `packages/slidev` (`accordo-slidev`)
- Existing updates:
  - `packages/comments` — add `accordo.comments.internal.getSurfaceAdapter` command (generalized surface adapter)
  - `packages/comment-sdk` — **no type changes**; `blockId: string` stays as-is; slide anchors use `blockId: "slide:{idx}:{x}:{y}"` convention decoded by the comments bridge
  - `packages/bridge-types` — no new types needed (`SlideCoordinates` and `SurfaceType: "slide"` already exist)
  - `packages/bridge` (no API changes expected)
  - `packages/hub` (no routing changes; prompt behavior unchanged)

---

## 14. Phase Boundaries

| Item | Phase 3 (this) | Phase 4 (voice) | Phase 5 (diagrams) |
|---|---|---|---|
| Slide deck open/navigate/close | ✅ | — | — |
| Comments on slides | ✅ | — | — |
| Per-slide narration text generation | ✅ | — | — |
| Voice playback / TTS | — | ✅ | — |
| Live Q&A / interruptions | — | ✅ | — |
| Excalidraw comments | — | — | ✅ (uses same surface adapter) |
| Browser extension comments | — | — | Future (uses same surface adapter) |

