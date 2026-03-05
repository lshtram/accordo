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

### Demo deck

A ready-to-use 6-slide deck lives at:

```
/Users/Shared/dev/accordo/demo/accordo-demo.md
```

It covers: intro, architecture, comments, presentation modality, narration, roadmap.
Every slide has speaker notes so narration generation is testable on all slides.

### Prerequisites

1. Build: `pnpm build` in the workspace root
2. Start Hub:
   ```bash
   ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \
     node packages/hub/dist/index.js --port 3000
   ```
3. Install Slidev globally if not present: `npm install -g @slidev/cli`
4. Launch the Extension Development Host: open `packages/slidev/` in VS Code → F5
5. Connect your MCP client (Claude, Copilot, etc.) to `http://localhost:3000` with token `demo-token`

---

### Agent prompts to run (copy-paste these in order)

Each prompt is what you type to the agent. The expected tool call and response follow.

---

#### Step 1 — Discover available decks

**Prompt:**
> What presentation decks are available in this workspace?

**What the agent should do:** call `accordo.presentation.discover`  
**Expected response:** A list of `.md` files, including `demo/accordo-demo.md`

---

#### Step 2 — Open the demo deck

**Prompt:**
> Open the Accordo demo deck at `/Users/Shared/dev/accordo/demo/accordo-demo.md`

**What the agent should do:** call `accordo.presentation.open` with that path  
**Expected response:** Confirmation that the deck is now open  
**Side-effect to check:** A WebviewPanel titled "accordo-demo.md" appears in VS Code; a Slidev server starts (you'll see terminal output on port 7788+)

---

#### Step 3 — List the slides

**Prompt:**
> List all the slides in the current deck

**What the agent should do:** call `accordo.presentation.listSlides`  
**Expected response:** 6 slides with titles:
1. Accordo IDE
2. Architecture
3. Comment System
4. Presentation Modality
5. Narration Example
6. What's Next

---

#### Step 4 — Check which slide is current

**Prompt:**
> Which slide am I on right now?

**What the agent should do:** call `accordo.presentation.getCurrent`  
**Expected response:** `{ index: 0, title: "Accordo IDE" }`

---

#### Step 5 — Advance one slide

**Prompt:**
> Go to the next slide

**What the agent should do:** call `accordo.presentation.next`  
**Side-effect to check:** The Slidev WebviewPanel updates to show slide 2 (Architecture)

---

#### Step 6 — Jump to a specific slide

**Prompt:**
> Jump to slide 4 (the one about the presentation modality)

**What the agent should do:** call `accordo.presentation.goto` with `{ index: 3 }` (0-based)  
**Expected response:** Confirmation  
**Side-effect to check:** WebviewPanel shows "Presentation Modality"

---

#### Step 7 — Go back one slide

**Prompt:**
> Go back one slide

**What the agent should do:** call `accordo.presentation.prev`  
**Expected response:** Now on slide index 2 (Comment System)

---

#### Step 8 — Generate narration for current slide

**Prompt:**
> Generate the narration text for the current slide

**What the agent should do:** call `accordo.presentation.getCurrent` to find index, then `accordo.presentation.generateNarration` with that index  
**Expected response:** Plain text narration from the speaker notes (no `**`, `#`, `-` etc.)

Example for slide 2 (Comment System, index 2):
> "The comment system is the primary channel for human-agent communication. Rather than chat, the human places a comment directly on the artifact they care about. The agent sees open threads in every prompt."

---

#### Step 9 — Generate narration for all slides

**Prompt:**
> Generate narration for all slides

**What the agent should do:** call `accordo.presentation.generateNarration` with no slideIndex (or `"all"`)  
**Expected response:** An array of 6 `{ slideIndex, narrationText }` objects, all plain text

---

#### Step 10 — Test boundary: jump out of range

**Prompt:**
> Jump to slide 99

**What the agent should do:** call `accordo.presentation.goto` with `{ index: 99 }`  
**Expected response:** A structured error like `{ error: "Slide index 99 out of bounds (0–5)" }` — **not** an uncaught exception

---

#### Step 11 — Test re-opening the same deck (no restart)

**Prompt:**
> Open the demo deck again

**What the agent should do:** call `accordo.presentation.open` with the same path  
**Expected behaviour:** The existing WebviewPanel is revealed (focused), no new Slidev process is spawned. The agent should confirm the deck is already open.

---

#### Step 12 — Check state in the system prompt

**Prompt:**
> What is the current presentation state?

**What the agent should do:** read from its context / call `accordo.presentation.getCurrent`  
**Expected:** The agent reports `isOpen: true`, correct `deckUri`, `currentSlide`, and `totalSlides: 6`

---

#### Step 13 — Close the session

**Prompt:**
> Close the presentation

**What the agent should do:** call `accordo.presentation.close`  
**Expected response:** Confirmation  
**Side-effect to check:** WebviewPanel closes in VS Code; Slidev process is killed

---

#### Step 14 — Verify state reset after close

**Prompt:**
> Is there a presentation open?

**What the agent should do:** call `accordo.presentation.getCurrent` or `accordo.presentation.listSlides`  
**Expected response:** A structured error `{ error: "No presentation session is open." }` — not a crash

---

#### Step 15 — Test error on missing file

**Prompt:**
> Open a presentation at `/tmp/does-not-exist.md`

**What the agent should do:** call `accordo.presentation.open` with that non-existent path  
**Expected response:** A structured error `{ error: "ENOENT: no such file or directory..." }` — not a crash

---

### What to look for in Hub state

After Step 2 (open), connect to Hub and verify the system prompt / `/state` endpoint includes:

```json
{
  "modalities": {
    "accordo-slidev": {
      "isOpen": true,
      "deckUri": "/Users/Shared/dev/accordo/demo/accordo-demo.md",
      "currentSlide": 0,
      "totalSlides": 6,
      "narrationAvailable": true
    }
  }
}
```

After Step 13 (close):

```json
{
  "modalities": {
    "accordo-slidev": {
      "isOpen": false,
      "deckUri": null,
      "currentSlide": 0,
      "totalSlides": 0,
      "narrationAvailable": false
    }
  }
}
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
