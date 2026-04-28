/**
 * GAP-D1 — Spatial Relations Node Resolution
 *
 * Resolves node identifiers (nodeIds and UIDs) to DOM elements,
 * collects their bounding boxes, and deduplicates the result.
 *
 * @module
 */

import { getElementByRef } from "./page-map-traversal.js";
import type { Rect } from "./spatial-helpers.js";
import { parseUid } from "./spatial-relations-grammar.js";

/**
 * Resolve a list of UIDs to their numeric nodeIds, deduplicating
 * against an existing nodeId list. Uses the canonical parseUid grammar.
 */
export function resolveUidsToNodeIds(
  uids: string[],
  existingNodeIds: number[],
): number[] {
  const resolved = [...existingNodeIds];
  for (const uid of uids) {
    const parsed = parseUid(uid);
    if (parsed !== null && !resolved.includes(parsed.nodeId)) {
      resolved.push(parsed.nodeId);
    }
  }
  return resolved;
}

/**
 * Collect bounding boxes for a list of nodeIds from the DOM ref-index.
 * Returns a Map of nodeId -> Rect and a list of missing nodeIds.
 */
export function collectBoundingBoxes(
  nodeIds: number[],
): {
  nodes: Map<number, Rect>;
  missingNodeIds: number[];
} {
  const nodes = new Map<number, Rect>();
  const missingNodeIds: number[] = [];

  for (const nodeId of nodeIds) {
    const ref = `ref-${nodeId}`;
    const element = getElementByRef(ref);
    if (element === null) {
      missingNodeIds.push(nodeId);
      continue;
    }
    const rect = element.getBoundingClientRect();
    nodes.set(nodeId, {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  return { nodes, missingNodeIds };
}
