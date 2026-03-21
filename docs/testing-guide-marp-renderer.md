# Manual Testing Guide — Module 1: M50-RENDER (MarpRenderer)

**Status:** 35 automated tests written, awaiting implementation to turn green.  
**Package:** `accordo-marp` (`packages/marp`)  
**Module:** `MarpRenderer` — in-process Markdown → HTML rendering using `@marp-team/marp-core`  
**Requirements covered:** M50-RENDER-01 through M50-RENDER-06

---

## 0. Pre-flight

### 0.1 Automated tests must be green first

```bash
# From the accordo workspace root:
cd packages/marp
pnpm test
```

All 35 tests in `src/__tests__/marp-renderer.test.ts` must pass. If any fail, fix the implementation before proceeding.

### 0.2 Typecheck

```bash
pnpm typecheck
```

Zero TypeScript errors.

---

## 1. What was built

`MarpRenderer` is a class with two public methods:

```typescript
const renderer = new MarpRenderer();

// Renders a Marp Markdown deck to HTML + CSS + slide count + per-slide speaker notes
const result = renderer.render(`---
marp: true
---

# Hello World

Welcome.

---
# Slide 2

Content.
`);

// result.html     — string, full HTML with <section> elements
// result.css     — string, Marp theme CSS
// result.slideCount — number, 2
// result.comments — string[], ["", ""] (empty strings if no notes)

// Convenience: get speaker notes for a specific slide (or null if none)
const note = renderer.getNotes(result, 0); // null or string
```

This is a **pure in-process renderer** — no child process, no dev server, no network, no npm install at runtime.

---

## 2. Automated test walkthrough

Run the tests first to confirm green:

```bash
cd packages/marp
pnpm test -- src/__tests__/marp-renderer.test.ts
```

### 2.1 Basic rendering (M50-RENDER-01, M50-RENDER-02, M50-RENDER-03)

| Test | What it checks |
|---|---|
| `render() returns an object with html, css, slideCount, comments properties` | `MarpRenderResult` shape contract |
| `html is a non-empty string` | HTML is actually produced |
| `css is a non-empty string` | Marp theme CSS is included |
| `comments is an array` | Notes array is always present |
| `HTML output contains <section> elements` | Confirms `@marp-team/marp-core` is used (not hand-rolled HTML) |
| `HTML output contains the slide's heading text` | Content is correctly rendered |
| `render() is synchronous — returns a plain (non-Promise) value` | Confirms no async/server model |
| `render() produces deterministic output` | Live-reload path: same input = same output |

### 2.2 Slide counting (M50-RENDER-03)

| Test | What it checks |
|---|---|
| `single-slide deck returns slideCount = 1` | Baseline |
| `3-slide deck returns slideCount = 3` | Three `---` separators |
| `deck with no separator returns slideCount = 1` | Plain markdown fallback |
| `comments array length equals slideCount` | One entry per slide always |
| `2-slide deck returns slideCount = 2` | Two-separator case |

### 2.3 Directives (M50-RENDER-04)

| Test | What it checks |
|---|---|
| `marp: true in frontmatter renders without error` | Mandatory directive |
| `theme: default directive renders and produces non-empty CSS` | Theme directive |
| `paginate: true directive renders and produces CSS` | Pagination directive |
| `_class: lead directive renders and html contains "lead"` | Local class directive |
| `header: directive renders and header text appears in HTML` | Global header |
| `footer: directive renders and footer text appears in HTML` | Global footer |
| `multiple directives together render without error` | Combined directives |

### 2.4 Speaker notes (M50-RENDER-06)

| Test | What it checks |
|---|---|
| `<!-- notes --> is extracted into comments array` | Primary Marp syntax |
| `<!-- speaker_notes --> is extracted` | Alternative syntax |
| `slide with no notes has empty string in comments array` | Sentinel for no-notes slides |
| `multiple slides with mixed notes — correct per-slide extraction` | No note bleed between slides |
| `all slides with notes — all entries populated` | Full notes deck |
| `no notes in any slide — all comments entries are empty strings` | Note-less deck |

### 2.5 getNotes() helper (M50-RENDER-06)

| Test | What it checks |
|---|---|
| `getNotes() returns the note text for a slide that has notes` | Returns string |
| `getNotes() returns null for a slide with no notes` | Null sentinel (not "" or undefined) |
| `getNotes() returns null for out-of-range positive index` | Guard: index 999 on 1-slide deck |
| `getNotes() returns null for negative index` | Guard: -1 |

### 2.6 Edge cases (M50-RENDER-03)

| Test | What it checks |
|---|---|
| `empty string input does not throw` | Empty deck defensive |
| `empty string input returns a MarpRenderResult with correct shape` | Empty deck result shape |
| `deck with only frontmatter renders gracefully` | Frontmatter-only edge case |
| `deck with only content (no frontmatter) renders without error` | Marp works without frontmatter |
| `deck with very long content renders without error` | 10-slide stress case |

---

## 3. Manual / End-User Tests

Since this is an internal renderer module (not a user-facing tool), there are no direct user-observable behaviours here. The renderer is exercised through the full extension flow in later modules (M50-PVD, M50-EXT).

### 3.1 Manual renderer smoke test

You can verify the renderer works by writing a quick script:

```typescript
// In packages/marp/src/ (not in tests/)
import { MarpRenderer } from "./marp-renderer.js";

const md = `---
marp: true
theme: default
paginate: true
---

# Hello

Welcome to the deck.

<!-- notes -->

Speak slowly here.

---
# Slide Two

- Point A
- Point B

`;

const r = new MarpRenderer().render(md);
console.log("slideCount:", r.slideCount);
console.log("has HTML:", r.html.includes("<section"));
console.log("has CSS:", r.css.length > 0);
console.log("notes:", r.comments);
console.log("getNotes(0):", new MarpRenderer().getNotes(r, 0));
console.log("getNotes(999):", new MarpRenderer().getNotes(r, 999)); // should be null
```

Expected output:
```
slideCount: 2
has HTML: true
has CSS: true
notes: [ 'Speak slowly here.', '' ]
getNotes(0): Speak slowly here.
getNotes(999): null
```

### 3.2 Where to observe in VS Code

The MarpRenderer is used inside `PresentationProvider` (Module 7). Open a `.deck.md` file in VS Code with the `accordo-marp` extension active:

1. Run the extension in debug mode (F5 in the marp package)
2. Open any `.deck.md` file
3. The WebviewPanel should render the Marp slides
4. Navigate with arrow keys — slides scroll smoothly
5. Check DevTools → Console for any `marp-renderer` errors

---

## 4. Part 5 — Final check

```bash
# 1. All tests pass
cd packages/marp && pnpm test

# 2. TypeScript clean
cd packages/marp && pnpm typecheck

# 3. Build succeeds
cd packages/marp && pnpm build

# 4. Problems panel clean (VS Code debug session)
#    Open packages/marp in VS Code → Problems tab → zero errors
```

---

## 5. Affected by later modules

These later modules exercise the renderer end-to-end and are verified in their own testing guides:

| Later module | How it uses MarpRenderer |
|---|---|
| M50-RT (MarpAdapter) | Calls `renderer.render()` before navigating |
| M50-NAR (Narration) | Calls `renderer.getNotes()` for slide notes |
| M50-PVD (Provider) | Calls `renderer.render()` on open and file-change |
| M50-EXT (Extension) | Wires everything together in `extension.ts` |
