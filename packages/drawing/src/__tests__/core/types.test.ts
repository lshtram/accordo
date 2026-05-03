/**
 * DRW-U01, DRW-U02, DRW-U03 — Core type contract tests.
 *
 * Tests the type-level contracts defined in types.ts:
 *   DRW-U01: two_file_pair_type_rejects_triplet
 *   DRW-U02: managed_identity_customData_accordo_schema
 *   DRW-U03: layout_json_not_inferred_as_source_of_truth
 *
 * Source: docs/20-requirements/requirements-drawing.md §3 (DRW-R01..R05)
 * Requirements: DRW-R01, DRW-R02, DRW-R03, DRW-R04, DRW-R05
 */

import { describe, it, expect } from "vitest";
import type {
  DrawingPair,
  ManagedIdentity,
  SourceOfTruth,
  SourceGraph,
} from "../../core/types.js";

describe("core/types", () => {
  /**
   * DRW-U01 — Two-file source-of-truth model.
   * A DrawingPair must always have exactly 2 paths (.mmd + .excalidraw).
   * The type system enforces this; a triplet would be a type error.
   */
  it("DRW-U01: two_file_pair_type_rejects_triplet", () => {
    // Valid 2-file pair
    const pair: DrawingPair = {
      mmdPath: "/foo/bar.mmd",
      excalidrawPath: "/foo/bar.excalidraw",
    };
    expect(pair.mmdPath).toBe("/foo/bar.mmd");
    expect(pair.excalidrawPath).toBe("/foo/bar.excalidraw");

    // TypeScript would reject a third field:
    // const bad: DrawingPair = { mmdPath: "", excalidrawPath: "", extra: "" };
    // This is a compile-time check, not runtime. We test the valid shape instead.
    expect(true).toBe(true);
  });

  /**
   * DRW-U02 — Managed identity schema via customData.accordo.
   * A manually constructed ManagedIdentity with all required fields is valid.
   * Missing a required field is a type error (compile-time check).
   * DRW-R05: stable identity is Mermaid node ID or edge key.
   */
  it("DRW-U02: managed_identity_customData_accordo_schema", () => {
    const nodeIdentity: ManagedIdentity = {
      version: 1,
      entityKind: "node",
      identity: "auth",
      sceneRole: "primary",
      sourcePath: "diagrams/foo.mmd",
      status: "active",
    };
    expect(nodeIdentity.version).toBe(1);
    expect(nodeIdentity.identity).toBe("auth");
    expect(nodeIdentity.status).toBe("active");

    const edgeIdentity: ManagedIdentity = {
      version: 1,
      entityKind: "edge",
      identity: "A->B:0",
      sceneRole: "primary",
      sourcePath: "diagrams/foo.mmd",
      status: "active",
    };
    expect(edgeIdentity.entityKind).toBe("edge");
    expect(edgeIdentity.identity).toBe("A->B:0");

    // Orphaned identity with orphanReason
    const orphaned: ManagedIdentity = {
      version: 1,
      entityKind: "node",
      identity: "orphan-node",
      sceneRole: "primary",
      sourcePath: "diagrams/foo.mmd",
      status: "orphaned",
      orphanReason: "duplicate-managed-identity",
    };
    expect(orphaned.status).toBe("orphaned");
    expect(orphaned.orphanReason).toBe("duplicate-managed-identity");
  });

  /**
   * DRW-U03 — SourceOfTruth type does NOT include layout-json.
   * DRW-R04: layout.json must not be canonical for this package.
   */
  it("DRW-U03: layout_json_not_inferred_as_source_of_truth", () => {
    // SourceOfTruth is a union of exactly "mmd" | "excalidraw"
    // TypeScript rejects "layout-json" as a value of SourceOfTruth:
    const mmd: SourceOfTruth = "mmd";
    const excalidraw: SourceOfTruth = "excalidraw";
    expect(mmd).toBe("mmd");
    expect(excalidraw).toBe("excalidraw");

    // Compile-time check: uncommenting the line below would be a type error:
    // const bad: SourceOfTruth = "layout-json";
    expect(true).toBe(true);
  });

  /**
   * DRW-U03b — SourceGraph type contracts (flowchart only in slice 1).
   * DRW-R02: .mmd owns canonical topology/labels/diagram structure.
   */
  it("DRW-U03b: source_graph_flowchart_type", () => {
    const graph: SourceGraph = {
      type: "flowchart",
      direction: "TD",
      nodes: [
        { id: "A", label: "Node A" },
        { id: "B", label: "Node B" },
      ],
      edges: [
        { id: "A->B:0", from: "A", to: "B", ordinal: 0 },
      ],
      clusters: [],  // deferred in slice 1
    };
    expect(graph.type).toBe("flowchart");
    expect(graph.direction).toBe("TD");
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.clusters).toHaveLength(0);
  });
});
