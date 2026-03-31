# Review — G-3 — Phase 1: Diagnosis Verification

**Date:** 2026-03-31  
**Reviewer:** Reviewer agent  
**Bug:** Comment pins don't track diagram viewport movement (pan / zoom)

---

## Verdict: DIAGNOSIS CONFIRMED ✅

The investigation findings are accurate. Every claim has been verified against the actual source code.

---

## 1. Root Cause — Verified

### 1.1 `PinPositioner` uses native DOM `scroll` events

`packages/comment-sdk/src/pin-renderer.ts:137`:

```typescript
target.addEventListener("scroll", this._repositionHandler, true);
```

`pin-renderer.ts:93`:
```typescript
window.addEventListener("resize", this._repositionHandler);
```

The `_repositionHandler` is wired **only** to DOM `scroll` events and `window.resize`. These fire when a standard scrollable container scrolls (DOM node scroll position changes).

**Excalidraw does not scroll the DOM.** It pans via `appState.scrollX` / `appState.scrollY` (internal React state) applied as CSS transforms to canvas elements. No DOM `scroll` event fires during a pan. Therefore `_repositionHandler` **never fires** when the user pans the diagram, and `coordinateToScreen()` — which reads `appState.scrollX/Y/zoom` live — is never called after initial render.

This is the confirmed root cause.

### 1.2 Dead code comment — Verified

`packages/diagram/src/webview/comment-overlay.ts:374–382`:

```typescript
// ── A18-W04 — Pin re-render on scroll/zoom ─────────────────────────────
// We poll the appState by wrapping the Excalidraw handle's updateScene.
// A simpler approach: expose a function that comment-overlay.ts calls
// when it receives scroll/zoom change notifications via postMessage.
// Since the comment SDK manages its own pin positioning via coordinateToScreen,
// we just need to call sdk.loadThreads() whenever scroll/zoom changes.
// We do this from the window message handler in webview.ts (comments:load
// and canvas:node-moved messages trigger it there).
void prevScrollX; void prevScrollY; void prevZoom; // suppress unused warnings
_updatePinSizeCss(1); // initial default zoom
```

The comment says "We do this from the window message handler in webview.ts" — but `webview.ts` does **not** call any reposition function on `canvas:node-moved`. That handler only calls `applyHostMessage`. The link is broken. This is confirmed dead / unimplemented code.

The three state variables `prevScrollX`, `prevScrollY`, `prevZoom` are declared (lines 39–41), assigned initial values, and then immediately suppressed with `void` to silence the linter. They are never read for any useful purpose. The viewport tracking was designed but never connected.

---

## 2. Data Flow — Current (Broken) State

```
User pans/zooms Excalidraw
  └─> Excalidraw internal React state: appState.scrollX / scrollY / zoom
  └─> handleChange() fires in excalidraw-canvas.ts
        └─> only processes NodeMutations (moved / resized / styled)
        └─> appStateRaw is received but NEVER read
  └─> PinPositioner._repositionHandler: NEVER called (no DOM scroll)
  └─> Pins stay at stale screen coordinates
```

### Key observation: `appStateRaw` is already passed to `handleChange`

`excalidraw-canvas.ts:230–266`:
```typescript
const handleChange = useCallback(
  (
    elements: readonly ExcalidrawElement[],
    appStateRaw: Record<string, unknown>,  // ← viewport state is HERE
  ) => {
    // ... only processes mutations, never reads appStateRaw
  },
  [],
);
```

The viewport state (`scrollX`, `scrollY`, `zoom`) arrives in `handleChange` on **every** Excalidraw state change including pans and zooms. It is simply ignored. The fix path is straightforward.

---

## 3. Proposed Fix — Assessment

The proposal is:

1. **`excalidraw-canvas.ts`**: Track `prevViewportState` in `handleChange` — call `repositionPins()` when `scrollX`, `scrollY`, or `zoom` changes.
2. **`comment-overlay.ts`**: Export `repositionPins()` that calls `sdk.loadThreads(currentSdkThreads)`.

**Assessment: Directionally correct.** The mechanism is sound — `appStateRaw` already contains the viewport values, `handleChange` fires on every change, and `repositionPins()` calling `sdk.loadThreads(currentSdkThreads)` would reposition all pins via the live `coordinateToScreen()` callback.

However, **see Phase 2 for efficiency and flicker concerns** — `sdk.loadThreads()` is a destructive full replace (removes all pin DOM nodes, re-creates them). This is the correct mechanism for initial load but carries risk as a high-frequency reposition handler.

---

## 4. Module Boundary — No Issues

- The fix stays entirely within the webview bundle (`excalidraw-canvas.ts` + `comment-overlay.ts`). No extension-host code, no Hub code, no protocol changes required.
- `repositionPins()` as an export from `comment-overlay.ts` is a clean interface — `excalidraw-canvas.ts` imports from `comment-overlay.ts` already (showToast is imported the reverse direction via the window global; this new export would go the direct module-import route which is better).
- `currentSdkThreads` is already maintained as module-level state in `comment-overlay.ts` — the export closes the loop correctly.

---

## 5. Summary

| Claim | Verified? |
|---|---|
| `PinPositioner` listens only for DOM `scroll` events | ✅ |
| Excalidraw pans via internal React state, not DOM scroll | ✅ |
| `_repositionHandler` never fires on pan/zoom | ✅ |
| Dead code comment at `comment-overlay.ts:374` | ✅ |
| `prevScrollX/Y/prevZoom` declared but never used | ✅ |
| `appStateRaw` available in `handleChange` but never read | ✅ |
| Proposed fix mechanism is architecturally sound | ✅ with caveats (see Phase 2) |

**Phase 1 review: PASS. Proceed to Phase 2 (design review).**
