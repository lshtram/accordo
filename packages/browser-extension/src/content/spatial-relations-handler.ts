/**
 * GAP-D1 — Spatial Relations Content Script Handler
 *
 * Dispatched by `message-handlers.ts` when the relay sends a
 * `get_spatial_relations` action. Resolves node IDs from the most recent
 * page map, computes pairwise spatial relationships using `spatial-helpers.ts`,
 * and returns a SnapshotEnvelope-wrapped response.
 *
 * @module
 */

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import { getElementByRef } from "./page-map-traversal.js";
import type { Rect } from "./spatial-helpers.js";
import { computeSpatialRelations, MAX_SPATIAL_NODE_IDS } from "./spatial-helpers.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface GetSpatialRelationsPayload {
  nodeIds?: number[];
  tabId?: number;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handle the `get_spatial_relations` relay action.
 *
 * 1. Validates that `nodeIds` is a non-empty array of integers (max 50).
 * 2. Resolves each nodeId to a DOM element via the page map's ref index.
 * 3. Reads `getBoundingClientRect()` for each found element.
 * 4. Calls `computeSpatialRelations()` for pairwise geometry.
 * 5. Wraps the result in a SnapshotEnvelope and returns.
 *
 * @param payload — Raw relay payload with `nodeIds` array
 * @returns `{ data: SpatialRelationsResult }` on success, `{ error: string }` on failure
 */
export function handleGetSpatialRelationsAction(
  payload: unknown,
): Record<string, unknown> {
  // ── Step 1: Parse and validate payload ──────────────────────────────────
  if (typeof payload !== "object" || payload === null) {
    return { error: "invalid-payload" };
  }

  const obj = payload as Record<string, unknown>;

  if (!Array.isArray(obj["nodeIds"])) {
    return { error: "nodeIds-required" };
  }

  const rawNodeIds = obj["nodeIds"] as unknown[];
  const nodeIds: number[] = [];

  for (const id of rawNodeIds) {
    if (typeof id === "number" && Number.isInteger(id) && id >= 0) {
      nodeIds.push(id);
    }
  }

  if (nodeIds.length === 0) {
    return { error: "nodeIds-required" };
  }

  if (nodeIds.length > MAX_SPATIAL_NODE_IDS) {
    return { error: "too-many-nodes" };
  }

  // ── Step 2: Resolve elements and collect bounding boxes ──────────────────
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

  // ── Step 3: Compute pairwise spatial relations ───────────────────────────
  const spatialResult = computeSpatialRelations(nodes);

  // ── Step 4: Build response with SnapshotEnvelope ────────────────────────
  const envelope = captureSnapshotEnvelope("dom");

  const result = {
    ...envelope,
    pageUrl: typeof document !== "undefined" ? document.location?.href ?? "" : "",
    relations: spatialResult.relations,
    nodeCount: spatialResult.nodeCount,
    pairCount: spatialResult.pairCount,
    ...(missingNodeIds.length > 0 ? { missingNodeIds } : {}),
  };

  return { data: result };
}
