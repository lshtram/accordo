/**
 * G-3 — Comment pins track diagram viewport movement
 *
 * Tests that repositionPins() calls sdk.reposition() (in-place style.left/top updates)
 * rather than sdk.loadThreads() (which does destructive DOM recreation causing flicker).
 *
 * Requirements: G-3 (diag_workplan.md §4.16 — A18-W04 pin re-render on scroll/zoom)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCommentsLoad, repositionPins, sdk } from "../webview/comment-overlay.js";
import type { SdkThread } from "@accordo/comment-sdk";

/**
 * Mock the AccordoCommentSDK module so we can spy on reposition without
 * needing the real SDK DOM initialization (init() requires a canvas container).
 */
vi.mock("@accordo/comment-sdk", () => ({
  AccordoCommentSDK: vi.fn(() => ({
    init: vi.fn(),
    loadThreads: vi.fn(),
    reposition: vi.fn(),
    openPopover: vi.fn(),
  })),
}));

describe("repositionPins (G-3 — viewport pin tracking)", () => {
  beforeEach(() => {
    vi.mocked(sdk.reposition).mockClear();
  });

  // G3-T1: repositionPins calls sdk.reposition() (not loadThreads) for in-place updates
  // DR-1 fix: Using sdk.reposition() avoids DOM recreation and visible flicker at 60fps.
  it("G3-T1: repositionPins calls sdk.reposition() for in-place pin updates", () => {
    // Clear any prior calls
    vi.mocked(sdk.reposition).mockClear();
    vi.mocked(sdk.loadThreads).mockClear();

    // handleCommentsLoad calls sdk.loadThreads() to load threads (correct behavior)
    handleCommentsLoad([
      {
        id: "thread-1",
        anchor: {
          kind: "surface",
          uri: "file:///test.mmd",
          surfaceType: "diagram",
          coordinates: { nodeId: "node:A" },
        },
        status: "open",
        comments: [
          {
            id: "c1",
            author: { kind: "user", name: "Alice" },
            body: "Comment on A",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ]);

    // Verify loadThreads was called once by handleCommentsLoad
    expect(vi.mocked(sdk.loadThreads)).toHaveBeenCalledTimes(1);
    vi.mocked(sdk.loadThreads).mockClear();

    // repositionPins should call sdk.reposition() (not loadThreads)
    repositionPins();

    expect(vi.mocked(sdk.reposition)).toHaveBeenCalledTimes(1);
    // loadThreads should NOT be called by repositionPins
    expect(vi.mocked(sdk.loadThreads)).not.toHaveBeenCalled();
  });
});

describe("repositionPins empty state (G-3 — viewport pin tracking)", () => {
  // G3-T2: repositionPins is safe to call with no threads loaded
  it("G3-T2: repositionPins does not throw when no threads are loaded", () => {
    // handleCommentsLoad with empty array clears currentSdkThreads to []
    handleCommentsLoad([]);
    expect(() => repositionPins()).not.toThrow();
  });
});

/**
 * G-2 — Edge hit-testing geometry helpers
 *
 * Tests hitsEdgePolyline() and edgePolylineMidpoint() — the two named, exported
 * geometry helpers extracted from comment-overlay.ts.
 *
 * All tests are pure geometry — no DOM, no mocks needed.
 *
 * Requirements: docs/reviews/g2-edge-hit-testing-phase2.md §8
 */

import { describe, it, expect } from "vitest";
import { hitsEdgePolyline, edgePolylineMidpoint, EDGE_HIT_THRESHOLD } from "../webview/comment-overlay-geometry.js";

/** Threshold squared for use in assertions (avoids sqrt). */
const THRESHOLD_SQ = EDGE_HIT_THRESHOLD * EDGE_HIT_THRESHOLD;

describe("hitsEdgePolyline (G-2 — edge hit-testing)", () => {
  // G2-T1: Horizontal arrow — click on midpoint → hit
  it("G2-T1: horizontal arrow — click exactly on midpoint of segment → hit", () => {
    // Element at origin (0,0), horizontal line from (0,0) to (100,0)
    // Midpoint = (50, 0)
    const el = { x: 0, y: 0, points: [[0, 0], [100, 0]] as [number, number][] };
    expect(hitsEdgePolyline(50, 0, el)).toBe(true);
  });

  // G2-T2: Horizontal arrow — click far away → miss
  it("G2-T2: horizontal arrow — click 20px away from segment → miss", () => {
    const el = { x: 0, y: 0, points: [[0, 0], [100, 0]] as [number, number][] };
    // 20px perpendicular distance — well beyond the 8px threshold
    expect(hitsEdgePolyline(50, 20, el)).toBe(false);
  });

  // G2-T3: Diagonal arrow — click on midpoint → hit
  it("G2-T3: diagonal arrow — click on midpoint of diagonal segment → hit", () => {
    // Diagonal from (0,0) to (100,100) — midpoint (50,50)
    const el = { x: 0, y: 0, points: [[0, 0], [100, 100]] as [number, number][] };
    expect(hitsEdgePolyline(50, 50, el)).toBe(true);
  });

  // G2-T4: Diagonal arrow — click far away → miss
  it("G2-T4: diagonal arrow — click 20px perpendicular distance away → miss", () => {
    // Point (50, 30) is ~14px away from diagonal y=x — beyond 8px threshold
    const el = { x: 0, y: 0, points: [[0, 0], [100, 100]] as [number, number][] };
    expect(hitsEdgePolyline(50, 30, el)).toBe(false);
  });

  // G2-T5: Self-loop — click on visible part → hit
  // Self-loop with 4 points: bottom → right → top → left → bottom (clockwise)
  // Absolute points (el=50,50): P0=(50,80), P1=(80,50), P2=(50,20), P3=(20,50), P4=(50,80)
  // Each segment ≈ √(30²+30²) ≈ 42.43px; total loop ≈ 169.7px; half ≈ 84.85px
  // Midpoint lands at P2=(50,20) absolute=(100,70)
  it("G2-T5: self-loop — click on P2 apex of right arc → hit", () => {
    const el = {
      x: 50,
      y: 50,
      points: [
        [0, 30], [30, 0], [0, -30], [-30, 0], [0, 30],
      ] as [number, number][],
    };
    // Click exactly at P2=(50,20) which is on the polyline
    expect(hitsEdgePolyline(50, 20, el)).toBe(true);
  });

  // G2-T6: Self-loop — click far away → miss
  it("G2-T6: self-loop — click far from any loop segment → miss", () => {
    const el = {
      x: 50,
      y: 50,
      points: [
        [0, 30], [30, 0], [0, -30], [-30, 0], [0, 30],
      ] as [number, number][],
    };
    // Click at (1000, 1000) — nowhere near the loop
    expect(hitsEdgePolyline(1000, 1000, el)).toBe(false);
  });

  // G2-T7: Arrow with only 2 points — midpoint = geometric midpoint
  it("G2-T7: 2-point arrow — midpoint of polyline equals geometric midpoint", () => {
    const el = { x: 0, y: 0, points: [[0, 0], [200, 0]] as [number, number][] };
    const mid = edgePolylineMidpoint(el);
    // Midpoint of (0,0)→(200,0) is (100,0)
    expect(mid.x).toBe(100);
    expect(mid.y).toBe(0);
  });

  // G2-T8: Edge element with absent/empty points → graceful no-hit
  it("G2-T8: absent points → returns false (no crash)", () => {
    const el = { x: 0, y: 0 } as { x: number; y: number; points?: [number, number][] };
    expect(hitsEdgePolyline(0, 0, el)).toBe(false);
  });

  it("G2-T8b: empty points array → returns false (no crash)", () => {
    const el = { x: 0, y: 0, points: [] as [number, number][] };
    expect(hitsEdgePolyline(0, 0, el)).toBe(false);
  });

  it("G2-T8c: single-point points array → returns false (no crash)", () => {
    const el = { x: 0, y: 0, points: [[50, 50]] as [number, number][] };
    expect(hitsEdgePolyline(50, 50, el)).toBe(false);
  });

  // Additional boundary tests
  it("edge within threshold on endpoint → hit", () => {
    const el = { x: 0, y: 0, points: [[0, 0], [100, 0]] as [number, number][] };
    expect(hitsEdgePolyline(0, 0, el)).toBe(true); // exactly at start point
  });

  it("click exactly at threshold boundary → miss (boundary is exclusive-ish via sqrt)", () => {
    // At exactly 8px from the segment, squared distance = 64
    // pointSegDistSq returns 64 which is <= 64 so it should hit
    const el = { x: 0, y: 0, points: [[0, 0], [100, 0]] as [number, number][] };
    // Point at x=50, y=8 — perpendicular distance = 8px (exactly threshold)
    expect(hitsEdgePolyline(50, 8, el)).toBe(true);
  });

  it("click just beyond threshold → miss", () => {
    const el = { x: 0, y: 0, points: [[0, 0], [100, 0]] as [number, number][] };
    // At x=50, y=9 — perpendicular distance ≈ 9px > 8px threshold
    expect(hitsEdgePolyline(50, 9, el)).toBe(false);
  });
});

describe("edgePolylineMidpoint (G-2 — edge midpoint)", () => {
  it("G2-T7b: 2-point horizontal → midpoint is geometric midpoint", () => {
    const el = { x: 10, y: 20, points: [[0, 0], [200, 0]] as [number, number][] };
    const mid = edgePolylineMidpoint(el);
    expect(mid.x).toBe(110); // 10 + 100
    expect(mid.y).toBe(20);  // 20 + 0
  });

  it("G2-T3b: 3-point L-shape → midpoint at half total arc length", () => {
    // L-shape: (0,0) → (100,0) → (100,100)
    // Segment 1: 100px, Segment 2: 100px, Total: 200px, Half: 100px
    // Midpoint is 100px along first segment → (100, 0) relative, or (100, 0) absolute since el.x=el.y=0
    const el = { x: 0, y: 0, points: [[0, 0], [100, 0], [100, 100]] as [number, number][] };
    const mid = edgePolylineMidpoint(el);
    expect(mid.x).toBe(100);
    expect(mid.y).toBe(0);
  });

  it("G2-T5b: self-loop → midpoint is arc-length midpoint, lands exactly at P2", () => {
    // 4-point self-loop: (0,30)→(30,0)→(0,-30)→(-30,0)→(0,30)
    // Absolute: P0=(50,80), P1=(80,50), P2=(50,20), P3=(20,50), P4=(50,80)
    // Segments: all √(30²+30²) ≈ 42.43px; total ≈ 169.7px; half ≈ 84.85px.
    // Walk 42.43px (P0→P1) + 42.43px (P1→P2) = 84.85px = exactly half.
    // Midpoint lands exactly at P2 = (50, 20) absolute.
    const el = { x: 50, y: 50, points: [[0, 30], [30, 0], [0, -30], [-30, 0], [0, 30]] as [number, number][] };
    const mid = edgePolylineMidpoint(el);
    // P2 = el + (0,-30) = (50, 20) absolute
    expect(mid.x).toBe(50);
    expect(mid.y).toBe(20);
  });

  it("G2-T8d: absent points → returns el.x, el.y (no crash)", () => {
    const el = { x: 7, y: 13 } as { x: number; y: number; points?: [number, number][] };
    const mid = edgePolylineMidpoint(el);
    expect(mid.x).toBe(7);
    expect(mid.y).toBe(13);
  });

  it("G2-T8e: empty points → returns el.x, el.y (no crash)", () => {
    const el = { x: 7, y: 13, points: [] as [number, number][] };
    const mid = edgePolylineMidpoint(el);
    expect(mid.x).toBe(7);
    expect(mid.y).toBe(13);
  });

  it("G2-T8f: single-point points → returns el.x, el.y (no crash)", () => {
    const el = { x: 7, y: 13, points: [[5, 5]] as [number, number][] };
    const mid = edgePolylineMidpoint(el);
    expect(mid.x).toBe(7);
    expect(mid.y).toBe(13);
  });

  it("zero-length segment (both points same) → does not crash, returns el.x, el.y", () => {
    const el = { x: 0, y: 0, points: [[0, 0], [0, 0]] as [number, number][] };
    const mid = edgePolylineMidpoint(el);
    expect(mid.x).toBe(0);
    expect(mid.y).toBe(0);
  });
});
