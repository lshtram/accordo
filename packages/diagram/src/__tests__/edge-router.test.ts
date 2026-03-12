/**
 * A9 — Edge router tests
 *
 * Tests cover the public contract of routeEdge() in canvas/edge-router.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * Coordinate convention: points and bounding boxes are all in absolute canvas
 * coordinates. The canvas generator normalises points relative to the element
 * origin when constructing the Excalidraw element.
 *
 * Requirements: diag_arch_v4.2.md §9.3, §9.4
 * Requirement IDs: ER-01 through ER-15
 */

// API checklist:
// ✓ routeEdge — 15 tests (ER-01..ER-15)
//   covered routing modes: "auto", "direct", "orthogonal", unknown fallback.
//   covered paths: no waypoints, 1 waypoint, 2 waypoints, self-loop,
//   horizontally aligned, vertically aligned, overlapping boxes, diagonal.
//   covered invariants: ≥2 points for all modes, binding presence/absence,
//   startBinding/endBinding .gap ≥ 0, focus ∈ [-1,1], unknown routing no-throw.

import { describe, it, expect } from "vitest";
import { routeEdge } from "../canvas/edge-router.js";
import type { BoundingBox } from "../canvas/edge-router.js";

// ── Standard bounding boxes ───────────────────────────────────────────────────

/** Node on the left side of the canvas. */
const LEFT: BoundingBox = { x: 0, y: 100, w: 180, h: 60 };
/** Node to the right of LEFT, same row. */
const RIGHT: BoundingBox = { x: 300, y: 100, w: 180, h: 60 };
/** Node below LEFT. */
const BELOW: BoundingBox = { x: 0, y: 300, w: 180, h: 60 };
/** Node diagonally positioned. */
const DIAG: BoundingBox = { x: 300, y: 300, w: 180, h: 60 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("routeEdge (A9 — edge router)", () => {
  // ER-01: "auto" no waypoints → exactly 2 points, both bindings set
  it("ER-01: 'auto' with no waypoints → 2 points, startBinding and endBinding non-null", () => {
    const result = routeEdge("auto", [], LEFT, RIGHT);
    expect(result.points).toHaveLength(2);
    expect(result.startBinding).not.toBeNull();
    expect(result.endBinding).not.toBeNull();
  });

  // ER-02: "auto" self-loop (source === target) → valid multi-point loop path
  it("ER-02: 'auto' self-loop (source === target) → at least 4 points for loop", () => {
    const result = routeEdge("auto", [], LEFT, LEFT);
    expect(result.points.length).toBeGreaterThanOrEqual(4);
  });

  // ER-03: "direct" no waypoints → exactly 2 points, both bindings null
  it("ER-03: 'direct' with no waypoints → 2 points, bindings null", () => {
    const result = routeEdge("direct", [], LEFT, RIGHT);
    expect(result.points).toHaveLength(2);
    expect(result.startBinding).toBeNull();
    expect(result.endBinding).toBeNull();
  });

  // ER-04: "direct" with 2 waypoints → 4-point path
  it("ER-04: 'direct' with 2 waypoints → 4 points total", () => {
    const waypoints = [{ x: 100, y: 200 }, { x: 200, y: 200 }];
    const result = routeEdge("direct", waypoints, LEFT, RIGHT);
    expect(result.points).toHaveLength(4);
  });

  // ER-05: "orthogonal" between offset nodes → at least 3 points (L-shape)
  it("ER-05: 'orthogonal' between offset source and target → at least 3 points", () => {
    const result = routeEdge("orthogonal", [], LEFT, DIAG);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  // ER-06: "orthogonal" top-to-bottom → at least 3 points
  it("ER-06: 'orthogonal' top-to-bottom → at least 3 points", () => {
    const result = routeEdge("orthogonal", [], LEFT, BELOW);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  // ER-07: "orthogonal" with one waypoint → at least as many points as without
  it("ER-07: 'orthogonal' with one waypoint → equal or more points than without", () => {
    const noWp = routeEdge("orthogonal", [], LEFT, DIAG);
    const withWp = routeEdge("orthogonal", [{ x: 150, y: 200 }], LEFT, DIAG);
    expect(withWp.points.length).toBeGreaterThanOrEqual(noWp.points.length);
  });

  // ER-08: "orthogonal" overlapping boxes → valid non-zero-length path (no throw)
  it("ER-08: 'orthogonal' with overlapping bounding boxes → valid non-zero-length path", () => {
    const box1: BoundingBox = { x: 0, y: 0, w: 180, h: 60 };
    const box2: BoundingBox = { x: 50, y: 10, w: 180, h: 60 }; // overlapping
    const result = routeEdge("orthogonal", [], box1, box2);
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    // First and last points must differ (non-degenerate path)
    const first = result.points[0]!;
    const last = result.points[result.points.length - 1]!;
    expect(Math.hypot(last[0] - first[0], last[1] - first[1])).toBeGreaterThan(0);
  });

  // ER-09: all routing modes return at least 2 points (basic structural invariant)
  it("ER-09: all routing modes return at least 2 points", () => {
    for (const routing of ["auto", "direct", "orthogonal"] as const) {
      const result = routeEdge(routing, [], LEFT, RIGHT);
      expect(result.points.length, `routing: ${routing}`).toBeGreaterThanOrEqual(2);
    }
  });

  // ER-10: startBinding.gap >= 0 for "auto"
  it("ER-10: 'auto' startBinding.gap >= 0 (arrow does not penetrate source node)", () => {
    const result = routeEdge("auto", [], LEFT, RIGHT);
    expect(result.startBinding!.gap).toBeGreaterThanOrEqual(0);
  });

  // ER-11: endBinding.gap >= 0 for "auto"
  it("ER-11: 'auto' endBinding.gap >= 0 (arrow does not penetrate target node)", () => {
    const result = routeEdge("auto", [], LEFT, RIGHT);
    expect(result.endBinding!.gap).toBeGreaterThanOrEqual(0);
  });

  // ER-12: "auto" binding focus values are within [-1, 1]
  it("ER-12: 'auto' binding focus values are within [-1, 1]", () => {
    const result = routeEdge("auto", [], LEFT, DIAG);
    expect(result.startBinding!.focus).toBeGreaterThanOrEqual(-1);
    expect(result.startBinding!.focus).toBeLessThanOrEqual(1);
    expect(result.endBinding!.focus).toBeGreaterThanOrEqual(-1);
    expect(result.endBinding!.focus).toBeLessThanOrEqual(1);
  });

  // ER-13: "direct" with one waypoint → exactly 3 points
  it("ER-13: 'direct' with 1 waypoint → 3 points total", () => {
    const result = routeEdge("direct", [{ x: 200, y: 150 }], LEFT, RIGHT);
    expect(result.points).toHaveLength(3);
  });

  // ER-14: "auto" horizontally aligned nodes → valid 2-point path, bindings set
  it("ER-14: 'auto' horizontally aligned nodes (same y) → 2 points, bindings set", () => {
    // Both nodes at the same y — should still produce a valid path
    const result = routeEdge("auto", [], LEFT, RIGHT);
    expect(result.points).toHaveLength(2);
    expect(result.startBinding).not.toBeNull();
    expect(result.endBinding).not.toBeNull();
  });

  // ER-15: unknown routing string → falls back gracefully (no throw, >= 2 points)
  it("ER-15: unknown routing string → falls back to auto-like behaviour (no throw)", () => {
    const result = routeEdge("future-routing-mode", [], LEFT, RIGHT);
    expect(result.points.length).toBeGreaterThanOrEqual(2);
  });
});
