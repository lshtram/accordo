/**
 * DRW-R06..R16 — Merge plan computation and element update detection.
 *
 * DRW-R07: .mmd is the authoritative source for topology and labels.
 * DRW-R08: unmanaged elements are NEVER removed or modified by merge.
 * DRW-R09: elements absent from merged .mmd are removed.
 * DRW-R10: orphan (don't silently delete) malformed or duplicate elements.
 *
 * Source: docs/20-requirements/requirements-drawing.md §4 (DRW-R06..R16)
 * Source: docs/10-architecture/drawing-architecture.md §6
 * Requirements: DRW-R06, DRW-R07, DRW-R08, DRW-R09, DRW-R10, DRW-R15, DRW-R16
 */

import type { SourceEdge, SourceGraph } from "./source-graph.js";
import type { SceneIndex, SceneElement, ManagedIdentity } from "./scene-index.js";
import type { MergePlan } from "../types.js";

/**
 * DRW-R06 — Compute the merge plan from source graph and scene index.
 *
 * Algorithm:
 * 1. Classify each active managed element: preserved / updated / removed
 * 2. Detect label changes using __label stored in customData.accordo
 * 3. Added: source identities not in scene
 * 4. Orphaned: carried through from scene (already classified by scene-index)
 * 5. Unmanaged: carried through unchanged (DRW-R08)
 *
 * DRW-R07: label is Mermaid-owned semantics — compare stored __label vs source label.
 * DRW-R16: bootstrap engine selected when scene has no active managed elements.
 */
export function computeMergePlan(source: SourceGraph, scene: SceneIndex, sourcePath = "drawing.mmd"): MergePlan {
  const sourceNodeIdentities = new Set(source.nodes.map((n) => n.id));
  const sourceEdgeIdentities = new Set(source.edges.map((e) => e.id));

  // Index scene elements by identity (for added detection)
  const sceneByIdentity = new Map<string, SceneElement[]>();
  for (const el of scene.activeManaged) {
    const accordo = el.customData?.accordo;
    const key = `${accordo?.entityKind ?? ""}:${accordo?.identity ?? ""}`;
    if (!sceneByIdentity.has(key)) sceneByIdentity.set(key, []);
    sceneByIdentity.get(key)!.push(el);
  }

  const preserved: SceneElement[] = [];
  const updated: SceneElement[] = [];
  const removed: SceneElement[] = [];
  const added: SceneElement[] = [];

  for (const el of scene.activeManaged) {
    const accordo = el.customData?.accordo;
    const identity = accordo?.identity ?? "";
    const kind = accordo?.entityKind ?? "node";
    const inSource = kind === "edge"
      ? sourceEdgeIdentities.has(identity)
      : sourceNodeIdentities.has(identity);

    if (!inSource) {
      // DRW-R09: element not in source → removed
      removed.push(el);
    } else {
      const sourceLabel = kind === "edge"
        ? findSourceEdgeLabel(source.edges, identity)
        : source.nodes.find((n) => n.id === identity)?.label;

      if (sourceLabel !== undefined) {
        const storedLabel = readStoredLabel(el);
        if (storedLabel !== sourceLabel) {
          updated.push(withStoredLabel(el, sourceLabel));
          continue;
        }
      }
      preserved.push(el);
    }
  }

  for (const nodeId of sourceNodeIdentities) {
    if (!sceneByIdentity.has(`node:${nodeId}`)) {
      const srcNode = source.nodes.find((n) => n.id === nodeId)!;
      added.push(makeNewNodeElement(nodeId, srcNode.label, sourcePath));
    }
  }

  for (const edgeId of sourceEdgeIdentities) {
    if (!sceneByIdentity.has(`edge:${edgeId}`)) {
      const srcEdge = source.edges.find((e) => e.id === edgeId)!;
      added.push(makeNewEdgeElement(srcEdge, sourcePath));
    }
  }

  // DRW-R16: bootstrap when no active managed elements exist
  const placementEngine: "accordo" | "bootstrap" =
    scene.activeManaged.length > 0 ? "accordo" : "bootstrap";

  return {
    preserved,
    updated,
    added,
    removed,
    orphaned: scene.orphanedManaged,
    unmanaged: scene.unmanaged,
    placementEngine,
    counts: {
      preserved: preserved.length,
      added: added.length,
      updated: updated.length,
      removed: removed.length,
      orphaned: scene.orphanedManaged.length,
    },
  };
}

// ── Label storage helpers ────────────────────────────────────────────────────
// Stored as __label in customData.accordo for semantic change detection.
// This is NOT a non-standard field — it supplements the required identity
// field for change tracking (DRW-R07).

function readStoredLabel(el: SceneElement): string {
  const accordo = el.customData?.accordo as Record<string, unknown> | undefined;
  return (accordo?.["__label"] as string | undefined) ?? el.customData?.accordo?.identity ?? "";
}

function withStoredLabel(el: SceneElement, label: string): SceneElement {
  // DRW-R07: preserve any existing accordo fields, update __label.
  const prevAccordo = el.customData?.accordo as ManagedIdentity | undefined;
  const { __label: _prev, ...rest } = prevAccordo ?? ({} as ManagedIdentity);
  // Cast the result through unknown to satisfy TypeScript's excess-property check
  // on the structured spread — rest is a partial ManagedIdentity and TypeScript
  // won't accept a partial as the full type without the intermediate cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accordo = { ...rest, __label: label } as unknown as ManagedIdentity;
  return {
    ...el,
    customData: {
      ...(el.customData ?? {}),
      accordo,
    },
  };
}

// ── New element factory ───────────────────────────────────────────────────────
// Uses stable id format: "new-{identity}" (no timestamp/Date.now).

function makeNewNodeElement(nodeId: string, label: string, sourcePath: string): SceneElement {
  return {
    id: `new-${nodeId}`,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "node" as const,
        identity: nodeId,
        sceneRole: "primary" as const,
        sourcePath,
        status: "active" as const,
        __label: label,
      } as ManagedIdentity & Record<string, unknown>,
    },
  };
}

function makeNewEdgeElement(edge: SourceEdge, sourcePath: string): SceneElement {
  return {
    id: `new-edge-${edge.id}`,
    type: "line",
    x: 0,
    y: 0,
    points: [[0, 0], [100, 0]],
    customData: {
      accordo: {
        version: 1 as const,
        entityKind: "edge" as const,
        identity: edge.id,
        sceneRole: "primary" as const,
        sourcePath,
        status: "active" as const,
        __label: edge.label ?? edge.id,
      } as ManagedIdentity & Record<string, unknown>,
    },
  };
}

function findSourceEdgeLabel(edges: SourceEdge[], edgeId: string): string | undefined {
  const edge = edges.find((item) => item.id === edgeId);
  return edge ? (edge.label ?? edge.id) : undefined;
}
