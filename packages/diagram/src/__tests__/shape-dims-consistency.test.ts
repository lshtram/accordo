/**
 * H0-01c — Cross-module shape-dimension consistency test
 *
 * Locks the single-source-of-truth invariant: getShapeDimensions() in
 * shape-map.ts must return identical { w, h } for every shape that
 * placement.ts previously hardcoded in its own SHAPE_DIMS table.
 *
 * Pattern: call function directly, assert real requirement outcomes.
 * In RED state the stub throws → vitest reports an uncaught exception
 * (test body throws) → test fails. In GREEN state function returns the
 * correct value → assertions pass.
 *
 * Requirements: requirements-diagram-hardening.md §H0-01
 * Requirement IDs: H0-01c
 */

import { describe, it, expect } from "vitest";
import { getShapeDimensions } from "../canvas/shape-map.js";

// Shapes that appear in placement.ts SHAPE_DIMS (the duplicated table).
// These must all match exactly — any drift is a contract violation.
const PLACEMENT_SHAPE_DIMS: Array<{ shape: string; w: number; h: number }> = [
  { shape: "rectangle",     w: 180, h: 60 },
  { shape: "rounded",       w: 180, h: 60 },
  { shape: "stadium",       w: 180, h: 60 },
  { shape: "parallelogram", w: 180, h: 60 },
  { shape: "diamond",       w: 140, h: 80 },
  { shape: "hexagon",       w: 140, h: 80 },
  { shape: "circle",        w: 80,  h: 80 },
  { shape: "ellipse",       w: 80,  h: 80 },
  { shape: "cylinder",      w: 120, h: 80 },
  { shape: "subgraph",      w: 200, h: 120 },
];

describe("H0-01c: getShapeDimensions must match every shape previously in placement SHAPE_DIMS", () => {
  for (const { shape, w, h } of PLACEMENT_SHAPE_DIMS) {
    it(`H0-01c: '${shape}' → w=${w}, h=${h} (matches old placement table)`, () => {
      // Call the function directly. RED: stub throws → test body throws →
      // vitest marks test failed (not an assertion on error type). GREEN:
      // function returns { w, h } → assertions verify exact values.
      const dims = getShapeDimensions(shape);
      expect(dims.w).toBe(w);
      expect(dims.h).toBe(h);
    });
  }

  it("H0-01c: unknown shape falls back to rectangle dimensions (180×60)", () => {
    const dims = getShapeDimensions("future-unknown-shape");
    expect(dims.w).toBe(180);
    expect(dims.h).toBe(60);
  });

  it("H0-01c: returned object has w and h as own numeric properties", () => {
    const dims = getShapeDimensions("rectangle");
    // Verify both w and h are own properties of the returned object
    expect(Object.prototype.hasOwnProperty.call(dims, "w")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(dims, "h")).toBe(true);
    expect(typeof dims.w).toBe("number");
    expect(typeof dims.h).toBe("number");
  });
});
