# Investigation — Collision Detection Failure in `placeNodes()`

**Date:** 2026-03-31  
**Module:** `packages/diagram/src/reconciler/placement.ts`  
**Symptom:** CommentsTools placed at x=211 despite overlapping Bridge (x=321..501)

---

## Executive Summary

**There are two independent bugs.** Bug 1 is the primary cause of the observed failure.
Bug 2 is a latent aggravator that would silently corrupt collision detection whenever
`placeNodes()` is called from `diagram-tool-ops.ts` (the `accordo_diagram_patch` tool path).

---

## Bug 1 — PRIMARY: `placeNodes()` is never called from `diagram-tool-ops.ts`

### Location

`packages/diagram/src/tools/diagram-tool-ops.ts`, lines 264–337

### What happens

The `accordo_diagram_patch` handler:

1. Calls `reconcile(oldSource, newSource, currentLayout)` → returns `reconcileResult.layout`
   where `layout.unplaced = ["BrowserTools", "DiagramTools", "CommentsTools"]`
   and `layout.nodes` contains Bridge, Registry, and all other pre-existing placed nodes.
2. Applies nodeStyle/clusterStyle overrides → `finalLayout`
3. **Writes `finalLayout` directly to disk** (line 337: `await writeLayout(lPath, finalLayout)`)
4. **Never calls `generateCanvas()` or `placeNodes()`**

The new nodes stay in `unplaced[]` forever in the layout.json — they are **never positioned**.

`placeNodes()` is only called inside `generateCanvas()` (canvas-generator.ts line 71), which is
only invoked from the webview path (`panel-core.ts` line 102: `generateCanvas(parseResult.diagram, layout)`).

When the webview subsequently opens the diagram and calls `loadAndPost()`:
- It reads the persisted layout (which still has the 3 nodes in `unplaced[]`)
- It calls `generateCanvas(parseResult.diagram, layout)` — **this** triggers `placeNodes()`
- But at this point `layout` came from `readLayout()` which reads the JSON written by `diagram-tool-ops`
- That JSON has `layout.nodes` with **all pre-existing placed nodes including Bridge**

So `allPlaced` is seeded correctly inside `placeNodes()` — **but only from the webview path**.

### The actual positions observed (-269, -29, 211)

These come from the **dagre absolute positions** (fallback path, `placement.ts` lines 159-162),
because no placed neighbour was found. Those dagre positions happen to produce exactly the
three x-values reported, and the collision check passes because:
- BrowserTools at (-269, 450): no obstacles nearby
- DiagramTools at (-29, 450): does not overlap BrowserTools (-269+180=-89 ≤ -29, so clear)
- CommentsTools at (211, 450): does not overlap DiagramTools (-29+180=151 ≤ 211, so clear)
  — and **Bridge is in `allPlaced`**, so `rectsOverlap(commentsTools, bridge)` = **true**
  — so Pass A kicks in and shifts CommentsTools to x=691 (two steps of crossDx=240)

**Wait** — this means if `placeNodes()` receives the correct layout (Bridge in `allPlaced`),
it WOULD detect the collision and shift CommentsTools to x=691, NOT x=211.

The x=211 result therefore means one of:
- (a) `placeNodes()` was called with a layout where Bridge was absent from `layout.nodes`, OR
- (b) `placeNodes()` was never called and the x=211 is the raw dagre position stored directly

Path (b) is confirmed by the `diagram-tool-ops.ts` code: the patch handler never calls
`placeNodes()`. The positions appearing in layout.json are whatever dagre computed,
written to the layout via a different mechanism — or the nodes remain in `unplaced[]` with
their actual rendered positions being determined later by the webview.

**The x=211 value in layout.json is the dagre absolute position stored without collision resolution.**
The collision resolution in `placeNodes()` happens at webview render time, not at patch time.
The observed layout.json therefore shows pre-collision-resolution positions — which is the bug:
**the layout.json written by `diagram-tool-ops` contains unresolved `unplaced[]` entries**.

---

## Bug 2 — SECONDARY: `rectsOverlap` degenerates when existing nodes lack `w`/`h`

### Location

`packages/diagram/src/reconciler/placement.ts`, lines 111–114

```typescript
const allPlaced = new Map<string, { x: number; y: number; w: number; h: number }>();
for (const [id, nl] of Object.entries(existingLayout.nodes)) {
  allPlaced.set(id, { x: nl.x, y: nl.y, w: nl.w, h: nl.h });  // line 113
}
```

### The risk

`NodeLayout.w` and `NodeLayout.h` are always present in a correctly-formed layout.json.
However, if a layout.json was written by a path that stored nodes without `w`/`h` (e.g.
a legacy file or a partial write), `nl.w` and `nl.h` would be `undefined`.
In JavaScript, `undefined` arithmetic coerces to `NaN`, and comparisons with `NaN` always
return `false`, causing `rectsOverlap()` to return `false` for any comparison involving
that node — silently ignoring it as an obstacle.

Concrete example with Bridge at (321, 446, w=undefined, h=undefined):
```
rectsOverlap({x:211, y:450, w:180, h:60}, {x:321, y:446, w:0, h:0})
→ !(391<=321 || 321<=211 || 510<=446 || 446<=450)
→ !(false || false || false || true)
→ false   ← Bridge invisible to the collision checker
```

This is a latent bug: it would only manifest if `w`/`h` were absent from stored entries,
which is not the current format. But it is worth a defensive guard.

---

## Root Cause (Primary)

The `accordo_diagram_patch` handler in `diagram-tool-ops.ts` does not call `generateCanvas()`
or `placeNodes()`. It writes `reconcileResult.layout` (which has new nodes in `unplaced[]`)
directly to disk. Collision resolution only happens at webview render time.

**Consequence:** The layout.json written after a patch contains unresolved node positions.
The positions visible in layout.json for the new nodes are:
- Either the raw dagre positions (if the caller inspects layout via some read-back path)
- Or the nodes remain in `unplaced[]` (never promoted to `nodes{}` in the JSON)

Either way, the layout.json does not contain final collision-resolved positions until the
next `generateCanvas()` call from the webview.

---

## Code Trace (Exact Lines)

```
diagram-tool-ops.ts:266  reconcile(oldSource, newSource, currentLayout)
  reconciler.ts:135      addUnplaced(layout, nodesAdded)       ← BrowserTools/DiagramTools/CommentsTools
  reconciler.ts:89-95    layout.nodes preserved (Bridge IS here)
  reconciler.ts:169-180  returns ReconcileResult.layout
                           .nodes   = {Bridge, Registry, ...existing}
                           .unplaced = ["BrowserTools","DiagramTools","CommentsTools"]

diagram-tool-ops.ts:277  finalLayout = reconcileResult.layout
diagram-tool-ops.ts:337  writeLayout(lPath, finalLayout)  ← written with unplaced[] intact
                          ← placeNodes() is NEVER CALLED HERE

panel-core.ts:102        generateCanvas(parseResult.diagram, layout)  ← only from webview
  canvas-generator.ts:71 placeNodes(resolvedLayout.unplaced, parsed, resolvedLayout)
    placement.ts:111-114  allPlaced seeded from resolvedLayout.nodes (Bridge IS here)
    placement.ts:200-204  hasOverlap() checks against Bridge ✓
    placement.ts:212-216  Pass A: (211,450) overlaps Bridge → shift to (451,450)
    placement.ts:212-216  Pass A: (451,450) overlaps Bridge → shift to (691,450)
    placement.ts:212-216  Pass A: (691,450) clear → resolved ✓
                          CommentsTools final position: x=691 (correct, no overlap)
```

---

## The `rectsOverlap` function itself is correct

For reference, verifying the math directly:

```
CommentsTools: x=211, y=450, w=180, h=60  → right=391, bottom=510
Bridge:        x=321, y=446, w=180, h=60  → right=501, bottom=506

rectsOverlap check:
  !(391 ≤ 321)  → false
  !(501 ≤ 211)  → false
  !(510 ≤ 446)  → false
  !(506 ≤ 450)  → false
  result: !(false) = true  ← correctly detects overlap
```

`rectsOverlap` is not the bug.

---

## Summary of Bugs

| # | Severity | Location | Line | Description |
|---|---|---|---|---|
| 1 | **HIGH** | `diagram-tool-ops.ts` | 337 | `writeLayout()` called before `placeNodes()` — new nodes never collision-resolved in layout.json |
| 2 | MEDIUM | `placement.ts` | 113 | No guard against `undefined` w/h on existing nodes — `rectsOverlap` silently degenerates |

---

## Fix Direction (for developer)

**Bug 1:** After `reconcileResult.layout` is computed and before `writeLayout()`,
if `finalLayout.unplaced.length > 0`, call `placeNodes()` and merge the result into
`finalLayout.nodes`, then clear `finalLayout.unplaced`. The parsed diagram is available
via `parseMermaid(newSource)` (already called inside `reconcile`; could be returned as
part of `ReconcileResult`, or re-parsed here).

**Bug 2:** In `placement.ts` line 113, add a guard:
```typescript
allPlaced.set(id, {
  x: nl.x,
  y: nl.y,
  w: typeof nl.w === "number" ? nl.w : 180,
  h: typeof nl.h === "number" ? nl.h : 60,
});
```
