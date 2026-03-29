# accordo-slidev — Requirements Specification

**Package:** `accordo-slidev`  
**Type:** VS Code extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-03-05

---

## 1. Purpose

Accordo Slidev is the presentation modality for Accordo IDE. It allows an agent to open, navigate, and control technical slide decks inside VS Code, annotate slides through the Comment SDK, and generate per-slide narration text. Voice playback is deferred to Phase 4 (`accordo-voice`).

---

## 2. Extension Manifest Contract

```json
{
  "name": "accordo-slidev",
  "displayName": "Accordo Presentations",
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

- `accordo.presentation.open`
- `accordo.presentation.close`

---

## 3. Tooling Requirements

All tools are registered through `bridge.registerTools("accordo-slidev", tools)`.
All non-discover tools belong to group `presentation`.

| Requirement ID | Requirement |
|---|---|
| M44-TL-01 | `accordo.presentation.discover` exists and is ungrouped (prompt-visible) |
| M44-TL-02 | `accordo.presentation.open` opens a deck URI and starts a session; returns error if file does not exist or is not a valid Slidev deck |
| M44-TL-03 | `accordo.presentation.close` ends the active session, kills the Slidev process, disposes the webview, and resets state |
| M44-TL-04 | `accordo.presentation.listSlides` returns ordered slide metadata |
| M44-TL-05 | `accordo.presentation.getCurrent` returns current slide index and title |
| M44-TL-06 | `accordo.presentation.goto` moves to exact slide index |
| M44-TL-07 | `accordo.presentation.next` advances one slide |
| M44-TL-08 | `accordo.presentation.prev` goes back one slide |
| M44-TL-09 | `accordo.presentation.generateNarration` returns narration text for a given slide (or all slides) |

### Tool danger levels

- Navigation/read tools (`discover`, `listSlides`, `getCurrent`, `goto`, `next`, `prev`, `generateNarration`): `safe`, `requiresConfirmation: false`
- Session management (`open`, `close`): `moderate`, `requiresConfirmation: false`

---

## 4. Module Specifications

### M44-EXT — Extension Activation

**File:** `src/extension.ts`

| Requirement ID | Requirement |
|---|---|
| M44-EXT-01 | Activates Bridge dependency and acquires BridgeAPI exports |
| M44-EXT-02 | Registers all presentation tools |
| M44-EXT-03 | Creates WebviewPanel on demand (via `presentation.open` tool), not via custom editor provider |
| M44-EXT-04 | Acquires comments surface adapter via `accordo.comments.internal.getSurfaceAdapter` when available |
| M44-EXT-05 | Publishes initial modality state via `bridge.publishState` |
| M44-EXT-06 | If comments extension is unavailable, presentation still works without comments |
| M44-EXT-07 | Only one presentation session is active at a time; opening a new deck closes the previous session |

### M44-RT — Presentation Runtime Adapter

**File:** `src/runtime-adapter.ts`

| Requirement ID | Requirement |
|---|---|
| M44-RT-01 | Defines runtime-neutral interface for `listSlides/getCurrent/goto/next/prev` |
| M44-RT-02 | Slidev implementation conforms to the adapter interface |
| M44-RT-03 | Adapter returns deterministic errors for invalid slide indices |
| M44-RT-04 | Adapter emits slide-change events consumed by state publisher |
| M44-RT-05 | Adapter validates deck content on open; returns structured error for unrecognizable formats or missing files |
| M44-RT-06 | `getCurrent` polls `GET http://localhost:{port}/json` to obtain the current slide index from the Slidev server — does NOT rely on iframe URL tracking, which is unreliable |

### M44-PVD — Presentation Provider

**File:** `src/presentation-provider.ts`

| Requirement ID | Requirement |
|---|---|
| M44-PVD-01 | Opens deck in a VS Code WebviewPanel (not a CustomTextEditorProvider) |
| M44-PVD-02 | Spawns Slidev dev server as a child process (`npx slidev <deckUri> --port <N> --remote false`) |
| M44-PVD-03 | WebviewPanel HTML contains an `<iframe>` pointing at the Slidev server URL (wrapped via `vscode.env.asExternalUri`) |
| M44-PVD-04 | Injects Comment SDK overlay alongside the iframe when comments integration is enabled |
| M44-PVD-05 | Handles panel lifecycle cleanup (`dispose`): kills Slidev process, resets session state |
| M44-PVD-06 | When webview panel is disposed, session state resets to `{ isOpen: false, deckUri: null, currentSlide: 0, totalSlides: 0, narrationAvailable: false }` |
| M44-PVD-07 | Supports reopen/focus of existing session for same deck URI (no restart) |
| M44-PVD-08 | Port selection searches the range 7788–7888 for the first available port; `accordo.presentation.port` setting overrides the range with a fixed port |

### M44-CBR — Comments Bridge

**File:** `src/presentation-comments-bridge.ts`

| Requirement ID | Requirement |
|---|---|
| M44-CBR-01 | Receives webview comment messages and forwards to comments surface adapter |
| M44-CBR-02 | Constructs slide anchors: `{ kind: "surface", uri, surfaceType: "slide", coordinates: { type: "slide", slideIndex, x, y } }` |
| M44-CBR-03 | Subscribes to adapter store changes and pushes `comments:load` back to webview |
| M44-CBR-04 | Handles missing comments extension gracefully (no throw) |
| M44-CBR-05 | Maps between SDK `blockId` (opaque string) and `SlideCoordinates` (structured anchor); encoding convention: `blockId = "slide:{slideIndex}:{x}:{y}"` where `x` and `y` are 0–1 floats to 4 decimal places |

### M44-NAR — Narration Text Generator

**File:** `src/narration.ts`

| Requirement ID | Requirement |
|---|---|
| M44-NAR-01 | `generateNarration` accepts a slide index (or "all") and the deck content |
| M44-NAR-02 | Returns structured narration text per slide: `{ slideIndex, narrationText }[]` |
| M44-NAR-03 | Narration text is derived from the slide's markdown content (headings, bullet points, speaker notes) |
| M44-NAR-04 | If no speaker notes exist, generates a summary-style narration from the slide content |
| M44-NAR-05 | Output format is suitable for future TTS consumption (plain text, no markdown) |

### M44-STATE — Modality State Contribution

**File:** `src/presentation-state.ts`

| Requirement ID | Requirement |
|---|---|
| M44-STATE-01 | Publishes state key `modalities["accordo-slidev"]` |
| M44-STATE-02 | Includes `isOpen`, `deckUri`, `currentSlide`, `totalSlides`, `narrationAvailable` |
| M44-STATE-03 | Emits updates on open/close, navigation, and narration generation events |
| M44-STATE-04 | Subscribes to runtime adapter events and webview panel lifecycle; calls `bridge.publishState` on every state transition |

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

---

## 6. Webview Message Protocol

### Webview -> host

- `presentation:ready`
- `presentation:slideChanged { index: number }`
- Comment SDK messages (`comment:create`, `comment:reply`, `comment:resolve`, `comment:delete`)

### Host -> webview

- `presentation:goto { index: number }`
- Comment SDK updates (`comments:load`, `comments:add`, `comments:update`, `comments:remove`)

---

## 7. Non-Functional Requirements

| Requirement ID | Requirement |
|---|---|
| M44-NFR-01 | No `vscode` imports outside extension package boundaries |
| M44-NFR-02 | Webview CSP: nonce-based script policy; `frame-src` restricted to Slidev localhost origin |
| M44-NFR-03 | Remote-safe URL handling via `vscode.env.asExternalUri` for the Slidev iframe URL |
| M44-NFR-04 | Tool handlers return structured errors (no uncaught throws at boundary) |
| M44-NFR-05 | All public exports have explicit TypeScript return types |
| M44-NFR-06 | Slidev process started with `--remote false` to prevent external network access |

---

## 8. Testing Requirements

| Requirement ID | Requirement |
|---|---|
| M44-TST-01 | Unit tests for tool registration and discover behavior |
| M44-TST-02 | Unit tests for runtime adapter navigation semantics |
| M44-TST-03 | Unit tests for state publication transitions |
| M44-TST-04 | Unit tests for comments bridge message translation and anchor construction |
| M44-TST-05 | Unit tests for narration text generation from slide content |
| M44-TST-06 | Unit tests for deck validation (existing file, valid format, missing file error) |
| M44-TST-07 | Smoke test: open deck → navigate → comment roundtrip |

---

## 9. Affected Packages

Requirements in this document affect:

- `packages/slidev` (new)
- `packages/comments` — add `accordo.comments.internal.getSurfaceAdapter` command (see presentation-architecture.md §7)
- `packages/comment-sdk` — **no type changes**; `blockId: string` stays as-is; slide surfaces use `blockId: "slide:{idx}:{x}:{y}"` as an opaque string convention decoded by the comments bridge
- `packages/bridge-types` — no new types needed (`SlideCoordinates` and `SurfaceType: "slide"` already exist)
- `packages/bridge` (no API change expected)
- `packages/hub` (no protocol change expected)

---

## 10. Deferred to Phase 4 (accordo-voice)

The following capabilities are explicitly **out of scope** for Phase 3:

- Voice playback / TTS of narration text
- `startNarration` / `pauseNarration` / `stopNarration` tools
- `answerQuestion` tool for live Q&A
- Voice bridge module (`presentation-voice-bridge.ts`)
- Session state fields: `isNarrating`, `pendingQuestions`, `lastQuestionAt`
- `mode: "comments" | "voice"` state field (Phase 3 is comments-only)

