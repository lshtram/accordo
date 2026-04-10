# Generic Diagram Geometry Architecture

> **Status:** DRAFT v1.0  
> **Author:** Architect Agent  
> **Date:** 2026-04-05  
> **Scope:** All Mermaid diagram types — generic geometry pipeline  
> **Supersedes:** Mermaid Geometry Integration proposal (state-diagram-specific)

---

## Table of Contents

1. [Recommendation](#1-recommendation)
2. [Design Principles](#2-design-principles)
3. [Generic Architecture](#3-generic-architecture)
4. [Intermediate Geometry Model](#4-intermediate-geometry-model)
5. [Provider Model by Diagram Family](#5-provider-model-by-diagram-family)
6. [Impact on LayoutStore and Schema Evolution](#6-impact-on-layoutstore-and-schema-evolution)
7. [Rollout Plan](#7-rollout-plan)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [What Remains Reusable](#9-what-remains-reusable)

---

## 1. Recommendation

**Build a three-family geometry pipeline that shares a common `ParsedDiagram` contract but dispatches to family-specific geometry providers for layout sizing and canvas generation.**

The three families are:

| Family | Diagram Types | Geometry Semantics |
|--------|--------------|-------------------|
| **Graph** | flowchart, stateDiagram-v2, classDiagram, erDiagram, block-beta | Nodes with bounding boxes, directed/undirected edges, optional clusters. 2D free-placement canvas. |
| **Tree** | mindmap | Recursive parent→child hierarchy. Synthetic edges. Radial or top-down layout. No clusters. |
| **Sequence** | sequence | Participant lanes (horizontal axis), time-ordered messages (vertical axis). No free-placement — layout is constrained by reading order. |

**Why three families, not one universal model?**

Because forcing sequence diagrams into a `{x, y, w, h}` node-placement model produces worse results than a purpose-built lane model. Similarly, mindmaps have no explicit edges and their tree-recursive structure is fundamentally different from graph traversal. Attempting to unify all three into a single geometry representation adds complexity without adding value — each family's layout algorithm is genuinely different.

However, the pipeline surrounding these families — parsing, persistence, reconciliation, Excalidraw scene generation — can and should be generic. The family boundary is narrow: it lives only in the geometry provider and the canvas generator's shape dispatch.

**The prior Mermaid Geometry Integration proposal is superseded.** Its approach of extracting geometry from Mermaid's SVG rendering (`render()` + `getBBox()`) is abandoned because:
- jsdom's `getBBox()` returns zeros in Node.js (BLOCKER-1 from prior review)
- SVG ID → node ID mapping varies per diagram type and is undocumented (BLOCKER-2)
- The parse-only path (`diag.db`) already works reliably and provides all structural data needed

Instead, geometry sizing will be computed from text content using our own measurement utilities, and layout positioning will use our existing layout engines (dagre, d3-hierarchy, cytoscape-fcose) or new purpose-built engines for sequence diagrams.

---

## 2. Design Principles

### P1: Parse-Only, Never Render

All structural data comes from `diag.db` after Mermaid's parser runs. We never call `mermaid.render()` for geometry extraction. This eliminates the jsdom/`getBBox()` class of problems entirely.

### P2: Family-Specific Geometry, Generic Everything Else

The pipeline has a narrow "family waist" — only the geometry provider and the shape-to-element mapper need family-specific code. Parsing, persistence, reconciliation, tool dispatch, and the Excalidraw element pipeline are generic.

### P3: Stable IDs from Parse, Not from SVG

Node IDs are derived deterministically from the parse tree — never from SVG element IDs. Each parser adapter is responsible for producing stable, deterministic IDs that survive re-parse. The existing `renames` mechanism in `ParsedDiagram` handles ID migration when Mermaid's internal IDs change.

### P4: Text-Based Sizing

Node dimensions are computed from label text content using a text measurement utility (canvas `measureText` or a font metrics library). This gives us control over sizing without depending on browser rendering. The measurement produces a `SizeHint` that the layout engine uses as minimum bounds.

### P5: Layout Engine as Strategy

Each diagram family selects a layout engine via a strategy pattern. The engine receives the parsed structure + size hints and produces positioned geometry. Adding a new layout engine (or a new diagram family) means implementing one interface — no existing code changes.

### P6: Sequence Diagrams Are First-Class, Not Hacked In

Sequence diagrams get their own geometry model (`SequenceGeometry`) with participants, messages, activations, and notes — not a force-fit into the graph node model. The `DiagramType` union expands to include non-spatial types, and the LayoutStore schema gains an optional `sequence` field.

### P7: Preserve What Works

The existing `ParsedDiagram` interface, the parser adapter dispatch table, the `LayoutStore` persistence format, and the Excalidraw reconciliation pipeline all work well. The new architecture extends them — it does not replace them.

---

## 3. Generic Architecture

### 3.1 Pipeline Overview

```
Mermaid Source
    │
    ▼
┌─────────────────────┐
│  Parser Adapter      │  Generic dispatch table (existing pattern)
│  adapter.ts          │  Input: source string, type string
│                      │  Output: ParsedDiagram
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Geometry Provider   │  Family-specific (Graph | Tree | Sequence)
│  geometry/<family>/  │  Input: ParsedDiagram
│                      │  Output: GeometrySized (ParsedDiagram + SizeHints)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Layout Engine       │  Family-specific strategy
│  layout/<engine>/    │  Input: GeometrySized
│                      │  Output: LayoutStore (positioned geometry)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Layout Store        │  Generic persistence (existing, extended)
│  layout-store.ts     │  Reads/writes layout.json
│                      │  Reconciles user edits with re-layout
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Canvas Generator    │  Family-aware shape dispatch
│  canvas/             │  Input: LayoutStore
│                      │  Output: ExcalidrawElement[]
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Excalidraw Scene    │  Generic (existing)
│  webview/            │  Renders elements in editor
└─────────────────────┘
```

### 3.2 Dispatch Table Design

The existing `PARSERS` record in `adapter.ts` dispatches by `DiagramType` string. This pattern extends cleanly:

```
PARSERS:        Record<DiagramType, ParserFn>          — existing
GEOMETRY:       Record<DiagramFamily, GeometryProvider> — new
LAYOUT_ENGINES: Record<DiagramType, LayoutEngine>       — new (replaces hardcoded dagre selection)
CANVAS_SHAPES:  Record<DiagramFamily, ShapeMapper>      — new (replaces single generateCanvas)
```

The key insight: `PARSERS` and `LAYOUT_ENGINES` dispatch by **type** (because each type has unique db API and layout preferences), while `GEOMETRY` and `CANVAS_SHAPES` dispatch by **family** (because geometry semantics and Excalidraw element shapes are shared within families).

### 3.3 Family Resolution

A pure function maps `DiagramType → DiagramFamily`:

```
flowchart        → graph
stateDiagram-v2  → graph
classDiagram     → graph
erDiagram        → graph
block-beta       → graph
mindmap          → tree
sequence         → sequence
```

This function is the single source of truth for family membership. Adding a new type means adding one entry here and implementing its parser.

### 3.4 Module Structure

```
packages/diagram/src/
├── parser/
│   ├── adapter.ts              # Generic dispatch (existing, extended)
│   ├── flowchart.ts            # Type-specific parser (existing)
│   ├── state-diagram.ts        # Type-specific parser (existing)
│   ├── class-diagram.ts        # Type-specific parser (new)
│   ├── er-diagram.ts           # Type-specific parser (new)
│   ├── mindmap.ts              # Type-specific parser (new)
│   ├── block-beta.ts           # Type-specific parser (new)
│   └── sequence.ts             # Type-specific parser (new)
├── geometry/
│   ├── types.ts                # SizeHint, GeometryProvider interface
│   ├── text-measure.ts         # Text → dimensions utility
│   ├── graph-geometry.ts       # Graph family geometry provider
│   ├── tree-geometry.ts        # Tree family geometry provider
│   └── sequence-geometry.ts    # Sequence family geometry provider
├── layout/
│   ├── layout-store.ts         # Generic persistence (existing, extended)
│   ├── auto-layout.ts          # Layout engine dispatch (existing, extended)
│   ├── engines/
│   │   ├── dagre-engine.ts     # Graph layout (existing logic, extracted)
│   │   ├── d3-hierarchy-engine.ts  # Tree layout (planned)
│   │   ├── fcose-engine.ts     # Block-beta layout (planned)
│   │   └── sequence-engine.ts  # Sequence layout (new)
│   └── types.ts                # LayoutEngine interface
├── canvas/
│   ├── canvas-generator.ts     # Family-aware dispatch (existing, extended)
│   ├── graph-shapes.ts         # Graph family → Excalidraw elements
│   ├── tree-shapes.ts          # Tree family → Excalidraw elements
│   ├── sequence-shapes.ts      # Sequence family → Excalidraw elements
│   ├── edge-router.ts          # Edge → Excalidraw arrow (existing)
│   └── shape-map.ts            # Mermaid shape → Excalidraw shape (existing)
├── reconciler/                 # Unchanged — generic by design
├── tools/                      # Unchanged — generic by design
├── webview/                    # Unchanged — generic by design
└── types.ts                    # Extended type definitions
```

---

## 4. Intermediate Geometry Model

### 4.1 Core Interfaces

The geometry layer sits between parsing and layout. Its job is to attach sizing information to parsed nodes so the layout engine knows how much space each node needs.

#### SizeHint

```
SizeHint {
  minWidth:  number    // Minimum width in pixels (from text measurement)
  minHeight: number    // Minimum height in pixels (from text measurement)
  padding:   number    // Per-side padding added to text bounds
  shape:     string    // Mermaid shape identifier (affects aspect ratio)
}
```

Every node in every family gets a `SizeHint`. This is the universal geometry primitive.

#### GeometryProvider Interface

```
GeometryProvider {
  measure(parsed: ParsedDiagram): GeometrySized
}
```

Where `GeometrySized` extends `ParsedDiagram` by attaching a `SizeHint` to each node. The provider reads each node's label text, runs it through `text-measure`, applies shape-specific padding rules, and returns the enriched structure.

### 4.2 Family-Specific Geometry Extensions

#### Graph Family (no extension needed)

Graph nodes map directly to `SizeHint`. The existing `ParsedNode` structure (id, label, shape, style) plus `SizeHint` is sufficient. Clusters get their own `SizeHint` computed from their children's bounds plus cluster padding.

#### Tree Family

Tree nodes also use `SizeHint` directly. The tree structure is already captured in `ParsedDiagram.edges` (synthetic parent→child edges). No geometry extension needed — the d3-hierarchy engine works from edges + size hints.

#### Sequence Family

Sequence diagrams need a richer geometry model because their layout is fundamentally different:

```
SequenceGeometry {
  participants: SequenceParticipant[]    // Ordered left-to-right
  messages:     SequenceMessage[]        // Ordered top-to-bottom (time axis)
  activations:  SequenceActivation[]     // Stacked execution boxes
  notes:        SequenceNote[]           // Annotations attached to participants
  loops:        SequenceFragment[]       // Alt/opt/loop/par/critical fragments
}

SequenceParticipant {
  id:        string
  label:     string
  type:      "participant" | "actor"
  sizeHint:  SizeHint                   // Header box dimensions
}

SequenceMessage {
  from:      string                     // Participant ID
  to:        string                     // Participant ID (or self)
  label:     string
  type:      "solid" | "dashed" | "dotted"
  arrowType: "filled" | "open" | "cross"
  sizeHint:  SizeHint                   // Label dimensions
}

SequenceActivation {
  participant: string
  startMsg:    number                   // Message index
  endMsg:      number                   // Message index
}

SequenceNote {
  over:      string[]                   // Participant IDs
  text:      string
  position:  "left" | "right" | "over"
  sizeHint:  SizeHint
}

SequenceFragment {
  type:      "alt" | "opt" | "loop" | "par" | "critical" | "break"
  label:     string
  sections:  { condition: string; messages: number[] }[]
  sizeHint:  SizeHint
}
```

This model is NOT stored in `ParsedDiagram.nodes/edges` — it uses a separate `sequenceGeometry` field on the geometry result. The sequence parser produces a `ParsedDiagram` with an empty nodes/edges and attaches the `SequenceGeometry` as an extension.

### 4.3 Text Measurement

The `text-measure` utility computes pixel dimensions for text strings without browser rendering:

- Uses a precomputed font metrics table for the Excalidraw fonts (Excalifont, Nunito, Comic Shanns)
- Input: text string, font family, font size, max width (for wrapping)
- Output: `{ width: number, height: number }` in pixels
- Falls back to character-count heuristic (average char width × count) if font metrics are unavailable

This replaces the SVG `getBBox()` approach entirely. It won't be pixel-perfect, but it will be:
- Deterministic (same input → same output)
- Fast (no DOM, no rendering)
- Portable (works in Node.js and browser)

The layout engine adds padding and shape-specific adjustments on top of the text measurement.

---

## 5. Provider Model by Diagram Family

### 5.1 Graph Family

**Types:** flowchart, stateDiagram-v2, classDiagram, erDiagram, block-beta

**Parser → ParsedDiagram mapping:**

All graph types produce a standard `ParsedDiagram` with nodes, edges, and optional clusters. The per-type parsers handle the differences in Mermaid's `diag.db` API:

| Type | Nodes Source | Edges Source | Clusters Source | ID Strategy |
|------|-------------|-------------|----------------|-------------|
| flowchart | `db.getVertices()` (method) | `db.getEdges()` (method) | `db.getSubGraphs()` (method) | Vertex key as-is |
| stateDiagram-v2 | `db.nodes` (property) | `db.edges` (property) | Nested states | State ID with `_` prefix stripped |
| classDiagram | `db.classes` (Map) | `db.relations` (Array) | `db.namespaces` (Map) | Class name as-is |
| erDiagram | `db.entities` (Map) | `db.relationships` (Array) | None | Entity label (not synthetic Mermaid ID) |
| block-beta | `db.getBlocksFlat()` (method) | `db.getEdges()` (method) | `db.getColumns()` (method) | Block ID as-is |

**Geometry provider:** `graph-geometry.ts`
- Iterates all nodes, measures label text → `SizeHint`
- For classDiagram: measures class members (attributes + methods) to compute taller boxes
- For erDiagram: measures entity attributes list
- For block-beta: respects `columns` grid constraints as size hints
- Iterates clusters, computes aggregate `SizeHint` from children

**Layout engines:**
- flowchart, stateDiagram-v2, classDiagram, erDiagram → dagre (hierarchical directed graph)
- block-beta → cytoscape-fcose (force-directed with grid constraints)

**Canvas generator:** `graph-shapes.ts`
- Maps `ParsedNode.shape` → Excalidraw element type using existing `shape-map.ts`
- Creates rectangle/diamond/ellipse/etc. elements with positioned bounds from LayoutStore
- Creates arrow elements from edge waypoints using existing `edge-router.ts`
- Creates group elements from cluster bounds

### 5.2 Tree Family

**Types:** mindmap

**Parser → ParsedDiagram mapping:**

The mindmap parser calls `db.getMindmap()` which returns a recursive tree. The parser flattens this into `ParsedDiagram` format:
- Each tree node becomes a `ParsedNode` with a path-based ID (e.g., `root.child1.grandchild2`)
- Parent→child relationships become synthetic edges
- No clusters (mindmaps are flat hierarchies)

**Geometry provider:** `tree-geometry.ts`
- Measures each node's label text → `SizeHint`
- Applies node-type-specific padding (root gets more padding than leaves)
- Mindmap `nodeType` enum affects shape: `RECT`, `ROUNDED_RECT`, `CIRCLE`, `BANG`, `CLOUD`, `HEXAGON`

**Layout engine:** d3-hierarchy
- Uses `d3.tree()` or `d3.cluster()` for radial/top-down layout
- Size hints feed into `nodeSize()` configuration
- Direction from `db.getDirection()` if available, otherwise top-down

**Canvas generator:** `tree-shapes.ts`
- Maps mindmap node types → Excalidraw shapes
- Root node gets emphasized styling (larger, bolder)
- Edges are curved connectors (Excalidraw arrows with `roundness`)
- No clusters to render

### 5.3 Sequence Family

**Types:** sequence

**Parser → ParsedDiagram mapping:**

The sequence parser calls Mermaid's sequence-specific db methods:
- `db.getActors()` → participants (ordered Map)
- `db.getMessages()` → messages (ordered Array)
- `db.getActivations?.()` → activations if available
- `db.getNotes?.()` → notes if available
- `db.getLoops?.()` or parsed from message flow → fragments

The parser produces a `ParsedDiagram` where:
- `nodes` contains participants (for ID tracking and persistence compatibility)
- `edges` is empty (messages are NOT edges — they have ordering semantics)
- The full `SequenceGeometry` is attached as an extension field

**Geometry provider:** `sequence-geometry.ts`
- Measures participant labels → `SizeHint` for header boxes
- Measures message labels → `SizeHint` for label positioning
- Measures note text → `SizeHint` for note boxes
- Computes fragment bounds from enclosed messages
- Computes activation bar widths (fixed narrow width)

**Layout engine:** `sequence-engine.ts` (purpose-built)

This is NOT a graph layout problem. The sequence layout algorithm is:

1. **Horizontal axis (participants):** Space participants left-to-right with equal gaps. Participant order is fixed by declaration order. Participant width = max(header `SizeHint.minWidth`, widest message touching this participant).

2. **Vertical axis (time):** Messages are stacked top-to-bottom in declaration order. Each message occupies a fixed row height + its label height. Self-messages get extra height for the loop-back arrow.

3. **Activations:** Narrow rectangles centered on participant lifelines. Start/end Y from message positions.

4. **Fragments:** Rectangles enclosing their message range. Nested fragments indent inward. Alt/par sections get horizontal divider lines.

5. **Notes:** Positioned beside or over their target participants at the Y position of their associated message.

Output: A `SequenceLayout` that extends `LayoutStore` with sequence-specific positioned data.

**Canvas generator:** `sequence-shapes.ts`
- Participant headers → Excalidraw rectangles (participant) or stick figures (actor)
- Lifelines → Excalidraw vertical dashed lines
- Messages → Excalidraw horizontal arrows with labels
- Self-messages → Excalidraw curved arrows
- Activations → Excalidraw narrow filled rectangles
- Notes → Excalidraw rectangles with text
- Fragments → Excalidraw rectangles with header labels and dashed dividers

### 5.4 Adding a New Family (Future)

To add a new diagram family (e.g., Gantt, Pie, Git graph):

1. Add the type to `DiagramType` union in `types.ts`
2. Add the family mapping in `getFamilyForType()`
3. Implement a parser in `parser/<type>.ts` → produces `ParsedDiagram`
4. Implement a geometry provider in `geometry/<family>-geometry.ts` (or reuse existing)
5. Implement or select a layout engine
6. Implement a canvas shape mapper in `canvas/<family>-shapes.ts` (or reuse existing)
7. Register all four in the dispatch tables

No existing code changes required beyond step 1-2 (type union + family map).

---

## 6. Impact on LayoutStore and Schema Evolution

### 6.1 Current LayoutStore Schema (v1.0)

```
{
  "version": "1.0",
  "diagram_type": SpatialDiagramType,
  "nodes": Record<NodeId, NodeLayout>,    // { x, y, w, h }
  "edges": Record<EdgeKey, EdgeLayout>,   // { waypoints, labelPos }
  "clusters": Record<ClusterId, ClusterLayout>,
  "unplaced": NodeId[],
  "aesthetics": AestheticsState
}
```

### 6.2 Proposed Schema Evolution (v1.1)

```
{
  "version": "1.1",
  "diagram_type": DiagramType,            // CHANGED: now includes "sequence"
  "diagram_family": DiagramFamily,        // NEW: "graph" | "tree" | "sequence"
  "nodes": Record<NodeId, NodeLayout>,    // Unchanged
  "edges": Record<EdgeKey, EdgeLayout>,   // Unchanged
  "clusters": Record<ClusterId, ClusterLayout>,  // Unchanged
  "unplaced": NodeId[],                   // Unchanged
  "aesthetics": AestheticsState,          // Unchanged

  // NEW: Family-specific extensions (only one populated per diagram)
  "sequence"?: SequenceLayout             // Only for sequence diagrams
}
```

**Schema migration:** v1.0 files are fully compatible — `diagram_family` is computed from `diagram_type` on read if missing. No destructive migration needed.

### 6.3 Changes to `types.ts`

**`DiagramType` union expansion:**
```
Current:  DiagramType = SpatialDiagramType
                      = "flowchart" | "block-beta" | "classDiagram" 
                        | "stateDiagram-v2" | "erDiagram" | "mindmap"

Proposed: DiagramType = SpatialDiagramType | SequenceDiagramType
          SpatialDiagramType = (unchanged)
          SequenceDiagramType = "sequence"
```

**New `DiagramFamily` type:**
```
DiagramFamily = "graph" | "tree" | "sequence"
```

**New `SequenceLayout` type** (stored in layout.json under `"sequence"` key):
```
SequenceLayout {
  participants: Record<string, { x: number, y: number, w: number, h: number }>
  lifelines:    Record<string, { x: number, topY: number, bottomY: number }>
  messages:     { fromX: number, toX: number, y: number, label: string, type: string }[]
  activations:  { participantId: string, x: number, y: number, w: number, h: number }[]
  notes:        { x: number, y: number, w: number, h: number, text: string }[]
  fragments:    { x: number, y: number, w: number, h: number, type: string, label: string, sections: { y: number }[] }[]
  totalWidth:   number
  totalHeight:  number
}
```

### 6.4 Changes to `layout-store.ts`

- `SPATIAL_TYPES` set → rename to `ALL_TYPES` or replace with `DiagramType` union check
- `readLayout()` version validation: accept `"1.0"` and `"1.1"`, compute `diagram_family` on read if missing
- `createEmptyLayout()`: add optional `diagram_family` parameter, initialize `sequence` field for sequence types
- New mutators for sequence layout: `patchParticipant()`, `patchMessage()`, etc.
- `unplaced[]` semantics: for sequence diagrams, unplaced participants are appended to the right of the participant axis

### 6.5 `unplaced[]` Resolution (Addresses BLOCKER-4)

The `unplaced[]` array holds node IDs that exist in the parse but have no position in the layout. Currently its resolution is undefined. The generic architecture defines it:

1. **On first layout:** All nodes start in `unplaced[]`. The layout engine processes all unplaced nodes and assigns positions. After layout, `unplaced` is empty.

2. **On re-parse (diagram source changed):**
   - New nodes (in parse but not in layout) → added to `unplaced[]`
   - Removed nodes (in layout but not in parse) → removed from layout
   - Existing nodes → positions preserved (no re-layout)

3. **Incremental layout:** The layout engine receives only `unplaced[]` nodes. It positions them relative to existing placed nodes:
   - **Graph family:** Run dagre on the full graph but pin existing node positions. New nodes get positioned around their connected neighbors.
   - **Tree family:** Insert new nodes at their tree position (parent determines approximate location).
   - **Sequence family:** New participants append to the right. New messages insert at their declaration order position (pushes later messages down).

4. **Manual unplace:** User can drag a node to "limbo" (outside canvas bounds) which adds it to `unplaced[]`. Next layout pass will reposition it.

### 6.6 `w`/`h` vs `width`/`height` Naming (Addresses BLOCKER-3)

The current `NodeLayout` uses `w`/`h`. The geometry model uses `minWidth`/`minHeight` in `SizeHint`. These are intentionally different concepts:

- `SizeHint.minWidth/minHeight` — minimum dimensions computed from text content (input to layout)
- `NodeLayout.w/h` — actual positioned dimensions after layout (may be larger than minimum)

No renaming needed. The geometry provider produces `SizeHint`, the layout engine produces `NodeLayout`. The names are different because the concepts are different.

---

## 7. Rollout Plan

### Phase 0: Foundation (Do First)

**Goal:** Build the generic infrastructure without changing any existing behavior.

1. Add `DiagramFamily` type and `getFamilyForType()` function to `types.ts`
2. Add `SequenceDiagramType = "sequence"` to the type union
3. Create `geometry/types.ts` with `SizeHint` and `GeometryProvider` interfaces
4. Create `geometry/text-measure.ts` — text → dimensions utility
5. Create `layout/types.ts` with `LayoutEngine` interface
6. Update `layout-store.ts` to accept v1.1 schema (backward-compatible)
7. Create dispatch tables in adapter (geometry, layout engine, canvas shape mapper)

**Tests:** All existing tests remain green. New unit tests for text measurement and family resolution.

### Phase 1: Graph Family Extraction

**Goal:** Extract existing flowchart/state logic into the graph family provider pattern.

1. Extract existing dagre layout logic into `layout/engines/dagre-engine.ts` implementing `LayoutEngine`
2. Create `geometry/graph-geometry.ts` implementing `GeometryProvider` for graph family
3. Create `canvas/graph-shapes.ts` extracting graph-specific shape generation from `canvas-generator.ts`
4. Wire flowchart and stateDiagram-v2 through the new pipeline
5. Verify identical output (snapshot tests)

**Tests:** Existing 618 tests must remain green. Snapshot comparison for flowchart and state diagram rendering.

### Phase 2: Remaining Graph Types

**Goal:** Add classDiagram, erDiagram, block-beta parsers through the graph family pipeline.

1. Implement `parser/class-diagram.ts`
2. Implement `parser/er-diagram.ts`
3. Implement `parser/block-beta.ts`
4. Extend `graph-geometry.ts` for class member lists and ER attribute lists
5. Wire block-beta to fcose engine (or dagre initially, fcose later)

**Tests:** Per-parser unit tests. Integration tests for each type through the full pipeline.

### Phase 3: Tree Family

**Goal:** Add mindmap support through the tree family pipeline.

1. Implement `parser/mindmap.ts`
2. Implement `geometry/tree-geometry.ts`
3. Implement `layout/engines/d3-hierarchy-engine.ts`
4. Implement `canvas/tree-shapes.ts`

**Tests:** Mindmap-specific unit and integration tests.

### Phase 4: Sequence Family

**Goal:** Add sequence diagram support through the sequence family pipeline.

1. Implement `parser/sequence.ts` producing `SequenceGeometry`
2. Implement `geometry/sequence-geometry.ts`
3. Implement `layout/engines/sequence-engine.ts`
4. Implement `canvas/sequence-shapes.ts`
5. Extend `LayoutStore` with `SequenceLayout` persistence
6. Extend reconciler to handle sequence-specific edit operations

**Tests:** Full sequence diagram test suite — parsing, layout, canvas generation, persistence.

### Phase 5: Polish and Edge Cases

**Goal:** Handle cross-cutting concerns.

1. Implement `unplaced[]` resolution for all families (§6.5)
2. Add animation support for sequence diagrams (message-by-message reveal)
3. Performance optimization for large diagrams (>100 nodes)
4. Error recovery — graceful degradation when Mermaid parse fails partway

---

## 8. Risks and Mitigations

### R1: Mermaid `diag.db` API Instability

**Risk:** Mermaid's internal `diag.db` API is not public. It changes between versions without notice. Our parsers couple directly to it.

**Mitigation:**
- Pin Mermaid version (currently 11.4.1) and only upgrade deliberately
- Each parser has a test that validates the db API shape — if Mermaid upgrades break the API, tests fail immediately
- The `ParsedDiagram` interface is OUR contract — parsers translate Mermaid's API into our stable model. Changes in Mermaid are absorbed by the parser, not propagated through the pipeline

### R2: Text Measurement Accuracy

**Risk:** Our text measurement won't match Excalidraw's actual rendering exactly. Nodes may be slightly too wide or too narrow.

**Mitigation:**
- Use the same font metrics that Excalidraw uses internally (Excalifont metrics are extractable)
- Add a configurable padding multiplier (default 1.2×) to prevent text overflow
- The layout is user-editable — small sizing errors are correctable by dragging
- This is strictly better than the prior proposal's `getBBox()` approach which returned zeros in Node.js

### R3: Sequence Diagram Complexity

**Risk:** Sequence diagrams have many features (activations, fragments, notes, self-messages, parallel groups). The initial implementation may not cover all of them.

**Mitigation:**
- Phase 4 starts with the core: participants, messages, and simple notes
- Activations, fragments, and advanced features are added incrementally
- The `SequenceGeometry` model is designed to be extensible — new fields can be added without breaking existing layouts

### R4: Breaking Changes to LayoutStore Schema

**Risk:** Existing layout.json files may not load after schema changes.

**Mitigation:**
- v1.1 schema is strictly backward-compatible with v1.0
- `readLayout()` handles both versions
- `diagram_family` is computed on read if missing (no migration needed)
- New `sequence` field is optional — absent for all existing graph/tree diagrams

### R5: Performance with Large Diagrams

**Risk:** The text measurement step adds O(n) computation per node. For diagrams with 200+ nodes, this could slow down the parse-to-render pipeline.

**Mitigation:**
- Text measurement results are cached by (text, font, fontSize) tuple
- Layout engine results are persisted (layout.json) — re-layout only happens when source changes
- Incremental layout (§6.5) avoids full re-layout when only a few nodes change

### R6: Mermaid Sequence Parser Access

**Risk:** Mermaid's sequence diagram db API may differ significantly from the documented spatial diagram APIs. The exact methods (`getActors`, `getMessages`, etc.) need verification.

**Mitigation:**
- Verify the API during Phase 4 implementation by examining Mermaid 11.4.1 source
- The `SequenceGeometry` model is designed from sequence diagram semantics, not from Mermaid's API — the parser adapts whatever API Mermaid provides into our model
- If Mermaid's sequence API is insufficient, we can fall back to parsing the Mermaid source text directly (sequence syntax is simple and regular)

---

## 9. What Remains Reusable

### Fully Reusable (No Changes)

| Component | Why |
|-----------|-----|
| **Reconciler** (`reconciler/`) | Already generic — works with `ParsedDiagram` + `LayoutStore` regardless of type. The reconciler diffs node IDs, not geometry. |
| **Webview** (`webview/`) | Receives `ExcalidrawElement[]` — doesn't care what diagram produced them. |
| **Tools** (`tools/`) | MCP tool handlers dispatch by diagram path, not by type. Generic. |
| **Edge router** (`canvas/edge-router.ts`) | Works with waypoints from any layout engine. |
| **Shape map** (`canvas/shape-map.ts`) | Maps Mermaid shape strings → Excalidraw types. Used by all graph-family shapes. |
| **`ParsedDiagram` interface** | Already type-agnostic. Sequence extends it, doesn't replace it. |
| **`LayoutStore` schema** (core fields) | `nodes`, `edges`, `clusters`, `unplaced`, `aesthetics` — all unchanged. |
| **Layout file I/O** | `readLayout()`/`writeLayout()` — extended for v1.1 but v1.0 compatible. |
| **`renames` mechanism** | ID migration works for any diagram type. |
| **Aesthetic system** | Node styles, edge styles, cluster styles — generic by design. |

### Reusable with Extraction (Refactor, No New Logic)

| Component | Change Needed |
|-----------|--------------|
| **Dagre layout logic** in `auto-layout.ts` | Extract into `layout/engines/dagre-engine.ts` implementing `LayoutEngine` interface. Same logic, new wrapper. |
| **Canvas generation** in `canvas-generator.ts` | Extract graph-specific shape generation into `canvas/graph-shapes.ts`. The orchestration logic (iterate nodes → create elements) stays in `canvas-generator.ts` and dispatches by family. |
| **Flowchart parser** (`parser/flowchart.ts`) | Already works. No changes needed. |
| **State diagram parser** (`parser/state-diagram.ts`) | Already works. No changes needed. |

### New Code Required

| Component | Reason |
|-----------|--------|
| `geometry/text-measure.ts` | Text → pixel dimensions without DOM |
| `geometry/graph-geometry.ts` | Attaches `SizeHint` to graph nodes |
| `geometry/tree-geometry.ts` | Attaches `SizeHint` to tree nodes |
| `geometry/sequence-geometry.ts` | Builds `SequenceGeometry` from parse |
| `parser/class-diagram.ts` | New parser for Mermaid classDiagram |
| `parser/er-diagram.ts` | New parser for Mermaid erDiagram |
| `parser/mindmap.ts` | New parser for Mermaid mindmap |
| `parser/block-beta.ts` | New parser for Mermaid block-beta |
| `parser/sequence.ts` | New parser for Mermaid sequence |
| `layout/engines/sequence-engine.ts` | Purpose-built sequence layout algorithm |
| `layout/engines/d3-hierarchy-engine.ts` | Tree layout engine |
| `layout/engines/fcose-engine.ts` | Force-directed layout for block-beta |
| `canvas/tree-shapes.ts` | Tree family → Excalidraw elements |
| `canvas/sequence-shapes.ts` | Sequence family → Excalidraw elements |

### Discarded (From Prior Proposal)

| Component | Why Discarded |
|-----------|--------------|
| **SVG `render()` + `getBBox()` extraction** | jsdom returns zeros; undocumented SVG IDs; fragile across types |
| **`GeometryMap` type** (from prior proposal) | Replaced by `SizeHint` which is simpler and doesn't carry positioned data |
| **Browser-side geometry extraction** | Adds latency, complexity, and a browser dependency to a pipeline that should be self-contained |

---

## Appendix A: Decision Log

### ADR-GEOM-01: Parse-Only vs SVG Extraction

**Context:** The prior proposal extracted geometry from Mermaid's SVG rendering. This requires a DOM environment with working `getBBox()`.

**Decision:** Use parse-only path (`diag.db`) for structure + our own text measurement for sizing.

**Rationale:** jsdom `getBBox()` returns zeros. Even if we solved that (e.g., with a canvas-based polyfill), we'd be coupling to Mermaid's undocumented SVG structure. The parse path is stable, fast, and works everywhere.

**Consequences:** We must build and maintain a text measurement utility. Sizing won't be pixel-perfect with Mermaid's rendering, but it will be consistent with Excalidraw's rendering (which is what matters).

### ADR-GEOM-02: Three Families vs Universal Model

**Context:** Should all diagram types share a single geometry/layout model?

**Decision:** Three families (graph, tree, sequence) with a shared pipeline wrapper.

**Rationale:** Sequence diagrams have fundamentally different layout semantics (ordered lanes + time axis). Forcing them into a node-placement model produces worse layouts than a purpose-built engine. The overhead of three families is modest — most code is shared in the pipeline wrapper.

**Consequences:** New diagram types must declare their family. Types that don't fit any family require a new family (rare — most diagrams are graphs).

### ADR-GEOM-03: Extending LayoutStore vs Separate Store

**Context:** Should sequence diagrams use a separate persistence format or extend LayoutStore?

**Decision:** Extend LayoutStore with an optional `sequence` field.

**Rationale:** A separate store would require duplicating file I/O, reconciliation, and persistence logic. The LayoutStore's core fields (`nodes`, `aesthetics`) are still useful for sequence diagrams (participants are nodes with styles). The `sequence` field adds the layout-specific data that doesn't fit the node/edge model.

**Consequences:** `readLayout()` and `writeLayout()` handle the new field. Schema version bumps to 1.1 but remains backward-compatible.

### ADR-GEOM-04: Text Measurement Strategy

**Context:** How do we compute node dimensions without browser rendering?

**Decision:** Precomputed font metrics table + character-count fallback.

**Rationale:** Excalidraw uses a known set of fonts (Excalifont, Nunito, Comic Shanns). We can extract glyph metrics from these fonts and compute text bounds accurately. For edge cases (unusual characters, complex scripts), the character-count heuristic provides a reasonable fallback. This is the approach used by many diagram tools (draw.io, PlantUML).

**Consequences:** Font metric data must be bundled with the package. If Excalidraw adds new fonts, we must update the metrics table. Sizing is approximate but sufficient for layout purposes.
