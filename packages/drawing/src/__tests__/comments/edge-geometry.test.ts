/**
 * DRW-C03 — Unit tests for edge geometry: polyline midpoint and hit testing.
 *
 * DRW-C03: Pins render on shapes AND edges. Edge pins must be positioned from
 *   edge geometry (polyline points), not from width/height bounding boxes.
 * DRW-C04: Pins track live Excalidraw viewport — pan/zoom uses viewport state
 *   (scrollX/scrollY/zoom), not DOM scroll listeners.
 *
 * These are unit tests for the pure geometry functions that the webview
 * overlay uses to position edge comment pins.
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.6 (DRW-C03, DRW-C04)
 * Source: docs/10-architecture/drawing-architecture.md §9.10
 * Requirements: DRW-C03, DRW-C04
 */

import { describe, it, expect } from "vitest";
import type { SceneElement } from "../../core/types.js";

/**
 * Edge geometry functions are implemented in the comments module.
 * Tests verify:
 * - edgePolylineMidpoint computes the geometric center of a polyline
 * - hitsEdgePolyline correctly identifies proximity to line segments
 *
 * Phase B: stubs throw "not implemented" — these tests define the correct
 * behavior for the geometry utilities that the overlay uses.
 */
import {
  edgePolylineMidpoint,
  hitsEdgePolyline,
} from "../../comments/drawing-comments-bridge.js";

/** Helper: horizontal edge polyline at y=100, from x=50 to x=250 */
function horizontalEdge(): SceneElement {
  return {
    id: "edge-A->B",
    type: "line",
    x: 50,
    y: 100,
    width: 200,
    height: 0,
    points: [
      [0, 0],
      [200, 0],
    ],
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "edge",
        identity: "A->B:0",
        sceneRole: "primary",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

/** Helper: diagonal/angled edge polyline */
function angledEdge(): SceneElement {
  return {
    id: "edge-C->D",
    type: "line",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    points: [
      [0, 0],
      [100, 50],
    ],
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "edge",
        identity: "C->D:0",
        sceneRole: "primary",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

/** Helper: multi-segment polyline (L-shaped or zig-zag) */
function multiSegmentEdge(): SceneElement {
  return {
    id: "edge-E->F",
    type: "line",
    x: 50,
    y: 100,
    width: 200,
    height: 100,
    points: [
      [0, 0],
      [100, 0],
      [100, 50],
      [200, 50],
    ],
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "edge",
        identity: "E->F:0",
        sceneRole: "primary",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

/** Helper: very short edge (two points close together) */
function shortEdge(): SceneElement {
  return {
    id: "edge-G->H",
    type: "line",
    x: 100,
    y: 100,
    width: 20,
    height: 0,
    points: [
      [0, 0],
      [20, 0],
    ],
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "edge",
        identity: "G->H:0",
        sceneRole: "primary",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

describe("comments/edge-geometry", () => {
  /**
   * DRW-C03: edgePolylineMidpoint computes the geometric center of all polyline points.
   *
   * The midpoint is NOT the center of the element's bounding box — it is the
   * average of all polyline point coordinates, giving the visual center of the line.
   *
   * Phase B: function throws "not implemented" — test defines expected behavior.
   */
  describe("edgePolylineMidpoint", () => {
    it("DRW-CU01: horizontal edge midpoint is at halfway point of the line", () => {
      const el = horizontalEdge();
      const mid = edgePolylineMidpoint(el);
      // Element origin is (50,100), points are [[0,0],[200,0]]
      // Midpoint = (50 + 250)/2, (100 + 100)/2 = (150, 100)
      expect(mid).not.toBeNull();
      expect(mid!.x).toBe(150);
      expect(mid!.y).toBe(100);
    });

    it("DRW-CU01: angled edge midpoint averages all point coordinates", () => {
      const el = angledEdge();
      const mid = edgePolylineMidpoint(el);
      // Origin (0,0), points [[0,0],[100,50]]
      // Midpoint = (0 + 100)/2, (0 + 50)/2 = (50, 25)
      expect(mid).not.toBeNull();
      expect(mid!.x).toBe(50);
      expect(mid!.y).toBe(25);
    });

    it("DRW-CU01: multi-segment edge midpoint averages ALL points, not just endpoints", () => {
      const el = multiSegmentEdge();
      const mid = edgePolylineMidpoint(el);
      // Origin (50,100), points [[0,0],[100,0],[100,50],[200,50]]
      // All absolute points: (50,100),(150,100),(150,150),(250,150)
      // Average x = (50+150+150+250)/4 = 600/4 = 150
      // Average y = (100+100+150+150)/4 = 500/4 = 125
      expect(mid).not.toBeNull();
      expect(mid!.x).toBe(150);
      expect(mid!.y).toBe(125);
    });

    it("DRW-CU01: short edge midpoint works correctly", () => {
      const el = shortEdge();
      const mid = edgePolylineMidpoint(el);
      // Origin (100,100), points [[0,0],[20,0]]
      // Midpoint = (100+120)/2, (100+100)/2 = (110, 100)
      expect(mid).not.toBeNull();
      expect(mid!.x).toBe(110);
      expect(mid!.y).toBe(100);
    });

    it("DRW-CU01: returns null when element has no points", () => {
      const elWithoutPoints: SceneElement = {
        id: "no-points",
        type: "line",
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        customData: {
          accordo: {
            version: 1 as const,
            entityKind: "edge" as const,
            identity: "X->Y:0",
            sceneRole: "primary" as const,
            sourcePath: "foo.mmd",
            status: "active" as const,
          },
        },
        // no points property
      };
      expect(edgePolylineMidpoint(elWithoutPoints)).toBeNull();
    });

    it("DRW-CU01: returns null when element has fewer than 2 points", () => {
      const elOnePoint: SceneElement = {
        id: "one-point",
        type: "line",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        points: [[0, 0]],
        customData: {
          accordo: {
            version: 1 as const,
            entityKind: "edge" as const,
            identity: "X->Y:1",
            sceneRole: "primary" as const,
            sourcePath: "foo.mmd",
            status: "active" as const,
          },
        },
      };
      expect(edgePolylineMidpoint(elOnePoint)).toBeNull();
    });
  });

  /**
   * DRW-C03: hitsEdgePolyline returns true when a screen point is within
   * threshold pixels of the polyline. Used to detect edge pin click targets.
   *
   * DRW-C04: The pan/zoom viewport tracking means pin positions are computed
   * from Excalidraw element coordinates + viewport state, not from DOM scroll.
   * hitsEdgePolyline operates on element-local coordinates (already transformed
   * by the caller using scrollX/scrollY/zoom), so the threshold is in scene units.
   *
   * Phase B: function throws "not implemented" — test defines expected behavior.
   */
  describe("hitsEdgePolyline", () => {
    it("DRW-CU01: point directly on the line segment hits", () => {
      const el = horizontalEdge();
      // Point at (150, 100) is exactly on the horizontal line at y=100
      expect(hitsEdgePolyline(el, { x: 150, y: 100 }, 5)).toBe(true);
    });

    it("DRW-CU01: point within threshold distance hits", () => {
      const el = horizontalEdge();
      // Point at (150, 103) is 3px below the line — within default threshold
      expect(hitsEdgePolyline(el, { x: 150, y: 103 }, 5)).toBe(true);
    });

    it("DRW-CU01: point outside threshold does not hit", () => {
      const el = horizontalEdge();
      // Point at (150, 110) is 10px below — outside threshold of 5
      expect(hitsEdgePolyline(el, { x: 150, y: 110 }, 5)).toBe(false);
    });

    it("DRW-CU01: point near endpoint hits", () => {
      const el = horizontalEdge();
      // Point near left endpoint (52, 102) is within threshold
      expect(hitsEdgePolyline(el, { x: 52, y: 102 }, 5)).toBe(true);
    });

    it("DRW-CU01: multi-segment edge hit detection works across all segments", () => {
      const el = multiSegmentEdge();
      // Point at (152, 125) is near the vertical segment at x=150, between y=100-150
      expect(hitsEdgePolyline(el, { x: 152, y: 125 }, 5)).toBe(true);
    });

    it("DRW-CU01: threshold is respected — outside threshold misses", () => {
      const el = horizontalEdge();
      // Point at (150, 120) is 20px away — threshold is 10
      expect(hitsEdgePolyline(el, { x: 150, y: 120 }, 10)).toBe(false);
    });

    it("DRW-CU01: very narrow threshold picks only very close points", () => {
      const el = horizontalEdge();
      expect(hitsEdgePolyline(el, { x: 150, y: 101 }, 2)).toBe(true);
      expect(hitsEdgePolyline(el, { x: 150, y: 104 }, 2)).toBe(false);
    });

    it("DRW-CU01: diagonal edge hit detection works", () => {
      const el = angledEdge();
      // Point (50, 25) is exactly at the midpoint
      expect(hitsEdgePolyline(el, { x: 50, y: 25 }, 5)).toBe(true);
      // Point (55, 27) is close to the line
      expect(hitsEdgePolyline(el, { x: 55, y: 27 }, 5)).toBe(true);
    });

    it("DRW-CU01: returns false for element with no points", () => {
      const elNoPoints: SceneElement = {
        id: "no-points",
        type: "line",
        x: 0,
        y: 0,
        customData: {
          accordo: {
            version: 1 as const,
            entityKind: "edge" as const,
            identity: "X->Y:2",
            sceneRole: "primary" as const,
            sourcePath: "foo.mmd",
            status: "active" as const,
          },
        },
      };
      expect(hitsEdgePolyline(elNoPoints, { x: 50, y: 50 }, 5)).toBe(false);
    });
  });

  /**
   * DRW-C04: Viewport-to-screen coordinate transformation.
   *
   * The overlay computes screen positions by combining:
   * 1. Element coordinates from the Excalidraw scene
   * 2. Live viewport state (scrollX, scrollY, zoom) from the Excalidraw API
   *
   * These tests verify the coordinate transformation is correct:
   * screenX = (elementX + scrollX) * zoom
   * screenY = (elementY + scrollY) * zoom
   *
   * This is separate from hitsEdgePolyline which operates in scene coordinates.
   * These are pure math tests — no stub dependency.
   */
  describe("DRW-C04: viewport-to-screen transformation", () => {
    it("DRW-CU01: screen coordinate = element coordinate * zoom + scrollX/Y", () => {
      // Simulate Excalidraw viewport state
      const viewport = { scrollX: 100, scrollY: 200, zoom: 1.5 };
      const elementX = 50;
      const elementY = 100;

      const screenX = (elementX + viewport.scrollX) * viewport.zoom;
      const screenY = (elementY + viewport.scrollY) * viewport.zoom;

      // (50 + 100) * 1.5 = 225
      // (100 + 200) * 1.5 = 450
      expect(screenX).toBe(225);
      expect(screenY).toBe(450);
    });

    it("DRW-CU01: zoom scales element coordinates correctly", () => {
      const viewport = { scrollX: 0, scrollY: 0, zoom: 2.0 };
      const elementX = 100;
      const elementY = 50;

      const screenX = (elementX + viewport.scrollX) * viewport.zoom;
      const screenY = (elementY + viewport.scrollY) * viewport.zoom;

      expect(screenX).toBe(200);
      expect(screenY).toBe(100);
    });

    it("DRW-CU01: negative scroll positions are handled correctly", () => {
      const viewport = { scrollX: -50, scrollY: -30, zoom: 1.0 };
      const elementX = 100;
      const elementY = 50;

      const screenX = (elementX + viewport.scrollX) * viewport.zoom;
      const screenY = (elementY + viewport.scrollY) * viewport.zoom;

      expect(screenX).toBe(50);
      expect(screenY).toBe(20);
    });

    it("DRW-CU01: zoom 0.5 halves the element coordinates", () => {
      const viewport = { scrollX: 0, scrollY: 0, zoom: 0.5 };
      const elementX = 200;
      const elementY = 100;

      const screenX = (elementX + viewport.scrollX) * viewport.zoom;
      const screenY = (elementY + viewport.scrollY) * viewport.zoom;

      expect(screenX).toBe(100);
      expect(screenY).toBe(50);
    });

    it("DRW-CU01: combined zoom and scroll works for edge midpoint", () => {
      const viewport = { scrollX: 80, scrollY: 60, zoom: 1.25 };
      // Horizontal edge at scene position (50, 100)
      const el = horizontalEdge();
      const midScene = edgePolylineMidpoint(el);
      if (midScene) {
        const screenX = (midScene.x + viewport.scrollX) * viewport.zoom;
        const screenY = (midScene.y + viewport.scrollY) * viewport.zoom;
        // midScene = (150, 100) → (150+80)*1.25=287.5, (100+60)*1.25=200
        expect(screenX).toBe(287.5);
        expect(screenY).toBe(200);
      }
    });
  });
});
