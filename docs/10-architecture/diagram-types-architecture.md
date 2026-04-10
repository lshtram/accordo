# Diagram Types Architecture — Per-Type Parser & Layout Reference

**Status:** DRAFT  
**Date:** 2026-04-03  
**Scope:** Mermaid `diag.db` API reference and parser design for all 6 spatial diagram types  
**Parent:** `docs/10-architecture/diagram-architecture.md` (v4.2) §6, §15  
**Audience:** Implementers writing `parseXxx()` functions and extending auto-layout

---

## 1. Overview

This document provides the **implementation-ready** reference for extending the Accordo diagram system from flowchart-only (diag.1) to all 6 spatial diagram types. It is the result of runtime introspection of the Mermaid 11.4.1 `diag.db` API and documents the actual data structures returned by each diagram type's parser.

### 1.1 Document Purpose

The main architecture doc (`diagram-architecture.md` §6.3) contains **speculative** API signatures that were written before implementation. This document **supersedes** §6.3 with verified, runtime-inspected data structures and provides the concrete mapping from each Mermaid db API to our `ParsedDiagram` interface.

### 1.2 Implementation Priority

| Priority | Diagram Type | Layout Engine | Rationale |
|---|---|---|---|
| 1 | `stateDiagram-v2` | dagre (already wired) | Closest to flowchart; validates the multi-type pattern |
| 2 | `classDiagram` | dagre (already wired) | Rich node content (members/methods); tests namespace clustering |
| 3 | `erDiagram` | dagre (already wired, LR default) | Undirected relationships; tests cardinality edge types |
| 4 | `mindmap` | d3-hierarchy (new dependency) | Tree structure; no edges; radial layout |
| 5 | `block-beta` | cytoscape-fcose (new dependency) | Grid-based; column constraints; deferred to diag.2 |

### 1.3 Shared Pattern

Every parser file follows the pattern established by `flowchart.ts`:

```
packages/diagram/src/parser/<type>.ts
```

Each exports a single function:

```typescript
export function parse<Type>(db: <Type>Db): ParsedDiagram
```

The function:
1. Reads type-specific properties/methods from the Mermaid `diag.db` object
2. Maps type-specific shapes → our `NodeShape` union
3. Maps type-specific edge/relation types → our `EdgeType` union
4. Builds cluster membership from type-specific grouping (subgraphs, namespaces, composite states)
5. Returns a `ParsedDiagram` (the rest of the pipeline — layout, reconciler, canvas — is type-agnostic)

The adapter (`adapter.ts`) dispatches to the correct parser based on `detectDiagramType()`. The gate at line 151 (`if (type !== "flowchart")`) is the single line to change.

---

## 2. stateDiagram-v2

### 2.1 Mermaid db API (Verified)

**Access pattern:** Properties, not methods.

| API | Type | Description |
|---|---|---|
| `db.nodes` | `Array<StateNode>` | Flat list of all states (including start/end pseudostates) |
| `db.edges` | `Array<StateEdge>` | Flat list of all transitions |
| `db.rootDoc` | `Array<RootDocEntry>` | Recursive tree of `{stmt, ...}` objects (not needed for parsing) |

> **Critical finding:** The architecture doc §6.3 speculated `getRootDoc()`, `getStates()`, `getRelations()` as methods. The actual API uses **direct property access**: `db.nodes` and `db.edges`. There are no getter methods for the primary data.

### 2.2 Data Structures

```typescript
interface StateNode {
  id: string;            // "idle", "active", "root_start", "root_end", "active_start"
  label: string;         // Same as id for user-defined states
  shape: string;         // "rect" | "stateStart" | "stateEnd" | "roundedWithTitle"
  cssClasses: string;    // " statediagram-state" or with " statediagram-cluster"
  isGroup: boolean;      // true for composite states
  parentId?: string;     // Present for states inside a composite state
  domId: string;         // "state-idle-2" (internal, not used)
  type?: string;         // "group" for composite states
  dir?: string;          // "TB" for composite states
  padding: number;       // 8
  rx: number;            // 10 (corner radius)
  ry: number;            // 10
  look: string;          // "classic"
  centerLabel: boolean;
  labelStyle: string;
  cssCompiledStyles: string[];
  cssStyles: string[];
}

interface StateEdge {
  id: string;            // "edge0", "edge1", ...
  start: string;         // Source state id
  end: string;           // Target state id
  label: string;         // Transition label (may be "")
  arrowhead: string;     // "normal"
  arrowTypeEnd: string;  // "arrow_barb"
  thickness: string;     // "normal"
  classes: string;       // "transition"
  style: string;         // "fill:none"
  labelStyle: string;
  labelpos: string;      // "c"
  labelType: string;     // "text"
  arrowheadStyle: string;
  look: string;          // "classic"
}
```

### 2.3 Key Behaviours

**Start/End pseudostates:** `[*]` in Mermaid source generates synthetic nodes that are **included** in the parsed diagram (not filtered out):
- Top-level: `root_start`, `root_end`
- Inside composite state `active`: `active_start`, `active_end`

These pseudostates are full `ParsedNode` entries with edges connecting them to other states. They are rendered as small 30×30 ellipses (see DEC-016).

**Composite states:** Nodes with `isGroup: true` act as clusters. Their children have `parentId` set to the composite state's `id`.

**Shape mapping:**

| Mermaid `shape` | Our `NodeShape` | Description |
|---|---|---|
| `"rect"` | `"rounded"` | Normal state (rounded rectangle per UML convention) |
| `"stateStart"` | `"stateStart"` | Initial pseudostate (small filled circle, 30×30) |
| `"stateEnd"` | `"stateEnd"` | Final pseudostate (small bullseye circle, 30×30) |
| `"roundedWithTitle"` | `"rectangle"` | Composite state container (cluster, not rendered as node) |

> **Design note (DEC-016):** Pseudostate shapes are kept as `"stateStart"`/`"stateEnd"` rather than mapping to the existing `"circle"` NodeShape. UML convention renders initial/final pseudostates as small circles (~30px), not full-size circles (80px). Separate shape map entries with smaller dimensions achieve this without introducing conditional sizing logic.

**Edge type:** All edges are `"arrow"` — state diagrams have only one transition style.

### 2.4 Parser Design: `parseStateDiagram(db)`

```typescript
// packages/diagram/src/parser/state-diagram.ts

export type StateDiagramDb = Record<string, unknown>;

export function parseStateDiagram(db: StateDiagramDb): ParsedDiagram {
  // 1. Read db.nodes (Array<StateNode>)
  // 2. Read db.edges (Array<StateEdge>)
  // 3. Separate nodes into:
  //    - Regular states (isGroup === false) → ParsedNode
  //    - Composite states (isGroup === true) → ParsedCluster
  // 4. Build cluster membership from parentId
   // 5. Map shapes: rect→rounded, stateStart→stateStart, stateEnd→stateEnd (kept as-is)
  // 6. Build edges with ordinal counter
  // 7. Return ParsedDiagram
}
```

**Cluster model:** For each node where `isGroup === true`, create a `ParsedCluster`. For each node with `parentId`, set `cluster: parentId` and add to the parent cluster's `members[]`.

**Direction:** Not directly available on db. Default to `"TD"`.

### 2.5 Shape Map Additions

Add to `shape-map.ts`:

```typescript
// State diagram shapes
stateStart:        { elementType: "ellipse", width: 30,  height: 30,  roundness: null },
stateEnd:          { elementType: "ellipse", width: 30,  height: 30,  roundness: null },
// "rect" states map to existing "rounded" entry
// "roundedWithTitle" composite states become clusters, not shape entries
```

### 2.6 Auto-Layout

Already wired — `DAGRE_TYPES` includes `"stateDiagram-v2"`. The `computeInitialLayout()` → `layoutWithDagre()` path works as-is because:
- Composite states become clusters via `ParsedCluster` → dagre compound mode
- Start/end pseudostates are just small nodes

The `SHAPE_DIMS` table in `auto-layout.ts` needs entries for pseudostate shapes:

```typescript
stateStart: { w: 30, h: 30 },
stateEnd:   { w: 30, h: 30 },
```

---

## 3. classDiagram

### 3.1 Mermaid db API (Verified)

**Access pattern:** Properties (Maps and Arrays).

| API | Type | Description |
|---|---|---|
| `db.classes` | `Map<string, ClassNode>` | All classes, keyed by class name |
| `db.relations` | `Array<ClassRelation>` | All relationships between classes |
| `db.namespaces` | `Map<string, NamespaceNode>` | Namespace groupings |
| `db.direction` | `string` | Layout direction (e.g., `"TB"`) |
| `db.notes` | `Array<...>` | Class notes (currently unused) |
| `db.relationType` | `Record<string, number>` | Enum: `AGGREGATION=0, EXTENSION=1, COMPOSITION=2, DEPENDENCY=3, LOLLIPOP=4` |
| `db.lineType` | `Record<string, number>` | Enum: `LINE=0, DOTTED_LINE=1` |

> **Critical finding:** §6.3 speculated `getClasses()`, `getRelations()`, `getNamespaces()` as methods. The actual API uses **direct Map/Array properties**: `db.classes`, `db.relations`, `db.namespaces`.

### 3.2 Data Structures

```typescript
interface ClassNode {
  id: string;              // "Animal", "Dog"
  type: string;            // "" (unused)
  label: string;           // Same as id
  text: string;            // Same as id
  shape: string;           // Always "classBox"
  cssClasses: string;      // "default"
  methods: ClassMember[];  // Method entries
  members: ClassMember[];  // Attribute entries
  annotations: string[];   // e.g., ["interface"], ["abstract"]
  styles: string[];
  domId: string;           // "classId-Animal-0"
  parent?: string;         // Namespace id if inside a namespace
}

interface ClassMember {
  memberType: "attribute" | "method";
  visibility: "+" | "-" | "#" | "~";  // public, private, protected, package
  classifier: string;      // "" or "static" / "abstract"
  text: string;            // Full text: "\\+String name" or "\\+makeSound() : void"
  id: string;              // "String name" or "makeSound"
  parameters?: string;     // Method params (methods only)
  returnType?: string;     // Method return type (methods only)
}

interface ClassRelation {
  id1: string;             // Source class name
  id2: string;             // Target class name
  relation: {
    type1: number;         // Relation type at id1 end (from relationType enum)
    type2: number | "none";// Relation type at id2 end
    lineType: number;      // 0 = LINE, 1 = DOTTED_LINE
  };
  relationTitle1: string;  // "none" or cardinality text
  relationTitle2: string;  // "none" or cardinality text
  title: string;           // Relationship label (e.g., "inherits")
}

interface NamespaceNode {
  id: string;              // "Animals"
  classes: {};             // Empty (class membership tracked via ClassNode.parent)
  children: {};            // Empty
  domId: string;           // "classId-Animals-0"
}
```

### 3.3 Key Behaviours

**Namespace as cluster:** Classes inside a namespace have `parent: "<namespace_id>"`. The namespace itself becomes a `ParsedCluster` with those classes as members.

**Relation type mapping:**

| `relation.type1` | `relation.lineType` | Mermaid syntax | Our `EdgeType` |
|---|---|---|---|
| `1` (EXTENSION) | `0` (LINE) | `<\|--` | `"inheritance"` |
| `1` (EXTENSION) | `1` (DOTTED_LINE) | `<\|..` | `"realization"` |
| `2` (COMPOSITION) | `0` (LINE) | `*--` | `"composition"` |
| `0` (AGGREGATION) | `0` (LINE) | `o--` | `"aggregation"` |
| `3` (DEPENDENCY) | `1` (DOTTED_LINE) | `..>` | `"dotted"` |
| `4` (LOLLIPOP) | `0` (LINE) | `()--` | `"arrow"` (fallback) |

**Direction:** Available as `db.direction` (string). Default: `"TB"`.

**Label richness:** Unlike other types, class nodes carry structured content (attributes + methods). For `ParsedNode.label`, concatenate: `className` + newline-separated members. The canvas generator already handles multi-line labels.

### 3.4 Parser Design: `parseClassDiagram(db)`

```typescript
// packages/diagram/src/parser/class-diagram.ts

export type ClassDiagramDb = Record<string, unknown>;

export function parseClassDiagram(db: ClassDiagramDb): ParsedDiagram {
  // 1. Read db.classes (Map<string, ClassNode>)
  // 2. Read db.relations (Array<ClassRelation>)
  // 3. Read db.namespaces (Map<string, NamespaceNode>)
  // 4. For each class:
  //    - Build label: className + "---" + attributes + "---" + methods
  //    - Shape: "classBox" → "rectangle" (all classes are rectangles)
  //    - If class.parent exists, set cluster membership
  // 5. For each namespace: create ParsedCluster
  // 6. For each relation: map (type1, lineType) to EdgeType
  // 7. Build ordinal counter
  // 8. Direction from db.direction
  // 9. Return ParsedDiagram
}
```

### 3.5 Shape Map Additions

```typescript
// Class diagram shapes
classBox: { elementType: "rectangle", width: 200, height: 120, roundness: null },
```

Note: `classBox` nodes are taller (120px) than flowchart rectangles (60px) because they carry attribute/method lists.

### 3.6 Auto-Layout

Already wired — `DAGRE_TYPES` includes `"classDiagram"`. Default rankdir: `"TB"`. Namespaces become dagre compound clusters. No changes needed to `auto-layout.ts`.

The `SHAPE_DIMS` table in `auto-layout.ts` needs a `classBox` entry:

```typescript
classBox: { w: 200, h: 120 },
```

---

## 4. erDiagram

### 4.1 Mermaid db API (Verified)

**Access pattern:** Properties (Maps and Arrays).

| API | Type | Description |
|---|---|---|
| `db.entities` | `Map<string, EntityNode>` | All entities, keyed by entity name |
| `db.relationships` | `Array<ERRelationship>` | All relationships |
| `db.Cardinality` | `Record<string, string>` | Enum: `ZERO_OR_ONE, ZERO_OR_MORE, ONE_OR_MORE, ONLY_ONE, MD_PARENT` |
| `db.Identification` | `Record<string, string>` | Enum: `NON_IDENTIFYING, IDENTIFYING` |
| `db.direction` | `string` | Layout direction (default: `"TB"`, but we override to `"LR"`) |

> **Critical finding:** §6.3 speculated `getEntities()`, `getRelationships()` as methods. The actual API uses **direct Map/Array properties**: `db.entities`, `db.relationships`.

### 4.2 Data Structures

```typescript
interface EntityNode {
  id: string;              // "entity-CUSTOMER-0" (NOT the entity name)
  label: string;           // "CUSTOMER" (the entity name)
  attributes: EntityAttribute[];
  alias: string;           // "" or alias text
  shape: string;           // Always "erBox"
  look: string;            // "classic"
  cssClasses: string;      // "default"
  cssStyles: string[];
}

interface EntityAttribute {
  type: string;            // "string", "int", "date", "float", etc.
  name: string;            // Attribute name
  keys: string[];          // ["PK"], ["FK"], or []
  comment: string;         // "" or inline comment
}

interface ERRelationship {
  entityA: string;         // Entity id (e.g., "entity-CUSTOMER-0")
  roleA: string;           // Relationship label (e.g., "places")
  entityB: string;         // Entity id
  relSpec: {
    cardA: string;         // Cardinality at A end
    relType: string;       // "IDENTIFYING" or "NON_IDENTIFYING"
    cardB: string;         // Cardinality at B end
  };
}
```

### 4.3 Key Behaviours

**Entity ID vs Name:** Mermaid generates synthetic IDs (`entity-CUSTOMER-0`). The entity name is in `label`. For `ParsedNode.id`, use the **label** (entity name) as the stable identity — it's what users write in Mermaid source and what appears in `layout.json` keys.

**Relationship references:** `entityA`/`entityB` in relationships use the synthetic `id`, not the label. The parser must build a `syntheticId → label` lookup map.

**No clusters:** ER diagrams have no grouping construct. `clusters` is always `[]`.

**Cardinality on edges:** ER relationships carry cardinality at both ends. For `ParsedEdge.label`, format as: `"roleA"` (the relationship label). Cardinality information is encoded in the edge type.

**Edge type mapping:**

| `relSpec.relType` | Our `EdgeType` |
|---|---|
| `"IDENTIFYING"` | `"arrow"` (solid line) |
| `"NON_IDENTIFYING"` | `"dotted"` (dashed line) |

**Attribute syntax:** Attributes must use newline separators, NOT semicolons. `CUSTOMER { string name\nstring email }` — NOT `CUSTOMER { string name; string email }`.

### 4.4 Parser Design: `parseErDiagram(db)`

```typescript
// packages/diagram/src/parser/er-diagram.ts

export type ErDiagramDb = Record<string, unknown>;

export function parseErDiagram(db: ErDiagramDb): ParsedDiagram {
  // 1. Read db.entities (Map<string, EntityNode>)
  // 2. Read db.relationships (Array<ERRelationship>)
  // 3. Build syntheticId → entityName lookup from entities
  // 4. For each entity:
  //    - Use label (entity name) as ParsedNode.id
  //    - Build label: entity name + attribute list
  //    - Shape: "erBox" → "rectangle"
  // 5. For each relationship:
  //    - Resolve entityA/entityB synthetic IDs to entity names
  //    - Map relType to EdgeType
  //    - Use roleA as edge label
  // 6. Build ordinal counter
  // 7. Direction: force "LR" (ER convention)
  // 8. Return ParsedDiagram (clusters: [])
}
```

### 4.5 Shape Map Additions

```typescript
// ER diagram shapes
erBox: { elementType: "rectangle", width: 200, height: 100, roundness: null },
```

ER boxes are taller (100px) to accommodate attribute lists.

### 4.6 Auto-Layout

Already wired — `DAGRE_TYPES` includes `"erDiagram"`. `DEFAULT_RANKDIR` already has `erDiagram: "LR"`. No changes needed to `auto-layout.ts`.

The `SHAPE_DIMS` table needs an `erBox` entry:

```typescript
erBox: { w: 200, h: 100 },
```

---

## 5. mindmap

### 5.1 Mermaid db API (Verified)

**Access pattern:** Method (`getMindmap()`) + property (`nodeType`).

| API | Type | Description |
|---|---|---|
| `db.getMindmap()` | `MindmapNode` | Root of the tree (recursive `children[]`) |
| `db.nodes` | `Array<MindmapNode>` | Flat list of all nodes (including root; same objects as tree) |
| `db.nodeType` | `Record<string, number>` | Enum: `DEFAULT=0, NO_BORDER=0, ROUNDED_RECT=1, RECT=2, CIRCLE=3, CLOUD=4, BANG=5, HEXAGON=6` |
| `db.elements` | `object` | Always `{}` — unused |

### 5.2 Data Structures

```typescript
interface MindmapNode {
  id: number;              // Sequential integer (0, 1, 2, ...)
  nodeId: string;          // "root", "Origins", "Long history" — the display text
  level: number;           // Indentation level (0 = root, 2 = first child, 4 = grandchild)
  descr: string;           // Display description (same as nodeId)
  type: number;            // Node type from nodeType enum (0=default, 3=circle, etc.)
  width: number;           // 200 (default — not yet laid out)
  padding: number;         // 10
  isRoot: boolean;         // true only for the root node
  children: MindmapNode[]; // Child nodes (recursive)
  icon?: string;           // Optional icon class (e.g., "fa fa-book")
}
```

### 5.3 Key Behaviours

**Tree structure, no edges:** Mindmaps are pure trees. The parent→child relationship is implicit in the `children[]` arrays. There are no explicit edges in the Mermaid source. For `ParsedDiagram.edges`, generate synthetic edges from each parent to its children.

**Node identity:** `nodeId` is the text label, which may contain spaces (e.g., `"Long history"`). For `ParsedNode.id`, use a **dot-separated path** from root: `"root"`, `"root.Origins"`, `"root.Origins.Long history"`. This matches the identity model in `types.ts` §4 (`NodeId` doc: "Mindmap nodes use dot-separated path IDs").

**Level field:** The `level` field uses double-stepped indentation (0, 2, 4, 6...). Divide by 2 for the actual depth. This is only informational — the tree structure in `children[]` is authoritative.

**No clusters:** Mindmaps have no grouping construct. `clusters` is always `[]`.

**Shape mapping:**

| Mermaid `type` | Name | Our `NodeShape` |
|---|---|---|
| `0` | DEFAULT / NO_BORDER | `"rounded"` |
| `1` | ROUNDED_RECT | `"rounded"` |
| `2` | RECT | `"rectangle"` |
| `3` | CIRCLE | `"circle"` |
| `4` | CLOUD | `"ellipse"` (approximation) |
| `5` | BANG | `"hexagon"` (approximation) |
| `6` | HEXAGON | `"hexagon"` |

### 5.4 Parser Design: `parseMindmap(db)`

```typescript
// packages/diagram/src/parser/mindmap.ts

export type MindmapDb = Record<string, unknown>;

export function parseMindmap(db: MindmapDb): ParsedDiagram {
  // 1. Call db.getMindmap() → root MindmapNode
  // 2. Walk tree recursively:
  //    a. Build path-based ID: "root", "root.Origins", etc.
  //    b. Create ParsedNode with path ID, descr as label, mapped shape
  //    c. Create synthetic ParsedEdge from parent path → child path
  // 3. Direction: not applicable (radial layout)
  // 4. Return ParsedDiagram (clusters: [], edges: synthetic parent→child)
}
```

### 5.5 Shape Map Additions

No additions needed — mindmap node types map to existing shapes (`rounded`, `rectangle`, `circle`, `ellipse`, `hexagon`).

### 5.6 Auto-Layout: d3-hierarchy (diag.2)

Mindmaps use **radial tree layout** via `d3-hierarchy`. This is a new dependency not yet installed.

```typescript
// New: packages/diagram/src/layout/mindmap-layout.ts
import { hierarchy, tree } from "d3-hierarchy";

export function layoutMindmap(parsed: ParsedDiagram): LayoutStore {
  // 1. Build d3 hierarchy from ParsedDiagram edges (parent→child)
  // 2. Apply d3.tree() with radial projection
  // 3. Convert polar coordinates to Cartesian (x, y)
  // 4. Return LayoutStore
}
```

**Dispatch change in `auto-layout.ts`:** Remove `"mindmap"` from the unsupported error and add a dispatch arm:

```typescript
if (parsed.type === "mindmap") {
  return layoutMindmap(parsed);
}
```

---

## 6. block-beta

### 6.1 Mermaid db API (Verified)

**Access pattern:** Methods.

| API | Type | Description |
|---|---|---|
| `db.getBlocksFlat()` | `Array<BlockNode>` | Flat list of all blocks (first entry is root composite) |
| `db.getBlocks()` | `Array<BlockNode>` | Top-level blocks only (children nested) |
| `db.getEdges()` | `Array<BlockEdge>` | All edges between blocks |
| `db.getColumns(parentId)` | `number` | Column count for a parent block |
| `db.getClasses()` | `object` | CSS classes (usually `{}`) |

### 6.2 Data Structures

```typescript
interface BlockNode {
  id: string;              // "a", "b", "group1", "root"
  label: string;           // "App", "Backend", "" (empty for groups)
  type: string;            // "square" | "composite" | "round" | ...
  widthInColumns: number;  // How many grid columns this block spans (default: 1)
  children?: BlockNode[];  // Present only for "composite" type blocks
  columns?: number;        // Column count (only on root composite)
}

interface BlockEdge {
  id: string;              // "1-a-b" (prefix-start-end)
  start: string;           // Source block id
  end: string;             // Target block id
  label: string;           // Edge label (may be "")
  type: string;            // "edge"
  arrowTypeEnd: string;    // "arrow_point"
  arrowTypeStart: string;  // "arrow_open"
}
```

### 6.3 Key Behaviours

**Grid-based layout:** Block-beta is fundamentally a **grid/column** layout system, not a free-form graph. The root block has a `columns` count, and blocks are placed left-to-right, wrapping to new rows. Blocks can span multiple columns via `widthInColumns`.

**Composite blocks as clusters:** Blocks with `type: "composite"` are containers. Their `children[]` are nested blocks. These become `ParsedCluster` entries.

**Root is virtual:** The first entry in `getBlocksFlat()` is always the root composite (`id: "root"`, `type: "composite"`). This is not a visible node — skip it during node creation.

**Shape mapping:**

| Mermaid `type` | Our `NodeShape` |
|---|---|
| `"square"` | `"rectangle"` |
| `"round"` | `"rounded"` |
| `"circle"` | `"circle"` |
| `"composite"` | cluster (not a node shape) |

**Edge type:** All edges are `"arrow"` — block diagrams don't distinguish edge styles.

### 6.4 Parser Design: `parseBlockBeta(db)`

```typescript
// packages/diagram/src/parser/block-beta.ts

export type BlockBetaDb = Record<string, unknown>;

export function parseBlockBeta(db: BlockBetaDb): ParsedDiagram {
  // 1. Call db.getBlocksFlat() → Array<BlockNode>
  // 2. Skip root composite (id === "root")
  // 3. For each block:
  //    - If type === "composite": create ParsedCluster
  //    - Else: create ParsedNode with mapped shape
  //    - Track parent→child for cluster membership
  // 4. Call db.getEdges() → Array<BlockEdge>
  // 5. Build edges with ordinal counter
  // 6. Return ParsedDiagram
}
```

### 6.5 Auto-Layout: cytoscape-fcose (diag.2)

Block-beta uses **force-directed layout with cluster containment** via `cytoscape` + `cytoscape-fcose`. These are new dependencies not yet installed.

The grid/column semantics are unique to block-beta and cannot be expressed in dagre's Sugiyama algorithm. The fcose layout with cluster constraints is the closest match that respects group containment while allowing force-directed node placement.

```typescript
// New: packages/diagram/src/layout/block-layout.ts
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";

cytoscape.use(fcose);

export function layoutBlockBeta(parsed: ParsedDiagram): LayoutStore {
  // 1. Build cytoscape graph from ParsedDiagram
  // 2. Set compound nodes for clusters
  // 3. Apply fcose layout with column constraints
  // 4. Extract positions
  // 5. Return LayoutStore
}
```

**Alternative consideration:** Given block-beta's strict grid semantics, a simpler custom grid layout (no external dependency) may be more appropriate than fcose. Each block occupies `widthInColumns` columns in a fixed-column grid. This is a design decision for diag.2.

---

## 7. Flowchart (Reference — Already Implemented)

Included for completeness and as the canonical pattern.

### 7.1 Mermaid db API

| API | Type | Description |
|---|---|---|
| `db.getVertices()` | `Map<string, FlowchartVertex>` or `Record<string, FlowchartVertex>` | All nodes |
| `db.getEdges()` | `Array<FlowchartEdge>` | All edges |
| `db.getSubGraphs()` | `Array<FlowchartSubgraph>` | All subgraphs |
| `db.getDirection()` | `string` | Layout direction |

### 7.2 Implementation

See `packages/diagram/src/parser/flowchart.ts` — 157 lines, fully tested (67 tests).

---

## 8. Adapter Dispatch Changes

### 8.1 Current Gate (adapter.ts line 151)

```typescript
if (type !== "flowchart") {
  return { valid: false, error: { line: 0, message: `...diag.1 (flowchart only)` } };
}
```

### 8.2 Target State

```typescript
import { parseFlowchart } from "./flowchart.js";
import { parseStateDiagram } from "./state-diagram.js";
import { parseClassDiagram } from "./class-diagram.js";
import { parseErDiagram } from "./er-diagram.js";
import { parseMindmap } from "./mindmap.js";
import { parseBlockBeta } from "./block-beta.js";

// Inside parseMermaid(), replace the gate with a dispatch:
const PARSERS: Record<string, (db: Record<string, unknown>) => ParsedDiagram> = {
  "flowchart": parseFlowchart,
  "stateDiagram-v2": parseStateDiagram,
  "classDiagram": parseClassDiagram,
  "erDiagram": parseErDiagram,
  "mindmap": parseMindmap,
  "block-beta": parseBlockBeta,
};

const parser = PARSERS[type];
if (!parser) {
  return { valid: false, error: { line: 0, message: `No parser for type '${type}'` } };
}
const parsed = parser(db);
return { valid: true, diagram: { ...parsed, type, renames } };
```

### 8.3 Import Strategy

Each parser file is a separate module. The adapter imports them all statically. This is acceptable because:
- All parsers are pure functions with no side effects at import time
- The mermaid package (the heavy dependency) is already loaded lazily
- Tree-shaking is not a concern for a VS Code extension

---

## 9. Shape Map Summary

New entries needed in `shape-map.ts` for diagram-type-specific shapes:

| Shape Key | Element Type | Width | Height | Roundness | Source Type |
|---|---|---|---|---|---|
| `stateStart` | ellipse | 30 | 30 | null | stateDiagram-v2 |
| `stateEnd` | ellipse | 30 | 30 | null | stateDiagram-v2 |
| `classBox` | rectangle | 200 | 120 | null | classDiagram |
| `erBox` | rectangle | 200 | 100 | null | erDiagram |

Existing shapes already cover: `rectangle`, `rounded`, `diamond`, `circle`, `ellipse`, `hexagon`.

Mindmap and block-beta node types map to existing shape entries.

### 9.1 D-01 Shape Fidelity: Line Polygon Approach

Per DEC-014, hexagon and parallelogram shapes will be upgraded from approximations to `line`-based polygons. The shape map will change:

| Shape Key | Current Type | New Type | Points (closed path) | Notes |
|---|---|---|---|---|
| `hexagon` | `diamond` (approx) | `line` | `[[0,40],[45,0],[135,0],[180,40],[135,80],[45,80],[0,40]]` | 6-vertex polygon, 180×80 |
| `parallelogram` | `rectangle` (approx) | `line` | `[[20,0],[180,0],[160,60],[0,60],[20,0]]` | 4-vertex skewed polygon, 180×60 |
| `cylinder` | `rectangle` (approx) | `rectangle` (unchanged) | N/A | Deferred — curved caps require composition |

**Type changes required:**
- `ExcalidrawElement.type` union: add `"line"`
- `ExcalidrawElement` interface: add `points?: ReadonlyArray<[number, number]>`
- `scene-adapter.ts`: pass `points` through to Excalidraw API for `line` elements
- `canvas-generator.ts`: handle `line` element creation with point arrays
- Text overlay: generate companion `text` element centered on polygon shapes (line polygons are not containers)

---

## 10. Auto-Layout Summary

### 10.1 No Changes Needed (dagre types)

`auto-layout.ts` already supports `stateDiagram-v2`, `classDiagram`, and `erDiagram` via `DAGRE_TYPES`. The `layoutWithDagre()` function is type-agnostic — it operates on `ParsedDiagram` fields.

The only additions needed:
- `SHAPE_DIMS` entries for `classBox` and `erBox` (so dagre allocates correct node sizes)

### 10.2 New Layout Engines (diag.2)

| Type | Engine | New File | New Dependency |
|---|---|---|---|
| `mindmap` | d3-hierarchy radial tree | `mindmap-layout.ts` | `d3-hierarchy` |
| `block-beta` | cytoscape-fcose or custom grid | `block-layout.ts` | `cytoscape`, `cytoscape-fcose` (or none if custom grid) |

---

## 11. Edge Type Mapping Summary

| Diagram Type | Mermaid Representation | Our `EdgeType` |
|---|---|---|
| flowchart | `type: 1` | `"arrow"` |
| flowchart | `type: 2` | `"dotted"` |
| flowchart | `type: 3` | `"thick"` |
| stateDiagram-v2 | all transitions | `"arrow"` |
| classDiagram | EXTENSION + LINE | `"inheritance"` |
| classDiagram | EXTENSION + DOTTED_LINE | `"realization"` |
| classDiagram | COMPOSITION + LINE | `"composition"` |
| classDiagram | AGGREGATION + LINE | `"aggregation"` |
| classDiagram | DEPENDENCY + DOTTED_LINE | `"dotted"` |
| classDiagram | LOLLIPOP + LINE | `"arrow"` |
| erDiagram | IDENTIFYING | `"arrow"` |
| erDiagram | NON_IDENTIFYING | `"dotted"` |
| mindmap | parent→child (synthetic) | `"arrow"` |
| block-beta | all edges | `"arrow"` |

---

## 12. Risks and Mitigations

### 12.1 Mermaid API Instability

**Risk:** The `diag.db` APIs documented here are internal and undocumented. They may change in future Mermaid versions.

**Mitigation:** 
- Mermaid is pinned at `11.4.1` in `package.json`
- Each parser file has comprehensive tests that exercise the actual Mermaid API
- On upgrade: run parser tests; if they fail, update only the affected parser file
- The rest of the system (`ParsedDiagram` consumers) is unaffected

### 12.2 Node ID Collisions

**Risk (erDiagram):** Entity names could collide with synthetic IDs.

**Mitigation:** Use entity `label` (the user-written name) as `NodeId`, not the synthetic `id`. Entity names are unique within a diagram by Mermaid parser enforcement.

**Risk (mindmap):** Dot-separated path IDs could be ambiguous if node text contains dots.

**Mitigation:** This is an inherent limitation of the path-based identity model. For diag.2, we accept this and document it. If it becomes a problem, a hash-based fallback can be introduced.

### 12.3 Mermaid Version Discrepancy

**Note:** The main architecture doc §15.1 mentions Mermaid `11.12.3`, but `package.json` pins `11.4.1`. The introspection results in this document are from `11.4.1`. This discrepancy should be resolved — the pinned version in `package.json` is the source of truth.

---

## 13. TDD Implementation Plan for stateDiagram-v2

This section outlines the full TDD cycle for the first new parser.

### Phase A — Design (this document)
- [x] Interfaces defined: `parseStateDiagram(db: StateDiagramDb): ParsedDiagram`
- [x] Shape mapping table defined
- [x] Cluster model defined (composite state → cluster)
- [x] Edge mapping defined (all → arrow)

### Phase B — Failing Tests
Write tests in `packages/diagram/src/__tests__/state-diagram.test.ts`:

| Test ID | Description |
|---|---|
| SD-01 | Parse simple two-state diagram → 2 nodes, 1 edge |
| SD-02 | Start/end pseudostates `[*]` → nodes with shape `"stateStart"`/`"stateEnd"` (30×30 ellipse) |
| SD-03 | Composite state → cluster with members |
| SD-04 | Nested composite → cluster.parent set |
| SD-05 | Transition labels preserved in edge.label |
| SD-06 | Multiple transitions → ordinal counter |
| SD-07 | Shape mapping: rect→rounded, stateStart→stateStart, stateEnd→stateEnd |
| SD-08 | Empty diagram (no transitions) → nodes only |
| SD-09 | Self-transition (state → same state) |
| SD-10 | adapter.ts integration: `parseMermaid()` returns valid ParsedDiagram for stateDiagram-v2 source |
| SD-11 | Full pipeline: parse → layout → canvas generates without error |

### Phase C — Implementation
Create `packages/diagram/src/parser/state-diagram.ts`, update `adapter.ts` dispatch.

### Phase D — Green + Review
All tests pass, reviewer checks against this architecture document.
