# Testing Guide — Session 8B: accordo-slidev (M44)

**Date:** 2026-03-05  
**Package:** `accordo-slidev`  
**Session:** 8B  
**TDD Phase:** F (all phases complete, ready to commit)

---

## 1. What Was Built

A full VS Code extension (`accordo-slidev`) that adds a **presentation modality** to Accordo IDE. An agent can:

- **Open** a Slidev deck and browse it in a VS Code WebviewPanel
- **Navigate** slides (goto, next, prev) via MCP tools
- **List** slide metadata (titles, notes previews)
- **Get** the current slide (authoritative REST poll against the Slidev dev server)
- **Generate narration** text from slide content or speaker notes (TTS-ready plain text)
- **Annotate** slides via the Comment SDK (when accordo-comments is active)

The extension is inert if `accordo-bridge` is absent, and works without comments if `accordo-comments` is absent.

---

## 2. Automated Test Results

```
Test Files  7 passed (7)
Tests       137 passed (137)
Duration    ~560 ms
```

| File | Tests | Requirements |
|---|---|---|
| `narration.test.ts` | 16 | M44-NAR-01–05, M44-RT-05 |
| `presentation-state.test.ts` | 11 | M44-STATE-01–04, M44-PVD-06 |
| `presentation-comments-bridge.test.ts` | 22 | M44-CBR-01–05 |
| `slidev-adapter.test.ts` | 27 | M44-RT-01–06, M44-TL-04–08 |
| `presentation-tools.test.ts` | 27 | M44-TL-01–09 |
| `presentation-provider.test.ts` | 18 | M44-PVD-01–08, M44-EXT-07 |
| `extension.test.ts` | 16 | M44-EXT-01–06 |

---

## 3. Modules Implemented

### M44-NAR — Narration Text Generator (`src/narration.ts`)

Pure functions, no VS Code dependency.

| Export | Behaviour |
|---|---|
| `parseDeck(raw)` | Splits on `---`, extracts speaker notes after `<!-- notes -->` |
| `slideToNarrationText(slide)` | Prefers notes > heading + bullets; strips all markdown |
| `generateNarration(deck, target)` | Returns `SlideNarration[]`; returns `[]` for out-of-range index |

### M44-STATE — Modality State (`src/presentation-state.ts`)

| Method | Behaviour |
|---|---|
| `update(partial)` | Merges partial + calls `bridge.publishState("accordo-slidev", ...)` |
| `reset()` | Restores `INITIAL_SESSION_STATE`, publishes |
| `getState()` | Returns a snapshot copy (not a live reference) |

### M44-CBR — Comments Bridge (`src/presentation-comments-bridge.ts`)

| Export | Behaviour |
|---|---|
| `encodeBlockId(coords)` | `"slide:3:0.5000:0.3000"` — 4-decimal floats |
| `parseBlockId(str)` | Decodes back to `SlideCoordinates`; returns `null` for non-slide IDs |
| `PresentationCommentsBridge.handleWebviewMessage` | Dispatches `comment:create/reply/resolve/delete` to `SurfaceAdapterLike` |
| `loadThreadsForUri(uri)` | Sends `comments:load` + subscribes to `onChanged` for live updates |
| `buildAnchor(blockId, uri)` | Returns `CommentAnchorSurface` with `surfaceType: "slide"` |

### M44-RT — Slidev Runtime Adapter (`src/slidev-adapter.ts`)

| Method | Behaviour |
|---|---|
| `validateDeck(path, content)` | Returns `{ valid: false, error }` for empty content |
| `listSlides()` | Extracts `#` headings as titles; falls back to `"Slide N"` |
| `goto(index)` | `RangeError` for out-of-bounds |
| `next / prev` | No-op at last/first slide |
| `getCurrent()` | Polls `GET http://localhost:{port}/json`; falls back to internal cursor |
| `onSlideChanged(listener)` | Returns disposable; fires on `goto/next/prev` |
| `dispose()` | Clears poll timer and all listeners |

### M44-PVD — Presentation Provider (`src/presentation-provider.ts`)

| Export | Behaviour |
|---|---|
| `findFreePort(start, end)` | Scans TCP range; throws for empty range / exhausted range |
| `PresentationProvider.open(deckUri, ...)` | Same deck → reveal; different deck → close first then reopen |
| `PresentationProvider.close()` | Kills process, disposes panel, calls `onDispose` callback |
| Port range | `PORT_RANGE_START = 7788`, `PORT_RANGE_END = 7888` |

### M44-TL — Presentation Tools (`src/presentation-tools.ts`)

9 tools created by `createPresentationTools(deps)`:

| Tool | Group | Danger |
|---|---|---|
| `accordo.presentation.discover` | _(none — prompt-visible)_ | safe |
| `accordo.presentation.open` | presentation | moderate |
| `accordo.presentation.close` | presentation | moderate |
| `accordo.presentation.listSlides` | presentation | safe |
| `accordo.presentation.getCurrent` | presentation | safe |
| `accordo.presentation.goto` | presentation | safe |
| `accordo.presentation.next` | presentation | safe |
| `accordo.presentation.prev` | presentation | safe |
| `accordo.presentation.generateNarration` | presentation | safe |

### M44-EXT — Extension Entry Point (`src/extension.ts`)

| Behaviour | Details |
|---|---|
| Inert if bridge absent | Returns early from `activate()` with no error |
| Tools registered | `bridge.registerTools("accordo-slidev", tools)` → 9 tools |
| Initial state published | `bridge.publishState("accordo-slidev", { isOpen: false, ... })` |
| Comments optional | Only calls `getSurfaceAdapter` when `accordo.accordo-comments` is installed |

---

## 4. Manual E2E Test Checklist

> ⚠️ Requires a workspace with a Slidev `.md` deck file.
> You can create a minimal deck at `slides.md`:
> ```markdown
> # Slide One
> Hello world
> ---
> # Slide Two
> Second slide
> <!-- notes -->
> Speak this text to the audience.
> ```

### Prerequisites
1. Build all packages: `pnpm build`
2. Open the Accordo workspace containing the `accordo-slidev` extension
3. Ensure Accordo Hub is running: `ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret node packages/hub/dist/index.js --port 3000`
4. Launch the Extension Development Host (F5 in `accordo-slidev` package)

### 4.1 Discover decks

```
Tool: accordo.presentation.discover
Args: {}
Expected: { decks: ["slides.md", ...] }
```

### 4.2 Open a deck

```
Tool: accordo.presentation.open
Args: { "deckUri": "/absolute/path/to/slides.md" }
Expected: {}  (empty success)
Side-effect: WebviewPanel appears, Slidev dev server spawned on port 7788+
```

### 4.3 List slides

```
Tool: accordo.presentation.listSlides
Args: {}
Expected: { slides: [{ index: 0, title: "Slide One" }, { index: 1, title: "Slide Two", notesPreview: "Speak this..." }] }
```

### 4.4 Get current slide

```
Tool: accordo.presentation.getCurrent
Args: {}
Expected: { index: 0, title: "Slide One" }
```

### 4.5 Navigate slides

```
Tool: accordo.presentation.next   → current moves to index 1
Tool: accordo.presentation.goto   Args: { index: 0 }  → back to index 0
Tool: accordo.presentation.prev   → no-op (already at index 0)
Tool: accordo.presentation.goto   Args: { index: 9999 }  → { error: "Slide index 9999 out of bounds..." }
```

### 4.6 Narration

```
Tool: accordo.presentation.generateNarration
Args: {}  (all slides)
Expected: { narrations: [{ slideIndex: 0, narrationText: "Slide One Hello world" }, { slideIndex: 1, narrationText: "Speak this text to the audience." }] }

Args: { slideIndex: 1 }
Expected: { narrations: [{ slideIndex: 1, narrationText: "Speak this text to the audience." }] }
```

### 4.7 State published to Hub

Connect an MCP client and observe `modalities["accordo-slidev"]`:
- On open: `{ isOpen: true, deckUri: "...", currentSlide: 0, totalSlides: 2, narrationAvailable: true }`
- After goto(1): `currentSlide: 1`
- On close: `{ isOpen: false, deckUri: null, currentSlide: 0, totalSlides: 0, narrationAvailable: false }`

### 4.8 Close session

```
Tool: accordo.presentation.close
Args: {}
Expected: {}  — WebviewPanel disposed, Slidev process killed
```

### 4.9 Error cases

| Scenario | Expected response |
|---|---|
| `open` with non-existent path | `{ error: "ENOENT: no such file..." }` |
| `listSlides` with no session | `{ error: "No presentation session is open." }` |
| `goto` with missing index arg | `{ error: "index is required..." }` |
| `open` with empty file | `{ error: "Deck file is empty: ..." }` |

### 4.10 Same-deck reopen (no restart)

1. Open `/deck.md` → note the port N
2. Open `/deck.md` again → WebviewPanel reveals (no new Slidev process spawned)
3. Open `/other.md` → previous session closes, new session starts

---

## 5. Key Design Decisions

| Decision | Rationale |
|---|---|
| `getCurrent` polls `/json` REST endpoint | More reliable than iframe URL tracking which can drift |
| `blockId = "slide:{idx}:{x.4f}:{y.4f}"` | Compact, stable, decodable without registry |
| Narration text is plain (no markdown) | TTS-ready; `accordo-voice` phase 4 can consume directly |
| `findFreePort` range 7788–7888 | Avoids collisions with common dev ports (3000, 5173, etc.) |
| Adapter injected into tools via `PresentationToolDeps` | Enables unit testing without VS Code/Slidev running |
| `onDispose` callback on `PresentationProvider` | Clean state reset without tight coupling to state contribution |

---

## 6. Run the Tests

```bash
# accordo-slidev only
pnpm --filter accordo-slidev test

# All packages
pnpm test
```
