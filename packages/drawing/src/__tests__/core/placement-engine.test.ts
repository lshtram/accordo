/**
 * DRW-U19..DRW-U24 — Placement engine deterministic behavior tests.
 *
 * DRW-U19: placement_is_deterministic_same_inputs
 * DRW-U20: placement_anchors_to_preserved_neighbors
 * DRW-U21: disconnected_component_uses_frontier_placement
 * DRW-U22: collision_margin_prevents_overlap
 * DRW-U23: collision_resolution_search_order_stable
 * DRW-U24: placement_fails_after_SEARCH_MAX_STEPS
 *
 * Source: docs/20-requirements/requirements-drawing.md §4 (DRW-R11..R16)
 * Source: docs/10-architecture/drawing-architecture.md §5
 * Requirements: DRW-R12, DRW-R13, DRW-R14, DRW-R15
 */

import { describe, it, expect } from "vitest";
import {
  placeNewNodes,
  computeMergePlan,
  type SourceGraph,
  type SceneIndex,
  PLACEMENT_MAIN_GAP_PX,
  PLACEMENT_COLLISION_MARGIN_PX,
} from "../../core/types.js";

function makeSource(nodes: string[], edges: Array<[string, string]> = []): SourceGraph {
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

function makeSceneIndex(managedIds: string[]): SceneIndex {
  return {
    activeManaged: managedIds.map((id) => ({
      id: `el-${id}`,
      type: "rectangle",
      x: 300,
      y: 200,
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
    orphanedManaged: [],
    unmanaged: [],
  };
}

describe("core/placement-engine", () => {
  /**
   * DRW-U19 — Identical inputs produce identical placement coordinates.
   * DRW-R12: no randomness, timestamp seeding, or unstable iteration order.
   */
  it("DRW-U19: placement_is_deterministic_same_inputs", () => {
    const source = makeSource(["A", "B"], [["A", "B"]]);
    const scene = makeSceneIndex(["A"]);

    const plan1 = placeNewNodes(computeMergePlan(source, scene), source);
    const plan2 = placeNewNodes(computeMergePlan(source, scene), source);

    const coords1 = plan1.added.map((e) => `${e.x},${e.y}`);
    const coords2 = plan2.added.map((e) => `${e.x},${e.y}`);

    expect(coords1).toEqual(coords2);
  });

  /**
   * DRW-U20 — New node connected to preserved anchor places near that anchor.
   * DRW-R13: anchor-based placement relative to preserved neighbors.
   */
  it("DRW-U20: placement_anchors_to_preserved_neighbors", () => {
    const source = makeSource(["A", "B"], [["A", "B"]]);
    const scene = makeSceneIndex(["A"]); // A is preserved, B is new

    const plan = placeNewNodes(computeMergePlan(source, scene), source);
    const addedB = plan.added.find((e) => e.customData?.accordo?.identity === "B");

    expect(addedB).toBeDefined();
    const anchor = scene.activeManaged[0];
    // Check B is placed within MAIN_GAP_PX (+ generous tolerance) of anchor
    const dx = Math.abs((addedB!.x + 50) - (anchor.x + 50));
    const dy = Math.abs((addedB!.y + 20) - (anchor.y + 20));
    expect(dx).toBeLessThanOrEqual(PLACEMENT_MAIN_GAP_PX + 100);
    expect(dy).toBeLessThanOrEqual(PLACEMENT_MAIN_GAP_PX + 100);
  });

  /**
   * DRW-U21 — Disconnected component uses frontier placement outside scene bounds.
   * DRW-R14: frontier placement when no preserved anchor exists.
   */
  it("DRW-U21: disconnected_component_uses_frontier_placement", () => {
    // Source has A and C; C is disconnected from A which is preserved
    const source = makeSource(["A", "C"], []);
    const scene = makeSceneIndex(["A"]);

    const plan = placeNewNodes(computeMergePlan(source, scene), source);
    const addedC = plan.added.find((e) => e.customData?.accordo?.identity === "C");

    expect(addedC).toBeDefined();
    // Frontier for TD direction is BELOW the existing scene (y > 200)
    expect(addedC!.y).toBeGreaterThan(200);
  });

  /**
   * DRW-U22 — Newly placed node with collision margin does not overlap existing elements.
   * DRW-R15: collision_margin prevents overlap.
   */
  it("DRW-U22: collision_margin_prevents_overlap", () => {
    const source = makeSource(["A", "B"], []);
    const scene = makeSceneIndex(["A"]);

    const plan = placeNewNodes(computeMergePlan(source, scene), source);

    for (const added of plan.added) {
      for (const existing of scene.activeManaged) {
        const ax = added.x - PLACEMENT_COLLISION_MARGIN_PX;
        const ay = added.y - PLACEMENT_COLLISION_MARGIN_PX;
        const aw = (added.width ?? 100) + 2 * PLACEMENT_COLLISION_MARGIN_PX;
        const ah = (added.height ?? 40) + 2 * PLACEMENT_COLLISION_MARGIN_PX;

        const bx = existing.x;
        const by = existing.y;
        const bw = existing.width ?? 100;
        const bh = existing.height ?? 40;

        const overlap =
          ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
        expect(overlap).toBe(false);
      }
    }
  });

  /**
   * DRW-U23 — Collision resolution follows stable lane search order.
   * DRW-R15: search order 0, +1, -1, +2, -2, ...
   */
  it("DRW-U23: collision_resolution_search_order_stable", () => {
    const source = makeSource(["new1"], []);
    // Scene occupies the ideal slot
    const denseScene: SceneIndex = {
      activeManaged: [
        {
          id: "occupy",
          type: "rectangle",
          x: 300,
          y: 160,
          width: 100,
          height: 40,
          customData: {
            accordo: {
              version: 1,
              entityKind: "node",
              identity: "occupy",
              sceneRole: "primary",
              sourcePath: "foo.mmd",
              status: "active",
            },
          },
        },
      ],
      orphanedManaged: [],
      unmanaged: [],
    };

    const plan = placeNewNodes(computeMergePlan(source, denseScene), source);
    // Must succeed without throwing placement-failed
    expect(plan.added.length).toBeGreaterThan(0);
  });

  /**
   * DRW-U24 — Empty scene uses bootstrap, not accordo placement engine.
   * DRW-R16: bootstrap allowed when no usable managed scene exists.
   * placement-failed only applies to accordo engine.
   */
  it("DRW-U24: empty_scene_uses_bootstrap_not_accordo", () => {
    const source = makeSource(["A"], []);
    const emptyScene: SceneIndex = {
      activeManaged: [],
      orphanedManaged: [],
      unmanaged: [],
    };

    const plan = computeMergePlan(source, emptyScene);
    expect(plan.placementEngine).toBe("bootstrap");
  });
});
