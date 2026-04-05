/**
 * C — classDiagram parser (internal)
 *
 * Accesses the mermaid `diagram.db` API (mermaid 11.x).
 * This is the ONLY file in the codebase that imports mermaid internals for
 * classDiagram. All other modules use the stable ParsedDiagram type via adapter.ts.
 */

import type {
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
  NodeId,
  ClusterId,
  NodeShape,
  EdgeType,
} from "../types.js";

/**
 * Internal type representing the mermaid classDiagram parser database object.
 * Typing is loose (unknown fields) because this is an undocumented API.
 * Narrowed inside parseClassDiagram via runtime checks.
 */
export type ClassDiagramDb = Record<string, unknown>;

// ── Internal shapes matching mermaid 11.x classDiagram db ─────────────────────

interface MermaidClassMember {
  id: string;
  memberType: "method" | "attribute";
  visibility: string;
  text: string;
  cssStyle: string;
  classifier: string;
  parameters: string;
  returnType: string;
}

interface MermaidClassNode {
  id: string;
  type: string;
  label: string;
  text: string;
  shape: string;
  cssClasses: string;
  members: MermaidClassMember[];
  methods: MermaidClassMember[];
  annotations: string[];
  domId: string;
}

// Mermaid classDiagram relation types (ClassDB.relationType enum)
const RELATION_TYPE = {
  AGGREGATION: 0,
  EXTENSION: 1,
  COMPOSITION: 2,
  DEPENDENCY: 3,
  LOLLIPOP: 4,
} as const;

// Mermaid classDiagram line types (ClassDB.lineType enum)
const LINE_TYPE = {
  LINE: 0,
  DOTTED_LINE: 1,
} as const;

interface MermaidRelation {
  id1: string;
  id2: string;
  relationTitle1: string;
  relationTitle2: string;
  type: string;
  title: string;
  text: string;
  style: string[];
  relation: {
    type1: number;
    type2: number;
    lineType: number;
  };
}

interface MermaidNote {
  id: string;
  class: string;
  text: string;
  index: number;
}

// ── Edge type mapping ─────────────────────────────────────────────────────────

const EDGE_TYPE_MAP: Readonly<Record<number, EdgeType>> = {
  [RELATION_TYPE.EXTENSION]: "inheritance",
  [RELATION_TYPE.COMPOSITION]: "composition",
  [RELATION_TYPE.AGGREGATION]: "aggregation",
  [RELATION_TYPE.DEPENDENCY]: "dependency",
  [RELATION_TYPE.LOLLIPOP]: "association",
};

/**
 * Convert a mermaid classDiagram parser `db` object into a stable ParsedDiagram.
 *
 * Called only from adapter.ts after `mermaid.mermaidAPI.getDiagramFromText()`
 * returns a classDiagram diagram. All mermaid-version-specific field access lives
 * here so breakage on Mermaid upgrades is isolated to this file.
 */
export function parseClassDiagram(db: ClassDiagramDb): ParsedDiagram {
  // Runtime guards before casting — db is Record<string, unknown>
  const rawClasses = db.classes instanceof Map
    ? (db.classes as Map<string, MermaidClassNode>)
    : new Map<string, MermaidClassNode>();
  const rawRelations = Array.isArray(db.relations)
    ? (db.relations as MermaidRelation[])
    : [];
  const rawNotes = db.notes instanceof Map
    ? (db.notes as Map<string, MermaidNote>)
    : new Map<string, MermaidNote>();
  const rawDirection = typeof db.direction === "string" ? db.direction : "TD";

  // Normalize direction: "TB" → "TD" like flowchart does
  const normalizedDirection =
    rawDirection === "TB" ? "TD" : rawDirection;

  // Build nodes map from classes
  const nodes = new Map<NodeId, ParsedNode>();
  for (const [_id, cn] of rawClasses) {
    // Extract classes from cssClasses string (space-separated)
    const classes = cn.cssClasses
      ? cn.cssClasses.split(/\s+/).filter((c: string) => c.length > 0)
      : [];

    // Merge annotations into classes
    const allClasses = [...classes, ...(cn.annotations ?? [])];

    nodes.set(cn.id, {
      id: cn.id,
      label: cn.label ?? cn.text ?? "",
      shape: "rectangle" as NodeShape, // class nodes default to rectangle
      classes: allClasses,
    });
  }

  // Build edges with per-(from,to) ordinal counter
  const ordinalCounter = new Map<string, number>();
  const edges: ParsedEdge[] = rawRelations.map((r) => {
    const key = `${r.id1}:${r.id2}`;
    const ordinal = ordinalCounter.get(key) ?? 0;
    ordinalCounter.set(key, ordinal + 1);
    return {
      from: r.id1,
      to: r.id2,
      label: r.title ?? "",
      ordinal,
      type: EDGE_TYPE_MAP[r.relation.type1] ?? "arrow",
    };
  });

  // Build clusters from notes (single-member clusters)
  const clusters: ParsedCluster[] = [];
  for (const [_id, note] of rawNotes) {
    clusters.push({
      id: note.id,
      label: note.text,
      members: [note.class],
    });
  }

  return {
    type: "classDiagram", // overridden by adapter.ts spread with detected type
    nodes,
    edges,
    clusters,
    renames: [], // classDiagram does not support @rename annotations
    direction: normalizedDirection as "TD" | "LR" | "RL" | "BT",
  };
}
