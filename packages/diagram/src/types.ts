/**
 * A1 — Internal types for accordo-diagram
 *
 * Pure type definitions. No runtime code. Every other module imports from here.
 *
 * Source: diag_arch_v4.2.md §4, §5, §6, §7
 *
 * Requirements coverage:
 *   §4 Identity model   → DiagramType, SpatialDiagramType,
 *                          NodeId, EdgeKey, ClusterId, RenameAnnotation
 *   §5 Layout store     → LayoutStore, NodeLayout, EdgeLayout, ClusterLayout,
 *                          NodeStyle, EdgeStyle, ClusterStyle, AestheticsConfig, NodeSizing
 *   §6 Parser adapter   → ParsedDiagram, ParsedNode, ParsedEdge, ParsedCluster,
 *                          ParseResult, NodeShape, EdgeType
 *   §7 Reconciler       → ReconcileResult
 *   §9 Canvas generator  → ExcalidrawElement, CanvasScene
 */

// ── §4 Identity ────────────────────────────────────────────────────────────────

/**
 * Spatial diagrams: nodes exist in 2D space, positions preserved across edits.
 * Require both .mmd and .layout.json files.
 */
export type SpatialDiagramType =
  | "flowchart"
  | "block-beta"
  | "classDiagram"
  | "stateDiagram-v2"
  | "erDiagram"
  | "mindmap";

/**
 * All diagram types supported by this extension.
 * Only spatial types: this extension is a shared 2D whiteboard.
 * Non-spatial types (sequence, gantt, etc.) are not in scope.
 */
export type DiagramType = SpatialDiagramType;

/**
 * Stable Mermaid node identity.
 * Unique for the lifetime of the diagram. Valid Mermaid identifier.
 * Mindmap nodes use dot-separated path IDs (e.g. "root.Security.Auth").
 */
export type NodeId = string;

/**
 * Edge identity key.
 * Format: "{fromId}->{toId}:{ordinal}"
 * Examples: "auth->api:0", "auth->api:1"
 * Ordinal is 0-based among all edges with the same (from, to) pair, in
 * declaration order.
 */
export type EdgeKey = string;

/** Cluster identity from Mermaid subgraph/namespace ID. */
export type ClusterId = string;

/**
 * Rename annotation parsed from a Mermaid comment.
 * Format in source: "%% @rename: old_id -> new_id"
 * Returned by the parser; consumed and stripped by the reconciler.
 */
export interface RenameAnnotation {
  oldId: NodeId;
  newId: NodeId;
}

// ── §5 Layout store ────────────────────────────────────────────────────────────

/**
 * Complete on-disk layout for a spatial diagram (.layout.json).
 * Stores positions, sizes, and styles for every node, edge, and cluster.
 */
export interface LayoutStore {
  /** Semantic version of the layout.json format. Must be "1.0" for diag.1. */
  version: "1.0";
  /** Diagram type this layout was created for (used for validation). */
  diagram_type: SpatialDiagramType;
  /** Node layout entries, keyed by Mermaid node ID. */
  nodes: Record<NodeId, NodeLayout>;
  /** Edge layout entries, keyed by EdgeKey. */
  edges: Record<EdgeKey, EdgeLayout>;
  /** Cluster layout entries, keyed by ClusterId. */
  clusters: Record<ClusterId, ClusterLayout>;
  /**
   * Nodes that exist in Mermaid source but have no position in `nodes`.
   * Added by the reconciler when new nodes appear. Processed by the placement
   * engine on the next render and promoted to `nodes`.
   */
  unplaced: NodeId[];
  /** Global aesthetic settings applied to all canvas elements. */
  aesthetics: AestheticsConfig;
  /** Optional metadata field for extensibility. */
  metadata?: Record<string, unknown>;
}

/** Layout entry for a single node. */
export interface NodeLayout {
  /** X coordinate (pixels from canvas origin). */
  x: number;
  /** Y coordinate (pixels from canvas origin). */
  y: number;
  /** Width in pixels. Default: per-type NodeSizing.w. */
  w: number;
  /** Height in pixels. Default: per-type NodeSizing.h. */
  h: number;
  /** Per-node visual style overrides. Empty {} means use diagram defaults. */
  style: NodeStyle;
  /**
   * Stable Rough.js seed derived deterministically from node ID on final render.
   * Ensures identical appearance across sessions. Computed on first render if absent.
   */
  seed?: number;
}

/** Layout entry for a single edge. */
export interface EdgeLayout {
  /**
   * Routing strategy. Default: "auto" (dagre-computed).
   * Extended values ("curved", "orthogonal", "direct") added in diag.2.
   */
  routing: "auto" | "curved" | "orthogonal" | "direct" | string;
  /**
   * Intermediate waypoints between endpoints.
   * Empty [] means derive the path from `routing`.
   */
  waypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** Per-edge visual style overrides. */
  style: EdgeStyle;
}

/** Layout entry for a cluster (Mermaid subgraph/namespace). */
export interface ClusterLayout {
  /** X coordinate of top-left corner. */
  x: number;
  /** Y coordinate of top-left corner. */
  y: number;
  /** Width in pixels. */
  w: number;
  /** Height in pixels. */
  h: number;
  /** Cluster label text as declared in Mermaid source. */
  label: string;
  /** Per-cluster visual style overrides. */
  style: ClusterStyle;
}

/**
 * Per-node visual style overrides.
 * All fields optional: empty {} means inherit diagram defaults.
 * Highest priority in the three-tier style inheritance (§5.1).
 */
export interface NodeStyle {
  /** Background fill color (hex "#rrggbb" or named). */
  backgroundColor?: string;
  /** Border/stroke color. */
  strokeColor?: string;
  /** Border width in pixels. */
  strokeWidth?: number;
  /**
   * Stroke line style. Supersedes strokeDash when set.
   * Default: "solid".
   */
  strokeStyle?: "solid" | "dashed" | "dotted";
  /** Whether the stroke is dashed. Kept for backward compat; prefer strokeStyle. */
  strokeDash?: boolean;
  /**
   * Fill pattern for the node background.
   * Default: "hachure" (Excalidraw default hand-drawn fill).
   */
  fillStyle?: "hachure" | "cross-hatch" | "solid" | "zigzag" | "dots" | "dashed" | "zigzag-line";
  /** Mermaid shape hint. See NodeShape for valid values. */
  shape?: NodeShape;
  /** Font size in pixels. */
  fontSize?: number;
  /** Text/font color. */
  fontColor?: string;
  /** Font weight. Default: "normal". */
  fontWeight?: "normal" | "bold";
  /** Opacity [0, 1]. Default: 1. */
  opacity?: number;
  /**
   * Per-node roughness (hand-drawn level). Overrides the diagram-level
   * aesthetics.roughness. 0 = crisp, 1 = hand-drawn (default), 2–3 = very rough.
   */
  roughness?: number;
  /**
   * Font family for node text.
   * Default: "Excalifont" (hand-drawn feel).
   */
  fontFamily?: "Excalifont" | "Nunito" | "Comic Shanns";
}

/** Per-edge visual style overrides. All fields optional. */
export interface EdgeStyle {
  strokeColor?: string;
  /** Line width in pixels. Default: 1.5. */
  strokeWidth?: number;
  /** Stroke line style. Supersedes strokeDash when set. Default: "solid". */
  strokeStyle?: "solid" | "dashed" | "dotted";
  /** Whether line is dashed. Kept for backward compat; prefer strokeStyle. */
  strokeDash?: boolean;
}

/** Per-cluster visual style overrides. All fields optional. */
export interface ClusterStyle {
  /** Background fill (usually semi-transparent). */
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  /** Whether cluster border is dashed. */
  strokeDash?: boolean;
}

/**
 * Global aesthetic configuration stored per-diagram in layout.json.
 * Applied uniformly to all Excalidraw elements by the canvas generator.
 */
export interface AestheticsConfig {
  /**
   * Rough.js hand-drawn effect level.
   * 0 = crisp | 1 = hand-drawn (default).
   */
  roughness?: number;
  /**
   * Animation mode for canvas rendering.
   * "draw-on" = progressive element loading (default, diag.2 implementation).
   * "static" = full scene loads immediately.
   */
  animationMode?: "draw-on" | "static";
  /** Theme identifier (reserved for future presets). Default: "hand-drawn". */
  theme?: string;
}

/**
 * Default node dimensions and spacing per diagram type.
 * Used by dagre auto-layout and the canvas generator.
 */
export interface NodeSizing {
  /** Default width in pixels. */
  w: number;
  /** Default height in pixels. */
  h: number;
  /** Horizontal spacing between nodes (dagre nodesep). */
  hSpacing: number;
  /** Vertical spacing between ranks (dagre ranksep). */
  vSpacing: number;
}

// ── §6 Parser adapter ──────────────────────────────────────────────────────────

/**
 * Valid Mermaid node shapes.
 * Determines how ParsedNode.shape maps to an Excalidraw element (§9.2).
 */
export type NodeShape =
  | "rectangle"
  | "rounded"
  | "diamond"
  | "circle"
  | "cylinder"
  | "stadium"
  | "parallelogram"
  | "hexagon"
  | "ellipse"
  | "stateStart"
  | "stateEnd"
  | string; // open for future diagram types

/**
 * Edge arrow/line style.
 * Values beyond the first four are diagram-type-specific.
 */
export type EdgeType =
  | "arrow"
  | "dotted"
  | "thick"
  | "bold"
  | "inheritance"
  | "composition"
  | "aggregation"
  | "realization"
  | string; // open for future types

/**
 * Stable output from the parser adapter.
 * Hides all mermaid internal API details. Used throughout the system to reason
 * about diagram structure independent of the underlying Mermaid version.
 */
export interface ParsedDiagram {
  /** Detected diagram type from the first line of source. */
  type: DiagramType;
  /** All nodes, keyed by their Mermaid ID. */
  nodes: Map<NodeId, ParsedNode>;
  /** All edges in declaration order. */
  edges: readonly ParsedEdge[];
  /** All clusters (subgraphs / namespaces). */
  clusters: readonly ParsedCluster[];
  /** @rename annotations found in the source (stripped before write-back). */
  renames: readonly RenameAnnotation[];
  /** Flow direction hint, if present (e.g. "TD", "LR"). */
  direction?: "TD" | "LR" | "RL" | "BT";
}

/**
 * Inline visual style resolved from Mermaid `style` directives and `classDef`
 * definitions. All fields are optional — absent means "use diagram default".
 */
export interface ParsedNodeStyle {
  /** Fill colour (Excalidraw backgroundColor). E.g. "#f9f" or "#4dabf7". */
  backgroundColor?: string;
  /** Stroke/border colour (Excalidraw strokeColor). */
  strokeColor?: string;
  /** Stroke width in pixels (Excalidraw strokeWidth). */
  strokeWidth?: number;
  /** Stroke line style. */
  strokeStyle?: "solid" | "dashed";
  /** Text/label colour (Excalidraw fontColor). */
  fontColor?: string;
}

/** Parsed representation of a single node. */
export interface ParsedNode {
  /** Unique Mermaid node ID (stable identity). */
  id: NodeId;
  /** Display label/text. */
  label: string;
  /** Node shape used in Mermaid syntax. */
  shape: NodeShape;
  /**
   * Applied Mermaid classDef names (e.g. ["service", "critical"]).
   * Used to resolve visual defaults from classDef blocks.
   */
  classes: readonly string[];
  /** Parent cluster ID if this node is inside a subgraph/namespace. */
  cluster?: ClusterId;
  /**
   * Class diagram members (attributes and methods).
   * Only populated for classDiagram nodes. Each entry is a display string
   * like "+String name" or "+bark() string". Empty for non-class diagrams.
   */
  members?: readonly string[];
  /**
   * Resolved visual style from `style` directives and/or `classDef` blocks.
   * classDef styles are merged first, then inline `style` overrides them.
   * Absent means no explicit style was declared.
   */
  style?: ParsedNodeStyle;
}

/** Parsed representation of a single edge. */
export interface ParsedEdge {
  /** Source node ID. */
  from: NodeId;
  /** Target node ID. */
  to: NodeId;
  /** Edge label/annotation. Empty string "" if none. */
  label: string;
  /**
   * 0-based ordinal among all edges with the same (from, to) pair, in
   * declaration order. Used to build the EdgeKey.
   */
  ordinal: number;
  /** Arrow/line style. Default: "arrow". */
  type: EdgeType;
  /**
   * Stroke line style derived from the Mermaid edge syntax.
   * "dashed" for dotted/dashed edges (e.g. `-.->`, `-.-`),
   * "solid" for normal and thick edges.
   * Absent = default (solid).
   */
  strokeStyle?: "solid" | "dashed";
  /**
   * Stroke width multiplier for thick edges (e.g. `==>`).
   * Absent = default (1).
   */
  strokeWidth?: number;
  /**
   * Excalidraw arrowhead at the start (tail) of the edge.
   * null = no arrowhead. Absent = use type-based default.
   */
  arrowheadStart?: "arrow" | "triangle" | "dot" | "bar" | null;
  /**
   * Excalidraw arrowhead at the end (head) of the edge.
   * null = no arrowhead. Absent = use type-based default.
   */
  arrowheadEnd?: "arrow" | "triangle" | "dot" | "bar" | null;
}

/** Parsed representation of a cluster (subgraph or namespace). */
export interface ParsedCluster {
  /** Unique cluster ID from the Mermaid subgraph/namespace directive. */
  id: ClusterId;
  /** Label text displayed on the cluster background. */
  label: string;
  /** Node IDs that are direct members (not members of nested sub-clusters). */
  members: readonly NodeId[];
  /** Parent cluster ID if this cluster is nested inside another. */
  parent?: ClusterId;
}

/**
 * Result of a parse operation.
 * Discriminated union: `valid` flag narrows to either the parsed diagram or
 * a structured error.
 */
export type ParseResult =
  | { valid: true; diagram: ParsedDiagram }
  | { valid: false; error: { line: number; message: string } };

// ── §7 Reconciler ──────────────────────────────────────────────────────────────

/**
 * Output of a reconciliation pass.
 * Describes what changed so callers can update UI state and trigger re-renders.
 */
export interface ReconcileResult {
  /** Updated layout after topology changes. */
  layout: LayoutStore;
  /** Mermaid source with @rename annotations stripped (if any were present). */
  mermaidCleaned?: string;
  /** Summary of structural changes made during this pass. */
  changes: {
    nodesAdded: readonly NodeId[];
    nodesRemoved: readonly NodeId[];
    edgesAdded: number;
    edgesRemoved: number;
    clustersChanged: number;
    /** Human-readable rename descriptions: ["old_id -> new_id", ...] */
    renamesApplied: readonly string[];
  };
  /** The already-parsed new diagram — useful for callers that need to re-use the parse result without re-parsing. */
  diagram: ParsedDiagram;
}

// ── §9 Canvas generator ────────────────────────────────────────────────────────

/**
 * A single Excalidraw element produced by the canvas generator.
 * Generated fresh on each render — `id` is NOT stable and is not stored in
 * layout.json.  `mermaidId` links back to the stable Mermaid node/edge/cluster
 * ID so consumers can reconcile scene changes back to layout.
 *
 * Source: diag_arch_v4.2.md §9.3
 */
export interface ExcalidrawElement {
  /** Excalidraw element ID — generated fresh on every render (not persisted). */
  id: string;
  /** Stable back-link to the Mermaid node/edge/cluster this element represents. */
  mermaidId: string;
  /**
   * Semantic kind of this element — used by the webview to construct blockIds for
   * comment anchors without needing to parse the mermaidId format.
   * "label" elements (text overlays, edge labels) are not commentable.
   */
  kind?: "cluster" | "node" | "edge" | "label";
  /** Excalidraw element type. */
  type: "rectangle" | "diamond" | "ellipse" | "arrow" | "text" | "line" | "freedraw";
  /** X coordinate (pixels from canvas origin). */
  x: number;
  /** Y coordinate (pixels from canvas origin). */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Rough.js hand-drawn level (0 = crisp, 1 = hand-drawn default). */
  roughness: number;
  /** Font family string.  Default: "Excalifont". */
  fontFamily: string;
  /** Fill pattern.  Default: "hachure". */
  fillStyle?: string;
  /** Text alignment.  Default: "center" (set by scene-adapter). */
  textAlign?: string;
  /** Text content — for node shape elements and standalone text labels. */
  label?: string;
  /** Arrow path in absolute canvas coordinates.  Only set for type "arrow". */
  points?: ReadonlyArray<[number, number]>;
  /** Excalidraw binding for the arrow start.  null for explicit-path arrows. */
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  /** Excalidraw binding for the arrow end.  null for explicit-path arrows. */
  endBinding?: { elementId: string; focus: number; gap: number } | null;
  /**
   * Arrowhead style at the start of the arrow.  null = no arrowhead.
   * Values: "arrow" | "triangle" | "dot" | "bar" (Excalidraw Arrowhead type).
   */
  arrowheadStart?: "arrow" | "triangle" | "dot" | "bar" | null;
  /**
   * Arrowhead style at the end of the arrow.  null = no arrowhead.
   * Values: "arrow" | "triangle" | "dot" | "bar" (Excalidraw Arrowhead type).
   */
  arrowheadEnd?: "arrow" | "triangle" | "dot" | "bar" | null;
  /** Background fill color (hex or named). */
  backgroundColor?: string;
  /** Stroke/border color. */
  strokeColor?: string;
  /** Border width in pixels. */
  strokeWidth?: number;
  /** Stroke line style. */
  strokeStyle?: "solid" | "dashed" | "dotted";
  /** Dashed stroke flag. */
  strokeDash?: boolean;
  /** Opacity 0–100 (Excalidraw convention). */
  opacity?: number;
  /** Corner rounding level.  null = crisp corners.  Only for rectangles. */
  roundness?: number | null;
  /**
   * For shape elements: list of bound elements (e.g. text labels).
   * null / absent = no bindings.
   */
  boundElements?: Array<{ id: string; type: string }> | null;
  /**
   * For text elements that are bound to a shape: the containing element's
   * Excalidraw ID.  null / absent = standalone text.
   */
  containerId?: string | null;
  /** Font size in pixels.  Only for text elements.  Default: 16. */
  fontSize?: number;
}

/**
 * Complete Excalidraw canvas scene produced by generateCanvas().
 * Elements are in render order: cluster backgrounds → node shapes → edges.
 * The returned layout reflects any unplaced nodes that were resolved during
 * generation (layout.unplaced[] is always empty in the returned value).
 *
 * Source: diag_arch_v4.2.md §9.3
 */
export interface CanvasScene {
  /** All Excalidraw elements in render order. */
  elements: ExcalidrawElement[];
  /**
   * Updated layout store.
   * Any nodes that were in unplaced[] have been promoted to nodes{}.
   * The returned layout.unplaced[] is always empty.
   */
  layout: LayoutStore;
}
