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
