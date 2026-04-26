# Testing Guide — Priority R: Marp Slide Comment: User-left vs Agent-left Behaviour Divergence

> **Module:** `packages/marp/` (focus-thread contract) + `packages/comments/` (unified focus dispatch)
> **What it does:** Fixes the bug where clicking a **user-left** comment pin on a Marp slide would dismiss the presentation. Both user-left and agent-left comments now route through `accordo.presentation.internal.focusThread` (PRESENTATION_FOCUS_THREAD) instead of `accordo_preview_internal_focusThread` (PREVIEW_FOCUS_THREAD).

---

## Section 1 — Automated Tests

Run both test files together:

```bash
pnpm test -- --run packages/marp/src/__tests__/focus-thread-contract.test.ts packages/comments/src/__tests__/unified-focus-dispatch.test.ts
```

Or run them individually:

```bash
# Marp focus-thread contract — URI normalization, slide index parsing/validation, focus plan building
pnpm test -- --run packages/marp/src/__tests__/focus-thread-contract.test.ts

# Unified focus dispatch — slide surfaces, no author-based divergence
pnpm test -- --run packages/comments/src/__tests__/unified-focus-dispatch.test.ts
```

---

### `packages/marp/src/__tests__/focus-thread-contract.test.ts` — 16 tests

**What it verifies:**

| Test group | What is tested |
|---|---|
| `R-FOCUS-06` — `normalizeDeckUriToFsPath` | `file:///path/to/deck.md` normalizes to an absolute `fsPath` string (no `file://` scheme); bare `fsPath` is returned as-is (idempotent); `file://` and bare `fsPath` forms of the same deck resolve to equal paths |
| `R-PVD-18` — `parseSlideIndex` | Parses `slide:3:0.5000:0.5000` → `3`; returns `null` for non-slide blockIds (`block:abc123`); returns `null` for malformed slide blockIds (missing fields) |
| `R-PVD-18` — `isValidSlideIndex` | Valid 0-based indices within bounds return `true`; negative indices return `false` (no throw); `NaN` returns `false` (no throw); out-of-range indices return `false` (no throw); `Infinity`/`-Infinity` return `false` (no throw) |
| `R-FOCUS-06` — `buildPresentationFocusThreadPlan` | When `requestedDeckUri === currentDeckUri`, `shouldOpenDeck` is `false`; when two URI forms of the same deck are compared (`file:///…` vs `/…`), `shouldOpenDeck` is `false` (normalization collapses the difference); `focusMessage` type is `'comments:focus'` with correct `threadId` and `blockId` |
| `R-FOCUS-06` — `toVsCodeUri` | Converts `file:/// URI` to `vscode.Uri` with correct `fsPath`; converts bare `fsPath` to `vscode.Uri` with matching `fsPath` |

---

### `packages/comments/src/__tests__/unified-focus-dispatch.test.ts` — 8 tests

**What it verifies:**

| Test group | What is tested |
|---|---|
| `R-NR-15` — `buildUnifiedThreadFocusPlan` for native-comments | Source `'native-comments'` with slide anchor does **not** use `PREVIEW_FOCUS_THREAD` (the buggy path); source `'native-comments'` with slide anchor uses `PRESENTATION_FOCUS_THREAD`; source `'panel'` with slide anchor also uses `PRESENTATION_FOCUS_THREAD`; source `'native-comments'` with non-slide anchor does not throw |
| `R-NR-16` — Slide dispatch parity | Same slide thread produces identical `primaryCommand` for both `'panel'` and `'native-comments'` sources; same slide thread produces identical `primaryArgs` for both sources; `primaryArgs` contain the tuple `(uri, threadId, blockId)`; author `kind` (`'user'` vs `'agent'`) produces identical `primaryCommand` and `primaryArgs` for the same anchor — **this is the core regression test for Priority R** |

---

## Section 2 — User Journey Tests

These scenarios describe real interactions from the perspective of a user. No technical knowledge is assumed.

---

### Scenario 1 — Click an agent-left comment pin on a slide

**Setup:** You have a Marp presentation open (`deck.md`). An AI agent has left a comment on slide 3.

**Steps:**
1. Open the VS Code **Comments Panel** (View → Comments, or the icon in the Activity Bar).
2. Find the agent-left thread on slide 3 of `deck.md`.
3. Single-click the thread.

**What happens:**
- The deck presentation opens in a new tab (or focuses it if already open).
- The view jumps directly to **slide 3**.
- The pin for that thread highlights on the slide for 2–3 seconds then fades.
- The cursor does **not** jump to any line in a text editor — it stays on the slide surface.
- The presentation **stays open**.

---

### Scenario 2 — Click a user-left comment pin on a slide

> ⚠️ **This was the Priority R bug.** Before the fix, clicking a user-left comment on a slide would dismiss/close the presentation entirely. After the fix, behaviour matches Scenario 1.

**Setup:** You have a Marp presentation open (`deck.md`). You (the human user) have left a comment on slide 3.

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the user-left thread on slide 3 of `deck.md`.
3. Single-click the thread.

**What happens:**
- The deck presentation opens in a new tab (or focuses it if already open).
- The view jumps directly to **slide 3**.
- The pin for that thread highlights on the slide for 2–3 seconds then fades.
- The cursor stays on the slide surface.
- The presentation **stays open** — it does **not** dismiss or close.

**How to verify the fix worked:** Compare this behaviour side-by-side with an agent-left comment on the same slide. Both should feel identical.

---

### Scenario 3 — Click a comment with bad coordinates (invalid slide index)

**Setup:** A comment exists on `deck.md` but its stored slide index is invalid (e.g. slide index `99` in a 5-slide deck, or a malformed `blockId`).

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the thread with the bad slide index on `deck.md`.
3. Single-click the thread.

**What happens:**
- The system validates the slide index before acting.
- Because the index is out of range (or the `blockId` is malformed), the focus command does **not** crash or throw.
- The presentation **stays open** on whatever slide is currently displayed.
- No error is shown to the user.

---

### Scenario 4 — Click a comment when the presentation is already open on the same deck

**Setup:** The deck presentation `deck.md` is already open on slide 2. A comment exists on slide 5 of the same file.

**Steps:**
1. With `deck.md` presentation still open on slide 2, open the **Comments Panel**.
2. Find the thread on slide 5 of `deck.md`.
3. Single-click the thread.

**What happens:**
- The system detects the deck is already open (URI normalisation ensures `file:///…` and `/…` forms are treated as the same deck).
- The presentation **navigates to slide 5** — it does **not** close and reopen.
- `shouldOpenDeck` is `false` in this case; only the focus/navigation step runs.
- The transition is smooth; no flicker from a close+reopen cycle.

---

### Scenario 5 — Click a comment on a `.md` file that carries a slide `blockId` hint

**Setup:** You have a file `deck.md` which is a Marp presentation. A comment was anchored to this file with a `blockId` of `slide:2:0.5:0.5` (slide 2 coordinates).

**Steps:**
1. Open the VS Code **Comments Panel**.
2. Find the thread on `deck.md` with `blockId: "slide:2:0.5:0.5"`.
3. Single-click the thread.

**What happens:**
- The system detects the `slide:{index}:{x}:{y}` pattern in the `blockId`.
- The router selects the **slide surface** (not the plain text surface).
- Both the `panel` and `native-comments` source paths converge on `PRESENTATION_FOCUS_THREAD`.
- The deck presentation opens (or focuses) and jumps to **slide 2**.
- The comment pin on slide 2 is highlighted.
- The raw text of `deck.md` is **not** opened.

---

## Common Failure Modes

| Symptom | Likely cause |
|---|---|
| Clicking a user-left slide comment dismisses the presentation | The `buildUnifiedThreadFocusPlan` is still routing slide threads from `native-comments` through `PREVIEW_FOCUS_THREAD` instead of `PRESENTATION_FOCUS_THREAD` — the fix in `packages/comments/src/panel/unified-focus-dispatch.ts` was not applied |
| Clicking an agent-left slide comment works but user-left does not | Author-based divergence in the dispatch path; `R-NR-16-04` (author.kind parity test) would catch this |
| Presentation reopens (flickers) even when the same deck is already open | URI normalisation is not collapsing `file:///` and bare `fsPath` forms; `normalizeDeckUriToFsPath` may not be called, or `buildPresentationFocusThreadPlan` is not checking `currentDeckUri` |
| Clicking a comment with an invalid slide index crashes | `isValidSlideIndex` is throwing instead of returning `false` for invalid inputs |
| Clicking a slide comment has no effect at all | The `PRESENTATION_FOCUS_THREAD` command is not registered; extension activation may have failed |
