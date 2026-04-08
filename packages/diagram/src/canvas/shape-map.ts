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
 *   cylinder     → ellipse,   120×80  (diag.1 approximation)
 *   stadium      → rectangle, 180×60, large roundness
 *   hexagon      → diamond,   140×80  (diag.1 approximation)
 *   subroutine   → composite "subroutine", 180×60
 *   double_circle→ composite "double_circle", 90×90 (outer ellipse + inner ellipse)
 *   asymmetric   → rectangle, 180×60  (diag.1 approximation)
 *   parallelogram→ composite "parallelogram", 180×60
 *   parallelogram_alt → composite "parallelogram_alt", 180×60
 *   trapezoid    → composite "trapezoid", 180×60
 *   trapezoid_alt→ composite "trapezoid_alt", 180×60
 *   subgraph     → rectangle, 200×120, strokeDash true
 *   <unknown>    → rectangle, 180×60  (fallback)
 *
 * Composite shapes: shapes that cannot be represented by a single Excalidraw
 * primitive are rendered using multiple `line` elements forming a polygon
 * outline, plus a separate text label element. The `composite` field on
 * ShapeProps identifies these shapes and the renderer handles them separately.
 *
 * diag.1 simplification: exotic shapes (parallelogram, hexagon, cylinder)
 * render as approximations. Full fidelity is deferred to diag.2.
 *
 * Source: diag_arch_v4.2.md §9.2, diag_workplan.md §5 A8
 */

import type { NodeShape } from "../types.js";

/**
 * Identifies shapes that require composite multi-element rendering.
 * The canvas generator uses this to switch rendering strategy.
 *
 * - "subroutine"       : rectangle + 2 inner vertical line elements
 * - "parallelogram"    : 4 line segments forming a right-leaning parallelogram
 * - "parallelogram_alt": 4 line segments forming a left-leaning parallelogram
 * - "trapezoid"        : 4 line segments forming a trapezoid (top wider)
 * - "double_circle"    : outer ellipse + inner ellipse (concentric circles)
 */
export type CompositeKind =
  | "subroutine"
  | "parallelogram"
  | "parallelogram_alt"
  | "trapezoid"
  | "trapezoid_alt"
  | "double_circle";

/** Excalidraw element rendering properties for a given Mermaid node shape. */
export interface ShapeProps {
  /** Excalidraw element type. Used only when composite is absent. */
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
  /**
   * When set, this shape requires composite multi-element rendering.
   * The canvas generator will call buildCompositeElements() instead of
   * emitting a single primitive.
   */
  composite?: CompositeKind;
}

// ── Shape table ─────────────────────────────────────────────────────────────
// Entries follow diag_arch_v4.2.md §9.2.
// Exotic shapes (hexagon, parallelogram, cylinder) use diag.1 approximations;
// full fidelity is deferred to diag.2.

const SHAPE_TABLE: Record<string, ShapeProps> = {
  rectangle:      { elementType: "rectangle", width: 180, height: 60,  roundness: null },
  rounded:        { elementType: "rectangle", width: 180, height: 60,  roundness: 8    },
  diamond:        { elementType: "diamond",   width: 140, height: 80,  roundness: null },
  circle:         { elementType: "ellipse",   width: 80,  height: 80,  roundness: null },
  ellipse:        { elementType: "ellipse",   width: 80,  height: 80,  roundness: null },
  // cylinder → ellipse is the closest single Excalidraw primitive (diag.1 approximation)
  cylinder:       { elementType: "ellipse",   width: 120, height: 80,  roundness: null },
  stadium:        { elementType: "rectangle", width: 180, height: 60,  roundness: 32   },
  hexagon:        { elementType: "diamond",   width: 140, height: 80,  roundness: null },
  // Composite shapes — rendered with multiple line segments
  subroutine:     { elementType: "rectangle", width: 180, height: 60,  roundness: null, composite: "subroutine" },
  parallelogram:  { elementType: "rectangle", width: 180, height: 60,  roundness: null, composite: "parallelogram" },
  parallelogram_alt: { elementType: "rectangle", width: 180, height: 60, roundness: null, composite: "parallelogram_alt" },
  trapezoid:      { elementType: "rectangle", width: 180, height: 60,  roundness: null, composite: "trapezoid" },
  trapezoid_alt:  { elementType: "rectangle", width: 180, height: 60,  roundness: null, composite: "trapezoid_alt" },
  double_circle:  { elementType: "ellipse",   width: 90,  height: 90,  roundness: null, composite: "double_circle" },
  // Single primitive approximations
  asymmetric:     { elementType: "rectangle", width: 180, height: 60,  roundness: null },
  subgraph:       { elementType: "rectangle", width: 200, height: 120, roundness: null, strokeDash: true },
  stateStart:     { elementType: "ellipse",   width: 30,  height: 30,  roundness: null },
  stateEnd:       { elementType: "ellipse",   width: 30,  height: 30,  roundness: null },
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

/**
 * Return the default width and height for a given Mermaid node shape.
 *
 * This is the **single source of truth** for shape dimensions across the
 * entire diagram engine. Both the canvas generator (via `getShapeProps`) and
 * the placement engine must use this function — never a local lookup table.
 *
 * Unknown / future shapes fall back to the rectangle default (180×60).
 *
 * @requirement H0-01a — single source of truth for shape dimensions
 */
export function getShapeDimensions(shape: NodeShape): { w: number; h: number } {
  const props = getShapeProps(shape);
  return { w: props.width, h: props.height };
}
