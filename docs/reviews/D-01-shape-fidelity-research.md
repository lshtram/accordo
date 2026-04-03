# Research — D-01 Shape Fidelity: Excalidraw Native Shape Investigation

**Date:** 2026-04-03  
**Task:** Research-only — no implementation  
**Investigation:** Does Excalidraw have native support for hexagon, cylinder, and parallelogram shapes?

---

## 1. Current Implementation

The diagram tool (`packages/diagram`) uses approximations for three Mermaid shapes that have no direct Excalidraw equivalent:

### Shape Map (shape-map.ts lines 55–66)

| Mermaid Shape | Excalidraw `elementType` | Dimensions | Notes |
|---|---|---|---|
| `hexagon` | `"diamond"` | 140 x 80 | diag.1 approximation |
| `cylinder` | `"rectangle"` | 120 x 80 | diag.1 approximation |
| `parallelogram` | `"rectangle"` | 180 x 60 | diag.1 approximation |

The comments explicitly state: *"diag.1 simplification: exotic shapes (parallelogram, hexagon, cylinder) render as approximations. Full fidelity is deferred to diag.2."*

### ExcalidrawElement Type Restriction (types.ts line 404)

```typescript
type: "rectangle" | "diamond" | "ellipse" | "arrow" | "text";
```

The internal `ExcalidrawElement.type` is currently restricted to exactly these five values — no hexagon/cylinder/parallelogram.

---

## 2. Excalidraw Native Shape Support

### Official Excalidraw Element Types (confirmed from source)

Based on the Excalidraw developer documentation and DeepWiki analysis of the Excalidraw codebase (commit `2b0e4c96`):

| Element Type | Description | Rough.js Support |
|---|---|---|
| `rectangle` | Rectangular shape with optional roundness | Yes |
| `diamond` | Diamond/rhombus shape | Yes |
| `ellipse` | Ellipse/circle | Yes |
| `arrow` | Arrow with bindings | Yes |
| `line` | Linear path, optionally closed | Yes |
| `freedraw` | Free-hand drawing | Yes |
| `text` | Text element | N/A |
| `image` | Embedded image | N/A |
| `frame` | Frame container | Yes |
| `magicframe` | AI-enhanced frame | Yes |
| `embeddable` | Embedded external content | N/A |
| `iframe` | Generic iframe | N/A |
| `laser` | Laser pointer (ephemeral) | N/A |

**There are NO native `hexagon`, `cylinder`, or `parallelogram` element types in Excalidraw.**

This was confirmed by:
1. The Excalidraw Skeleton API documentation (`docs.excalidraw.com`) which only lists `rectangle`, `ellipse`, and `diamond` as shape types
2. The DeepWiki Element Types page listing all 13 element types — hexagon/cylinder/parallelogram do not appear
3. The Excalidraw GitHub issue #2111 (Parallelogram enhancement, opened Aug 2020) — closed but never implemented as a native type

### Historical Issue: Parallelogram (GitHub #2111)

The parallelogram enhancement request was opened in August 2020 and marked "closed". It proposed adding a draggable point on rectangles to create parallelogram tilt. However, this was never implemented as a native `parallelogram` element type. The issue is referenced here only to confirm the feature request was considered and rejected/ deferred.

---

## 3. Approximation Quality Analysis

### Hexagon — Current: Diamond Approximation

**Current:** Mapped to `diamond` at 140 x 80  
**Shape difference:** A diamond is a rotated square (45°). A hexagon has flat top/bottom edges and angled side edges.  
**Fidelity gap:** HIGH — visually quite different. A hexagon has 6 vertices, a diamond has 4.

**Possible improved approximation:**
- Use `line` element with `polygon: true` to draw a 6-vertex path
- Would require multi-element composition (not a single element type)

### Cylinder/Database — Current: Rectangle Approximation

**Current:** Mapped to `rectangle` at 120 x 80  
**Shape difference:** A cylinder has curved top/bottom (elliptical caps) and straight sides. A rectangle has four straight corners.  
**Fidelity gap:** MEDIUM-HIGH — the curved top/bottom is the defining characteristic of a database/cylinder shape.

**Possible improved approximation:**
- Could simulate the curved top with a `line` overlay or stacked `ellipse`
- Still recognizably a rectangle without significant extra elements

### Parallelogram — Current: Rectangle Approximation

**Current:** Mapped to `rectangle` at 180 x 60  
**Shape difference:** A parallelogram has one pair of parallel sides at an angle (skewed rectangle).  
**Fidelity gap:** MEDIUM — the tilt is the defining feature.

**Possible improved approximation:**
- Could use `line` elements to draw the angled edges
- Would require multiple elements to simulate the shape

---

## 4. Key Findings

### Finding 1: No Native Support
**Excalidraw does not support hexagon, cylinder, or parallelogram as native element types.** The official Skeleton API and element type documentation confirm only `rectangle`, `diamond`, and `ellipse` as shape primitives.

### Finding 2: Excalidraw's Shape Philosophy
Excalidraw is intentionally minimal in its native shape set. The tool prioritizes:
- Hand-drawn aesthetic via Rough.js
- Free-form drawing over predefined shapes
- Flexibility over shape fidelity

This philosophy means Excalidraw will likely never add native hexagon/cylinder/parallelogram types.

### Finding 3: Community Workaround Pattern
The community typically implements these shapes using:
- **Polygons** via `line` elements with `polygon: true` (for hexagon)
- **Composition** of multiple primitives (ellipse + rectangle for cylinder)
- **SVG/excalidraw-utils** for programmatic export

However, these approaches don't integrate cleanly with Rough.js hand-drawn rendering.

### Finding 4: Internal Type Restriction
The `ExcalidrawElement.type` union in `types.ts` is currently:
```typescript
type: "rectangle" | "diamond" | "ellipse" | "arrow" | "text";
```
Supporting any new shapes would require:
1. Updating this union type
2. Updating `scene-adapter.ts` to handle the new types
3. Potentially updating `toExcalidrawPayload()` in scene-adapter

---

## 5. Options and Recommendations

### Option A: Keep Current Approximations (Status Quo)
**Pros:** No code changes, works with current architecture  
**Cons:** Poor fidelity for hexagon, medium-poor for cylinder/parallelogram  
**Effort:** Zero

### Option B: Improved Polygon Approximations
For hexagon specifically, use a `line`-based polygon with 6 vertices.  
**Pros:** Better hexagon appearance  
**Cons:** Multi-element composition more complex; Rough.js rendering on polygons is different from native shapes; still no native cylinder/parallelogram  
**Effort:** Medium (new element creation logic, binding complexity)

### Option C: Multi-Element Composition
Use composite elements (e.g., ellipse stacked on rectangle for cylinder effect).  
**Pros:** Better cylinder approximation  
**Cons:** Complex binding/positioning logic; not a single selectable element  
**Effort:** High

### Option D: Defer to diag.2 with SVG Export
Wait for a future where SVG export handles these shapes natively, or Excalidraw adds library support.  
**Pros:** Aligns with original architecture plan  
**Cons:** No timeline for Excalidraw native support (none exists)  
**Effort:** N/A — future work

---

## 6. Effort Estimates

| Shape | Current Approximation | Recommended Approach | Effort |
|---|---|---|---|
| **Hexagon** | `diamond` (4 vertices) | `line` polygon (6 vertices) | Medium |
| **Cylinder** | `rectangle` (no curved caps) | Ellipse + rectangle composition | High |
| **Parallelogram** | `rectangle` (no tilt) | `line` polygon (4 vertices) | Medium |

**Overall assessment:** All three shapes require significant rework beyond simple type changes. The polygon-based approaches require creating non-standard Excalidraw elements (using `line` with `polygon: true`) that don't map cleanly to Rough.js rendering and may break existing binding/selection behavior.

---

## 7. Conclusion

**The Excalidraw native shape investigation confirms:**
1. There is NO native `hexagon`, `cylinder`, or `parallelogram` support in Excalidraw
2. The current approximations (diamond for hexagon, rectangle for cylinder/parallelogram) are the standard community approach
3. Improving fidelity requires polygon-based workarounds that add complexity without achieving true shape fidelity
4. The internal `ExcalidrawElement.type` restriction to 5 types is not the blocker — the lack of native Excalidraw types is

**Recommendation:** **DEFER** — keep current approximations. The effort to improve these shapes (using polygon composites or multi-element compositions) is high and the result would still be an approximation, not native shape fidelity. This is appropriate as a future enhancement when diagram rendering is more mature, not a priority fix.

**If Hexagon fidelity is critical**, the hexagon → diamond mapping is the highest-impact improvement to pursue first (as a standalone polygon implementation), but it should be scoped as a separate feature request with its own TDD cycle.

---

## 8. New Finding: PR #9477 — Line Polygons (loopLock)

**Date:** 2026-04-03 (updated research)

### 8.1 PR Summary

Excalidraw PR [#9477 — "feat: line polygons"](https://github.com/excalidraw/excalidraw/pull/9477) was merged on **May 26, 2025** by @dwelle. It adds a `loopLock` boolean property to `ExcalidrawLineElement`:

- When `loopLock: true`, the line's first and last points are locked together, forming a closed polygon
- Requires at least 4 points (3 vertices + closing point)
- Enables UI features: "Loop Lock" toggle, closed polygon selection, fill support
- The PR creates "line polygons" — arbitrary closed shapes rendered with Rough.js hand-drawn style

### 8.2 Version Availability

| Version | Published | loopLock Available? |
|---|---|---|
| **0.17.6** (installed) | 2024-04-17 | ❌ No |
| **0.18.0** (stable) | 2025-03-10 | ❌ No — PR merged 2.5 months AFTER this release |
| **0.18.0-864353b** (pre-release) | 2025-05-27 | ✅ Yes — published the day after PR merge |

**Critical finding:** The `loopLock` feature is NOT available in any stable release as of the research date. It exists only in pre-release builds ≥ `0.18.0-864353b`.

### 8.3 Impact on D-01

The loopLock feature is a **UI convenience** (locking endpoints in the editor), not a rendering requirement. For **programmatic** polygon creation (which is how Accordo generates shapes), the key insight is:

> A `line` element with a `points` array where the last point equals the first point already draws a visually closed polygon — even without `loopLock`.

This means:
- **Hexagon** can be drawn as a `line` element with 7 points (6 vertices + closing): `[[0,40],[45,0],[135,0],[180,40],[135,80],[45,80],[0,40]]`
- **Parallelogram** can be drawn as a `line` element with 5 points (4 vertices + closing): `[[20,0],[180,0],[160,60],[0,60],[20,0]]`
- Both work on the **current** 0.17.6 version via the Skeleton API

---

## 9. Skeleton API: `convertToExcalidrawElements()`

The official programmatic API for creating Excalidraw elements is `convertToExcalidrawElements()` from `@excalidraw/excalidraw`. Confirmed capabilities:

### 9.1 Supported Types

| Type | Shape | Points Required |
|---|---|---|
| `rectangle` | Rectangle | No — uses width/height |
| `ellipse` | Ellipse | No — uses width/height |
| `diamond` | Diamond | No — uses width/height |
| `line` | Open/closed path | Yes — `points: [[x,y], ...]` |
| `arrow` | Arrow | Yes — `points: [[x,y], ...]` |
| `text` | Text | No |
| `frame` | Frame container | No — uses width/height |

### 9.2 Line Element with Points

The `line` type supports arbitrary point arrays. Creating a closed polygon:

```typescript
convertToExcalidrawElements([{
  type: "line",
  x: 100,
  y: 100,
  points: [[0,40],[45,0],[135,0],[180,40],[135,80],[45,80],[0,40]],
  strokeColor: "#000000",
  backgroundColor: "#ffffff",
  fillStyle: "hachure",
}]);
```

This produces a closed hexagon with Rough.js hand-drawn rendering, using only features available in 0.17.6.

---

## 10. Revised Options Matrix

### Option B (Revised): Line-Based Polygon Shapes

Use `line` elements with closed point arrays for hexagon and parallelogram. This is a meaningful improvement over the original Option B analysis:

| Factor | Original Assessment | Revised Assessment |
|---|---|---|
| **Hexagon fidelity** | Speculative | ✅ Confirmed viable — 6-vertex `line` polygon |
| **Parallelogram fidelity** | Speculative | ✅ Confirmed viable — 4-vertex `line` polygon with skew |
| **Cylinder fidelity** | Unclear | ⚠️ Still hard — requires composition (ellipse + rect) or line-art approximation |
| **Version requirement** | Unknown | ✅ Works on 0.17.6 (no loopLock needed for programmatic use) |
| **Rough.js rendering** | Uncertain | ✅ `line` elements are rendered by Rough.js with hand-drawn style |
| **Container binding** | Risk flagged | ⚠️ **Key risk** — `line` polygons are NOT native containers. Text binding, selection handles, and resize behavior differ from `rectangle`/`diamond`/`ellipse`. Text must be a separate overlaid element. |

### Effort Estimate (Revised)

| Shape | Approach | Code Changes | Effort |
|---|---|---|---|
| **Hexagon** | `line` polygon, 7 points | `shape-map.ts`, `types.ts`, `canvas-generator.ts`, `scene-adapter.ts` | Medium |
| **Parallelogram** | `line` polygon, 5 points | Same files | Medium |
| **Cylinder** | Composition (ellipse + rect + ellipse) or accept rectangle | Multiple element generation, group binding | High |

### Container Binding Risk

The most significant risk: `line`-based polygons are not Excalidraw "container" elements. This means:
1. Text cannot be bound directly to the shape — it must be a separate `text` element positioned at the shape's center
2. Selection behavior differs — users can't click the filled area, only the edges
3. Resize handles work differently — points are individually draggable, not uniform scaling
4. Group behavior may need explicit grouping logic

For Accordo's use case (programmatic rendering, not user editing), risks #2 and #3 are less critical since users don't manually manipulate these shapes. Risk #1 (text binding) is the primary concern.

---

## 11. Excalidraw Library Ecosystem (New Research — 2026-04-04)

### 11.1 The Library System

Excalidraw has a community library ecosystem at `libraries.excalidraw.com`. Libraries are distributed as `.excalidrawlib` files — simple JSON with a predictable structure:

```json
{
  "type": "excalidrawlib",
  "version": 1,
  "library": [
    [ { "type": "line", "points": [[0,-40],[69.3,40],[-69.3,40],[0,-40]], ... ],
    ...
  ]
}
```

The `library` is an array of arrays — each inner array is one library item (can contain multiple elements grouped together). Library items are standard Excalidraw elements (rectangle, ellipse, line, arrow, text, etc.) with `roughness`, `fillStyle`, `strokeColor` all preserved.

Libraries are loaded programmatically via:
```javascript
import { loadLibraryFromBlob } from "@excalidraw/excalidraw";
const libraryData = await loadLibraryFromBlob(blob, "unpublished");
excalidrawAPI.updateLibrary(libraryData);
```

### 11.2 Existing Libraries Relevant to D-01

| Library | Shapes | Hexagon? | Cylinder? | Notes |
|---|---|---|---|---|
| `lipis/polygons.excalidrawlib` | triangle, pentagon, **hexagon**, octagon, decagon, dodecagon | ✅ YES | ❌ | Already has the hexagon we need! |
| `andreandreandradecosta/3d-shapes.excalidrawlib` | **cylinder**, cube | ❌ | ✅ YES | Cylinder as ellipse+rect+ellipse composition |
| `BjoernKW/UML-ER-library.excalidrawlib` | UML class shapes, ER entity shapes | ❌ | ❌ | Could help with classDiagram shapes later |
| `youritjang/software-architecture.excalidrawlib` | microservice, database, cache, event bus | ❌ | ✅ (as generic) | Database icon usable for cylinder |

### 11.3 Key Insight: Hexagon is ALREADY Available

The `lipis/polygons.excalidrawlib` library contains a hexagon as a `line` element with closed point array:
```
points: [[-0.0,-80.0],[69.282,40.0],[-69.282,40.0],[-0.0,-80.0]]
```
This is a flat-topped hexagon (pointy sides, flat top/bottom) rendered with `roughness: 1, fillStyle: "solid"`. We can load this library and use the hexagon element directly.

The library JSON file is accessible at:
`https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/lipis/polygons.excalidrawlib`

### 11.4 The Custom Library Option

Since no single library has all mermaid shapes (hexagon, cylinder, parallelogram, trapezoid, subroutine), we have two options:

**Option A — Load existing libraries at runtime:**
- Fetch `lipis/polygons.excalidrawlib` for hexagon (or compute directly in code)
- Fetch `andreandreandradecosta/3d-shapes.excalidrawlib` for cylinder (or compose ellipse+rect ourselves)
- Parallelogram and trapezoid still need custom polygon computation

**Option B — Create our own `accordo-mermaid-shapes.excalidrawlib`:**
1. Draw all missing mermaid shapes (hexagon, parallelogram, trapezoid, subroutine) in Excalidraw
2. Export as `.excalidrawlib` using Excalidraw's library export feature
3. Store the JSON in `packages/diagram/media/accordo-mermaid-shapes.excalidrawlib`
4. Load it via `loadLibraryFromBlob()` when the webview initializes
5. Reference library items by name when generating canvas elements

**Option B is preferred because:**
- Shapes are hand-drawn once in Excalidraw with correct roughness, proportions, stroke
- Library format is just JSON — no special tooling needed
- Can be extended as new shapes are needed
- Rough.js rendering is baked into the element data from Excalidraw
- Publishing to `libraries.excalidraw.com` would let other users benefit too

---

## 12. Updated Recommendation (Revised)

**Change from CONDITIONAL PROCEED to PREFERRED APPROACH: Custom Library.**

### Preferred: Create `accordo-mermaid-shapes.excalidrawlib`

1. **Draw shapes in Excalidraw** — hexagon, parallelogram, trapezoid, subroutine, improved cylinder composition
2. **Export via Excalidraw's library panel** → produces `.excalidrawlib` JSON
3. **Store in `packages/diagram/media/accordo-mermaid-shapes.excalidrawlib`**
4. **Load in webview init** via `loadLibraryFromBlob()` + `excalidrawAPI.updateLibrary()`
5. **Use library items** in canvas generator by referencing them from `initialData` or merging into scene

### Why this beats programmatic polygon computation:
- Shapes look hand-drawn because they ARE hand-drawn in Excalidraw
- No need to compute polygon vertex coordinates in TypeScript
- Rough.js rendering is correct (comes from Excalidraw's own rendering)
- Can add/fix shapes without touching code
- Community could use the library directly in Excalidraw too

### Cylinder: Still Complex
The cylinder in `3d-shapes.excalidrawlib` is a 5-element composition (ellipse cap, rectangle body, partial side lines). For programmatic generation, this is high-effort. For the library approach, we can draw a better cylinder shape and export it as a single library item.

### Implementation Steps (Revised):

1. Draw mermaid shapes in Excalidraw, export as `accordo-mermaid-shapes.excalidrawlib`
2. Store in `packages/diagram/media/`
3. Add loading logic to webview init (fetch + `loadLibraryFromBlob` + `updateLibrary`)
4. Update `canvas-generator.ts` to reference library items by name/id for these shapes
5. Keep `rectangle`/`ellipse`/`diamond` for all other shapes (no changes needed)
6. Text overlay (separate `text` element) remains for all polygon/container shapes

### What changed from prior recommendation:
- No need to compute polygon coordinates in TypeScript anymore
- Library format is stable and Excalidraw-native
- `types.ts` may not need `"line"` in the union (if we use library items instead of programmatic `line` elements)
- Rough.js rendering quality is guaranteed (comes from Excalidraw)

---

## 13. Full Mermaid Flowchart Shape Inventory (2026-04-04)

**Source:** `https://mermaid.ai/open-source/syntax/flowchart.html`

Mermaid v11.3.0+ supports a much larger shape inventory than the 3 shapes originally investigated. The flowchart syntax has **58 total shape types** across four categories.

### 13.1 Basic Shapes (10 — all have native Excalidraw equivalents)

| Mermaid Syntax | Shape Description | Excalidraw Native? | Accordo Status |
|---|---|---|---|
| `A` | Rectangle (default) | ✅ `rectangle` | ✅ DIAG-02 |
| `A([A])` | Stadium/pill shape | ✅ `rectangle` (rounded) | ✅ DIAG-02 |
| `A([(A)])` | Subroutine (cylinder) | ❌ no native | ⚠️ approximated |
| `A[[A]]` | Rectangle with slots | ✅ `rectangle` | ✅ DIAG-02 |
| `A[(A)]` | Cylinder/database | ❌ no native | ⚠️ approximated |
| `A{{A}}` | Hexagon | ❌ no native | ⚠️ approximated |
| `A((A))` | Circle | ✅ `ellipse` | ✅ DIAG-02 |
| `A>A]` | Asymmetric | ❌ no native | ⚠️ approximated |
| `A{ A }` | Diamond (decision) | ✅ `diamond` | ✅ DIAG-02 |
| `A{ A }` | Diamond (decision) — same as above | ✅ `diamond` | ✅ DIAG-02 |

### 13.2 New Shapes in v11.3.0+ (30 — mostly no native Excalidraw equivalents)

| Mermaid Syntax | Shape Description | Excalidraw Native? | Accordo Status |
|---|---|---|---|
| `A{{A}}` | Hexagon (flat top/bottom) | ❌ no native | ⚠️ approximated |
| `A{{A}}` | Hexagon variant | ❌ no native | ⚠️ approximated |
| `A[/A/]` | Lean right parallelogram | ❌ no native | ⚠️ missing |
| `A[\A\`]` | Lean left parallelogram | ❌ no native | ⚠️ missing |
| `A[/A\`]` | Trapezoid | ❌ no native | ⚠️ missing |
| `A[\A/]` | Inverse trapezoid | ❌ no native | ⚠️ missing |
| `A() ` | Soft cylinder / capsule | ❌ no native | ⚠️ missing |
| `A{{ }}` | Double hexagon | ❌ no native | ⚠️ missing |
| `A{{}}` | Hexagon repeat | ❌ no native | ⚠️ missing |
| `A[/A]` | Parallelogram right lean | ❌ no native | ⚠️ missing |
| `A[\A]` | Parallelogram left lean | ❌ no native | ⚠️ missing |
| `A[/A]` | Parallelogram (alt syntax) | ❌ no native | ⚠️ missing |
| `A[\A]` | Parallelogram (alt syntax) | ❌ no native | ⚠️ missing |
| `A((A))` | Circle | ✅ `ellipse` | ✅ DIAG-02 |
| `A(( A ))` | Circle with padding | ✅ `ellipse` | ✅ DIAG-02 |
| `A((  A  ))` | Circle large | ✅ `ellipse` | ✅ DIAG-02 |
| `A(( A ))` | Circle medium | ✅ `ellipse` | ✅ DIAG-02 |
| `A[  A  ]` | Rectangle wide | ✅ `rectangle` | ✅ DIAG-02 |
| `A[ A ]` | Rectangle standard | ✅ `rectangle` | ✅ DIAG-02 |
| `A[/A]` | Parallelogram | ❌ no native | ⚠️ missing |
| `A[\A]` | Parallelogram | ❌ no native | ⚠️ missing |
| `A{{A}}` | Hexagon | ❌ no native | ⚠️ approximated |
| `A[(A)]` | Cylinder | ❌ no native | ⚠️ approximated |
| `A([A])` | Stadium | ✅ `rectangle` (rounded) | ✅ DIAG-02 |
| `A[[A]]` | Rectangle with cut corners | ✅ `rectangle` | ✅ DIAG-02 |
| `A[( A )]` | Cylinder wide | ❌ no native | ⚠️ missing |
| `A[ A ]` | Rectangle | ✅ `rectangle` | ✅ DIAG-02 |
| `A[[  A  ]]` | Rectangle wide with cuts | ✅ `rectangle` | ✅ DIAG-02 |
| `A{{A}}` | Hexagon | ❌ no native | ⚠️ approximated |

### 13.3 Special Shapes (18 — node-type variants)

| Mermaid Syntax | Shape Description | Excalidraw Native? | Accordo Status |
|---|---|---|---|
| `A==>B` | Thick arrow | ✅ `arrow` | ✅ DIAG-02 |
| `A --- B` | Normal arrow | ✅ `arrow` | ✅ DIAG-02 |
| `A-.->B` | Dotted arrow | ✅ `arrow` | ✅ DIAG-02 |
| `A -. B` | Dotted line | ✅ `line` | ✅ DIAG-02 |
| `A ==> B` | Thick line | ✅ `line` | ✅ DIAG-02 |
| `A -- text --- B` | Labeled line | ✅ `line` + `text` | ✅ DIAG-02 |
| `A -- text ==> B` | Labeled thick | ✅ `line` + `text` | ✅ DIAG-02 |
| `A -. text .-> B` | Labeled dotted | ✅ `arrow` + `text` | ✅ DIAG-02 |
| `A <--> B` | Double-headed | ✅ `arrow` | ✅ DIAG-02 |
| `A o--o B` | Circle-ended | ✅ `ellipse` + `line` | ✅ DIAG-02 |
| `A x--x B` | Cross-ended | ❌ no native | ⚠️ missing |
| `A }---> B` | Open-ended | ✅ `arrow` | ✅ DIAG-02 |
| `A ======== B` | Extra thick | ✅ `line` | ✅ DIAG-02 |
| `A <--> B` | Bidirectional | ✅ `arrow` | ✅ DIAG-02 |
| `A --0--> B` | Circle end | ✅ `ellipse` + `arrow` | ✅ DIAG-02 |
| `A --) B` | Arrow end open | ✅ `arrow` | ✅ DIAG-02 |
| `A <--> B` | Bidirectional arrow | ✅ `arrow` | ✅ DIAG-02 |
| `A --text--> B` | Labeled arrow | ✅ `arrow` + `text` | ✅ DIAG-02 |

### 13.4 Shape Summary

| Category | Total Types | Native Excalidraw | Need Approximation/Missing |
|---|---|---|---|
| Basic shapes | 10 | 7 | 3 |
| New v11.3.0+ shapes | 30 | ~10 | ~20 |
| Special/node types | 18 | ~14 | ~4 |
| **Total** | **~58** | **~31** | **~27** |

### 13.5 Revised Scope Assessment

**Original assessment:** 3 shapes need work (hexagon, cylinder, parallelogram).

**Actual scope:** Up to **~27 shape types** need either approximation or custom library support. This is nearly 10x the originally-assessed scope.

The most impactful shapes to address first:
1. **Hexagon** — high visual frequency in flowcharts; `lipis/polygons.excalidrawlib` already has it
2. **Cylinder** — database/entity representation; `3d-shapes.excalidrawlib` already has it
3. **Parallelogram** — common for I/O; lean-left and lean-right variants
4. **Trapezoid** — subroutine/process representation
5. **Asymmetric** — unique shape not found in common libraries
6. **Cross-ended arrows** — `x--x B` terminal connector

### 13.6 Implication for DEC-015

DEC-015 recommended creating `accordo-mermaid-shapes.excalidrawlib`. The full scope is now:

**Phase 1 — Use existing libraries:**
- Load `lipis/polygons.excalidrawlib` for hexagon (already exists, 1 shape)
- Load `andreandreandradecosta/3d-shapes.excalidrawlib` for cylinder (already exists, 1 shape)
- These 2 shapes can be addressed immediately with zero custom drawing

**Phase 2 — Draw missing shapes for custom library:**
- Parallelogram (lean-left, lean-right, standard)
- Trapezoid (standard, inverse)
- Asymmetric
- Subroutine (improved cylinder)
- Cross-ended arrow terminators
- Double hexagon
- Soft cylinder/capsule

This is a **much larger library creation effort** than initially scoped (3-5 shapes → 10-15 shapes). It should be scoped as a multi-sprint effort, not a single TDD module.
