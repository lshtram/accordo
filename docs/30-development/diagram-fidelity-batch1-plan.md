# Diagram Flowchart Fidelity — Batch 1 Design Note

**Date:** 2026-04-08  
**Module:** `diagram-flowchart-fidelity-batch1`  
**Requirements:** `docs/20-requirements/requirements-diagram-fidelity.md` (FC-01 through FC-05)  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)  
**Status:** Phase A — design + stubs

---

## 1. Summary

Five user-validated visual defects in flowchart rendering need targeted fixes in
the parser and canvas-generator layers. All fixes are localised — no new modules,
no new dependencies, no architecture changes.

| Defect Group | Root Cause | Fix Location | Risk |
|---|---|---|---|
| FC-01: Trapezoid orientation | Geometry cases swapped in `buildCompositeElements()` | `canvas-generator.ts` lines 504–520 | LOW — swap two case blocks |
| FC-02: Circle → oval | Layout w/h diverge, no enforcement for circle shape | `canvas-generator.ts` simple-shape branch | LOW — add dimension clamp |
| FC-03: Missing edge labels | Edge label text empty/dropped between parser and canvas | `flowchart.ts` + `canvas-generator.ts` | MEDIUM — need to trace exact drop point |
| FC-04: Cross arrowhead | Mapping exists (`bar`) but need to verify passthrough | `flowchart.ts` + `canvas-generator.ts` + `scene-adapter.ts` | LOW — verify existing mapping |
| FC-05: HTML entity decoding | No entity decoder in flowchart parser | New `decode-html.ts` + `flowchart.ts` | LOW — pure string transform |

---

## 2. Detailed Design Per Defect Group

### 2.1 FC-01: Trapezoid Orientation (Cases 12, 13)

**Root cause analysis:**

In `canvas-generator.ts` `buildCompositeElements()`:
- `case "trapezoid"` (lines 504–510) produces points wider at top, narrower at bottom
- `case "trapezoid_alt"` (lines 512–519) produces points wider at bottom, narrower at top

In Mermaid's convention:
- `[/text\]` → vertex type `trapezoid` → should be wider at **bottom** (base on bottom)
- `[\text/]` → vertex type `inv_trapezoid` → should be wider at **top** (base on top)

The geometry is **swapped** — `trapezoid` renders `trapezoid_alt`'s shape and vice versa.

**Fix approach:** Swap the polygon point calculations between the two cases in
`buildCompositeElements()`. The SHAPE_MAP in `flowchart.ts` is correct
(`trapezoid: "trapezoid"`, `inv_trapezoid: "trapezoid_alt"`) — the naming
matches Mermaid's internal types. The bug is purely in the geometry.

**Files changed:**
- `packages/diagram/src/canvas/canvas-generator.ts` — swap geometry in `case "trapezoid"` and `case "trapezoid_alt"`

**Test strategy:** Assert polygon point coordinates — top edge width vs bottom
edge width for both shapes.

---

### 2.2 FC-02: Circle → Oval (Case 14)

**Root cause analysis:**

`shape-map.ts` correctly maps `circle → { elementType: "ellipse", width: 80, height: 80 }`.

However, in `canvas-generator.ts` the simple-shape branch (line 829–830) uses
`width: nl.w, height: nl.h` from the layout store. If the layout engine (dagre)
or the reconciler assigned different w/h values (e.g. to accommodate text width),
the circle becomes an oval.

**Fix approach:** In the simple-shape rendering branch of `canvas-generator.ts`,
when `node.shape === "circle"`, enforce `width === height` using `Math.max(nl.w, nl.h)`.
This ensures the circle fully contains the text label while remaining a true circle.

**Guard:** Only apply this enforcement for `"circle"` shape — NOT for `"ellipse"`
which legitimately allows independent w/h.

**Files changed:**
- `packages/diagram/src/canvas/canvas-generator.ts` — add dimension enforcement before simple-shape pushElement

**Test strategy:** Assert that a circle node produces an ExcalidrawElement with
`width === height`, even when layout provides unequal dimensions.

---

### 2.3 FC-03: Missing Edge Labels (Cases 16, 17, 19, 21)

**Root cause analysis:**

The edge label pipeline:
1. `flowchart.ts` line 314: `label: e.text ?? ""`
2. `canvas-generator.ts` line 977: `label: edge.label ? normalizeLabel(edge.label) : undefined`
3. `scene-adapter.ts` lines 197–202: converts `label` to `{ text, fontSize }`

Potential drop points:
- **Point 1:** Mermaid's `e.text` may be `undefined` for labeled edges in certain
  syntax forms, falling through to `""`. Empty string is falsy, so Point 2 drops it.
- **Point 1 alt:** Mermaid may HTML-encode the label (e.g. `&amp;`), which while
  non-empty survives to rendering but displays incorrectly (covered by FC-05).
- **Point 2:** The truthiness check `edge.label ?` drops empty strings `""`.

The most likely cause: Mermaid's parser returns edge label text in `e.text` for
some syntax variants but may use a different field (e.g. `e.labelText` or
`e.properties.text`) for others. The fix must inspect the actual Mermaid edge
object structure for the failing cases.

**Fix approach:**
1. In `flowchart.ts`, broaden the label extraction to check additional Mermaid
   fields: `e.text ?? e.labelText ?? ""` (exact field name TBD during implementation
   based on Mermaid's actual API for v11.x edge objects).
2. Apply `decodeHtmlEntities()` (FC-05) to the extracted label.
3. In `canvas-generator.ts`, the truthiness check at line 977 is correct behaviour
   (empty labels should not create label elements) — no change needed there.

**Files changed:**
- `packages/diagram/src/parser/flowchart.ts` — broaden edge label extraction
- (also benefits from FC-05's `decodeHtmlEntities()`)

**Test strategy:** Parse a Mermaid flowchart with `A -->|label text| B` and assert
the ParsedEdge has `label === "label text"`. Then verify the generated canvas
arrow element has a non-undefined `label`.

**Risk:** MEDIUM — depends on Mermaid's internal edge object structure which is
undocumented. Implementation phase may need runtime inspection of the `e` object.

---

### 2.4 FC-04: Cross Arrowhead (Case 29)

**Root cause analysis:**

`flowchart.ts` line 97 maps `arrow_cross: [null, "bar"]`. This mapping IS present
and correctly typed. The Excalidraw arrowhead type `"bar"` renders as a
perpendicular line (|), which is the closest native approximation to Mermaid's
X marker.

The defect report says "second edge terminator should be X marker". Two
possibilities:
1. The `"bar"` value is present but the scene adapter drops/ignores it → fix in passthrough
2. The user expects a visual X but gets a | → expected limitation of Excalidraw

**Fix approach:**
1. Add a verification test that `arrow_cross` maps to `[null, "bar"]` in the parser.
2. Add an end-to-end test that traces the arrowhead from parser → canvas-generator
   → scene-adapter output, ensuring `"bar"` appears in the final Excalidraw element.
3. Add a code comment documenting the limitation (FC-04d).
4. If the passthrough test reveals the arrowhead IS being dropped (e.g. scene-adapter
   only passes `arrowheadEnd` when it's `"arrow"`), fix the passthrough.

**Files changed:**
- `packages/diagram/src/parser/flowchart.ts` — add documenting comment
- (Possible: `scene-adapter.ts` if arrowhead passthrough is broken)

**Test strategy:** Assert ParsedEdge arrowhead values + assert ExcalidrawElement
arrowhead values for `--x` and `x--x` syntax.

---

### 2.5 FC-05: HTML Entity / Emoji Decoding (Case 32)

**Root cause analysis:**

Mermaid's internal parser may output HTML entities in label text (e.g. `&amp;`
for `&`). The class-diagram parser has a targeted `decodeGenerics()` function
that only handles `~T~` → `<T>` conversion. The flowchart parser has NO entity
decoding.

**Fix approach:** Create a shared utility `decodeHtmlEntities()` in
`packages/diagram/src/parser/decode-html.ts` that handles:
- The 5 standard named entities: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`
- Decimal numeric entities: `&#NNN;`
- Hex numeric entities: `&#xHHHH;`
- Unknown named entities pass through unchanged

Apply this function in `flowchart.ts`:
- Node labels: `decodeHtmlEntities(v.text ?? v.label ?? "")`  (line 287)
- Edge labels: `decodeHtmlEntities(e.text ?? "")`  (line 314)

**Files changed:**
- `packages/diagram/src/parser/decode-html.ts` — **new file** (stub in Phase A)
- `packages/diagram/src/parser/flowchart.ts` — import and apply to labels

**Test strategy:** Unit tests for `decodeHtmlEntities()` covering all entity types.
Integration tests verifying decoded labels appear in ParsedDiagram output.

---

## 3. Code Seam Summary

| File | Lines | Change Type | Requirements |
|---|---|---|---|
| `packages/diagram/src/canvas/canvas-generator.ts` | 504–520, 827–830 | Modify | FC-01, FC-02 |
| `packages/diagram/src/parser/flowchart.ts` | 83–84 (no change), 287, 314 | Modify | FC-03, FC-05f, FC-05g |
| `packages/diagram/src/parser/decode-html.ts` | (new file) | Create | FC-05a–e |
| `packages/diagram/src/webview/scene-adapter.ts` | 187–203 | Verify/possibly modify | FC-04c |

**Files NOT changed:**
- `types.ts` — no type changes needed
- `shape-map.ts` — circle mapping is already correct
- `edge-router.ts` — routing is not involved in these defects
- `class-diagram.ts` — `decodeGenerics()` is unrelated (FC-05h)
- `placement.ts` — layout engine changes are out of scope
- `adapter.ts` — parser dispatch unchanged

---

## 4. Stubs

### 4.1 `decode-html.ts` (new file)

A stub file is created at `packages/diagram/src/parser/decode-html.ts` with the
correct signature and a "not implemented" throw. This allows the test-builder to
write failing tests against the interface immediately.

---

## 5. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FC-03: Edge label field name may differ across Mermaid versions | MEDIUM | Labels still missing | Implementation phase inspects actual `e` object at runtime; add defensive fallback chain |
| FC-04: Users expect visual X but Excalidraw only has `bar` | LOW | Visual mismatch accepted | Document limitation; consider composite X rendering in a future batch |
| FC-05: Mermaid may encode entities differently in v12+ | LOW | Entities not decoded | The decoder handles standard HTML entities; future Mermaid versions would need a review |
| Trapezoid swap may affect existing visual regression baselines | LOW | CI noise | Update any snapshot-based tests in the same PR |

---

## 6. Architecture Impact

**None.** All changes are within the existing `parser → canvas-generator → scene-adapter`
pipeline documented in `docs/10-architecture/diagram-architecture.md` §4–§9. No new
components, no new package boundaries, no new external dependencies. The only new file
(`decode-html.ts`) is a pure utility within the parser module.
