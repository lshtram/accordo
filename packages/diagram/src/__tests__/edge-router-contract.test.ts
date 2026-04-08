/**
 * H0-03: Orthogonal routing point-count contract tests
 *
 * H0-03a: routeEdge returns exact point counts per routing mode:
 *          auto = 2, direct = 2+N, orthogonal ≥ 3, self-loop = 4
 * H0-03b: Orthogonal routing enforces ≥ 3 points post-condition.
 * H0-03c: Contract tests cover every mode × waypoint combination:
 *          auto, direct/0wp, direct/2wp, orthogonal/0wp, orthogonal/1wp,
 *          orthogonal/2+wp, self-loop
 *
 * Contract assertions (exact counts) are used where the contract explicitly
 * specifies them. For orthogonal 2+ waypoints, the requirement specifies
 * ≥ 3 points — not a specific algorithm-internal count — so we test the
 * lower bound and axis-aligned segment invariants instead.
 *
 * RED/GREEN: All tests pass on current implementation (H0-03 contract was
 * already satisfied by the Phase A stubs). These tests lock in the invariant.
 *
 * Requirements: requirements-diagram-hardening.md §H0-03
 * Requirement IDs: H0-03a, H0-03b, H0-03c
 */

import { describe, it, expect } from "vitest";
import { routeEdge } from "../canvas/edge-router.js";
import type { BoundingBox } from "../canvas/edge-router.js";

// ── Standard bounding boxes ───────────────────────────────────────────────────

const LEFT: BoundingBox = { x: 0,   y: 100, w: 180, h: 60 };
const RIGHT: BoundingBox = { x: 300, y: 100, w: 180, h: 60 };
const BELOW: BoundingBox = { x: 0,   y: 300, w: 180, h: 60 };
const DIAG: BoundingBox = { x: 300, y: 300, w: 180, h: 60 };

// ── H0-03a: Exact point counts per routing mode ────────────────────────────────

describe("H0-03a: routeEdge returns correct point count per routing mode", () => {
  // auto: exactly 2 points (start centre-edge, end centre-edge)
  it("H0-03a: 'auto' with no waypoints → exactly 2 points", () => {
    const result = routeEdge("auto", [], LEFT, RIGHT);
    expect(result.points).toHaveLength(2);
  });

  // auto with waypoints — waypoints are ignored in auto mode, still 2 points
  it("H0-03a: 'auto' with waypoints (ignored) → exactly 2 points", () => {
    const result = routeEdge("auto", [{ x: 150, y: 200 }], LEFT, RIGHT);
    expect(result.points).toHaveLength(2);
  });

  // direct: 2 + N waypoints
  it("H0-03a: 'direct' with 0 waypoints → exactly 2 points", () => {
    const result = routeEdge("direct", [], LEFT, RIGHT);
    expect(result.points).toHaveLength(2);
  });

  it("H0-03a: 'direct' with 1 waypoint → exactly 3 points", () => {
    const result = routeEdge("direct", [{ x: 200, y: 150 }], LEFT, RIGHT);
    expect(result.points).toHaveLength(3);
  });

  it("H0-03a: 'direct' with 2 waypoints → exactly 4 points", () => {
    const result = routeEdge("direct", [{ x: 100, y: 200 }, { x: 200, y: 200 }], LEFT, RIGHT);
    expect(result.points).toHaveLength(4);
  });

  // orthogonal: ≥ 3 points (L-shape with 0 waypoints = 3 points)
  it("H0-03a: 'orthogonal' with 0 waypoints → exactly 3 points (L-shape)", () => {
    const result = routeEdge("orthogonal", [], LEFT, DIAG);
    expect(result.points).toHaveLength(3);
  });

  // orthogonal with 1 waypoint = 4 points (bend)
  it("H0-03a: 'orthogonal' with 1 waypoint → exactly 4 points (single bend)", () => {
    const result = routeEdge("orthogonal", [{ x: 150, y: 200 }], LEFT, DIAG);
    expect(result.points).toHaveLength(4);
  });

  // orthogonal with 2+ waypoints — contract is ≥ 3 points (Z-shape minimum).
  // The exact algorithm-internal count (7 points) is not part of the public
  // contract; we assert the lower bound and axis-aligned segment quality.
  it("H0-03a: 'orthogonal' with 2 waypoints → ≥ 3 points (Z-shape lower bound)", () => {
    const result = routeEdge("orthogonal", [{ x: 150, y: 200 }, { x: 300, y: 250 }], LEFT, DIAG);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  it("H0-03a: 'orthogonal' with 3 waypoints → ≥ 3 points (staircase lower bound)", () => {
    const result = routeEdge(
      "orthogonal",
      [{ x: 150, y: 200 }, { x: 250, y: 250 }, { x: 350, y: 280 }],
      LEFT,
      DIAG
    );
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  // self-loop: exactly 4 points
  it("H0-03a: self-loop (source === target) via 'auto' → exactly 4 points", () => {
    const result = routeEdge("auto", [], LEFT, LEFT);
    expect(result.points).toHaveLength(4);
  });

  it("H0-03a: self-loop with 'orthogonal' routing → exactly 4 points", () => {
    const result = routeEdge("orthogonal", [], LEFT, LEFT);
    expect(result.points).toHaveLength(4);
  });

  it("H0-03a: self-loop with 'direct' routing → exactly 4 points", () => {
    const result = routeEdge("direct", [], LEFT, LEFT);
    expect(result.points).toHaveLength(4);
  });
});

// ── H0-03b: Orthogonal post-condition ≥ 3 points enforced ───────────────────

describe("H0-03b: orthogonal routing enforces ≥ 3 points post-condition", () => {
  it("H0-03b: 'orthogonal' between horizontally aligned nodes → ≥ 3 points", () => {
    const result = routeEdge("orthogonal", [], LEFT, RIGHT);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  it("H0-03b: 'orthogonal' between vertically aligned nodes → ≥ 3 points", () => {
    const result = routeEdge("orthogonal", [], LEFT, BELOW);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  it("H0-03b: 'orthogonal' top-to-bottom → ≥ 3 points", () => {
    const result = routeEdge("orthogonal", [], { x: 0, y: 0, w: 180, h: 60 }, { x: 0, y: 300, w: 180, h: 60 });
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  it("H0-03b: 'orthogonal' with overlapping boxes → ≥ 3 points (no degenerate output)", () => {
    const box1: BoundingBox = { x: 0, y: 0, w: 180, h: 60 };
    const box2: BoundingBox = { x: 50, y: 10, w: 180, h: 60 };
    const result = routeEdge("orthogonal", [], box1, box2);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  it("H0-03b: 'orthogonal' result always has ≥ 3 points regardless of waypoint count", () => {
    const waypointCounts = [0, 1, 2, 3, 5];
    for (const count of waypointCounts) {
      const waypoints = Array.from({ length: count }, (_, i) => ({
        x: 100 + i * 50,
        y: 150 + i * 30,
      }));
      const result = routeEdge("orthogonal", waypoints, LEFT, DIAG);
      expect(
        result.points.length,
        `orthogonal with ${count} waypoints returned ${result.points.length} points (expected ≥ 3)`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  // Algorithm-quality invariant: all orthogonal path segments are axis-aligned
  it("H0-03b: orthogonal multi-waypoint path has only axis-aligned segments", () => {
    const waypoints = [{ x: 150, y: 200 }, { x: 300, y: 250 }];
    const result = routeEdge("orthogonal", waypoints, LEFT, DIAG);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < result.points.length - 1; i++) {
      const [x1, y1] = result.points[i]!;
      const [x2, y2] = result.points[i + 1]!;
      const isHorizontal = y1 === y2;
      const isVertical = x1 === x2;
      expect(
        isHorizontal || isVertical,
        `segment ${i}→${i + 1} is diagonal: (${x1},${y1})→(${x2},${y2})`
      ).toBe(true);
    }
  });

  // Endpoints are source and target centres
  it("H0-03b: orthogonal path endpoints are source and target centres", () => {
    const waypoints = [{ x: 150, y: 200 }, { x: 300, y: 250 }];
    const result = routeEdge("orthogonal", waypoints, LEFT, DIAG);
    const [sx, sy] = [LEFT.x + LEFT.w / 2, LEFT.y + LEFT.h / 2];
    const [tx, ty] = [DIAG.x + DIAG.w / 2, DIAG.y + DIAG.h / 2];
    expect(result.points[0]).toEqual([sx, sy]);
    expect(result.points[result.points.length - 1]).toEqual([tx, ty]);
  });
});

// ── H0-03c: Full mode × waypoint combination matrix ──────────────────────────

describe("H0-03c: routeEdge point-count contract matrix (every mode × waypoint combination)", () => {
  // Self-loop — special case, ignores waypoints
  it("H0-03c: self-loop via 'auto' → exactly 4 points", () => {
    const result = routeEdge("auto", [], LEFT, LEFT);
    expect(result.points).toHaveLength(4);
  });

  // Unknown routing → falls back to auto (2 points)
  it("H0-03c: unknown routing string → falls back to auto (2 points)", () => {
    const result = routeEdge("future-routing-mode", [], LEFT, RIGHT);
    expect(result.points).toHaveLength(2);
  });

  // All routing modes return at least 2 points (basic invariant)
  it("H0-03c: all routing modes return at least 2 points", () => {
    for (const routing of ["auto", "direct", "orthogonal", "curved"] as const) {
      const result = routeEdge(routing, [], LEFT, RIGHT);
      expect(result.points.length, `routing: ${routing}`).toBeGreaterThanOrEqual(2);
    }
  });

  // all modes × 0 waypoints — exact counts where contract specifies them
  const modes0wp: Array<[string, number]> = [
    ["auto",        2],
    ["direct",      2],
    ["orthogonal",  3],
  ];
  for (const [mode, expectedPoints] of modes0wp) {
    it(`H0-03c: '${mode}' / 0 wp → ${expectedPoints} points`, () => {
      const result = routeEdge(mode, [], LEFT, RIGHT);
      expect(result.points).toHaveLength(expectedPoints);
    });
  }

  // direct × N waypoints — exact count = 2 + N
  const directWpCounts: Array<[number, number]> = [
    [0, 2],
    [1, 3],
    [2, 4],
    [3, 5],
  ];
  for (const [wpCount, expectedPoints] of directWpCounts) {
    it(`H0-03c: 'direct' / ${wpCount} wp → ${expectedPoints} points`, () => {
      const waypoints = Array.from({ length: wpCount }, (_, i) => ({
        x: 100 + i * 50,
        y: 150 + i * 30,
      }));
      const result = routeEdge("direct", waypoints, LEFT, RIGHT);
      expect(result.points).toHaveLength(expectedPoints);
    });
  }

  // orthogonal × N waypoints — contract lower bound is ≥ 3 for all N.
  // Exact counts for N=0 and N=1 are contract-specified (L-shape=3, bend=4).
  // For N≥2 the contract says ≥ 3 — we assert only the lower bound.
  const orthogonalWpCounts: Array<[number, number]> = [
    [0, 3],   // L-shape — exact count per contract
    [1, 4],   // single bend — exact count per contract
    // N=2, N=3: contract is ≥ 3; test the lower bound to avoid brittleness
  ];
  for (const [wpCount, expectedPoints] of orthogonalWpCounts) {
    it(`H0-03c: 'orthogonal' / ${wpCount} wp → exactly ${expectedPoints} points (contract-specified)`, () => {
      const waypoints = Array.from({ length: wpCount }, (_, i) => ({
        x: 100 + i * 50,
        y: 150 + i * 30,
      }));
      const result = routeEdge("orthogonal", waypoints, LEFT, DIAG);
      expect(result.points).toHaveLength(expectedPoints);
    });
  }

  it("H0-03c: 'orthogonal' / 2 wp → at least 3 points (contract lower bound)", () => {
    const waypoints = [{ x: 150, y: 200 }, { x: 300, y: 250 }];
    const result = routeEdge("orthogonal", waypoints, LEFT, DIAG);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  it("H0-03c: 'orthogonal' / 3 wp → at least 3 points (contract lower bound)", () => {
    const waypoints = [
      { x: 150, y: 200 },
      { x: 250, y: 250 },
      { x: 350, y: 280 },
    ];
    const result = routeEdge("orthogonal", waypoints, LEFT, DIAG);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });
});
