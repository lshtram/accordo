# Priority R — Phase A Architecture Review

**Date:** 2026-04-19  
**Scope:** Marp slide comment focus divergence (`user-left` vs `agent-left`)  
**Status:** Phase A complete (requirements + interfaces/stubs)

---

## 1) Corrected diagnosis

### 1.1 What was initially suspected

The working hypothesis in the workplan was that user-originated slide comment focus might still be routed through markdown preview (`accordo_preview_internal_focusThread`) while agent-originated focus used Marp focus (`accordo.presentation.internal.focusThread`).

### 1.2 What the code actually shows

1. **Comments panel router has no author-based branch.**
   - `packages/comments/src/panel/navigation-router.ts` dispatches from `buildNavigationDispatchPlan(thread)` and does not branch on `author.kind`.
   - Slide targets route to `accordo.presentation.internal.focusThread`.

2. **A second focus entry point exists outside the panel router.**
   - `packages/comments/src/native-comment-controller.ts` command `accordo.comments.focusInPreview` calls `CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD`.
   - `packages/md-viewer/src/extension.ts` implements that command as markdown-preview focus (`panel.reveal()` + `comments:focus` message to md-viewer webview).

3. **Marp has its own canonical focus command.**
   - `packages/marp/src/extension.ts` command `accordo.presentation.internal.focusThread` performs Marp-specific open → slide navigation → `comments:focus` post.

### 1.3 Corrected root cause statement

The divergence is **entry-path divergence**, not `user` vs `agent` logic in the slide router.  
There are currently two focus pathways:

- **Path A (correct for slide):** comments panel router → `accordo.presentation.internal.focusThread`
- **Path B (problematic for slide):** native comment command `accordo.comments.focusInPreview` → markdown preview focus command

When slide threads reach Path B, focus behavior can target the wrong surface and destabilize Marp UX (including apparent dismiss/close behavior).

---

## 2) Design for Priority R

1. **Unify thread-focus planning across entry points**
   - Introduce a source-aware focus planning contract for both panel and native comment actions.
   - Native focus action must delegate to the same dispatch planner used by panel navigation.

2. **Harden Marp focus command path**
   - Normalize deck identity (`file:///...` vs fsPath) before deciding whether to reopen/close.
   - Avoid reopen churn for canonically equal URIs.

3. **Harden Marp webview focus handling**
   - Validate slide index before calling `goTo()`.
   - Invalid indices must no-op without mutating active slide state.

---

## 3) Requirements updates made in Phase A

### `docs/20-requirements/requirements-marp.md`

- **M50-FOCUS-06**: deck-identity normalization to prevent false reopen/close on equivalent URI forms.
- **M50-PVD-18**: `comments:focus` slide-index validation before `goTo()`.

### `docs/20-requirements/requirements-comments-panel.md`

- **M45-NR-15**: native comment UI focus action must delegate to shared navigation dispatch planner.
- **M45-NR-16**: slide dispatch parity for user-authored and agent-authored threads must resolve to identical command tuple.

---

## 4) Interface/stub deliverables added

### `packages/marp/src/focus-thread-contract.ts`

Added typed design contracts and stubs for:

- `normalizeDeckUriToFsPath()`
- `parseSlideIndex()`
- `buildPresentationFocusThreadPlan()`
- `isValidSlideIndex()`
- `toVsCodeUri()`

### `packages/comments/src/panel/unified-focus-dispatch.ts`

Added typed design contracts and stubs for:

- `ThreadFocusSource`
- `ThreadFocusRequest`
- `UnifiedThreadFocusPlan`
- `buildUnifiedThreadFocusPlan()`

These are Phase A-only stubs (`throw new Error("not implemented")`) and are intentionally non-functional until Phase C.

---

## 5) Requirement → interface mapping

- **M45-NR-15 / M45-NR-16** → `buildUnifiedThreadFocusPlan()` (source-invariant planning contract)
- **M50-FOCUS-06** → `normalizeDeckUriToFsPath()`, `toVsCodeUri()`, `buildPresentationFocusThreadPlan()`
- **M50-PVD-18** → `parseSlideIndex()`, `isValidSlideIndex()`

---

## 6) Risks and follow-up for Phase B/C

1. Native-command callsites may still bypass the unified planner until implementation wiring is completed.
2. URI normalization must preserve Windows path semantics and UNC handling.
3. Webview index validation must not regress current `comments:focus` happy-path behavior.

---

## 7) Two-audience explanation

### Non-technical

Some comment clicks are taking a “wrong hallway” in the app. One hallway opens the slide correctly; another hallway was built for markdown preview and can interrupt the presentation. We designed a fix so **all** comment clicks for slides use the same hallway, and we added guardrails so bad slide coordinates are ignored instead of breaking the view.

### Technical

The issue is not an `author.kind` branch in the panel router; it is multi-entry focus dispatch drift. We introduced a shared, source-aware planning contract for thread focus and a Marp-side focus contract that normalizes URI identity and validates slide indices before navigation side effects. Requirements were updated first (M45-NR-15/16, M50-FOCUS-06, M50-PVD-18), then matching interface/stub modules were added to keep Phase A coherent and compilable.

---

## 8) Handoff

Phase A is complete and ready for project-manager checkpoint / Phase B test design.
