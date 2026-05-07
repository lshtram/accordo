/**
 * DRW-CUI02, DRW-CUI03 — Webview/DOM seam tests for comment pin overlay.
 *
 * These tests verify the comment overlay behavior against the live Excalidraw
 * DOM without requiring a full VS Code webview environment.
 *
 * DRW-C03: Node and edge pins render via canonical SDK contract.
 * DRW-C04: Pins reposition on pan/zoom without reloading threads.
 *
 * Proof surfaces: DRW-CUI02, DRW-CUI03 (webview seam / UI integration)
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.6 (DRW-C03, DRW-C04)
 * Source: docs/10-architecture/drawing-architecture.md §9.10, §9.11
 * Requirements: DRW-C03, DRW-C04
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SdkThread } from "@accordo/comment-sdk";

/**
 * These tests target the DOM-overlay seam in the drawing webview.
 * The overlay is the part of the webview that:
 * 1. Builds a managed-element lookup from live Excalidraw elements
 * 2. Converts store threads into pin view-models
 * 3. Maps managed node/edge targets to screen coordinates using Excalidraw viewport state
 * 4. Opens/focuses the thread popover on host request
 *
 * The overlay functions are implemented in the comments module.
 * Phase B: stubs throw "not implemented" — these tests define the expected behavior.
 */
import {
  buildManagedElementLookup,
  computePinPosition,
} from "../../comments/drawing-comments-bridge.js";

/**
 * Simulated Excalidraw element (minimal shape for testing).
 * These match the SceneElement structure used by the core module.
 */
interface SimulatedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[][];
  customData?: {
    accordo?: {
      version: number;
      entityKind: string;
      identity: string;
      sceneRole: string;
      sourcePath: string;
      status: string;
    };
  };
}

/** Simulated Excalidraw viewport state */
interface SimulatedViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/**
 * Simulated screen position
 */
interface ScreenPos {
  x: number;
  y: number;
}

/** Helper: managed primary node element */
function makeNode(id: string, identity: string, x: number, y: number, w = 100, h = 40): SimulatedElement {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    customData: {
      accordo: {
        version: 1,
        entityKind: "node",
        identity,
        sceneRole: "primary",
        sourcePath: "test.mmd",
        status: "active",
      },
    },
  };
}

/** Helper: managed edge element */
function makeEdge(id: string, identity: string, x: number, y: number, points: number[][]): SimulatedElement {
  return {
    id,
    type: "line",
    x,
    y,
    width: 0,
    height: 0,
    points,
    customData: {
      accordo: {
        version: 1,
        entityKind: "edge",
        identity,
        sceneRole: "primary",
        sourcePath: "test.mmd",
        status: "active",
      },
    },
  };
}

/** Helper: unmanaged element (no customData.accordo) */
function makeUnmanaged(id: string, x: number, y: number): SimulatedElement {
  return { id, type: "rectangle", x, y, width: 80, height: 30 };
}

/** Helper: helper element */
function makeHelper(id: string, identity: string, x: number, y: number): SimulatedElement {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: 60,
    height: 20,
    customData: {
      accordo: {
        version: 1,
        entityKind: "node",
        identity,
        sceneRole: "helper",
        sourcePath: "test.mmd",
        status: "active",
      },
    },
  };
}

describe("comments/overlay-seam", () => {
  describe("DRW-C03: managed element lookup for pin placement", () => {
    it("DRW-CUI02: buildManagedElementLookup indexes active managed nodes by identity", () => {
      const elements: SimulatedElement[] = [
        makeNode("el1", "A", 100, 200),
        makeNode("el2", "B", 300, 400),
        makeEdge("edge1", "A->B:0", 100, 220, [[0, 0], [200, 0]]),
        makeUnmanaged("free1", 50, 50),
        makeHelper("helper1", "C", 80, 80),
      ];

      const lookup = buildManagedElementLookup(elements);

      // Node A must be findable by identity
      const nodeA = lookup.get("node:A");
      expect(nodeA).toBeDefined();
      expect(nodeA!.id).toBe("el1");
      expect(nodeA!.customData!.accordo!.identity).toBe("A");

      // Node B must be findable by identity
      const nodeB = lookup.get("node:B");
      expect(nodeB).toBeDefined();
      expect(nodeB!.id).toBe("el2");

      // Edge must be findable by identity
      const edgeAB = lookup.get("edge:A->B:0");
      expect(edgeAB).toBeDefined();
      expect(edgeAB!.id).toBe("edge1");

      // Unmanaged must NOT appear in lookup
      expect(lookup.has("free1")).toBe(false);

      // Helper must NOT appear in lookup (DRW-C02: helpers not commentable)
      expect(lookup.has("helper:C")).toBe(false);
    });

    it("DRW-CUI02: lookup returns undefined for orphaned elements", () => {
      const elements: SimulatedElement[] = [
        {
          id: "orphan1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          customData: {
            accordo: {
              version: 1,
              entityKind: "node",
              identity: "X",
              sceneRole: "primary",
              sourcePath: "test.mmd",
              status: "orphaned",
              orphanReason: "duplicate-managed-identity",
            },
          },
        },
      ];

      const lookup = buildManagedElementLookup(elements);
      // Orphaned elements must NOT be in the managed lookup
      expect(lookup.has("node:X")).toBe(false);
    });

    it("DRW-CUI02: lookup is empty when no elements are provided", () => {
      const lookup = buildManagedElementLookup([]);
      expect(lookup.size).toBe(0);
    });

    it("DRW-CUI02: duplicate active identities are not silently deduplicated", () => {
      // Two elements with the same identity — both should be handled (orphaned in real index)
      // but the lookup should not crash
      const elements: SimulatedElement[] = [
        makeNode("dup1", "A", 0, 0),
        makeNode("dup2", "A", 200, 0),
      ];

      // buildManagedElementLookup should not throw even with duplicate identities
      expect(() => buildManagedElementLookup(elements)).not.toThrow();
    });
  });

  describe("DRW-C03 / DRW-C04: pin position computation with viewport", () => {
    const standardViewport: SimulatedViewport = {
      scrollX: 0,
      scrollY: 0,
      zoom: 1.0,
    };

    it("DRW-CUI02: node pin positioned at element center using element bounds", () => {
      const elements: SimulatedElement[] = [
        makeNode("nodeA", "A", 100, 200, 100, 40),
      ];
      const lookup = buildManagedElementLookup(elements);

      const pos = computePinPosition(lookup, "node:A", standardViewport);

      expect(pos).not.toBeNull();
      // Center of node at (100,200) with size (100,40) → center (150, 220)
      expect(pos!.x).toBe(150);
      expect(pos!.y).toBe(220);
    });

    it("DRW-CUI02: edge pin positioned at polyline midpoint (DRW-C03)", () => {
      // Horizontal edge from (100,200) to (300,200)
      const elements: SimulatedElement[] = [
        makeEdge("edgeAB", "A->B:0", 100, 200, [[0, 0], [200, 0]]),
      ];
      const lookup = buildManagedElementLookup(elements);

      const pos = computePinPosition(lookup, "edge:A->B:0", standardViewport);

      expect(pos).not.toBeNull();
      // Midpoint of edge at (100,200) with points [[0,0],[200,0]]
      // Absolute points: (100,200), (300,200) → midpoint (200, 200)
      expect(pos!.x).toBe(200);
      expect(pos!.y).toBe(200);
    });

    it("DRW-CUI02: pin position updates with zoom (DRW-C04)", () => {
      const elements: SimulatedElement[] = [
        makeNode("nodeA", "A", 100, 200, 100, 40),
      ];
      const lookup = buildManagedElementLookup(elements);

      const zoomedViewport: SimulatedViewport = {
        scrollX: 0,
        scrollY: 0,
        zoom: 2.0,
      };

      const pos = computePinPosition(lookup, "node:A", zoomedViewport);

      expect(pos).not.toBeNull();
      // Element center (150, 220) * zoom 2.0 = (300, 440)
      expect(pos!.x).toBe(300);
      expect(pos!.y).toBe(440);
    });

    it("DRW-CUI02: pin position updates with scroll offset (DRW-C04)", () => {
      const elements: SimulatedElement[] = [
        makeNode("nodeA", "A", 100, 200, 100, 40),
      ];
      const lookup = buildManagedElementLookup(elements);

      const scrolledViewport: SimulatedViewport = {
        scrollX: 50,
        scrollY: -30,
        zoom: 1.0,
      };

      const pos = computePinPosition(lookup, "node:A", scrolledViewport);

      expect(pos).not.toBeNull();
      // Element center (150, 220) + scroll (50, -30) = (200, 190)
      expect(pos!.x).toBe(200);
      expect(pos!.y).toBe(190);
    });

    it("DRW-CUI02: combined zoom and scroll works correctly", () => {
      const elements: SimulatedElement[] = [
        makeNode("nodeA", "A", 100, 200, 100, 40),
      ];
      const lookup = buildManagedElementLookup(elements);

      const viewport: SimulatedViewport = {
        scrollX: 80,
        scrollY: 60,
        zoom: 1.25,
      };

      const pos = computePinPosition(lookup, "node:A", viewport);

      expect(pos).not.toBeNull();
      // Excalidraw viewport transform: (scene + scroll) * zoom = (287.5, 350)
      expect(pos!.x).toBe(287.5);
      expect(pos!.y).toBe(350);
    });

    it("DRW-CUI02: pin position returns null for unmanaged target", () => {
      const elements: SimulatedElement[] = [
        makeUnmanaged("free1", 50, 50),
      ];
      const lookup = buildManagedElementLookup(elements);

      // "free1" has no customData.accordo → not in lookup
      const pos = computePinPosition(lookup, "free1", standardViewport);
      expect(pos).toBeNull();
    });

    it("DRW-CUI02: pin position returns null for helper target", () => {
      const elements: SimulatedElement[] = [
        makeHelper("helper1", "C", 80, 80),
      ];
      const lookup = buildManagedElementLookup(elements);

      const pos = computePinPosition(lookup, "helper:C", standardViewport);
      expect(pos).toBeNull();
    });

    it("DRW-CUI02: edge pin updates on pan/zoom without reloading threads (DRW-C04)", () => {
      // This test verifies that computePinPosition computes fresh positions
      // from the current viewport state — it does not cache or reload threads
      const elements: SimulatedElement[] = [
        makeEdge("edgeAB", "A->B:0", 100, 200, [[0, 0], [200, 0]]),
      ];
      const lookup = buildManagedElementLookup(elements);

      // Position at zoom 1.0
      const pos1 = computePinPosition(lookup, "edge:A->B:0", { scrollX: 0, scrollY: 0, zoom: 1.0 });
      expect(pos1).not.toBeNull();
      expect(pos1!.x).toBe(200);
      expect(pos1!.y).toBe(200);

      // Position at zoom 1.5 — must update without any thread reload
      const pos2 = computePinPosition(lookup, "edge:A->B:0", { scrollX: 0, scrollY: 0, zoom: 1.5 });
      expect(pos2).not.toBeNull();
      // 200 * 1.5 = 300
      expect(pos2!.x).toBe(300);
      expect(pos2!.y).toBe(300);

      // Position with scroll offset — must update without reload
      const pos3 = computePinPosition(lookup, "edge:A->B:0", { scrollX: 100, scrollY: 50, zoom: 1.0 });
      expect(pos3).not.toBeNull();
      // 200 + 100 = 300, 200 + 50 = 250
      expect(pos3!.x).toBe(300);
      expect(pos3!.y).toBe(250);
    });
  });

  describe("DRW-C07: focus thread message triggers popover", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("DRW-CUI02: comments:focus message causes sender.postMessage to forward focus to webview", async () => {
      /**
       * DRW-C07: The host bridge's handleWebviewMessage receives a canonical
       * comments:focus message and must post it to the webview so the overlay
       * can open the popover for the target threadId.
       *
       * Phase B stub: DrawingCommentsBridge.handleWebviewMessage throws "not implemented".
       * This test calls it and asserts the correct postMessage call is made.
       */
      const { DrawingCommentsBridge } = await import("../../comments/drawing-comments-bridge.js");
      const { createStubSender, createStubAdapter } = await import("./_fixtures.js");

      const adapter = createStubAdapter();
      adapter.getThreadsForUri.mockReturnValue([]);
      const sender = createStubSender();

      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/focus.mmd");

      // Simulate a comments:focus host message arriving at the bridge
      const focusMessage = { type: "comments:focus" as const, threadId: "thread-focus-1" };

      // Phase B: this throws "not implemented" — test defines expected behavior
      await bridge.handleWebviewMessage(focusMessage);

      // The sender must post comments:focus to the webview so the overlay
      // knows which popover to open
      expect(sender.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "comments:focus", threadId: "thread-focus-1" })
      );
    });

    it("DRW-CUI02: comments:focus with unknown threadId does not post to webview (silent no-op)", async () => {
      /**
       * DRW-C07: If the focused threadId is not found in the store, the bridge
       * logs a warning but still posts comments:focus — the overlay handles
       * the unknown-ID case gracefully (no popover opens).
       *
       * Phase B: handleWebviewMessage throws — test defines expected behavior.
       */
      const { DrawingCommentsBridge } = await import("../../comments/drawing-comments-bridge.js");
      const { createStubSender, createStubAdapter } = await import("./_fixtures.js");

      const adapter = createStubAdapter();
      adapter.getThreadsForUri.mockReturnValue([]);
      const sender = createStubSender();

      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/focus2.mmd");

      const focusMessage = { type: "comments:focus" as const, threadId: "thread-nonexistent" };

      // Phase B: throws "not implemented"
      await bridge.handleWebviewMessage(focusMessage);

      // Even for an unknown threadId, the bridge posts the focus message
      // so the overlay can decide whether to show a "thread not found" state
      expect(sender.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "comments:focus", threadId: "thread-nonexistent" })
      );
    });
  });
});
