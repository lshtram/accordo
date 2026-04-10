# accordo-diagram — Flowchart Fidelity Requirements

**Package:** `accordo-diagram`  
**Date:** 2026-04-09 (Batch 2 added)  
**Parent document:** `docs/20-requirements/requirements-diagram.md`  
**Execution plans:**
- Batch 1: `docs/30-development/diagram-fidelity-batch1-plan.md`
- Batch 2: `docs/30-development/diagram-fidelity-batch2-plan.md`  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)

---

## 1. Purpose

This document defines fidelity requirements for user-validated visual defects in
flowchart rendering. These are distinct from the Phase 0 structural hardening
(H0-01 through H0-05) — they address *incorrect output*, not missing contracts
or validation gaps.

Each defect was identified through side-by-side comparison of Mermaid-rendered
diagrams vs. Accordo Excalidraw output and confirmed by the user.

**Batch 1 (FC-01 through FC-05):** Parser and shape-level fixes.  
**Batch 2 (FC-06 through FC-09):** Edge routing, direction coherence, and subgraph fixes.

---

## 2. Batch 1 Requirements (FC-01 through FC-05)

### FC-01: Trapezoid orientation matches Mermaid convention

**Defect cases:** 12, 13  
**Symptom:** Mermaid syntax `[/text\]` (trapezoid) renders wider-at-bottom in
Mermaid but wider-at-top in Accordo. The `[\text/]` (inv_trapezoid) variant is
also reversed.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-01a | `[/text\]` (Mermaid vertex type `trapezoid`) renders as wider-at-bottom, narrower-at-top | Given a flowchart with `A[/Trapezoid\]`, the generated polygon's top edge is shorter than its bottom edge |
| FC-01b | `[\text/]` (Mermaid vertex type `inv_trapezoid`) renders as wider-at-top, narrower-at-bottom | Given a flowchart with `A[\Alt Trapezoid/]`, the generated polygon's top edge is longer than its bottom edge |
| FC-01c | Existing trapezoid tests updated to assert correct orientation | No regression in any existing test that references trapezoid shapes |

---

### FC-02: Circle nodes render as true circles

**Defect case:** 14  
**Symptom:** A node declared with `((text))` (circle shape) renders as an oval
because the layout engine may assign unequal width/height to the underlying
ellipse element.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-02a | Circle-shaped nodes have equal width and height | Given a flowchart with `A((Circle))`, the ExcalidrawElement produced has `width === height` |
| FC-02b | The enforced dimension uses the larger of layout w/h | `Math.max(nl.w, nl.h)` is used so the circle fully contains the text label |
| FC-02c | Other ellipse-mapped shapes are NOT affected | Nodes with shape `ellipse` (e.g. from `([text])`) continue to respect independent w/h from layout |

---

### FC-03: Edge label text preserved through rendering

**Defect cases:** 16, 17, 19, 21  
**Symptom:** Edges declared with label text (e.g. `A -->|label text| B`) appear
with no visible label in the Excalidraw output.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-03a | Non-empty edge labels from Mermaid source appear in the rendered arrow element | Given `A -->|yes| B`, the arrow ExcalidrawElement has `label` containing `"yes"` |
| FC-03b | Empty-string edge labels do NOT generate a label element | An edge with `label: ""` produces an arrow with `label: undefined` (no dangling empty text) |
| FC-03c | HTML-encoded edge labels are decoded before rendering | If Mermaid's parser returns `e.text` as `"A &amp; B"`, the rendered label is `"A & B"` |

---

### FC-04: Cross (`--x`) arrowhead renders as bar marker

**Defect case:** 29  
**Symptom:** Mermaid `--x` syntax should produce an X-shaped terminator.
Excalidraw's native arrowhead types are limited to `arrow | triangle | dot | bar`.
There is no native "cross" or "X" arrowhead. The current mapping of `arrow_cross`
to `"bar"` is the closest available approximation, but it was not being applied
correctly on the second (end) terminator.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-04a | `--x` edges map to `arrowheadEnd: "bar"` | Given `A --x B`, the ParsedEdge has `arrowheadEnd === "bar"` |
| FC-04b | `x--x` edges map to both arrowheads as `"bar"` | Given `A x--x B`, the ParsedEdge has `arrowheadStart === "bar"` and `arrowheadEnd === "bar"` |
| FC-04c | Arrowhead values flow through to ExcalidrawElement | The arrow element in the CanvasScene has matching `arrowheadStart`/`arrowheadEnd` values from the ParsedEdge |
| FC-04d | Limitation documented: Excalidraw "bar" renders as `\|` not `X` | A code comment in `flowchart.ts` documents that `bar` is the closest Excalidraw approximation to Mermaid's cross marker |

**Design note:** Excalidraw has no native X arrowhead. Using `"bar"` (perpendicular
line) is the closest available approximation. Rendering a true composite X marker
would require custom SVG path injection into the scene adapter — out of scope for
Batch 1. If Case 29's visual was actually about the arrowhead being *missing entirely*
rather than being the wrong shape, FC-04c covers that (passthrough verification).

---

### FC-05: HTML entity and emoji decoding in labels

**Defect case:** 32  
**Symptom:** Node and edge labels containing HTML entities (`&amp;`, `&lt;`,
`&#39;`, `&#x1F600;`) or Mermaid-encoded characters render the raw entity
text instead of the decoded character.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-05a | A `decodeHtmlEntities()` utility exists in the parser layer | Function exported from `packages/diagram/src/parser/decode-html.ts` |
| FC-05b | Named HTML entities decoded | `&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`, `&quot;` → `"`, `&#39;` → `'` |
| FC-05c | Decimal numeric entities decoded | `&#60;` → `<`, `&#8364;` → `€` |
| FC-05d | Hex numeric entities decoded | `&#x3C;` → `<`, `&#x1F600;` → 😀 |
| FC-05e | Unknown named entities pass through unchanged | `&foobar;` → `&foobar;` (not corrupted) |
| FC-05f | Flowchart node labels decoded | `parseFlowchart()` applies `decodeHtmlEntities()` to `v.text` / `v.label` |
| FC-05g | Flowchart edge labels decoded | `parseFlowchart()` applies `decodeHtmlEntities()` to `e.text` |
| FC-05h | Class diagram's `decodeGenerics()` unchanged | The existing tilde-to-angle-bracket conversion in `class-diagram.ts` is NOT affected |

---

## 3. Batch 2 Requirements (FC-06 through FC-09)

### FC-06: Curved edge routing produces visible curves

**Defect cases:** 28, 48, 49  
**Symptom:** Mermaid renders edges as visibly curved splines (Bézier/catmull-rom).
Accordo renders all edges as straight 2-point lines because `"curved"` routing
is aliased to `"auto"` in the edge router, and `"auto"` produces only start/end
points with bindings.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-06a | `routeCurved()` exists in `edge-router.ts` and produces ≥ 3 points | Given a curved routing request, `routeCurved()` returns a `RouteResult` with `points.length >= 3` |
| FC-06b | The curved path includes at least one control point offset from the straight-line midpoint | The control point's perpendicular distance from the source→target line is > 0 |
| FC-06c | Curved routing returns non-null start and end bindings | `routeCurved()` returns `startBinding !== null && endBinding !== null` so Excalidraw maintains arrow↔shape connections |
| FC-06d | Flowchart edges default to curved routing (unless obstacle-upgraded to orthogonal) | Given a flowchart without explicit routing overrides, `canvas-generator.ts` passes `"curved"` (not `"auto"`) to `routeEdge()` |
| FC-06e | `"curved"` is no longer aliased to `"auto"` in the mode switch | `routeEdge("curved", ...)` calls `routeCurved()`, not `routeAuto()` |

---

### FC-07: Direction-aware edge attachment points

**Defect case:** 33  
**Symptom:** In RL (right-to-left) and BT (bottom-to-top) diagrams, edges exit
and enter nodes on geometrically arbitrary sides rather than following the declared
flow direction. Arrows may appear to point backwards or cross nodes unexpectedly.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-07a | `routeEdge()` accepts an optional `direction` parameter | The function signature includes `direction?: "TD" \| "LR" \| "RL" \| "BT"` |
| FC-07b | TD direction biases source exit to bottom face, target entry to top face | Given `direction: "TD"` and source above target, the start point is on the bottom half of source bbox and end point is on the top half of target bbox |
| FC-07c | LR direction biases source exit to right face, target entry to left face | Given `direction: "LR"`, start point x ≥ source centre x, end point x ≤ target centre x |
| FC-07d | RL direction biases source exit to left face, target entry to right face | Given `direction: "RL"`, start point x ≤ source centre x, end point x ≥ target centre x |
| FC-07e | BT direction biases source exit to top face, target entry to bottom face | Given `direction: "BT"`, start point y ≤ source centre y, end point y ≥ target centre y |
| FC-07f | Back-edges (opposing flow direction) fall back to centre-to-centre | Given `direction: "TD"` but target is above source, attachment reverts to standard `clampToBorder()` behaviour |
| FC-07g | `canvas-generator.ts` passes `parsed.direction` to `routeEdge()` | The `routeEdge()` call in the edge loop includes the diagram's parsed direction |
| FC-07h | Omitting `direction` produces identical output to current behaviour | `routeEdge("auto", [], src, tgt)` (no direction) returns the same result as before this change |

---

### FC-08: Subgraph-targeted edges rendered (not dropped)

**Defect cases:** 35, 36  
**Symptom:** Edges declared with a subgraph ID as source or target (e.g.
`A --> subgraph_B`) are silently dropped. They do not appear in the rendered
output because `auto-layout.ts` skips edges referencing cluster IDs and the
canvas generator finds no layout data for them.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-08a | Edges targeting cluster IDs are not skipped in layout computation | `auto-layout.ts` emits an `EdgeLayout` entry for edges where `from` or `to` is a cluster ID |
| FC-08b | A cluster-targeted edge endpoint resolves to the cluster bounding box | When `edge.to` is a cluster ID, the canvas generator uses the cluster's bounding box (centre point) as the target position |
| FC-08c | A cluster-sourced edge endpoint resolves to the cluster bounding box | When `edge.from` is a cluster ID, the canvas generator uses the cluster's bounding box (centre point) as the source position |
| FC-08d | Existing node-to-node edges are unaffected | Edges where both `from` and `to` are regular node IDs produce identical output to current behaviour |
| FC-08e | Nested subgraph edges resolve to the exact referenced cluster (not parent) | Given an edge whose `from`/`to` references a nested subgraph ID, the endpoint bbox used for routing is that nested cluster’s own bbox; parent cluster bbox is not used |

---

### FC-09: Edge attachment points account for curve tangent

**Defect cases:** 48, 49  
**Symptom:** Even when node positions are correct, edge start/end points attach
at visually wrong positions on node boundaries. For curved edges, the attachment
point is computed toward the target centre (straight-line direction) rather than
toward the curve's first control point, producing a visual "kink" at the
start/end of curved arrows.

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FC-09a | Curved edge start point is clamped toward the first control point | `routeCurved()` computes the start attachment by ray-casting from source centre toward the first control point (not toward target centre) |
| FC-09b | Curved edge end point is clamped from the last control point | `routeCurved()` computes the end attachment by ray-casting from target centre toward the last control point (not toward source centre) |
| FC-09c | Non-curved edges are unaffected by this change | `routeAuto()`, `routeDirect()`, and `routeOrthogonal()` produce identical output to current behaviour |

**Design note:** Full shape-aware boundary clipping (e.g. diamond shape has a
rotated-square boundary, not axis-aligned box) is desirable but complex. Batch 2
addresses attachment precision through direction bias (FC-07) and curve tangent
awareness (FC-09). True shape-aware clipping is deferred to a future batch.

---

## 4. Traceability Matrix

| Requirement | Defect Case | Code Seam | Test File |
|---|---|---|---|
| FC-01a | 12 | `canvas-generator.ts` `buildCompositeElements()` | `flowchart-fidelity.test.ts` |
| FC-01b | 13 | `canvas-generator.ts` `buildCompositeElements()` | `flowchart-fidelity.test.ts` |
| FC-01c | 12, 13 | (existing tests) | existing trapezoid tests |
| FC-02a | 14 | `canvas-generator.ts` simple-shape branch | `flowchart-fidelity.test.ts` |
| FC-02b | 14 | `canvas-generator.ts` simple-shape branch | `flowchart-fidelity.test.ts` |
| FC-02c | 14 | `canvas-generator.ts` simple-shape branch | `flowchart-fidelity.test.ts` |
| FC-03a | 16, 17, 19, 21 | `flowchart.ts` edge parsing + `canvas-generator.ts` label | `flowchart-fidelity.test.ts` |
| FC-03b | — | `canvas-generator.ts` label truthiness | `flowchart-fidelity.test.ts` |
| FC-03c | 16, 17, 19, 21 | `decode-html.ts` + `flowchart.ts` | `flowchart-fidelity.test.ts` |
| FC-04a | 29 | `flowchart.ts` `MERMAID_EDGE_ARROWHEADS` | `flowchart-fidelity.test.ts` |
| FC-04b | 29 | `flowchart.ts` `MERMAID_EDGE_ARROWHEADS` | `flowchart-fidelity.test.ts` |
| FC-04c | 29 | `canvas-generator.ts` → `scene-adapter.ts` | `flowchart-fidelity.test.ts` |
| FC-04d | 29 | `flowchart.ts` (comment) | — (documentation only) |
| FC-05a | 32 | `decode-html.ts` (new file) | `decode-html.test.ts` |
| FC-05b–d | 32 | `decode-html.ts` | `decode-html.test.ts` |
| FC-05e | 32 | `decode-html.ts` | `decode-html.test.ts` |
| FC-05f | 32 | `flowchart.ts` node label path | `flowchart-fidelity.test.ts` |
| FC-05g | 32 | `flowchart.ts` edge label path | `flowchart-fidelity.test.ts` |
| FC-05h | 32 | `class-diagram.ts` (no change) | existing class-diagram tests |
| FC-06a | 28, 48, 49 | `edge-router.ts` `routeCurved()` | `flowchart-fidelity-batch2.test.ts` |
| FC-06b | 28, 48, 49 | `edge-router.ts` `routeCurved()` | `flowchart-fidelity-batch2.test.ts` |
| FC-06c | 28, 48, 49 | `edge-router.ts` `routeCurved()` | `flowchart-fidelity-batch2.test.ts` |
| FC-06d | 28, 48, 49 | `canvas-generator.ts` edge section | `flowchart-fidelity-batch2.test.ts` |
| FC-06e | 28, 48, 49 | `edge-router.ts` mode switch | `flowchart-fidelity-batch2.test.ts` |
| FC-07a | 33 | `edge-router.ts` `routeEdge()` signature | `flowchart-fidelity-batch2.test.ts` |
| FC-07b | 33 | `edge-router.ts` direction bias | `flowchart-fidelity-batch2.test.ts` |
| FC-07c | 33 | `edge-router.ts` direction bias | `flowchart-fidelity-batch2.test.ts` |
| FC-07d | 33 | `edge-router.ts` direction bias | `flowchart-fidelity-batch2.test.ts` |
| FC-07e | 33 | `edge-router.ts` direction bias | `flowchart-fidelity-batch2.test.ts` |
| FC-07f | 33 | `edge-router.ts` fallback logic | `flowchart-fidelity-batch2.test.ts` |
| FC-07g | 33 | `canvas-generator.ts` edge section | `flowchart-fidelity-batch2.test.ts` |
| FC-07h | 33 | `edge-router.ts` (no-direction path) | `flowchart-fidelity-batch2.test.ts` |
| FC-08a | 35, 36 | `auto-layout.ts` edge collection | `flowchart-fidelity-batch2.test.ts` |
| FC-08b | 35, 36 | `canvas-generator.ts` cluster fallback | `flowchart-fidelity-batch2.test.ts` |
| FC-08c | 35, 36 | `canvas-generator.ts` cluster fallback | `flowchart-fidelity-batch2.test.ts` |
| FC-08d | 35, 36 | `auto-layout.ts` (no-change path) | existing edge tests |
| FC-08e | 35, 36 | `auto-layout.ts` nested cluster resolution | `flowchart-fidelity-batch2.test.ts` |
| FC-09a | 48, 49 | `edge-router.ts` `routeCurved()` | `flowchart-fidelity-batch2.test.ts` |
| FC-09b | 48, 49 | `edge-router.ts` `routeCurved()` | `flowchart-fidelity-batch2.test.ts` |
| FC-09c | 48, 49 | `edge-router.ts` (non-curved paths) | existing edge tests |

---

## 5. Non-Requirements (Explicitly Out of Scope)

| Item | Reason |
|------|--------|
| True X-shaped arrowhead rendering | Requires custom SVG composite; Excalidraw `"bar"` is the closest native type |
| State diagram / class diagram fidelity | Different defect batches; Batches 1–2 are flowchart-only |
| New shape types (e.g. Mermaid 11.x additions) | Feature work, not fidelity correction |
| Edge label positioning/offset tuning | Separate concern from label text presence (FC-03 covers text existence) |
| Phase 0 hardening items (H0-01 through H0-05) | Tracked in `requirements-diagram-hardening.md` |
| Shape-aware boundary clipping (diamond, hexagon, etc.) | Complex geometry; deferred to future batch (FC-09 design note) |
| Excalidraw custom SVG arrowheads | Out of scope for native Excalidraw element model |
