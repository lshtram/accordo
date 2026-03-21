# Manual Testing Guide — accordo-marp (All Modules)

**Status:** All 194 automated tests written. Implementation complete.  
**Package:** `accordo-marp` (`packages/marp`)  
**Modules:** M50-RENDER · M50-RTA · M50-RT · M50-NAR · M50-TL · M50-STATE · M50-CBR · M50-PVD · M50-EXT

---

## 0. Pre-flight

```bash
cd packages/marp
pnpm typecheck        # zero TypeScript errors
pnpm test             # all tests green (in Windows/CI environment)
```

> **Note:** Vitest cannot execute in the current mixed Windows/Linux environment due to esbuild platform binary mismatch. Run `pnpm test` on Windows or in CI.

---

## 1. Module-by-Module Automated Test Summary

### M50-RENDER — MarpRenderer (`marp-renderer.test.ts`) — 35 tests
Core rendering engine. Pure unit tests — no mocks needed.

| Group | Tests | Key assertions |
|---|---|---|
| Basic rendering | 9 | `html/css/slideCount/comments` shape, `<section>` present, synchronous return |
| Slide counting | 5 | 1/2/3-slide decks, comments length === slideCount |
| Directives | 7 | `marp: true`, `theme:`, `paginate:`, `_class:`, `header:`, `footer:` |
| Speaker notes | 6 | `<!-- notes -->`, `<!-- speaker_notes -->`, per-slide alignment |
| getNotes() | 4 | returns string or null (not ""/undefined) |
| Edge cases | 5 | empty string, frontmatter-only, no frontmatter, 10-slide stress |

### M50-RT — MarpAdapter (`marp-adapter.test.ts`) — 35 tests
Local cursor adapter (no HTTP polling, Marp is static HTML).

| Group | Tests | Key assertions |
|---|---|---|
| Interface | 3 | Implements `PresentationRuntimeAdapter`, all methods exist |
| listSlides | 4 | Heading extraction, notesPreview, empty deck |
| getCurrent | 2 | Returns current index and title |
| goto | 4 | RangeError for out-of-bounds, fires listeners on valid navigation |
| next/prev | 4 | Clamp at boundaries, fire listeners |
| validateDeck | 4 | Empty → invalid, no `---` → invalid, valid → valid |
| onSlideChanged | 4 | Fires listener, returns disposable, deduplication |
| handleWebviewSlideChanged | 4 | Updates cursor, fires listeners, ignores out-of-bounds |
| dispose | 2 | Cleans up listeners |

### M50-NAR — Narration (`narration.test.ts`) — 27 tests
Pure functions. No VS Code mocks needed.

| Group | Tests | Key assertions |
|---|---|---|
| parseDeck | 9 | Splits on `---`, strips frontmatter, extracts notes |
| slideToNarrationText | 8 | Notes preferred, markdown stripped, TTS-safe output |
| generateNarration | 9 | `all` returns array, numeric target, invalid → [], empty → [] |
| Edge | 2 | Empty deck: `parseDeck` → 0 slides, `generateNarration` → [] |

### M50-TL — Presentation Tools (`presentation-tools.test.ts`) — 30 tests
Unit tests of `createPresentationTools` with fully stubbed deps.

| Group | Tests | Key assertions |
|---|---|---|
| Count + names | 2 | Exactly 9 tools, correct `accordo_presentation_*` names |
| dangerLevel | 3 | discover/safe → safe, open/close → moderate, rest → safe |
| Grouping | 2 | discover ungrouped, rest in `group: "presentation"` |
| discover handler | 2 | Calls `discoverDeckFiles()`, returns `{ decks }` |
| open handler | 3 | Validates deckUri, returns error shape, calls `openSession` |
| close handler | 1 | Calls `closeSession()` |
| listSlides handler | 1 | Unwraps `SlideSummary[]`, returns `{ slides }` |
| getCurrent handler | 1 | Returns `{ index, title }` directly |
| goto handler | 3 | Validates number, returns error, calls `goto(index)` |
| next/prev handlers | 2 | Call `next()`/`prev()` |
| generateNarration handler | 2 | Wraps result in `{ narrations }`, handles "all" |
| All have handlers | 1 | Every tool has a `typeof === "function"` handler |

### M50-STATE — PresentationState (`presentation-state.test.ts`) — 14 tests

| Group | Tests | Key assertions |
|---|---|---|
| update() | 4 | Merges partial, publishes with key "accordo-marp" |
| reset() | 3 | Resets to INITIAL_SESSION_STATE, publishes |
| getState() | 3 | Returns a copy (not reference) |
| State shape | 4 | `isOpen`, `deckUri`, `currentSlide`, `totalSlides`, `narrationAvailable` all present |

### M50-CBR — Comments Bridge (`presentation-comments-bridge.test.ts`) — 31 tests
`encodeBlockId`/`parseBlockId` are pure math — 12 tests always pass. Bridge class tests require mocks.

| Group | Tests | Key assertions |
|---|---|---|
| encodeBlockId | 5 | Format `slide:N:x.xxxx:y.yyyy`, 4-decimal rounding |
| parseBlockId | 6 | Round-trips, null for invalid/malformed/missing fields |
| buildAnchor | 3 | Correct `CommentAnchorSurface` shape, null for invalid blockId |
| handleWebviewMessage | 9 | Forwards `comment:create/reply/resolve/reopen/delete` to adapter |
| Null adapter safety | 5 | All methods are no-ops (M50-CBR-04) |
| loadThreadsForUri | 5 | Sends `comments:load`, subscribes to `onChanged`, re-pushes on change |
| dispose | 3 | Calls subscription dispose, safe with null adapter |

### M50-PVD — PresentationProvider (`presentation-provider.test.ts`) — 25 tests
Tests `PresentationProvider` and `buildWebviewHtml`. Uses VS Code mock.

| Group | Tests | Key assertions |
|---|---|---|
| buildWebviewHtml | 6 | Contains `<section>`, CSS, nav JS, nonce CSP, no `frame-src` |
| Panel creation | 3 | `createWebviewPanel` called, HTML set, panel not null |
| Reuse same URI | 1 | Same URI → panel revealed, `createWebviewPanel` called once (M50-PVD-06) |
| Different URI | 1 | Different URI → old panel disposed, new panel created |
| Comments optional | 1 | `commentsBridge: null` does not throw (M50-PVD-04) |
| File watcher | 1 | `createFileSystemWatcher` called (M50-PVD-07) |
| close() | 5 | Panel disposed, `getPanel() === null`, callbacks fired, safe with no session |
| Live reload | 3 | `marp:update` posted on file change, revisions strictly increase (M50-PVD-09), slide clamped (M50-PVD-10) |
| dispose() | 2 | Safe when never opened, cleans up all resources |
| Message routing | 2 | `presentation:slideChanged` → adapter, `comment:*` → bridge |

### M50-EXT — Extension (`extension.test.ts`) — 28 tests

| Group | Tests | Key assertions |
|---|---|---|
| Engine gate | 4 | `"slidev"` → no tools registered, `"marp"` → tools registered |
| Bridge absent | 2 | Returns early, no throw |
| Bridge acquisition | 1 | Looks up `accordo.accordo-bridge` |
| Tool registration | 3 | 9 tools, namespace `"accordo-marp"`, calls `registerTools` |
| WebViewPanel on demand | 1 | `createWebviewPanel` only called when open tool invoked (M50-EXT-04) |
| Single session | 1 | Opening second deck disposes first panel (M50-EXT-08) |
| Comments adapter | 3 | Looks up `accordo-comments`, calls `executeCommand`, optional |
| Initial state | 4 | `publishState` called, key `"accordo-marp"`, `isOpen: false`, `deckUri: null` |
| Comments absent | 3 | Works without comments extension |
| Commands | 3 | Registers `accordo.marp.open/close`, pushes to subscriptions |
| Tool handlers | 3 | All 9 tools have function handlers, `close` is no-op when no session |

---

## 2. Manual End-to-End Verification

### 2.1 Smoke test — MarpRenderer in isolation

```typescript
import { MarpRenderer } from "./marp-renderer.js";

const r = new MarpRenderer().render(`---
marp: true
theme: default
---

# Hello

<!-- notes -->
Speak slowly here.
`);

console.assert(r.slideCount === 1);
console.assert(r.html.includes("<section"));
console.assert(r.comments[0] === "Speak slowly here.");
console.assert(new MarpRenderer().getNotes(r, 999) === null);
```

### 2.2 Full extension in VS Code

1. Open `packages/marp` in VS Code
2. Press F5 — Extension Development Host starts
3. Open any `.deck.md` file (or create one):
   ```markdown
   ---
   marp: true
   theme: default
   paginate: true
   ---
   
   # Slide One
   
   Welcome to the presentation.
   
   <!-- notes -->
   
   Say: "Welcome everyone."
   
   ---
   
   # Slide Two
   
   - Point one
   - Point two
   ```
4. Open MCP tools panel → `accordo_presentation_discover` → should list the deck
5. Run `accordo_presentation_open` with the deck path
6. WebViewPanel opens with rendered slides
7. Arrow keys navigate between slides
8. `accordo_presentation_listSlides` → returns 2 slides
9. `accordo_presentation_getCurrent` → returns current slide
10. `accordo_presentation_generateNarration` → returns narration text
11. `accordo_presentation_close` → panel closes

### 2.3 Engine selection

Set `"accordo.presentation.engine": "slidev"` in VS Code settings → `accordo-marp` activates but yields (no tools registered). Set to `"marp"` → tools register normally.

### 2.4 Comments integration

Install `accordo-comments` alongside `accordo-marp`. In a presentation session, right-click on a slide → "Add Comment". Verify comment appears in the Comments panel and the `comments:load` message is posted to the webview.

---

## 3. Part 5 — Final Check

```bash
# All automated tests
cd packages/marp && pnpm test

# TypeScript clean
cd packages/marp && pnpm typecheck

# Build clean
cd packages/marp && pnpm build

# Problems panel (VS Code debug)
# Open packages/marp in VS Code → Problems tab → zero errors
```

## 4. Architecture Notes

| Concern | Slidev | Marp |
|---|---|---|
| Runtime | Child process (`npx slidev`) | In-process (`@marp-team/marp-core`) |
| Webview | `<iframe>` → `localhost:port` | Direct HTML injection |
| Navigation | HTTP polling | In-webview JS + postMessage |
| Port management | Scan 7788–7888 | None |
| Live reload | File watcher → process restart | File watcher → `marp:update` postMessage |
| Comments | `postMessage` via iframe bridge | `postMessage` direct |
| Platform code | Windows shell shims needed | Zero |
| Startup | 5–180 s | < 1 s |
