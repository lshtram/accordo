/**
 * A2 — Flowchart-specific Mermaid parser (internal)
 *
 * Accesses the undocumented mermaid `diagram.parser.yy` API.
 * This is the ONLY file in the codebase that imports mermaid internals.
 * All other modules use the stable ParsedDiagram type via adapter.ts.
 *
 * Source: diag_arch_v4.2.md §6.3
 */

import type { ParsedDiagram } from "../types.js";

/**
 * Internal type representing the mermaid flowchart parser database object.
 * Typing is loose (unknown fields) because this is an undocumented API.
 * Narrowed inside parseFlowchart via runtime checks.
 */
export type FlowchartDb = Record<string, unknown>;

/**
 * Convert a mermaid flowchart parser `db` object into a stable ParsedDiagram.
 *
 * Called only from adapter.ts after `mermaid.mermaidAPI.getDiagramFromText()`
 * returns a flowchart diagram. All mermaid-version-specific field access lives
 * here so breakage on Mermaid upgrades is isolated to this file.
 */
export function parseFlowchart(_db: FlowchartDb): ParsedDiagram {
  throw new Error("not implemented");
}
