# Bug Diagnosis Review — `patchHandler` Missing `placeNodes()` Call

**Date:** 2026-03-31  
**File under review:** `packages/diagram/src/tools/diagram-tool-ops.ts` (`patchHandler`)  
**Verdict:** CONFIRMED — with one targeted amendment to the proposed fix

---

## 1. Diagnosis Accuracy

### 1.1 Root cause — CONFIRMED

The diagnosis is correct. `patchHandler` calls `reconcile()`, which adds new node IDs
to `layout.unplaced[]` via `addUnplaced()` (reconciler.ts line 135). The handler then
applies style/cluster overrides and calls `writeLayout()` directly — at **no point** is
`placeNodes()` invoked. The positions written to disk are therefore the raw initial-layout
positions (set by `computeInitialLayout` on the fallback path) or zero-initialized
coordinates if the layout was already established — either way, `unplaced[]` is persisted
non-empty and no collision resolution ever runs in the tool path.

### 1.2 Where `placeNodes()` does run — confirmed tool-path gap

- **Webview path** (`panel-core.ts`, lines 100–104): `generateCanvas()` is called with
  the layout (which may contain `unplaced[]`), `generateCanvas` internally calls
  `placeNodes()`, and the resolved `scene.layout` (with `unplaced: []`) is written back
  via `writeLayout()`. This path is correct and complete.
- **Tool path** (`patchHandler`): no equivalent step exists. `placeNodes()` is not
  imported in `diagram-tool-ops.ts` and is never called. This is the gap.

### 1.3 Evidence from the coordinate values

The evidence cited (BrowserTools, DiagramTools, CommentsTools with raw dagre x/y values
and a collision with Bridge at x=321) is consistent with the failure mode:
`computeInitialLayout` (via `placeNodes` step 1 — the dagre pass) produces ideal
positions, but the collision-avoidance passes (step 3 of `placeNodes`) and the
dagre-relative offset adjustment (step 2) are never applied.

---

## 2. Proposed Fix Assessment

### 2.1 Fix location — CORRECT

The placement step belongs immediately before `writeLayout()` in `patchHandler`, after
all style/cluster overrides have been applied to `finalLayout`. The sequence should be:

```
reconcile() → apply nodeStyles → apply clusterStyles → placeNodes (if unplaced > 0) → writeLayout()
```

This mirrors exactly what `generateCanvas` + `writeLayout` do in `panel-core.ts`.

### 2.2 The `parseMermaid(newSource)` call — NEEDS AMENDMENT

The proposal calls `parseMermaid(newSource)` a second time inside `patchHandler`. This
is unnecessary and carries two risks:

1. **Redundant parse.** `reconcile()` already calls `parseMermaid(newSource)` internally
   (reconciler.ts line 70). Parsing Mermaid source invokes the mermaid internal API
   (async, non-trivial cost) and the window-shim path. Parsing twice doubles the I/O for
   no reason.

2. **Type mismatch.** `placeNodes` accepts `ParsedDiagram`, not `ParseResult`. The
   proposal's code passes `newDiagram.diagram` — but `parseMermaid` returns `ParseResult`
   (discriminated union), so the caller needs to check `.valid` first. If the re-parse
   somehow fails (impossible given it already succeeded in `reconcile`, but still a guard
   the type system demands), the error would surface as an unhandled case.

**Better approach — surface the `ParsedDiagram` from `ReconcileResult`:**

Add an optional `diagram` field to `ReconcileResult` in `types.ts`:

```typescript
export interface ReconcileResult {
  layout: LayoutStore;
  mermaidCleaned?: string;
  diagram: ParsedDiagram;   // ← add: the validated new diagram, always present
  changes: { ... };
}
```

Then in `reconciler.ts`, include it in the return:

```typescript
return {
  layout,
  diagram: newDiagram,      // ← include parsed diagram
  ...(mermaidCleaned !== undefined ? { mermaidCleaned } : {}),
  changes: { ... },
};
```

Then in `patchHandler`:

```typescript
if (finalLayout.unplaced.length > 0) {
  const placed = placeNodes(finalLayout.unplaced, reconcileResult.diagram, finalLayout);
  const updatedNodes = { ...finalLayout.nodes };
  for (const [nodeId, pos] of placed) {
    updatedNodes[nodeId] = {
      ...updatedNodes[nodeId]!,
      ...pos,
      style: updatedNodes[nodeId]?.style ?? {},
    };
  }
  finalLayout = { ...finalLayout, nodes: updatedNodes, unplaced: [] };
}
```

This is zero-cost (the parse already happened), type-safe (no union to unwrap), and
consistent with how `reconcile()` already exposes its internal state.

### 2.3 Alternative: keep second parse, add `.valid` guard

If threading `diagram` through `ReconcileResult` is out of scope (e.g. touching shared
types is blocked), the second `parseMermaid` call is acceptable with one addition:

```typescript
if (finalLayout.unplaced.length > 0) {
  const newParseResult = await parseMermaid(newSource);
  if (newParseResult.valid) {                              // ← required guard
    const placed = placeNodes(finalLayout.unplaced, newParseResult.diagram, finalLayout);
    const updatedNodes = { ...finalLayout.nodes };
    for (const [nodeId, pos] of placed) {
      updatedNodes[nodeId] = {
        ...updatedNodes[nodeId]!,
        ...pos,
        style: updatedNodes[nodeId]?.style ?? {},
      };
    }
    finalLayout = { ...finalLayout, nodes: updatedNodes, unplaced: [] };
  }
  // If !valid: reconcile() already validated it, so this branch is unreachable.
  // Leaving unplaced[] in the file is the safe fallback — webview will resolve
  // it on next render.
}
```

The `.valid` guard makes the type narrowing explicit. The comment documents why the
`!valid` branch is dead code (not a silent swallow).

### 2.4 Import addition required

`placeNodes` is not currently imported in `diagram-tool-ops.ts`. The import line must
be added:

```typescript
import { placeNodes } from "../reconciler/placement.js";
```

---

## 3. Additional Risks

### 3.1 Style overrides after placement — ordering is correct

The proposed fix runs placement **after** style overrides, which is correct.
Style overrides (nodeStyles/clusterStyles) can set explicit `x` and `y` values
(lines 284–295 in the current `patchHandler`). If a caller explicitly positions a node
via `nodeStyles.x/y`, that node will **not** be in `unplaced[]` (because `unplaced[]`
only contains IDs that do not yet have `NodeLayout` entries in `finalLayout.nodes`).
The interaction is therefore safe — explicit positions set via `nodeStyles` are not
touched by `placeNodes`.

**One edge case to verify:** If a new node is added AND the caller passes a `nodeStyles`
override for it with explicit x/y, that node will be in `finalLayout.nodes` (added via
the style override block) AND in `finalLayout.unplaced[]`. The fix should check
`finalLayout.nodes[nodeId] === undefined` before placing — or, more robustly, only place
nodes that are in `unplaced[]` AND absent from `finalLayout.nodes`. Currently
`placeNodes` internally guards via `parsedNode = parsed.nodes.get(nodeId); if (!parsedNode) continue`
— but it does NOT skip nodes that already have positions in `existingLayout.nodes`.
This means a caller who passes both a new node in `content` and an `x/y` override in
`nodeStyles` for that same node would have the explicit position silently overwritten
by `placeNodes`.

**Recommended fix:** Before calling `placeNodes`, filter `finalLayout.unplaced` to
exclude any IDs that already have positions in `finalLayout.nodes`:

```typescript
const trueUnplaced = finalLayout.unplaced.filter(
  (id) => finalLayout.nodes[id] === undefined,
);
if (trueUnplaced.length > 0) {
  const placed = placeNodes(trueUnplaced, /* ... */);
  /* ... */
  finalLayout = { ...finalLayout, unplaced: [] };
}
```

### 3.2 `unplaced[]` not cleared when all nodes were placed via nodeStyles

If all nodes in `unplaced[]` happened to receive explicit x/y overrides via `nodeStyles`
(unusual but valid), they would have been promoted to `finalLayout.nodes` already.
With the filter from §3.1, `trueUnplaced` would be empty, `placeNodes` would return an
empty map, but `unplaced[]` would still be written to disk with the IDs. Adding an
unconditional `finalLayout = { ...finalLayout, unplaced: [] }` at the end of the
`unplaced` block (or replacing the condition with the filter approach) ensures
`unplaced[]` is always cleared before `writeLayout`.

---

## 4. Summary

| Item | Status |
|---|---|
| Bug location (`patchHandler` missing `placeNodes` call) | ✅ CONFIRMED |
| Fix location (before `writeLayout`, after style overrides) | ✅ CORRECT |
| `placeNodes` import missing from `diagram-tool-ops.ts` | ✅ Identified, must be added |
| Calling `parseMermaid` again vs threading through `ReconcileResult` | ⚠️ NEEDS AMENDMENT — prefer threading `diagram` through `ReconcileResult`; if not possible, add `.valid` guard |
| nodeStyles x/y + unplaced[] interaction (edge case) | ⚠️ NEEDS AMENDMENT — filter `unplaced` to exclude already-positioned IDs before calling `placeNodes` |
| `unplaced[]` cleared unconditionally | ⚠️ NEEDS AMENDMENT — ensure cleared even when all nodes were already positioned via nodeStyles |

**Overall verdict: CONFIRMED — core diagnosis and fix approach are correct. Apply the
three targeted amendments above before implementation.**
