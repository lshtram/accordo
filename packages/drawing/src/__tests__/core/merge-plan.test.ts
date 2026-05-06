/**
 * DRW-U12..DRW-U18 — Merge plan tests.
 *
 * DRW-U12: merge_preserves_matched_managed_geometry
 * DRW-U13: merge_updates_mermaid_owned_semantics
 * DRW-U14: merge_removes_deleted_managed_elements
 * DRW-U15: merge_preserves_unmanaged_elements
 * DRW-U16: merge_uses_accordo_placement_for_additions
 * DRW-U17: merge_uses_bootstrap_when_scene_empty
 * DRW-U18: collision_avoidance_finds_non_overlapping_slot
 *
 * Source: docs/20-requirements/requirements-drawing.md §4 (DRW-R06..R16)
 * Source: docs/10-architecture/drawing-architecture.md §7
 * Requirements: DRW-R06, DRW-R07, DRW-R08, DRW-R09, DRW-R11, DRW-R12, DRW-R15, DRW-R16
 */

import { describe, it, expect } from "vitest";
import { computeMergePlan, placeNewNodes, type SourceGraph, type SceneIndex } from "../../core/types.js";

/** Build a minimal SourceGraph */
function makeSource(nodes: string[], edges: Array<[string, string]>): SourceGraph {
  return {
    type: "flowchart",
    direction: "TD",
    nodes: nodes.map((id) => ({ id, label: id })),
    edges: edges.map(([from, to], i) => ({
      id: `${from}->${to}:${i}`,
      from,
      to,
      ordinal: i,
    })),
    clusters: [],
  };
}

/** Build a minimal SceneIndex with active managed nodes */
function makeSceneIndex(
  nodeIdentities: string[],
  orphaned?: string[],
  unmanaged?: string[]
): SceneIndex {
  return {
    activeManaged: nodeIdentities.map((id) => ({
      id: `el-${id}`,
      type: "rectangle",
      x: 100,
      y: 100,
      width: 100,
      height: 40,
      customData: {
        accordo: {
          version: 1 as const,
          entityKind: "node" as const,
          identity: id,
          sceneRole: "primary" as const,
          sourcePath: "foo.mmd",
          status: "active" as const,
        },
      },
    })),
    orphanedManaged: (orphaned ?? []).map((id) => ({
      id: `orphan-${id}`,
      type: "rectangle",
      x: 0,
      y: 0,
      customData: {
        accordo: {
          version: 1 as const,
          entityKind: "node" as const,
          identity: id,
          sceneRole: "primary" as const,
          sourcePath: "foo.mmd",
          status: "orphaned" as const,
          orphanReason: "test-orphan",
        },
      },
    })),
    unmanaged: (unmanaged ?? []).map((id) => ({
      id: `free-${id}`,
      type: "rectangle",
      x: 50,
      y: 50,
      // no customData.accordo
    })),
  };
}

function makeManagedEdge(identity: string, label = identity): SceneIndex["activeManaged"][number] {
  return {
    id: `edge-${identity}`,
    type: "line",
    x: 0,
    y: 0,
    points: [[0, 0], [100, 0]],
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "edge" as const,
        identity,
        sceneRole: "primary" as const,
        sourcePath: "foo.mmd",
        status: "active" as const,
        __label: label,
      },
    },
  };
}

describe("core/merge-plan", () => {
  /**
   * DRW-U12 — Matched managed elements are preserved with existing geometry.
   */
  it("DRW-U12: merge_preserves_matched_managed_geometry", () => {
    const source = makeSource(["A", "B"], [["A", "B"]]);
    const scene = makeSceneIndex(["A", "B"]);

    const plan = computeMergePlan(source, scene);

    expect(plan.placementEngine).toBe("accordo");
    expect(plan.preserved).toHaveLength(2);
    expect(plan.preserved.map((e) => e.customData!.accordo!.identity).sort()).toEqual(["A", "B"]);
  });

  /**
   * DRW-U13 — Matched elements with changed labels appear in updated list.
   */
  it("DRW-U13: merge_updates_mermaid_owned_semantics", () => {
    const source = makeSource(["A", "B"], [["A", "B"]]);
    source.nodes[0].label = "Updated A"; // label changed
    const scene = makeSceneIndex(["A", "B"]);

    const plan = computeMergePlan(source, scene);

    // updated list contains the element whose Mermaid-owned semantics changed
    expect(plan.updated.map((e) => e.customData!.accordo!.identity)).toContain("A");
    // The stale-label element must NOT be in preserved
    const staleInPreserved = plan.preserved.some(
      (e) => e.customData?.accordo?.identity === "A"
    );
    expect(staleInPreserved).toBe(false);
  });

  /**
   * DRW-U14 — Deleted managed identities are removed from scene.
   * DRW-R09: elements whose identity is absent from merged .mmd are removed.
   */
  it("DRW-U14: merge_removes_deleted_managed_elements", () => {
    // Scene has A, B; source only has A (B was deleted)
    const source = makeSource(["A"], []);
    const scene = makeSceneIndex(["A", "B"]);

    const plan = computeMergePlan(source, scene);

    expect(plan.removed).toHaveLength(1);
    expect(plan.removed[0].customData!.accordo!.identity).toBe("B");
  });

  /**
   * DRW-U15 — Unmanaged elements (no customData.accordo) are preserved unchanged.
   * DRW-R08: unmanaged elements are NEVER removed or modified by merge.
   */
  it("DRW-U15: merge_preserves_unmanaged_elements", () => {
    const source = makeSource(["A"], []);
    const scene = makeSceneIndex(["A"], [], ["free1", "free2"]);

    const plan = computeMergePlan(source, scene);

    expect(plan.unmanaged).toHaveLength(2);
    expect(plan.unmanaged.every((e) => !e.customData?.accordo)).toBe(true);
  });

  /**
   * DRW-U16 — New identities trigger accordo placement, not bootstrap.
   * DRW-R11: merge-time additions into existing drawings use Accordo placement.
   */
  it("DRW-U16: merge_uses_accordo_placement_for_additions", () => {
    // Scene has A; source adds B (new)
    const source = makeSource(["A", "B"], [["A", "B"]]);
    const scene = makeSceneIndex(["A"]);

    const plan = computeMergePlan(source, scene);

    expect(plan.placementEngine).toBe("accordo");
    expect(plan.added.some((e) => e.customData?.accordo?.identity === "B")).toBe(true);
  });

  /**
   * DRW-U17 — Empty scene triggers bootstrap, not accordo placement.
   * DRW-R16: bootstrap allowed when no usable existing managed scene exists.
   */
  it("DRW-U17: merge_uses_bootstrap_when_scene_empty", () => {
    const source = makeSource(["A"], []);
    const emptyScene: SceneIndex = {
      activeManaged: [],
      orphanedManaged: [],
      unmanaged: [],
    };

    const plan = computeMergePlan(source, emptyScene);

    expect(plan.placementEngine).toBe("bootstrap");
  });

  /**
   * DRW-U18 — Collision avoidance: newly placed nodes find non-overlapping slots.
   * DRW-R15: placement must not overlap existing elements.
   */
  it("DRW-U18: collision_avoidance_finds_non_overlapping_slot", () => {
    // Source adds two new nodes; scene already has a managed element at 100,100
    const source = makeSource(["A", "B"], []);
    const scene = makeSceneIndex(["existing"]);

    const plan = computeMergePlan(source, scene);

    // Both added nodes must be in the plan
    expect(plan.added.length).toBeGreaterThanOrEqual(2);

    // Run through placement engine — DRW-R15 requires collision-free placement
    const placed = placeNewNodes(plan, source);

    // No two added nodes may collide with each other
    // (simplified check: added nodes have different coordinates)
    const coords = placed.added.map((e) => ({ x: e.x, y: e.y }));
    const unique = new Set(coords.map((c) => `${c.x},${c.y}`));
    expect(unique.size).toBe(coords.length); // all coords unique
  });

  it("DRW-U19: merge_preserves_managed_edges_with_same_identity", () => {
    const source = makeSource(["A", "B"], [["A", "B"]]);
    const scene = makeSceneIndex(["A", "B"]);
    scene.activeManaged.push(makeManagedEdge("A->B:0"));

    const plan = computeMergePlan(source, scene);
    expect(plan.preserved.some((element) => element.customData?.accordo?.identity === "A->B:0")).toBe(true);
  });

  it("DRW-U20: merge_updates_managed_edge_when_semantics_change", () => {
    const source = makeSource(["A", "B"], [["A", "B"]]);
    source.edges[0]!.label = "new-edge-label";
    const scene = makeSceneIndex(["A", "B"]);
    scene.activeManaged.push(makeManagedEdge("A->B:0", "old-label"));

    const plan = computeMergePlan(source, scene);
    expect(plan.updated.some((element) => element.customData?.accordo?.identity === "A->B:0")).toBe(true);
  });

  it("DRW-U21: merge_removes_managed_edge_missing_from_source", () => {
    const source = makeSource(["A", "B"], []);
    const scene = makeSceneIndex(["A", "B"]);
    scene.activeManaged.push(makeManagedEdge("A->B:0"));

    const plan = computeMergePlan(source, scene);
    expect(plan.removed.some((element) => element.customData?.accordo?.identity === "A->B:0")).toBe(true);
  });
});
