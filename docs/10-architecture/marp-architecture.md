# Accordo — Marp Presentation Engine Architecture v1.0

**Status:** ACTIVE  
**Date:** 2026-03-19  
**Scope:** `accordo-marp` — lightweight presentation modality alternative to `accordo-slidev`

---

## 1. Goal

Provide a **zero-setup, cross-platform** presentation engine for Accordo IDE that:

1. Works identically on Windows, macOS, and Linux without platform-specific workarounds.
2. Starts in under 2 seconds (no npm installs, no dev server boot).
3. Exposes the **same 9 MCP tools** as `accordo-slidev` — engine swap is transparent to agents.
4. Supports comments via the existing Comment SDK and surface adapter pattern.
5. Supports per-slide narration text generation.

---

## 2. Framework Decision (ADR-03)

### Decision

Use **Marp Core** (`@marp-team/marp-core`) as a **bundled dependency** that renders Markdown to static HTML in-process. No child process, no dev server, no npm runtime installs.

### Why Marp

| Concern | Slidev (ADR-01) | Marp (ADR-03) |
|---|---|---|
| Runtime | Full Vite dev server as child process | Pure JS library, renders in extension host |
| Startup | 5–180 s (cold npm cache) | < 1 s |
| Port management | Scan range 7788–7888, `asExternalUri` | None |
| Platform parity | Windows needs `shell: true`, stdin pipe flags, `npx.cmd` shims | No platform differences |
| Process lifecycle | Must kill child on dispose, handle crashes, stderr forwarding | No process to manage |
| Navigation | HTTP polling `GET /json` + `POST /navigate/{index}` | In-webview JS: scroll to `<section>` by index |
| Live reload | HMR via Vite WebSocket | Re-render on file save, push HTML via `postMessage` |
| Advanced features | Vue components, Monaco, Shiki, layouts | CSS themes, directives, Shiki (via marp-core) |

### Trade-offs accepted

- No HMR (full re-render on save — acceptable for < 1s render times).
- No Vue component slides (Marp is pure CSS/Markdown).
- No built-in presenter mode (can be added later).

### Alternatives NOT chosen for this engine

| Option | Verdict |
|---|---|
| Slidev | Already implemented — kept as alternative engine |
| Raw reveal.js | Would require building everything from scratch |
| Marp CLI (child process) | Defeats the purpose — we want in-process rendering |

---

## 3. System Overview

```
Agent (MCP client)
  → Hub (tool registry, state, prompt)
  → Bridge (routes invoke to extension handlers)
  → accordo-marp (VS Code extension)
      ├── Presentation tools (9 MCP tools, same names as Slidev)
      ├── MarpRenderer (Markdown → HTML, in-process)
      ├── MarpAdapter (implements PresentationRuntimeAdapter)
      ├── Presentation session state
      ├── WebviewPanel provider (direct HTML injection, no iframe)
      ├── Comments bridge (to accordo-comments via surface adapter)
      └── FileSystemWatcher (live reload on save)
  → WebviewPanel
      ├── Marp-rendered <section> slides (direct HTML, no iframe)
      ├── Navigation JS (keyboard + postMessage)
      └── Comment SDK overlay (pins on slide regions)
```

### Key architectural difference from Slidev

```
Slidev:  WebviewPanel → <iframe src="localhost:N"> → Slidev dev server (child process)
Marp:    WebviewPanel → <section> slides (injected HTML) → no server, no iframe
```

---

## 4. Components

### 4.1 `accordo-marp` extension

| File | Responsibility |
|---|---|
| `extension.ts` | Activation, engine selection, dependency checks, tool registration |
| `runtime-adapter.ts` | Runtime-neutral interface for all presentation engines |
| `marp-renderer.ts` | Wraps `@marp-team/marp-core`; Markdown → `{ html, css, slideCount, comments }` |
| `marp-adapter.ts` | Implements `PresentationRuntimeAdapter`; local cursor tracking, webview message relay |
| `presentation-provider.ts` | WebviewPanel lifecycle; HTML injection; file watcher; live reload |
| `presentation-tools.ts` | 9 MCP tool definitions (reusable — identical interface to Slidev) |
| `presentation-state.ts` | Modality state publisher (reusable — identical to Slidev) |
| `presentation-comments-bridge.ts` | Comment SDK ↔ surface adapter (reusable — identical to Slidev) |
| `narration.ts` | Deck parsing + narration generation (reusable — near-identical to Slidev) |
| `types.ts` | Shared TypeScript interfaces |

### 4.2 Reuse from Slidev

Several modules are **structurally identical** between the two engines:

| Module | Reuse level | Notes |
|---|---|---|
| `presentation-tools.ts` | 95% identical | Same 9 tools, same `PresentationToolDeps`, same handler signatures |
| `presentation-state.ts` | Logically identical with engine-specific integration differences | Same `PresentationSessionState`, same publish wiring |
| `presentation-comments-bridge.ts` | Logically identical with engine-specific integration differences | Same blockId encoding, same anchor construction, same webview messages |
| `narration.ts` | 90% identical | Same parsing logic; Marp notes use `<!-- -->` like Slidev |
| `types.ts` | 95% identical | Same interfaces, Marp adds `MarpRenderResult` |
| `extension.ts` | 60% similar | Different activation logic (engine selection), no process spawning |
| `presentation-provider.ts` | 40% similar | Direct HTML injection vs iframe; file watcher vs process management |
| `marp-adapter.ts` vs `slidev-adapter.ts` | 30% similar | Local state vs HTTP polling; both implement same interface |

> **Future:** The logically-identical modules are candidates for extraction into a shared `@accordo/presentation-core` package. This is deferred — not needed until a third engine is considered. See §15 for the invariants required for safe reuse.

---

## 5. Engine Selection Architecture

### 5.1 Configuration

```
accordo.presentation.engine: "marp" | "slidev"   (default: "marp")
```

### 5.2 Activation flow

```
┌─────────────────┐     ┌──────────────────┐
│  accordo-marp   │     │  accordo-slidev  │
│  (activates)    │     │  (activates)     │
└────────┬────────┘     └────────┬─────────┘
         │                       │
    read setting            read setting
         │                       │
    engine="marp"?          engine="slidev"?
       ┌──┴──┐                ┌──┴──┐
       │ YES │                │ YES │
       └──┬──┘                └──┬──┘
    register 9 tools       register 9 tools
    publish state          publish state
         │                       │
    engine="slidev"?        engine="marp"?
       ┌──┴──┐                ┌──┴──┐
       │ YES │                │ YES │
       └──┬──┘                └──┬──┘
    yield (no-op)          yield (no-op)
```

Both extensions use the same tool names (`accordo.presentation.*`). Only one registers. The Hub/Bridge layer sees no difference.

### 5.3 MCP tool naming vs internal command naming

**MCP tools** (what agents call via Hub) use underscores: `accordo_presentation_*`. These are the canonical public surface.

**Internal VS Code commands** (registered by the extension) use dots or underscore+internal patterns:

| MCP tool | Internal command | Notes |
|---|---|---|
| `accordo_presentation_open` | `accordo.presentation.open` | VS Code command alias |
| `accordo_presentation_close` | `accordo.marp.close` | VS Code command |
| — | `accordo_presentation_internal_goto` | 0-based raw index; used by deferred fallback path in `navigation-router.ts` |
| — | `accordo.presentation.internal.focusThread` | Full sequence: open deck → navigate → post `comments:focus` to webview |
| — | `accordo_marp_internal_getNavigationRegistry` | Exposes `NavigationAdapterRegistry` to `accordo-comments` |

The `accordo.presentation.open` alias lets `accordo-comments`'s `navigation-router.ts` open a deck without depending on the `accordo.marp.open` command name directly.

### 5.4 Modality state key

- Marp publishes as `modalities["accordo-marp"]`
- Slidev publishes as `modalities["accordo-slidev"]`

The agent can detect which engine is active by checking which key exists.

---

## 6. Marp Rendering Pipeline

### 6.1 Render flow

```
Markdown file (.deck.md)
    │
    ▼
┌───────────────┐
│ MarpRenderer  │   ← @marp-team/marp-core (bundled JS dependency)
│  .render()    │
└───────┬───────┘
        │
        ▼
  { html, css, slideCount, comments[] }
        │
        ▼
┌───────────────────────────────────┐
│ PresentationProvider              │
│  buildWebviewHtml(renderResult)   │
│  → full HTML document with:       │
│    • <style> (Marp CSS + nav CSS) │
│    • <section> per slide           │
│    • Navigation JS                 │
│    • Comment SDK (if enabled)      │
└───────────────────────────────────┘
        │
        ▼
  webviewPanel.webview.html = fullHtml
```

### 6.2 Webview Message Protocol

The following table is the canonical protocol between webview and extension host. It mirrors `requirements-marp.md §6` exactly.

#### 6.2.1 Webview → Host messages

| Message type | Payload | Sender | Handler module |
|---|---|---|---|
| `presentation:ready` | (none) | Webview JS (on DOMContentLoaded) | `presentation-provider.ts` — sends initial `slide-index` to synchronize |
| `presentation:slideChanged` | `{ index: number }` | Webview JS (after scroll/nav) | `marp-adapter.ts` — updates local cursor; fires `onSlideChanged` listeners |
| `nav:next` | (none) | Webview JS (keyboard/button) | `marp-adapter.ts` → `next()` → `goto(current+1)` → sends `slide-index` back |
| `nav:prev` | (none) | Webview JS (keyboard/button) | `marp-adapter.ts` → `prev()` → `goto(current-1)` → sends `slide-index` back |
| `comment:create` | Comment SDK payload | Comment SDK overlay | `presentation-comments-bridge.ts` |
| `comment:reply` | Comment SDK payload | Comment SDK overlay | `presentation-comments-bridge.ts` |
| `comment:resolve` | Comment SDK payload | Comment SDK overlay | `presentation-comments-bridge.ts` |
| `comment:delete` | Comment SDK payload | Comment SDK overlay | `presentation-comments-bridge.ts` |

#### 6.2.2 Host → Webview messages

| Message type | Payload | Sender module | Webview handler |
|---|---|---|---|
| `slide-index` | `{ index: number, navigate?: boolean }` | `presentation-provider.ts` (on tool call or adapter event) | Webview JS — scrolls to `<section id="slide-{index}">` |
| `marp:update` | `{ html: string, css: string, currentSlide: number, revision: number }` | `presentation-provider.ts` (on file change) | Webview JS — replaces slide content, clamps currentSlide (see §6.5) |
| `comments:load` | Comment thread array | `presentation-comments-bridge.ts` | Comment SDK overlay |
| `comments:add` | Single thread | `presentation-comments-bridge.ts` | Comment SDK overlay |
| `comments:update` | Single thread | `presentation-comments-bridge.ts` | Comment SDK overlay |
| `comments:remove` | `{ threadId }` | `presentation-comments-bridge.ts` | Comment SDK overlay |

#### 6.2.3 Host-originated navigation round-trip (end-to-end)

When an agent calls a navigation tool (e.g., `accordo.presentation.goto`), the full round-trip is:

```
1. Agent → Hub → Bridge → presentation-tools.ts handler
2. Handler calls adapter.goto(index) [marp-adapter.ts]
3. Adapter validates bounds, updates local cursor
4. Adapter calls provider.postMessageToWebview({ type: 'slide-index', index, navigate: true })
5. Webview JS receives 'slide-index', scrolls to <section id="slide-{index}">
6. Webview JS fires presentation:slideChanged { index } back to host
7. Adapter receives slideChanged, confirms cursor is in sync
8. Adapter fires onSlideChanged listeners → state publisher updates modality state
9. Tool handler returns { currentSlide: index, title } to agent
```

For `nav:next`/`nav:prev` originating from webview keyboard input, the flow starts at step 6 (webview-initiated) — the adapter updates its local cursor and fires state change events.

### 6.3 In-webview navigation model

Marp renders each slide as a `<section>` element. Navigation is handled by in-webview JavaScript:

```js
// Simplified navigation logic injected into webview
const slides = document.querySelectorAll('section[id^="slide-"]');
let currentIndex = 0;

function gotoSlide(index) {
  if (index < 0 || index >= slides.length) return;
  slides[index].scrollIntoView({ behavior: 'smooth' });
  currentIndex = index;
  vscode.postMessage({ type: 'presentation:slideChanged', index });
}

// Host-originated navigation
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'slide-index' && msg.navigate) {
    gotoSlide(msg.index);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') gotoSlide(currentIndex + 1);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') gotoSlide(currentIndex - 1);
});
```

The host receives `presentation:slideChanged` messages and updates the adapter's local cursor.

### 6.5 Live reload

```
FileSystemWatcher (deck file, debounce: ~300ms)
    │  onChange (debounced)
    ▼
MarpRenderer.render(newContent)
    │
    ▼
provider.revision++ (monotonic counter)
    │
    ▼
webview.postMessage({ type: 'marp:update', html, css, currentSlide, revision })
    │
    ▼
Webview JS:
  1. Checks revision > lastReceivedRevision; drops stale updates
  2. Replaces <section> content with new HTML
  3. Clamps currentSlide: Math.min(currentSlide, newSlideCount - 1)
  4. Scrolls to clamped slide index
  5. lastReceivedRevision = revision
```

No process restart needed — just a postMessage with new HTML.

### 6.6 Live reload race condition mitigation

| Concern | Mitigation |
|---|---|
| Out-of-order updates (rapid saves) | `revision: number` (monotonic) on every `marp:update`; webview drops updates where `revision ≤ lastReceivedRevision` |
| Slide count decreases after edit | `currentSlide` is clamped to `Math.min(oldCurrentSlide, newSlideCount - 1)` after re-render |
| Flooding from rapid file changes | `FileSystemWatcher` onChange is debounced at ~300ms to avoid flooding renders |

---

## 7. Comments Integration

The Comment SDK overlay is injected into the webview HTML alongside the Marp-rendered slides. The comments bridge uses `SurfaceCommentAdapter` and the same `blockId` encoding convention as Slidev.

### 7.1 Navigation adapter registration

`accordo-marp` registers a `NavigationAdapter` for `surfaceType: "slide"` at activation time. The registry is exposed via `accordo_marp_internal_getNavigationRegistry` for retrieval by `accordo-comments`.

The `navigation-router.ts` in `accordo-comments` uses this registry for primary dispatch and falls back to `DEFERRED_COMMANDS.PRESENTATION_GOTO` / `DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD` when the registry returns nothing.

### 7.2 Known gap

`accordo-slidev` is not currently available in this workspace. The deferred fallback path (direct `DEFERRED_COMMANDS` commands) is implemented and functional, but the slide adapter registration path requires `accordo-marp` to be the active engine.

### 7.3 Anchor mapping

| Property | Value |
|---|---|
| `kind` | `"surface"` |
| `uri` | deck file URI |
| `surfaceType` | `"slide"` |
| `coordinates.type` | `"slide"` |
| `coordinates.slideIndex` | 0-based slide index |
| `coordinates.x` | 0–1 float (fraction of slide width) |
| `coordinates.y` | 0–1 float (fraction of slide height) |

### 7.4 blockId encoding

```
"slide:{slideIndex}:{x}:{y}"
```

Example: `"slide:3:0.5000:0.3000"` — identical to Slidev convention.

---

## 8. Session Model

- **One presentation session at a time.** Opening a new deck closes the previous session (disposes webview).
- Closing the webview panel ends the session and resets state.
- Calling `open` on the same URI that is already active refocuses the existing panel (no re-render).

---

## 9. Modality State Contribution

`accordo-marp` publishes to `modalities["accordo-marp"]`:

```ts
{
  isOpen: boolean;
  deckUri: string | null;
  currentSlide: number;
  totalSlides: number;
  narrationAvailable: boolean;
}
```

Identical shape to Slidev's state. State transitions on: open, close, navigate, generateNarration.

---

## 10. Webview Architecture

### 10.1 No iframe

Unlike Slidev (which needs an iframe to embed the dev server), Marp injects rendered HTML **directly** into the webview. This simplifies:

- **CSP:** No `frame-src` needed. Only `style-src` (for Marp CSS) and nonce-based `script-src`.
- **Communication:** Direct `vscode.postMessage` — no cross-frame messaging.
- **Comment SDK:** Overlay sits in the same document — easier coordinate mapping.

### 10.2 HTML structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src 'nonce-{NONCE}' 'unsafe-inline';
    script-src 'nonce-{NONCE}';
    img-src ${webview.cspSource} data:;
  ">
  <style nonce="{NONCE}">${marpCss}</style>
  <style nonce="{NONCE}">${navigationCss}</style>
</head>
<body>
  <div id="slide-container">
    ${marpSectionHtml}
  </div>
  <script nonce="{NONCE}">${navigationJs}</script>
  ${commentSdkScript}  <!-- only if comments enabled -->
</body>
</html>
```

---

## 11. Deck File Format

Marp uses standard Markdown with `---` slide separators (same as Slidev):

```markdown
---
marp: true
theme: default
paginate: true
---

# Slide 1 Title

Content here

<!-- speaker notes for slide 1 -->

---

# Slide 2 Title

- Bullet point
- Another point

---

# Slide 3

```code
example();
```​
```

The `marp: true` directive in the frontmatter is optional but recommended. The validator accepts decks with or without it.

---

## 12. Dependencies and Boundaries

### 12.1 Package dependencies

- **`@marp-team/marp-core`** — bundled npm dependency (the entire rendering engine)
- **`@accordo/bridge-types`** — workspace dependency (type-only, same as all extensions)
- **`accordo-bridge`** — VS Code extension dependency (tool registration, state publishing)
- **`accordo-comments`** — VS Code extension dependency (surface adapter for comments)

### 12.2 What is NOT needed (compared to Slidev)

- No `@slidev/cli` or `npx`
- No Node.js child process spawning
- No port management
- No HTTP polling
- No `shell: true` shim for Windows
- No stdin pipe handling
- No theme pre-installation
- No `--remote false` flag management
- No `vscode.env.asExternalUri()` (no localhost URL to wrap)

### 12.3 No Hub changes

Hub protocol and prompt generation are unaffected. The modality key differs (`accordo-marp` vs `accordo-slidev`) but the state shape is identical.

---

## 13. Security and Safety

- No child process spawning — no command injection surface.
- No localhost server — no port exposure, no network access.
- Webview CSP: nonce-based scripts, no `frame-src`, no `connect-src`.
- Marp-rendered HTML is sanitized by marp-core (no raw `<script>` injection from markdown).
- No handler functions cross Bridge/Hub boundaries.
- Tool handlers return structured errors (never throw across boundary).

---

## 14. Testing Strategy

- **Unit tests** for every module: renderer, adapter, tools, state, comments bridge, narration.
- **Marp renderer tests**: verify HTML output structure, CSS generation, slide counting, directive parsing.
- **Adapter tests**: navigation state tracking, out-of-bounds errors, slide-change events.
- **All tests run without VS Code** — `vscode` module is mocked (same pattern as Slidev).
- **No integration tests requiring npm installs or dev servers** — Marp renders in-process.

Coverage target: same as rest of Accordo (v8 provider, vitest).

---

## 15. Future: Shared Presentation Core

The logically-identical modules between `accordo-marp` and `accordo-slidev` are:

- `presentation-state.ts`
- `presentation-comments-bridge.ts`
- `presentation-tools.ts` (handler wiring, not implementation)
- `types.ts` (most interfaces)

**Invariants required for safe reuse** (must hold for any engine sharing these modules):

| Invariant | Description |
|---|---|
| Message names | Webview messages use the same `type` strings: `presentation:ready`, `presentation:slideChanged`, `nav:next`, `nav:prev`, `slide-index`, `comments:load`, etc. |
| `blockId` format | Comment block IDs follow `"slide:{slideIndex}:{x}:{y}"` encoding (4-decimal floats for x/y) |
| Slide-index synchronization | 0-based slide index; adapter tracks `currentSlide` locally; state publisher subscribes to `onSlideChanged` |
| State shape | `PresentationSessionState` has identical fields: `isOpen`, `deckUri`, `currentSlide`, `totalSlides`, `narrationAvailable` |
| `PresentationToolDeps` contract | Tool handlers receive the same dependency bag regardless of engine |

> **Note:** While these modules are logically identical, each engine has materially different integration assumptions (e.g., Marp uses direct HTML injection while Slidev uses an iframe to a dev server). The shared modules abstract over these differences through the `PresentationRuntimeAdapter` interface, but engine-specific integration code in the provider and adapter is NOT shared.

When a third engine is considered (or when the Comment SDK is extracted for browser use), these should be factored into `@accordo/presentation-core`. For now, duplication is acceptable — two engines is not enough to justify an abstraction layer.

---

## 16. Affected Packages

| Package | Change |
|---|---|
| `packages/marp` | **New** — entire extension |
| `packages/slidev` | **Minor** — read `accordo.presentation.engine` setting; yield if `"marp"` |
| `packages/comments` | None — surface adapter already exists |
| `packages/comment-sdk` | None |
| `packages/bridge-types` | None |
| `packages/bridge` | None |
| `packages/hub` | None |
