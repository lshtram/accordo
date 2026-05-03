/**
 * DRW-U08, DRW-U09, DRW-U10, DRW-U11 — Scene index tests.
 *
 * DRW-U08: index_active_managed_elements
 * DRW-U09: index_unmanaged_elements_preserved
 * DRW-U10: index_orphaned_elements_on_malformed_metadata
 * DRW-U11: index_orphaned_elements_on_duplicate_identity
 *
 * Source: docs/20-requirements/requirements-drawing.md §3 (DRW-R03, R06..R10)
 * Source: docs/10-architecture/drawing-architecture.md §3.2, §4.2
 * Requirements: DRW-R03, DRW-R08, DRW-R10
 */

import { describe, it, expect } from "vitest";
import { buildSceneIndex } from "../../core/types.js";
import type { SceneElement } from "../../core/types.js";

/** Minimal Excalidraw scene JSON shape for testing. */
function makeScene(elements: SceneElement[]): unknown {
  return { elements };
}

/** Helper: active managed element */
function activeNode(id: string, identity: string, x = 0, y = 0): SceneElement {
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

/** Helper: unmanaged element (no accordo customData) */
function unmanaged(id: string, x = 0, y = 0): SceneElement {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: 100,
    height: 40,
    // no customData.accordo → unmanaged
  };
}

/** Helper: orphaned element (missing identity) */
function orphanedMalformed(id: string): SceneElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "node" as const,
        // identity missing → malformed
        sceneRole: "primary" as const,
        sourcePath: "foo.mmd",
        status: "orphaned" as const,
        orphanReason: "malformed-identity-missing",
      },
    },
  };
}

describe("core/scene-index", () => {
  /**
   * DRW-U08 — Active managed elements are indexed correctly.
   */
  it("DRW-U08: index_active_managed_elements", () => {
    const scene = makeScene([
      activeNode("el1", "A"),
      activeNode("el2", "B"),
      activeNode("el3", "C"),
    ]);
    const index = buildSceneIndex(scene);

    expect(index.activeManaged).toHaveLength(3);
    expect(index.orphanedManaged).toHaveLength(0);
    expect(index.unmanaged).toHaveLength(0);
  });

  /**
   * DRW-U09 — Unmanaged elements (no customData.accordo) are preserved.
   */
  it("DRW-U09: index_unmanaged_elements_preserved", () => {
    const scene = makeScene([
      activeNode("el1", "A"),
      unmanaged("free1"),
      unmanaged("free2"),
    ]);
    const index = buildSceneIndex(scene);

    expect(index.activeManaged).toHaveLength(1);
    expect(index.unmanaged).toHaveLength(2);
    expect(index.orphanedManaged).toHaveLength(0);
  });

  /**
   * DRW-U10 — Malformed managed metadata → orphaned, not deleted silently.
   * DRW-R10: orphan, don't silently delete malformed managed elements.
   */
  it("DRW-U10: index_orphaned_elements_on_malformed_metadata", () => {
    const scene = makeScene([
      activeNode("el1", "A"),
      orphanedMalformed("bad1"),
    ]);
    const index = buildSceneIndex(scene);

    expect(index.activeManaged).toHaveLength(1);
    expect(index.orphanedManaged).toHaveLength(1);
    expect(index.orphanedManaged[0].customData!.accordo!.orphanReason).toBe(
      "malformed-identity-missing"
    );
  });

  /**
   * DRW-U11 — Duplicate active managed tuple → both orphaned, neither silently deleted.
   * DRW-R10, DRW-R24: duplicate-managed-identity orphanReason.
   */
  it("DRW-U11: index_orphaned_elements_on_duplicate_identity", () => {
    // Two elements with the same (entityKind, identity, sceneRole) tuple
    const scene = makeScene([
      activeNode("dup1", "A", 0, 0),
      activeNode("dup2", "A", 200, 0), // same node identity "A"
    ]);
    const index = buildSceneIndex(scene);

    // Both must be orphaned — no silent deduplication
    expect(index.orphanedManaged).toHaveLength(2);
    expect(index.activeManaged).toHaveLength(0);
    expect(index.orphanedManaged[0].customData!.accordo!.orphanReason).toBe(
      "duplicate-managed-identity"
    );
    expect(index.orphanedManaged[1].customData!.accordo!.orphanReason).toBe(
      "duplicate-managed-identity"
    );
  });
});
