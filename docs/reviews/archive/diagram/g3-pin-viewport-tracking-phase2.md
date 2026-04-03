# Review — G-3 — Phase 2: Design Review

**Date:** 2026-03-31  
**Reviewer:** Reviewer agent  
**Bug:** Comment pins don't track diagram viewport movement (pan / zoom)

---

## Verdict: CONDITIONAL PASS ⚠️

The proposed approach is viable, but `sdk.loadThreads()` as the reposition mechanism carries a **critical efficiency concern** that must be resolved before implementation. Three design requirements are specified below. The implementation must meet all three.

---

## 1. Design Proposal Recap

```
handleChange(elements, appStateRaw) in excalidraw-canvas.ts
  └─> compare appStateRaw.scrollX/Y/zoom vs prevViewportState
  └─> if changed: call repositionPins()

repositionPins() in comment-overlay.ts
  └─> sdk.loadThreads(currentSdkThreads)
```

---

## 2. Critical Issue: `sdk.loadThreads()` is a destructive full replace

### What `sdk.loadThreads()` actually does

From `packages/comment-sdk/src/thread-manager.ts:60–92`:

```typescript
loadThreads(...): void {
  // 1. Remove gutter markers from all .accordo-block--has-comments elements
  opts.container.querySelectorAll(".accordo-block--has-comments").forEach(...);
  
  // 2. Remove ALL existing pin DOM nodes
  for (const entry of this._pins.values()) {
    entry.element.remove();      // ← DOM removal per-pin
  }
  this._pins.clear();
  
  // 3. Re-create ALL pins from scratch
  for (const thread of threads) {
    const pos = opts.coordinateToScreen(thread.blockId);
    if (!pos) continue;
    const el = createPinElement(thread, pos, onPinClick);  // ← new DOM node per-pin
    layer.appendChild(el);
    ...
  }
}
```

This performs **O(n) DOM removals + O(n) DOM insertions** on every call, where n is the number of comment threads. The `handleChange` callback fires continuously while the user is panning (typically at 60fps in Excalidraw). With 10 threads at 60fps that is 1200 DOM operations per second.

### Severity

**HIGH.** With a small number of threads (≤5) this will likely be invisible to users. With larger diagrams (20–50 threads) this will cause:
1. **Visible pin flicker** — pins disappear and reappear on every frame.
2. **Layout thrashing** — browser must recalculate geometry after each batch.
3. **Open popover destroyed** — if the user has a popover open while panning, `loadThreads` removes the pin element the popover is anchored to. The popover will remain orphaned or crash.

### Required fix: Use a reposition-only path

The `PinPositioner._repositionHandler` already does the right thing — it iterates pin entries and updates `left`/`top` on existing DOM elements without any DOM creation/removal:

```typescript
// pin-renderer.ts:81–88 (the correct pattern)
this._repositionHandler = () => {
  for (const entry of getPins()) {
    const pos = opts.coordinateToScreen(entry.thread.blockId);
    if (!pos) continue;
    entry.element.style.left = `${pos.x}px`;
    entry.element.style.top = `${pos.y}px`;
  }
};
```

**Design requirement DR-1:** The reposition triggered from `handleChange` MUST call `PinPositioner._repositionHandler` (or equivalent inline logic) — NOT `sdk.loadThreads()`. This means either:

- **(Preferred) Option A:** Export a `repositionPins()` from `comment-overlay.ts` that directly calls the positoner's reposition handler. This requires exposing the handler or adding a `reposition()` method to `AccordoCommentSDK` / `PinPositioner`.
- **Option B:** `repositionPins()` replicates the loop inline — iterate `currentSdkThreads`, call `coordinateToScreen`, update existing pin elements' `style.left/top`. This duplicates logic but avoids SDK API changes.

Option A is cleaner. A `reposition()` method on `AccordoCommentSDK` that calls `this._positioner._repositionHandler?.()` (or via a proper public method on `PinPositioner`) would be the right surface.

---

## 3. Risk: Re-render Storms

### Trigger frequency

`handleChange` fires for **every Excalidraw state change**: element selection, cursor moves, text editing, scroll, zoom, drag. During a pan, it fires at animation-frame rate.

**Design requirement DR-2:** The viewport change detection in `handleChange` MUST use change detection to gate the reposition call — only fire when `scrollX`, `scrollY`, or `zoom.value` actually differs from the previous values. This prevents reposition calls during non-viewport state changes (element selection, etc.). The `prevViewportState` tracking proposed in the investigation is correct for this.

```typescript
// Correct gating pattern (pseudocode):
const nextScrollX = appStateRaw.scrollX as number;
const nextScrollY = appStateRaw.scrollY as number;
const nextZoom    = (appStateRaw.zoom as { value: number }).value;

if (nextScrollX !== prevScrollX || nextScrollY !== prevScrollY || nextZoom !== prevZoom) {
  prevScrollX = nextScrollX;
  prevScrollY = prevScrollY;  // ← BUG RISK: watch for copy-paste error here
  prevZoom    = nextZoom;
  repositionPins();
}
```

Even with the reposition-only path from DR-1, calling it at 60fps for every animation frame is acceptable (it's just n CSS property updates). But it should still be gated to avoid firing during non-viewport changes (keyboard, selection, etc.) which dominate usage.

---

## 4. Risk: Zoom Level and Pin Size CSS

`comment-overlay.ts` already has `_updatePinSizeCss(zoom: number)` which injects a `<style>` tag to scale pin dimensions with zoom. This is currently called only once at initialization (`_updatePinSizeCss(1)`).

**Design requirement DR-3:** When the viewport changes due to zoom, `_updatePinSizeCss` MUST also be called with the new zoom value. The reposition function should call both the coordinate update AND the CSS zoom update.

```typescript
export function repositionPins(): void {
  // 1. Update pin positions
  sdk.reposition(); // or equivalent
  // 2. Update pin CSS size for current zoom
  const appState = (window as ...__accordoHandle)?.getAppState?.();
  if (appState) _updatePinSizeCss(appState.zoom.value);
}
```

Alternatively, the zoom value can be passed into `repositionPins()` from `handleChange` where it is already computed.

---

## 5. Risk: Initial Scene Load Race Condition

**Low severity.** The existing `pollForCanvasReady()` interval already gates on `win.__accordoCanvasReady`. The `repositionPins()` call from `handleChange` will only be wired after the SDK initialises, because `prevViewportState` tracking must be set up after `sdk.init()` is called.

However: on initial scene load, `handleChange` fires before `handleCommentsLoad` has been called (the `comments:load` message arrives asynchronously after `host:load-scene`). So `repositionPins()` may be called with `currentSdkThreads = []` — this is harmless (nothing to reposition) but the developer should be aware.

**No action required** — the race is self-healing. Once `comments:load` fires and `handleCommentsLoad` calls `sdk.loadThreads(...)` with real threads, pins will be at the correct positions.

---

## 6. Coupling Concern: Cross-module call direction

Currently `excalidraw-canvas.ts` does **not** import from `comment-overlay.ts`. The module-communication is indirect via `window.__accordo*` globals.

The proposed fix requires `excalidraw-canvas.ts` to call `repositionPins()` from `comment-overlay.ts`. This introduces a direct module dependency:

```
excalidraw-canvas.ts  →  comment-overlay.ts
```

This is fine — both modules are in the same webview bundle, `comment-overlay.ts` already imports `showToast` from `excalidraw-canvas.ts`, so there's already implicit coupling. A direct export/import relationship is **cleaner** than the reverse direction of using window globals.

One caveat: this creates a **circular import risk** if `comment-overlay.ts` tries to import anything from `excalidraw-canvas.ts` in the same call chain. Currently `comment-overlay.ts` imports `showToast` from `excalidraw-canvas.ts`. The proposed addition would have `excalidraw-canvas.ts` import `repositionPins` from `comment-overlay.ts`. This is a **circular dependency at module level** and TypeScript/esbuild will resolve it as a runtime cycle.

**Design requirement (clarification of DR-1):** To avoid the circular import, `repositionPins` should be exposed on `window` (as `window.__accordoRepositionPins`) by `comment-overlay.ts` at init time, or the reposition call should be passed as a callback through `window.__accordoCanvasReady` ceremony. Alternatively, extract `repositionPins` to a third module that both can import without cycles. The simplest approach: store the function on `window` in `comment-overlay.ts`'s `pollForCanvasReady` callback (same pattern as `__accordoHandle`, `__accordoUI`, etc.).

---

## 7. Design Requirements Summary

| ID | Requirement | Priority |
|---|---|---|
| DR-1 | Reposition MUST use position-update-only path (not `loadThreads()`). Consider adding `reposition()` to `AccordoCommentSDK` or exposing via window global. | **BLOCKING** |
| DR-2 | Gate reposition on actual viewport-value change via `prevScrollX/Y/zoom` comparison. | Required |
| DR-3 | Zoom change MUST also call `_updatePinSizeCss(newZoom)`. | Required |
| DR-4 | Avoid circular import: use window global or third module for `repositionPins()` export. | Required |

---

## 8. Recommended Implementation Path

```
1. Add sdk.reposition() to AccordoCommentSDK
   → calls this._positioner._repositionHandler?.() (make it callable)
   
2. comment-overlay.ts: export repositionPins() that calls:
   a. sdk.reposition()
   b. _updatePinSizeCss(currentZoom)
   Then expose as: win.__accordoRepositionPins = repositionPins
   (in pollForCanvasReady after sdk.init)

3. excalidraw-canvas.ts: handleChange tracks prevScrollX/Y/zoom
   → on change: calls win.__accordoRepositionPins?.()
   (no new import needed — avoids circular dependency)
```

This path: zero DOM creation/removal on pan, correct zoom scaling, no circular imports, no re-render storm risk.

---

## Phase 2 Review: CONDITIONAL PASS

Proceed to implementation **only if** DR-1 through DR-4 are addressed. Specifically, DR-1 (no `loadThreads()` as reposition) is a **blocking requirement** — using `loadThreads()` for reposition will cause visible flicker and popover destruction on pan.

**After implementation → Phase 3 review required.**
