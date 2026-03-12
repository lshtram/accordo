/**
 * A8 — Shape map tests
 *
 * Tests cover the public contract of getShapeProps() in canvas/shape-map.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * Requirements: diag_arch_v4.2.md §9.2
 * Requirement IDs: SM-01 through SM-15
 */

// API checklist:
// ✓ getShapeProps — 15 tests (SM-01..SM-15)
//   covered shapes: rectangle, rounded, diamond, circle, ellipse, cylinder,
//   stadium, hexagon, parallelogram, subgraph, unknown fallback.
//   covered properties: elementType, width, height, roundness (null vs >0),
//   strokeDash (subgraph only), roundness ordering (stadium >= rounded),
//   structural completeness of returned ShapeProps.

import { describe, it, expect } from "vitest";
import { getShapeProps } from "../canvas/shape-map.js";
import type { ShapeProps } from "../canvas/shape-map.js";

describe("getShapeProps (A8 — shape map)", () => {
  // SM-01: "rectangle" → rectangle, 180×60, no rounding
  it("SM-01: 'rectangle' → elementType 'rectangle', 180×60, roundness null", () => {
    const p = getShapeProps("rectangle");
    expect(p.elementType).toBe("rectangle");
    expect(p.width).toBe(180);
    expect(p.height).toBe(60);
    expect(p.roundness).toBeNull();
  });

  // SM-02: "rounded" → rectangle, 180×60, roundness > 0
  it("SM-02: 'rounded' → elementType 'rectangle', 180×60, roundness > 0", () => {
    const p = getShapeProps("rounded");
    expect(p.elementType).toBe("rectangle");
    expect(p.width).toBe(180);
    expect(p.height).toBe(60);
    expect(p.roundness).not.toBeNull();
    expect(p.roundness!).toBeGreaterThan(0);
  });

  // SM-03: "diamond" → diamond, 140×80
  it("SM-03: 'diamond' → elementType 'diamond', 140×80", () => {
    const p = getShapeProps("diamond");
    expect(p.elementType).toBe("diamond");
    expect(p.width).toBe(140);
    expect(p.height).toBe(80);
  });

  // SM-04: "circle" → ellipse, 80×80
  it("SM-04: 'circle' → elementType 'ellipse', 80×80", () => {
    const p = getShapeProps("circle");
    expect(p.elementType).toBe("ellipse");
    expect(p.width).toBe(80);
    expect(p.height).toBe(80);
  });

  // SM-05: "ellipse" → ellipse, 80×80
  it("SM-05: 'ellipse' → elementType 'ellipse', 80×80", () => {
    const p = getShapeProps("ellipse");
    expect(p.elementType).toBe("ellipse");
    expect(p.width).toBe(80);
    expect(p.height).toBe(80);
  });

  // SM-06: "cylinder" → rectangle, 120×80 (diag.1 approximation)
  it("SM-06: 'cylinder' → elementType 'rectangle', 120×80", () => {
    const p = getShapeProps("cylinder");
    expect(p.elementType).toBe("rectangle");
    expect(p.width).toBe(120);
    expect(p.height).toBe(80);
  });

  // SM-07: "stadium" → rectangle, 180×60, large roundness > 0
  it("SM-07: 'stadium' → elementType 'rectangle', 180×60, roundness > 0", () => {
    const p = getShapeProps("stadium");
    expect(p.elementType).toBe("rectangle");
    expect(p.width).toBe(180);
    expect(p.height).toBe(60);
    expect(p.roundness!).toBeGreaterThan(0);
  });

  // SM-08: "hexagon" → diamond, 140×80 (diag.1 approximation)
  it("SM-08: 'hexagon' → elementType 'diamond', 140×80 (diag.1 approximation)", () => {
    const p = getShapeProps("hexagon");
    expect(p.elementType).toBe("diamond");
    expect(p.width).toBe(140);
    expect(p.height).toBe(80);
  });

  // SM-09: "parallelogram" → rectangle, 180×60 (diag.1 approximation)
  it("SM-09: 'parallelogram' → elementType 'rectangle', 180×60 (diag.1 approximation)", () => {
    const p = getShapeProps("parallelogram");
    expect(p.elementType).toBe("rectangle");
    expect(p.width).toBe(180);
    expect(p.height).toBe(60);
  });

  // SM-10: "subgraph" → rectangle, 200×120, strokeDash true
  it("SM-10: 'subgraph' → elementType 'rectangle', 200×120, strokeDash true", () => {
    const p = getShapeProps("subgraph");
    expect(p.elementType).toBe("rectangle");
    expect(p.width).toBe(200);
    expect(p.height).toBe(120);
    expect(p.strokeDash).toBe(true);
  });

  // SM-11: unknown shape → fallback rectangle, 180×60
  it("SM-11: unknown shape string → fallback 'rectangle', 180×60", () => {
    const p = getShapeProps("some-future-shape");
    expect(p.elementType).toBe("rectangle");
    expect(p.width).toBe(180);
    expect(p.height).toBe(60);
  });

  // SM-12: "rectangle" is not dashed
  it("SM-12: 'rectangle' → strokeDash is falsy", () => {
    const p = getShapeProps("rectangle");
    expect(p.strokeDash).toBeFalsy();
  });

  // SM-13: "diamond" has crisp corners
  it("SM-13: 'diamond' → roundness null (crisp corners)", () => {
    const p = getShapeProps("diamond");
    expect(p.roundness).toBeNull();
  });

  // SM-14: "stadium" roundness >= "rounded" roundness (stadium is more curved)
  it("SM-14: 'stadium' roundness >= 'rounded' roundness", () => {
    const rounded = getShapeProps("rounded");
    const stadium = getShapeProps("stadium");
    expect(stadium.roundness!).toBeGreaterThanOrEqual(rounded.roundness!);
  });

  // SM-15: returned ShapeProps has all required fields
  it("SM-15: returned ShapeProps has all required fields (elementType, width, height, roundness)", () => {
    const p: ShapeProps = getShapeProps("rectangle");
    expect(p).toHaveProperty("elementType");
    expect(p).toHaveProperty("width");
    expect(p).toHaveProperty("height");
    expect("roundness" in p).toBe(true); // present and may be null
  });
});
