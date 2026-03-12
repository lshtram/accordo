/**
 * A8 — Shape map: NodeShape → Excalidraw element properties
 *
 * Pure mapping from Mermaid node shape to the Excalidraw element type and
 * default rendering dimensions. Centralises all shape decisions so that
 * canvas-generator.ts has no shape logic.
 *
 * Shape mapping table (diag_arch_v4.2.md §9.2):
 *   rectangle    → rectangle, 180×60, roundness null
 *   rounded      → rectangle, 180×60, roundness 8
 *   diamond      → diamond,   140×80, roundness null
 *   circle       → ellipse,    80×80
 *   ellipse      → ellipse,    80×80
 *   cylinder     → rectangle, 120×80
 *   stadium      → rectangle, 180×60, large roundness
 *   hexagon      → diamond,   140×80  (diag.1 approximation)
 *   parallelogram→ rectangle, 180×60  (diag.1 approximation)
 *   subgraph     → rectangle, 200×120, strokeDash true
 *   <unknown>    → rectangle, 180×60  (fallback)
 *
 * diag.1 simplification: exotic shapes (parallelogram, hexagon, cylinder)
 * render as approximations. Full fidelity is deferred to diag.2.
 *
 * Source: diag_arch_v4.2.md §9.2, diag_workplan.md §5 A8
 */

import type { NodeShape } from "../types.js";

/** Excalidraw element rendering properties for a given Mermaid node shape. */
export interface ShapeProps {
  /** Excalidraw element type. */
  elementType: "rectangle" | "diamond" | "ellipse";
  /** Default rendering width in pixels. */
  width: number;
  /** Default rendering height in pixels. */
  height: number;
  /**
   * Corner rounding level.
   * null  = crisp/no rounding (rectangle, diamond).
   * > 0   = rounded corners (rounded, stadium).
   */
  roundness: number | null;
  /**
   * Whether the element border should be rendered dashed.
   * true for subgraph backgrounds; falsy for all other shapes.
   */
  strokeDash?: boolean;
}

// ── Shape table ─────────────────────────────────────────────────────────────
// Entries follow diag_arch_v4.2.md §9.2.
// Exotic shapes (hexagon, parallelogram, cylinder) use diag.1 approximations;
// full fidelity is deferred to diag.2.

const SHAPE_TABLE: Record<string, ShapeProps> = {
  rectangle:     { elementType: "rectangle", width: 180, height: 60,  roundness: null },
  rounded:       { elementType: "rectangle", width: 180, height: 60,  roundness: 8    },
  diamond:       { elementType: "diamond",   width: 140, height: 80,  roundness: null },
  circle:        { elementType: "ellipse",   width: 80,  height: 80,  roundness: null },
  ellipse:       { elementType: "ellipse",   width: 80,  height: 80,  roundness: null },
  cylinder:      { elementType: "rectangle", width: 120, height: 80,  roundness: null },
  stadium:       { elementType: "rectangle", width: 180, height: 60,  roundness: 32   },
  hexagon:       { elementType: "diamond",   width: 140, height: 80,  roundness: null },
  parallelogram: { elementType: "rectangle", width: 180, height: 60,  roundness: null },
  subgraph:      { elementType: "rectangle", width: 200, height: 120, roundness: null, strokeDash: true },
};

const FALLBACK_PROPS: ShapeProps = {
  elementType: "rectangle",
  width: 180,
  height: 60,
  roundness: null,
};

/**
 * Map a Mermaid node shape to its Excalidraw rendering properties.
 * Unknown / future shapes fall back to the rectangle default (180×60).
 */
export function getShapeProps(shape: NodeShape): ShapeProps {
  // NodeShape is an open union (string | named literals); cast to string is
  // safe for the Record index — we're widening to the type it already extends.
  return SHAPE_TABLE[shape as string] ?? FALLBACK_PROPS;
}
