# accordo-marp — Requirements Specification

**Package:** `accordo-marp`  
**Type:** VS Code extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-03-19

---

## 1. Purpose

Accordo Marp is a lightweight presentation modality for Accordo IDE, built on [Marp](https://marp.app/) (Markdown Presentation Ecosystem). It allows an agent to open, navigate, and control technical slide decks inside VS Code, annotate slides through the Comment SDK, and generate per-slide narration text — identical in MCP surface to `accordo-slidev`, but with a radically simpler runtime: Marp renders Markdown to static HTML, eliminating the need for a dev server, port management, child-process polling, and npm dependency installation.

### 1.1 Relationship to `accordo-slidev`

Both extensions expose the **same 9 navigation/session MCP tools** under the same `accordo.presentation.*` namespace, plus one capture tool (`accordo_webview_capture`) that is engine-specific. The Accordo system prompt configuration (`accordo.presentation.engine`) determines which extension is active. Only one engine is active at a time.

### 1.2 Why Marp

| Concern | Slidev | Marp |
|---|---|---|
| Installation | Requires `npx @slidev/cli`, Node.js, theme npm installs | `@marp-team/marp-core` is a pure JS library — zero child processes |
| Runtime model | Embedded Vite dev server, HTTP polling, port allocation | Static HTML render, injected directly into webview — no server |
| Cross-platform | Windows issues with `npx.cmd`, stdin pipe flags, cold npm cache | Works identically on Windows, macOS, Linux — no platform-specific shims |
| Startup time | 5–180 s (cold npm cache → install → Vite boot) | < 1 s (synchronous Markdown → HTML conversion) |
| Live reload | HMR via Vite WebSocket | Re-render on file change, push new HTML to webview |
| Navigation API | REST endpoint `GET /json`, POST `/navigate/{index}` | In-webview JS: scroll to `<section>` by index |
| Code slides | Strong (Shiki highlighting, Monaco integration) | Good (Shiki via `@marp-team/marp-core`, no Monaco) |
| Custom layouts | Slidev layouts, Vue components | CSS themes, `<!-- _class: -->` directives |

---

## 2. Extension Manifest Contract

```json
{
  "name": "accordo-marp",
  "displayName": "Accordo Presentations (Marp)",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "extensionDependencies": [
    "accordo.accordo-bridge",
    "accordo.accordo-comments"
  ],
  "main": "./dist/extension.js"
}
```

### Contributed commands

- `accordo.marp.open`
- `accordo.marp.close`

### Configuration

```json
{
  "accordo.presentation.engine": {
    "type": "string",
    "enum": ["marp", "slidev"],
    "default": "marp",
    "description": "Presentation engine to use. Only one engine is active at a time."
  }
}
```

> **Note:** This setting is contributed by `accordo-marp` (the default engine). When set to `"slidev"`, `accordo-marp` deactivates its tool registration and defers to `accordo-slidev`.

---

## 3. Tooling Requirements

All tools are registered through `bridge.registerTools("accordo-marp", tools)`.  
All non-discover tools belong to group `presentation`.

The tool names are **identical** to Slidev — the MCP surface is engine-agnostic:

| Requirement ID | Requirement |
|---|---|
| M50-TL-01 | `accordo.presentation.discover` exists and is ungrouped (prompt-visible) |
| M50-TL-02 | `accordo.presentation.open` opens a deck URI; renders it to HTML via Marp; displays in WebviewPanel; returns error if file does not exist or is not a valid Marp deck |
| M50-TL-03 | `accordo.presentation.close` ends the active session, disposes the webview, and resets state |
| M50-TL-04 | `accordo.presentation.listSlides` returns ordered slide metadata |
| M50-TL-05 | `accordo.presentation.getCurrent` returns current slide index and title |
| M50-TL-06 | `accordo.presentation.goto` moves to exact slide index |
| M50-TL-07 | `accordo.presentation.next` advances one slide |
| M50-TL-08 | `accordo.presentation.prev` goes back one slide |
| M50-TL-09 | `accordo.presentation.generateNarration` returns narration text for a given slide (or all slides) |
| M50-TL-10 | `accordo_webview_capture` captures the currently visible slide as a UTF-8-encoded SVG file; writes to a caller-specified output path; requires an open presentation session; returns `{ captured, output_path, slide, bytes }` |

### Tool danger levels

- Navigation/read tools (`discover`, `listSlides`, `getCurrent`, `goto`, `next`, `prev`, `generateNarration`): `safe`, `requiresConfirmation: false`
- Session management (`open`, `close`): `moderate`, `requiresConfirmation: false`
- Capture (`accordo_webview_capture`): `moderate`, `requiresConfirmation: false` (writes to disk)

---

## 4. Module Specifications

### M50-EXT — Extension Activation

**File:** `src/extension.ts`

| Requirement ID | Requirement |
|---|---|
| M50-EXT-01 | Reads `accordo.presentation.engine` setting; if value is `"slidev"`, does NOT register tools (yields to `accordo-slidev`) |
| M50-EXT-02 | Activates Bridge dependency and acquires BridgeAPI exports |
| M50-EXT-03 | Registers all 10 presentation tools when engine is `"marp"` (default): 9 navigation/session tools + `accordo_webview_capture` |
| M50-EXT-04 | Creates WebviewPanel on demand (via `presentation.open` tool) |
| M50-EXT-05 | Acquires comments surface adapter via `accordo.comments.internal.getSurfaceAdapter` when available |
| M50-EXT-06 | Publishes initial modality state via `bridge.publishState` |
| M50-EXT-07 | If comments extension is unavailable, presentation still works without comments |
| M50-EXT-08 | Only one presentation session is active at a time; opening a new deck closes the previous session |

### M50-RTA — Presentation Runtime Adapter Interface

**File:** `src/runtime-adapter.ts`

| Requirement ID | Requirement |
|---|---|
| M50-RTA-01 | Defines the `PresentationRuntimeAdapter` interface: `listSlides`, `getCurrent`, `goto`, `next`, `prev`, `onSlideChanged`, `validateDeck`, `dispose` |
| M50-RTA-02 | Interface is runtime-neutral — no Marp-specific or Slidev-specific imports; depends only on `types.ts` |
| M50-RTA-03 | Identical to `accordo-slidev`'s `runtime-adapter.ts` — candidate for future extraction to `@accordo/presentation-core` |

### M50-RT — Marp Runtime Adapter

**File:** `src/marp-adapter.ts`  
**Implements:** `PresentationRuntimeAdapter` from `src/runtime-adapter.ts` (same interface as Slidev)

| Requirement ID | Requirement |
|---|---|
| M50-RT-01 | Implements `PresentationRuntimeAdapter` interface: `listSlides`, `getCurrent`, `goto`, `next`, `prev`, `onSlideChanged`, `validateDeck`, `dispose` |
| M50-RT-02 | `validateDeck` checks that the file is non-empty and contains `---` slide separators (Marp uses same separator convention) |
| M50-RT-03 | `listSlides` parses the markdown, splits on `---`, extracts first `#` heading per slide as title |
| M50-RT-04 | `goto(index)` throws `RangeError` for out-of-bounds indices |
| M50-RT-05 | Navigation state is tracked locally (no server to poll — Marp is static HTML) |
| M50-RT-06 | `onSlideChanged` fires when the webview reports a slide change (via postMessage) |
| M50-RT-07 | Adapter emits slide-change events consumed by state publisher |

### M50-RENDER — Marp Rendering Engine

**File:** `src/marp-renderer.ts`

| Requirement ID | Requirement |
|---|---|
| M50-RENDER-01 | Uses `@marp-team/marp-core` to convert Markdown to HTML |
| M50-RENDER-02 | Rendering is synchronous (no child process, no server) |
| M50-RENDER-03 | Returns structured output: `{ html: string; css: string; slideCount: number; comments: string[] }` |
| M50-RENDER-04 | Supports Marp directives: `marp: true`, `theme:`, `paginate:`, `_class:`, `header:`, `footer:` |
| M50-RENDER-05 | Re-renders on file change and pushes updated HTML to the webview |
| M50-RENDER-06 | Processes `<!-- notes -->` speaker notes sections for narration extraction |

### M50-PVD — Presentation Provider

**File:** `src/presentation-provider.ts`

| Requirement ID | Requirement |
|---|---|
| M50-PVD-01 | Opens deck in a VS Code WebviewPanel |
| M50-PVD-02 | Renders deck Markdown → HTML via `MarpRenderer` and injects directly into webview (NO iframe, NO child process) |
| M50-PVD-03 | Webview HTML includes slide navigation JS (scroll/section-based, keyboard arrow keys) |
| M50-PVD-04 | Injects Comment SDK overlay when comments integration is enabled |
| M50-PVD-05 | Handles panel lifecycle cleanup (`dispose`): resets session state |
| M50-PVD-06 | Supports reopen/focus of existing session for same deck URI (no re-render) |
| M50-PVD-07 | Watches the deck file for changes; FileSystemWatcher debounces at ~300ms; on save, re-renders and pushes updated HTML to webview preserving current slide position |
| M50-PVD-08 | Webview CSP: nonce-based script policy, `style-src` for Marp CSS; NO `frame-src` needed (no iframe) |
| M50-PVD-09 | `marp:update` messages include a monotonic `revision: number`; webview drops updates where `revision ≤ lastReceivedRevision` |
| M50-PVD-10 | After live-reload re-render, if slide count changes, `currentSlide` is clamped to `Math.min(oldCurrentSlide, newSlideCount - 1)` |
| M50-PVD-11 | `requestCapture(): Promise<Buffer>` sends `host:request-capture` to the webview and resolves with the decoded SVG buffer when `presentation:capture-ready` is received; rejects if the panel is closed before the response arrives |

### M50-CBR — Comments Bridge

**File:** `src/presentation-comments-bridge.ts`

| Requirement ID | Requirement |
|---|---|
| M50-CBR-01 | Receives webview comment messages and forwards to comments surface adapter |
| M50-CBR-02 | Constructs slide anchors: `{ kind: "surface", uri, surfaceType: "slide", coordinates: { type: "slide", slideIndex, x, y } }` |
| M50-CBR-03 | Subscribes to adapter store changes and pushes `comments:load` back to webview |
| M50-CBR-04 | Handles missing comments extension gracefully (no throw) |
| M50-CBR-05 | Maps between SDK `blockId` (opaque string) and `SlideCoordinates`; encoding: `blockId = "slide:{slideIndex}:{x}:{y}"` (identical convention to Slidev) |

### M50-NAR — Narration Text Generator

**File:** `src/narration.ts`

| Requirement ID | Requirement |
|---|---|
| M50-NAR-01 | `generateNarration` accepts a slide index (or `"all"`) and the deck content |
| M50-NAR-02 | Returns structured narration text per slide: `{ slideIndex, narrationText }[]` |
| M50-NAR-03 | Narration text is derived from the slide's markdown content (headings, bullet points, speaker notes) |
| M50-NAR-04 | Marp uses `<!-- notes -->` or `<!-- speaker_notes -->` syntax; both are supported |
| M50-NAR-05 | Output format is suitable for TTS consumption (plain text, no markdown) |

### M50-STATE — Modality State Contribution

**File:** `src/presentation-state.ts`

| Requirement ID | Requirement |
|---|---|
| M50-STATE-01 | Publishes state key `modalities["accordo-marp"]` |
| M50-STATE-02 | Includes `isOpen`, `deckUri`, `currentSlide`, `totalSlides`, `narrationAvailable` |
| M50-STATE-03 | Emits updates on open/close, navigation, and narration generation events |
| M50-STATE-04 | Subscribes to adapter events and webview panel lifecycle; calls `bridge.publishState` on every state transition |

---

## 5. Data Contracts

### 5.1 Session state (extension-local)

```ts
interface PresentationSessionState {
  isOpen: boolean;
  deckUri: string | null;
  currentSlide: number;
  totalSlides: number;
  narrationAvailable: boolean;
}
```

### 5.2 Slide summary (tool response)

```ts
interface SlideSummary {
  index: number;
  /** Extracted from the first # heading in the slide, or "Slide {index}" if no heading */
  title: string;
  notesPreview?: string;
}
```

### 5.3 Narration output (tool response)

```ts
interface SlideNarration {
  slideIndex: number;
  narrationText: string;
}
```

### 5.4 Marp render output (internal)

```ts
interface MarpRenderResult {
  html: string;
  css: string;
  slideCount: number;
  comments: string[];  // speaker notes per slide
}
```

---

## 6. Webview Message Protocol

### Webview → Host

- `presentation:ready`
- `presentation:slideChanged { index: number }`
- `presentation:capture-ready { data: string | null, error?: string }` — response to `host:request-capture`; `data` is a base64-encoded UTF-8 SVG string (using `btoa(unescape(encodeURIComponent(svgString)))`); `null` on error
- `nav:next`
- `nav:prev`
- Comment SDK messages (`comment:create`, `comment:reply`, `comment:resolve`, `comment:delete`)

### Host → Webview

- `slide-index { index: number, navigate?: boolean }`
- `host:request-capture` — instructs webview to serialize the active slide SVG (`<svg data-marpit-svg class="active">`) via `XMLSerializer` and respond with `presentation:capture-ready`
- `marp:update { html: string, css: string, currentSlide: number, revision: number }` — live reload on file change; `revision` is monotonic (webview drops updates where `revision ≤ lastReceivedRevision`); after re-render, `currentSlide` is clamped to `Math.min(oldCurrentSlide, newSlideCount - 1)`
- Comment SDK updates (`comments:load`, `comments:add`, `comments:update`, `comments:remove`)

---

## 7. Non-Functional Requirements

| Requirement ID | Requirement |
|---|---|
| M50-NFR-01 | No `vscode` imports outside extension package boundaries |
| M50-NFR-02 | Webview CSP: nonce-based script policy; NO `frame-src` (no iframe); `style-src` for Marp-generated CSS |
| M50-NFR-03 | No child process spawning — Marp renders in-process via the JS API |
| M50-NFR-04 | Tool handlers return structured errors (no uncaught throws at boundary) |
| M50-NFR-05 | All public exports have explicit TypeScript return types |
| M50-NFR-06 | Startup to first slide visible: < 2 seconds for a 50-slide deck |
| M50-NFR-07 | Cross-platform: works identically on Windows, macOS, Linux with no platform-specific shims |

---

## 8. Testing Requirements

| Requirement ID | Requirement |
|---|---|
| M50-TST-01 | Unit tests for tool registration and discover behavior |
| M50-TST-02 | Unit tests for Marp adapter navigation semantics |
| M50-TST-03 | Unit tests for state publication transitions |
| M50-TST-04 | Unit tests for comments bridge message translation and anchor construction |
| M50-TST-05 | Unit tests for narration text generation from slide content (including Marp-style notes) |
| M50-TST-06 | Unit tests for deck validation (existing file, valid format, missing file error) |
| M50-TST-07 | Unit tests for Marp renderer: Markdown → HTML conversion, directive parsing, slide counting |
| M50-TST-08 | Unit tests for file-change watcher triggering re-render |

---

## 9. Affected Packages

Requirements in this document affect:

- `packages/marp` (new)
- `packages/comments` — no changes (surface adapter command already exists from Slidev work)
- `packages/comment-sdk` — no type changes; `blockId: string` stays as-is; slide anchors use same `"slide:{idx}:{x}:{y}"` convention
- `packages/bridge-types` — no new types needed
- `packages/bridge` — no API changes
- `packages/hub` — no protocol changes

---

## 10. Engine Selection Behavior

### 10.1 Configuration

```
accordo.presentation.engine: "marp" | "slidev"   (default: "marp")
```

### 10.2 Activation rules

| Setting value | `accordo-marp` behavior | `accordo-slidev` behavior |
|---|---|---|
| `"marp"` (default) | Registers all 10 tools, publishes state | Does NOT register tools (yields) |
| `"slidev"` | Does NOT register tools (yields) | Registers all 9 tools, publishes state |

Both extensions read the same setting on activation. Only the selected engine registers its tools. The MCP tool names are identical (`accordo.presentation.*`), so agents see no difference — the engine swap is transparent.

### 10.3 Changing engine at runtime

Changing the setting requires an extension host restart (VS Code reload). The agent prompt includes which engine is active via the modality state key (`accordo-marp` vs `accordo-slidev`).

---

## 11. Deferred / Out of Scope

- Voice playback / TTS of narration text (deferred to `accordo-voice`)
- Marp CLI export (PDF, PPTX) — can be added later as additional tools
- Custom Marp themes beyond built-in (`default`, `gaia`, `uncover`)
- Presenter notes view (separate panel) — future enhancement
- Marp directive auto-complete / IntelliSense — future enhancement
