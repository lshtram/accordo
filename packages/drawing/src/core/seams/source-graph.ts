/**
 * DRW-R02 — Source graph types and parser.
 *
 * The .mmd file owns canonical topology, labels, and diagram structure.
 * This seam parses Mermaid source into a typed SourceGraph.
 *
 * Source: docs/20-requirements/requirements-drawing.md §3 (DRW-R02)
 * Source: docs/10-architecture/drawing-architecture.md §4.1
 * Requirements: DRW-R02, DRW-R12
 */

/** Supported diagram types in slice 1. */
export type SourceGraphType = "flowchart" | "unsupported" | "invalid";

/**
 * DRW-R02 — The .mmd file owns canonical topology/labels/diagram structure.
 * direction is normalized: TD and TB both → "TD" (top-down grouping).
 */
export interface SourceGraph {
  type: SourceGraphType;
  direction: "TD" | "TB" | "BT" | "LR" | "RL";
  nodes: SourceNode[];
  edges: SourceEdge[];
  clusters: SourceCluster[];  // deferred in slice 1
}

export interface SourceNode {
  id: string;
  label: string;
  shape?: string;
}

/**
 * DRW-R02 — Edges are parsed and carry Mermaid edge semantics.
 * Identity format: "{from}->{to}:{ordinal}" for stable managed identity.
 */
export interface SourceEdge {
  id: string;       // "{from}->{to}:{ordinal}"
  from: string;
  to: string;
  ordinal: number;  // disambiguates multi-edges between same node pair
  label?: string;
}

export interface SourceCluster {
  id: string;
  label: string;
  memberIds: string[];
}

// ── Parser ───────────────────────────────────────────────────────────────────

import { DrawingError } from "./errors.js";

/** DRW-R02 — Parse .mmd content into a SourceGraph. */
export function parseMermaidSource(content: string): SourceGraph {
  const lines = content.trim().split("\n");
  if (lines.length === 0) {
    throw new DrawingError("source-parse-failed", "Empty source content");
  }

  const firstLine = lines[0].trim();
  // Direction is exactly 2 chars: TD, TB, BT, LR, or RL
  const directiveMatch = firstLine.match(
    /^(flowchart|graph|stateDiagram-v2|classDiagram|erDiagram|pie|requirementDiagram|gantt|gitGraph|journey)(?:\s+(TD|TB|BT|LR|RL))?/
  );
  if (!directiveMatch) {
    throw new DrawingError("source-parse-failed", "Unrecognized diagram directive");
  }

  const diagramType = directiveMatch[1];
  const rawDir = directiveMatch[2] ?? "TD";
  const direction = normalizeDirection(rawDir);

  // Slice 1: only flowchart/graph are supported
  if (diagramType !== "flowchart" && diagramType !== "graph") {
    return { type: "unsupported", direction, nodes: [], edges: [], clusters: [] };
  }

  const nodeLabels = new Map<string, string>();
  const edgesOut: SourceEdge[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("%%")) continue;

    // Node: "A", "A[Label]", "A([Label])", "A{Shape}", "A==>Label"
    const nodeMatch = line.match(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\s*"?([^"\]]*)"?\s*\]|\(\s*"?([^"\)]*)"?\s*\)|\{[^}]*\}|==+>?\s*"?([^"\s,}\]]*)"?)?/
    );
    if (nodeMatch) {
      const id = nodeMatch[1];
      const label = nodeMatch[2] ?? nodeMatch[3] ?? nodeMatch[4] ?? id;
      if (!nodeLabels.has(id)) nodeLabels.set(id, label);
    }

    // Edge operators — checked in priority order
    // -->  standard, ---  undirected, -.-> dotted, ==> thick, <--> bidirectional
    const EDGE_OPS = ["-->", "---", "-.->", "==>", "<-->"];
    let matchedOp = false;
    for (const op of EDGE_OPS) {
      const idx = line.indexOf(op);
      if (idx !== -1) {
        const rest = line.slice(idx + op.length).trim();
        // Split on whitespace, comma, or close bracket
        const toPart = rest.split(/[\s,\]]/)[0] ?? "";
        const from = line.slice(0, idx).trim();
        const to = toPart.replace(/[,\]]+/g, "");
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(from) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) {
          const existingCount = edgesOut.filter(e => e.from === from && e.to === to).length;
          edgesOut.push({
            id: `${from}->${to}:${existingCount}`,
            from,
            to,
            ordinal: existingCount,
          });
          if (!nodeLabels.has(from)) nodeLabels.set(from, from);
          if (!nodeLabels.has(to)) nodeLabels.set(to, to);
        }
        matchedOp = true;
        break;
      }
    }
    if (matchedOp) continue;
  }

  if (nodeLabels.size === 0 && edgesOut.length === 0) {
    throw new DrawingError("source-parse-failed", "No nodes or edges found in source");
  }

  return {
    type: "flowchart",
    direction,
    nodes: Array.from(nodeLabels.entries()).map(([id, label]) => ({ id, label })),
    edges: edgesOut,
    clusters: [],
  };
}

/**
 * DRW-R12 — Direction normalization.
 * TD and TB both mean top-down grouping → normalized to "TD".
 * BT, LR, RL are distinct directions.
 */
function normalizeDirection(raw: string): "TD" | "TB" | "BT" | "LR" | "RL" {
  switch (raw) {
    case "TD":
    case "TB": return "TD";
    case "BT": return "BT";
    case "LR": return "LR";
    case "RL": return "RL";
    default:   return "TD";
  }
}