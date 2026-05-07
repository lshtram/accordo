/**
 * DRW-C01 — Unit tests for anchor/blockId derivation and commentable eligibility.
 *
 * DRW-C01: Legacy anchor compatibility — `surfaceType: "diagram"`,
 *   `coordinates.type: "diagram-node"`, prefixed `nodeId` for nodes/edges/clusters.
 * DRW-C02: Only managed targets are commentable — helpers, labels, orphans,
 *   unmanaged elements are NOT commentable.
 *
 * Proof surface: DRW-CU01 (unit)
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.6 (DRW-C01, DRW-C02)
 * Source: docs/10-architecture/drawing-architecture.md §9.7, §9.10
 * Requirements: DRW-C01, DRW-C02
 */

import { describe, it, expect } from "vitest";
import type { SceneElement } from "../../../core/types.js";

/**
 * These functions are implemented in the comments module.
 * They are tested here for DRW-C01 blockId derivation and DRW-C02 eligibility.
 * Phase B: stubs throw "not implemented" — tests demonstrate the correct
 * expected behavior so implementation in Phase C can follow the contract.
 */
import {
  buildDrawingCommentNodeId,
  isCommentableTarget,
  type DrawingCommentAnchorTarget,
} from "../../comments/drawing-comments-bridge.js";

/** DRW-C01 — Valid managed node element */
function managedNode(id: string, identity: string, x = 0, y = 0): SceneElement {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: 100,
    height: 40,
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "node",
        identity,
        sceneRole: "primary",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

/** DRW-C01 — Valid managed edge element */
function managedEdge(id: string, identity: string, points = [[0, 0], [100, 0]]): SceneElement {
  return {
    id,
    type: "line",
    x: 0,
    y: 0,
    points,
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "edge",
        identity,
        sceneRole: "primary",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

/** DRW-C02 — Helper element (not commentable) */
function helperElement(id: string, identity: string): SceneElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 60,
    height: 20,
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "node",
        identity,
        sceneRole: "helper",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

/** DRW-C02 — Label element (not commentable) */
function labelElement(id: string, identity: string): SceneElement {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "node",
        identity,
        sceneRole: "label",
        sourcePath: "foo.mmd",
        status: "active" as const,
      },
    },
  };
}

/** DRW-C02 — Orphaned element (not commentable) */
function orphanedElement(id: string, identity: string): SceneElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "node",
        identity,
        sceneRole: "primary",
        sourcePath: "foo.mmd",
        status: "orphaned" as const,
        orphanReason: "duplicate-managed-identity",
      },
    },
  };
}

/** DRW-C02 — Unmanaged element (no customData.accordo) */
function unmanagedElement(id: string): SceneElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    // no customData.accordo
  };
}

describe("comments/anchor-id", () => {
  /**
   * DRW-C01: buildDrawingCommentNodeId derives prefixed blockId for nodes.
   * Prefix must be "node:" and identity must come from customData.accordo.identity.
   */
  describe("DRW-C01: nodeId derivation", () => {
    it("DRW-CU01: buildDrawingCommentNodeId prefixes node identity with 'node:'", () => {
      const target: DrawingCommentAnchorTarget = {
        prefix: "node",
        identity: "auth",
        nodeId: "node:auth",
      };
      const nodeId = buildDrawingCommentNodeId(target);
      expect(nodeId).toBe("node:auth");
    });

    it("DRW-CU01: buildDrawingCommentNodeId prefixes edge identity with 'edge:'", () => {
      const target: DrawingCommentAnchorTarget = {
        prefix: "edge",
        identity: "A->B:0",
        nodeId: "edge:A->B:0",
      };
      const nodeId = buildDrawingCommentNodeId(target);
      expect(nodeId).toBe("edge:A->B:0");
    });

    it("DRW-CU01: buildDrawingCommentNodeId prefixes cluster identity with 'cluster:'", () => {
      const target: DrawingCommentAnchorTarget = {
        prefix: "cluster",
        identity: "group1",
        nodeId: "cluster:group1",
      };
      const nodeId = buildDrawingCommentNodeId(target);
      expect(nodeId).toBe("cluster:group1");
    });

    it("DRW-CU01: edge id format is '{from}->{to}:{ordinal}'", () => {
      const target: DrawingCommentAnchorTarget = {
        prefix: "edge",
        identity: "Start->End:0",
        nodeId: "edge:Start->End:0",
      };
      const nodeId = buildDrawingCommentNodeId(target);
      expect(nodeId).toBe("edge:Start->End:0");
    });

    it("DRW-CU01: empty identity returns 'node:' prefix only", () => {
      const target: DrawingCommentAnchorTarget = {
        prefix: "node",
        identity: "",
        nodeId: "node:",
      };
      const nodeId = buildDrawingCommentNodeId(target);
      expect(nodeId).toBe("node:");
    });
  });

  /**
   * DRW-C02: Only primary managed elements (nodes and edges) are commentable.
   * Helper, label, orphaned, and unmanaged elements must NOT be considered commentable.
   */
  describe("DRW-C02: commentable eligibility", () => {
    it("DRW-CU01: managed primary node is commentable", () => {
      const el = managedNode("el1", "A");
      expect(isCommentableTarget(el)).toBe(true);
    });

    it("DRW-CU01: managed primary edge is commentable", () => {
      const el = managedEdge("edge1", "A->B:0");
      expect(isCommentableTarget(el)).toBe(true);
    });

    it("DRW-CU01: helper element is NOT commentable (DRW-C02)", () => {
      const el = helperElement("helper1", "A");
      expect(isCommentableTarget(el)).toBe(false);
    });

    it("DRW-CU01: label element is NOT commentable (DRW-C02)", () => {
      const el = labelElement("label1", "A");
      expect(isCommentableTarget(el)).toBe(false);
    });

    it("DRW-CU01: orphaned element is NOT commentable (DRW-C02)", () => {
      const el = orphanedElement("orphan1", "A");
      expect(isCommentableTarget(el)).toBe(false);
    });

    it("DRW-CU01: unmanaged element is NOT commentable (DRW-C02)", () => {
      const el = unmanagedElement("free1");
      expect(isCommentableTarget(el)).toBe(false);
    });

    it("DRW-CU01: element with no customData is NOT commentable", () => {
      const el: SceneElement = {
        id: "bare",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
      };
      expect(isCommentableTarget(el)).toBe(false);
    });

    it("DRW-CU01: malformed customData (missing identity) is NOT commentable", () => {
      const el: SceneElement = {
        id: "malformed",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        customData: {
          accordo: {
            version: 1 as const,
            entityKind: "node" as const,
            // identity missing → malformed
            sceneRole: "primary" as const,
            sourcePath: "foo.mmd",
            status: "active" as const,
          },
        },
      };
      expect(isCommentableTarget(el)).toBe(false);
    });
  });
});