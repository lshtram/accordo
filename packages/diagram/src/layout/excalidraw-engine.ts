/**
 * Excalidraw layout engine adapter.
 *
 * Calls @excalidraw/mermaid-to-excalidraw with raw Mermaid source,
 * then maps the output geometry back to Accordo's LayoutStore format
 * using the element-mapper.
 *
 * This is a pluggable alternative to layoutWithDagre() — same output
 * contract (LayoutStore). Input: raw Mermaid source + ParsedDiagram.
 *
 * Only valid for flowchart diagrams in Phase 1. Other types must use dagre.
 *
 * Source: docs/30-development/diagram-update-plan.md §7.3
 */

import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";

import type { ParsedDiagram, LayoutStore, SpatialDiagramType } from "../types.js";
import { createEmptyLayout } from "./layout-store.js";
import { extractGeometry, mapGeometryToLayout } from "./element-mapper.js";
import { layoutWithDagre } from "./auto-layout.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a LayoutStore for a flowchart diagram using the
 * @excalidraw/mermaid-to-excalidraw library for geometry.
 *
 * Steps:
 * 1. Validate source and diagram type
 * 2. Call parseMermaidToExcalidraw(source) → ExcalidrawElementSkeleton[]
 * 3. extractGeometry(skeletons) → UpstreamGeometry[]
 * 4. mapGeometryToLayout(geometries, parsed) → MappingResult
 * 5. For any unmapped nodes, fall back to dagre layout for those nodes
 * 6. Build and return a complete LayoutStore
 *
 * @param source  - Raw Mermaid source string (required; must not be empty)
 * @param parsed  - Accordo ParsedDiagram (for identity matching)
 * @returns LayoutStore with positions from the excalidraw engine
 * @throws Error if source is empty or undefined
 * @throws Error if parsed.type is not "flowchart"
 */
export async function layoutWithExcalidraw(
  source: string,
  parsed: ParsedDiagram,
): Promise<LayoutStore> {
  // ── Input validation ─────────────────────────────────────────────────────────
  if (!source || source.trim().length === 0) {
    throw new Error("layoutWithExcalidraw: source must be a non-empty string");
  }

  if (parsed.type !== "flowchart") {
    throw new Error(
      `layoutWithExcalidraw: only "flowchart" type is supported, got "${parsed.type}"`
    );
  }

  // ── Call upstream library ────────────────────────────────────────────────────
  const { elements } = await parseMermaidToExcalidraw(source);

  // ── Map geometry to Accordo identity model ───────────────────────────────────
  const geometries = extractGeometry(elements);
  const mapping = mapGeometryToLayout(geometries, parsed);

  // ── Build base layout store ──────────────────────────────────────────────────
  const base = createEmptyLayout(parsed.type as SpatialDiagramType);

  // ── For unmatched nodes: fall back to dagre ─────────────────────────────────
  // We run dagre on the full diagram then overlay the excalidraw positions.
  // This is correct because dagre positions are deterministic and stable.
  const dagreLayout = layoutWithDagre(parsed, {
    rankdir: "TB",
    nodeSpacing: 60,
    rankSpacing: 80,
  });

  // Build final node map: start with dagre positions, overlay excalidraw positions
  const nodes: typeof dagreLayout.nodes = { ...dagreLayout.nodes };
  for (const [nodeId, layout] of Object.entries(mapping.nodes)) {
    nodes[nodeId] = layout;
  }

  // ── Build final layout ────────────────────────────────────────────────────────
  return {
    ...base,
    nodes,
    edges: dagreLayout.edges,
    clusters: {
      ...dagreLayout.clusters,
      ...mapping.clusters,
    },
  };
}
