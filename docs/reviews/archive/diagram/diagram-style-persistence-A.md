# Review — diagram-style-persistence — Phase A

**Bugs under review:** F-2 (fillStyle/strokeStyle not persisted), F-3 (fontFamily not persisted)  
**Files in scope:** `packages/diagram/src/webview/message-handler.ts`, `scene-adapter.ts`, `panel-core.ts`  
**Reviewer:** AI Reviewer  
**Date:** 2026-03-31  
**Verdict:** NEEDS_CHANGES

---

## Re-Review — Blocking Issues Only — 2026-03-31

**Verdict: PASS on both blocking items. Design is cleared for Phase B.**

### Issue 1 — Arrow guard (BLOCKING → RESOLVED)

**Verdict: PASS**

Verified in `message-handler.ts` line 225:

```typescript
if (!isText && !mermaidId.endsWith(":label") && !mermaidId.includes("->")) {
  if (nextEl.fillStyle !== prevEl.fillStyle) style.fillStyle = nextEl.fillStyle;
  if (nextEl.strokeStyle !== prevEl.strokeStyle) style.strokeStyle = nextEl.strokeStyle;
}
```

This is the preferred option (A) from the original review. The triple guard is:
1. `!isText` — excludes bound text overlays (`:text` suffix)
2. `!mermaidId.endsWith(":label")` — excludes edge label text elements
3. `!mermaidId.includes("->")` — excludes edge arrows (e.g. `"A->B:0"`)

The comment block (lines 219–224) explicitly documents all three exclusion reasons, including the data-corruption rationale for the arrow case. This satisfies both the functional correctness requirement and the `coding-guidelines.md` requirement that intent is documented inline.

Notably, the guard is *tighter* than what I originally requested: the original Issue 1 proposed `!mermaidId.includes("->")` alone as the fix, but the implemented guard also includes `!mermaidId.endsWith(":label")`. That is correct — edge labels with a `:label` suffix (not ending in `:text`) would also produce spurious `layout.nodes` entries if left unguarded.

No concerns.

---

### Issue 2 — `REVERSE_FONT_FAMILY_MAP` type (BLOCKING → RESOLVED)

**Verdict: PASS**

Verified in `scene-adapter.ts` lines 104–108:

```typescript
export const REVERSE_FONT_FAMILY_MAP: Readonly<Partial<Record<number, "Excalifont" | "Nunito" | "Comic Shanns">>> = {
  1: "Excalifont",
  2: "Nunito",
  3: "Comic Shanns",
} as const;
```

The architect's claim that `noUncheckedIndexedAccess` is not enabled was verified directly — neither `tsconfig.base.json`, `packages/diagram/tsconfig.json`, nor `packages/diagram/tsconfig.webview.json` contain `noUncheckedIndexedAccess`. The `Partial<Record<number, V>>` form is therefore the correct and necessary way to make the compiler infer `V | undefined` on index access, so the `if (fontName != null)` guard at line 239 is enforced by the type system.

The comment block (lines 95–103 in `scene-adapter.ts`) documents the rationale explicitly, including the WF-15 reference. The usage site (line 238–241) correctly gates on `fontName != null` before emitting, which the `Partial<>` type now enforces at compile time.

No concerns.

---

### Outstanding from original review

| # | Action | Status |
|---|---|---|
| 1 | Arrow guard for fillStyle/strokeStyle (Issue 1) | ✅ RESOLVED — triple guard implemented with comment |
| 2 | `REVERSE_FONT_FAMILY_MAP` Partial type (Issue 2) | ✅ RESOLVED — `Partial<Record<number, ...>>` with JSDoc |
| 3 | Add WF-16 to proposed test list (arrow guard test) | Open — responsibility of test-builder in Phase B |
| 4 | Document fillStyle/strokeStyle boundary validation policy (Issue 3, informational) | Open — informational only, not blocking |

Phase B (test-writing) may now begin.

---

## PASS — Root Cause Analysis

All three root causes are correctly identified and the proposed fixes address them at the right layer.

### Bug 1 — `detectNodeMutations()` missing properties ✓

The current code (lines 196–221 of `message-handler.ts`) already detects `backgroundColor`, `strokeWidth`, `opacity`, `strokeColor`/`fontColor`, and `fontSize`. The proposed additions of `fillStyle`, `strokeStyle`, and `fontFamily` complete the set. The detection location is correct: this is the webview→extension-host boundary where Excalidraw's element objects are diffed before crossing into the domain model.

### Bug 2 — `toExcalidrawPayload()` hardcodes fillStyle ✓

Verified at `scene-adapter.ts` line 118:
```typescript
fillStyle: "hachure" as const,   // overwrites ...rest.fillStyle unconditionally
```
The explicit field appears **after** `...rest` in the object literal, so it always wins regardless of what `rest.fillStyle` contains. The proposed fix:
```typescript
fillStyle: rest.fillStyle ?? ("hachure" as const)
```
is the correct pattern — identical to the treatment of `strokeStyle` (line 120) and `strokeColor` (line 129) in the same function. `ExcalidrawElement.fillStyle` is declared as optional (`fillStyle?: string` at `types.ts` line 416), so the nullish coalesce is necessary and sufficient.

### Bug 3 — No reverse map for fontFamily ✓

`FONT_FAMILY_MAP` (string→number) is the only direction currently implemented. Because `ExcalidrawAPIElement.fontFamily` is typed as `number` (scene-adapter.ts line 63), a `REVERSE_FONT_FAMILY_MAP` (number→string) is the correct approach. Co-locating it with the forward map in `scene-adapter.ts` is the right call for discoverability and symmetry.

---

## PASS — Conversion Location

The fontFamily reverse conversion belongs in `detectNodeMutations`, **not** in `panel-core.ts`. Rationale: `panel-core.ts` receives `canvas:node-styled` messages that carry `style: Record<string, unknown>` already in domain terms. The numeric→string translation is part of reading Excalidraw's element objects, which is `detectNodeMutations`'s responsibility. Moving it elsewhere would violate the layer boundary.

---

## PASS — Shape-only / Text-only Guards (primary cases)

| Property | Guard proposed | Correct? | Rationale |
|---|---|---|---|
| `fillStyle` | `!isText` (shape-only) | ✓ | canvas-generator never sets fillStyle on text elements; Excalidraw does not render fill on text. |
| `strokeStyle` | `!isText` (shape-only) | ✓ | canvas-generator only sets strokeStyle on shape elements (line 166); NodeStyle has no strokeStyle for text. |
| `fontFamily` | `isText` (text-only) | ✓ | fontFamily is the rendered font; it belongs to the bound text element, not the shape. The shape element's fontFamily field exists in Excalidraw but has no visual effect. |

---

## NEEDS_CHANGES — Issues Requiring Fixes Before Phase B

### Issue 1 — `!isText` guard also fires for edge arrows (MUST FIX) 

**Severity: Medium**

The style-detection block (lines 192–221 of `message-handler.ts`) runs for **all** elements with a non-empty `mermaidId`, including edge arrows (mermaidId contains `"->"`). The `isNodeElement` guard (lines 179–183) was intentionally not applied to the style block — the comment at line 175 only explains that `isNodeElement` gates `moved`/`resized`.

With the proposed `!isText` guard for `fillStyle` and `strokeStyle`:
- An edge arrow (`mermaidId = "A->B:0"`) has `isText = false`, so `!isText = true`.
- `shapeNodeId = "A->B:0"` (unchanged, since it doesn't end in `":text"`).
- A styled mutation `{type:"styled", nodeId:"A->B:0", style:{fillStyle:"solid"}}` would be emitted.
- `handleNodeStyled` calls `patchNode(layout, "A->B:0", ...)` which creates a spurious entry in `layout.nodes["A->B:0"]` — silent data corruption (wrong record in the nodes map for an edge key).

Note: `backgroundColor`, `strokeWidth`, and `opacity` detection (lines 198–200) have the **same pre-existing gap** for arrows. The new properties should not inherit this gap without explicit acknowledgement. The design should either:

**(a) Preferred:** Apply the same guard to the new properties that `isNodeElement` already defines — add `!mermaidId.includes("->")` to the fillStyle/strokeStyle detection condition:
```typescript
if (!isText && !mermaidId.includes("->")) {
  if (nextEl.fillStyle !== prevEl.fillStyle) style.fillStyle = nextEl.fillStyle;
  if (nextEl.strokeStyle !== prevEl.strokeStyle) style.strokeStyle = nextEl.strokeStyle;
}
```

**(b) Acceptable:** Add a comment explicitly documenting that the gap is inherited intentionally, and add it to a tracked issue for a future cleanup of the full style block.

**Required test addition:** WF-16 — fillStyle change on an edge arrow → NOT emitted (the test suite should demonstrate that the chosen policy is enforced).

---

### Issue 2 — `REVERSE_FONT_FAMILY_MAP` type declaration needs tightening (SHOULD FIX)

**Severity: Minor**

The design specifies:
```typescript
REVERSE_FONT_FAMILY_MAP: Readonly<Record<number, "Excalifont"|"Nunito"|"Comic Shanns">>
```
This return type asserts that every numeric key maps to a valid string. But `Record<number, V>` in TypeScript means any `number` key is assumed present — the type would claim `REVERSE_FONT_FAMILY_MAP[99]` is `"Excalifont" | "Nunito" | "Comic Shanns"`, not `undefined`.

The correct declaration is:
```typescript
export const REVERSE_FONT_FAMILY_MAP: Readonly<Record<number, "Excalifont" | "Nunito" | "Comic Shanns" | undefined>> = {
  1: "Excalifont",
  2: "Nunito",
  3: "Comic Shanns",
} as const;
```
Or equivalently, declare the value type with `Partial<Record<number, ...>>`. This matters because the detection code must check for `undefined` before emitting (which is the intent of WF-15), but with the non-partial `Record<number, V>` the TypeScript compiler won't enforce that check.

If `noUncheckedIndexedAccess` is enabled in tsconfig (check before implementing — it often is in strict configs), this resolves automatically. If not, the partial/undefined-union form is required to keep the `coding-guidelines.md` §3.3 "zero unsafe `as X` casts" rule clean.

---

### Issue 3 — No runtime narrowing of `fillStyle`/`strokeStyle` values at the boundary (INFORMATIONAL — decide policy)

**Severity: Low**

`ExcalidrawAPIElement.fillStyle` is typed as `string` (scene-adapter.ts line 49). When written to `style.fillStyle` in `detectNodeMutations`, the value flows into `handleNodeStyled` → `patchNode` → layout JSON. The cast at `panel-core.ts` line 263 (`as import("../types.js").NodeStyle`) bypasses the union type `NodeStyle.fillStyle`.

In practice, Excalidraw only ever produces the seven values that exactly match our `NodeStyle.fillStyle` union, so this is not a runtime hazard. However, the design should make a deliberate choice:

- **Option A (no change):** Accept the widened type at the boundary, rely on the fact that Excalidraw's value set matches our union. Document this in the detection block with a comment.  
- **Option B (narrowing guard):** Add a `VALID_FILL_STYLES` set and check membership before emitting, similar to the WF-15 pattern for fontFamily. This is consistent with `coding-guidelines.md` §3.2: "Validate all external input at system boundaries."

The same question applies to `strokeStyle` (Excalidraw's values `"solid" | "dashed" | "dotted"` exactly match our union). The design should document which option is chosen before Phase C to avoid re-reviewing this at D2.

---

## PASS — Test Coverage (proposed WF-10 through WF-15 + SA-06/SA-07)

The six new `message-handler` tests cover:
- Happy path for each new property: WF-10 (fillStyle), WF-11 (strokeStyle), WF-13 (fontFamily)
- Negative gate for each guard: WF-12 (fillStyle on text), WF-14 (fontFamily on shape), WF-15 (unknown fontFamily numeric)

The two new `scene-adapter` tests cover:
- SA-06: fillStyle passes through when present in layout
- SA-07: fillStyle defaults to "hachure" when absent

This is the minimum sufficient set **given Issue 1 is resolved**. With Issue 1 resolved (whichever option is chosen), add **WF-16** for the arrow case.

---

## PASS — No Changes Needed to types.ts, protocol.ts, or panel-core.ts

- **`types.ts`:** `NodeStyle.fillStyle`, `.strokeStyle`, and `.fontFamily` are already declared (lines 163, 170, 190). `ExcalidrawElement.fillStyle` is already optional (line 416). No changes required.
- **`protocol.ts`:** `CanvasNodeStyledMessage.style: Record<string, unknown>` is intentionally generic. The new style properties flow through without modification.
- **`panel-core.ts`:** `handleNodeStyled` already does a generic merge (`{...existing, ...stylePatch} as NodeStyle`). No changes required for the fix to work end-to-end.

---

## Confirmed Design Decisions (record for `docs/decisions.md`)

1. **fontFamily conversion at `detectNodeMutations`** — correct layer; not in `panel-core`.
2. **fillStyle defaults to `"hachure"`** via `??` operator in `toExcalidrawPayload` — consistent with `strokeStyle` and `strokeColor` in the same function.
3. **REVERSE_FONT_FAMILY_MAP co-located in `scene-adapter.ts`** — correct placement; forward and reverse maps belong together.

---

## Required Actions Before Phase B Can Start

| # | Action | Owner | Blocking? |
|---|---|---|---|
| 1 | Decide and document the arrow guard policy for fillStyle/strokeStyle (Issue 1 option A or B), update the design | Architect | YES |
| 2 | Fix `REVERSE_FONT_FAMILY_MAP` type to use `Partial<Record<>>` or `undefined`-union (Issue 2) | Architect | YES |
| 3 | Add WF-16 to proposed test list (arrow guard test) | Test-builder | YES |
| 4 | Document the fillStyle/strokeStyle boundary validation policy (Issue 3) — Option A or B | Architect | NO (informational) |
