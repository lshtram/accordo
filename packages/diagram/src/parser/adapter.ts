/**
 * A2 — Flowchart parser adapter (public API)
 *
 * Exposes a stable interface over mermaid's internal parser.
 * All mermaid-version-specific code is in the per-diagram-type files
 * (e.g. flowchart.ts). Nothing outside the parser/ directory imports
 * mermaid internals directly.
 *
 * Source: diag_arch_v4.2.md §6
 */

import type {
  DiagramType,
  SpatialDiagramType,
  SequentialDiagramType,
  ParseResult,
} from "../types.js";

/**
 * Parse a Mermaid source string into a structured ParsedDiagram.
 *
 * Returns `{ valid: false, error }` for syntax errors or unsupported types
 * rather than throwing. Callers must check `.valid` before using `.diagram`.
 */
export function parseMermaid(_source: string): ParseResult {
  throw new Error("not implemented");
}

/**
 * Detect the diagram type from the first non-empty, non-comment line of source.
 * Returns null if the source is empty or the type is unrecognised.
 */
export function detectDiagramType(_source: string): DiagramType | null {
  throw new Error("not implemented");
}

/**
 * Type guard: returns true when `type` is a SpatialDiagramType.
 * Spatial diagrams have 2-D node positions and need a .layout.json file.
 */
export function isSpatialType(
  type: DiagramType
): type is SpatialDiagramType {
  throw new Error("not implemented");
}

/**
 * Type guard: returns true when `type` is a SequentialDiagramType.
 * Sequential diagrams are rendered via Kroki only; no canvas involved.
 */
export function isSequentialType(
  type: DiagramType
): type is SequentialDiagramType {
  throw new Error("not implemented");
}
