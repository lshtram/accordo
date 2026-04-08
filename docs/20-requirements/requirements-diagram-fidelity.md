# accordo-diagram — Flowchart Fidelity Requirements (Batch 1)

**Package:** `accordo-diagram`  
**Date:** 2026-04-08  
**Parent document:** `docs/20-requirements/requirements-diagram.md`  
**Execution plan:** `docs/30-development/diagram-fidelity-batch1-plan.md`  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)

---

## 1. Purpose

This addendum defines fidelity requirements for Batch 1 of user-validated visual
defects in flowchart rendering. These are distinct from the Phase 0 structural
hardening (H0-01 through H0-05) — they address *incorrect output*, not missing
contracts or validation gaps.

Each defect was identified through side-by-side comparison of Mermaid-rendered
diagrams vs. Accordo Excalidraw output and confirmed by the user.

---

## 2. Requirements

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

## 3. Traceability Matrix

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

---

## 4. Non-Requirements (Explicitly Out of Scope)

| Item | Reason |
|------|--------|
| True X-shaped arrowhead rendering | Requires custom SVG composite; Excalidraw `"bar"` is the closest native type |
| State diagram / class diagram fidelity | Different defect batches; Batch 1 is flowchart-only |
| New shape types (e.g. Mermaid 11.x additions) | Feature work, not fidelity correction |
| Edge label positioning/offset tuning | Separate concern from label text presence (FC-03 covers text existence) |
| Phase 0 hardening items (H0-01 through H0-05) | Tracked in `requirements-diagram-hardening.md` |
