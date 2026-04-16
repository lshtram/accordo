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
import { getElementByRef, getUidByNodeId } from "./page-map-traversal.js";
import type { Rect } from "./spatial-helpers.js";
import { computeSpatialRelations, MAX_SPATIAL_NODE_IDS } from "./spatial-helpers.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface GetSpatialRelationsPayload {
  nodeIds?: number[];
  /** B2-UID-001: Canonical uid strings "{frameId}:{nodeId}". */
  uids?: string[];
  tabId?: number;
}

/**
 * Parse a uid string "{frameId}:{nodeId}" and return the nodeId.
 * Returns null if the uid format is invalid.
 */
function parseUid(uid: string): number | null {
  const colonIdx = uid.indexOf(":");
  if (colonIdx < 0) return null;
  const nodeIdStr = uid.slice(colonIdx + 1);
  const nodeId = parseInt(nodeIdStr, 10);
  return isNaN(nodeId) ? null : nodeId;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handle the `get_spatial_relations` relay action.
 *
 * 1. Validates that at least one of `nodeIds` or `uids` is a non-empty array (max 50 total).
 * 2. Resolves each nodeId/uid to a DOM element via the page map's ref index.
 * 3. Reads `getBoundingClientRect()` for each found element.
 * 4. Calls `computeSpatialRelations()` for pairwise geometry.
 * 5. Wraps the result in a SnapshotEnvelope and returns.
 *
 * @param payload — Raw relay payload with `nodeIds` or `uids` array
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

  const rawNodeIds = (obj["nodeIds"] as unknown[] | undefined) ?? [];
  const rawUids = (obj["uids"] as string[] | undefined) ?? [];

  if (!Array.isArray(rawNodeIds) && !Array.isArray(rawUids)) {
    return { error: "nodeIds-required" };
  }

  // Collect numeric nodeIds
  const nodeIds: number[] = [];
  if (Array.isArray(rawNodeIds)) {
    for (const id of rawNodeIds) {
      if (typeof id === "number" && Number.isInteger(id) && id >= 0) {
        nodeIds.push(id);
      }
    }
  }

  // B2-UID-001: Parse uids and extract nodeIds
  if (Array.isArray(rawUids)) {
    for (const uid of rawUids) {
      if (typeof uid !== "string") continue;
      const parsed = parseUid(uid);
      if (parsed !== null && !nodeIds.includes(parsed)) {
        nodeIds.push(parsed);
      }
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

  // B2-UID-001: Enrich each relation with sourceUid and targetUid
  const relations = spatialResult.relations.map((rel) => {
    const sourceUid = getUidByNodeId(rel.sourceNodeId);
    const targetUid = getUidByNodeId(rel.targetNodeId);
    return {
      ...rel,
      ...(sourceUid !== undefined ? { sourceUid } : {}),
      ...(targetUid !== undefined ? { targetUid } : {}),
    };
  });

  const result = {
    ...envelope,
    pageUrl: typeof document !== "undefined" ? document.location?.href ?? "" : "",
    relations,
    nodeCount: spatialResult.nodeCount,
    pairCount: spatialResult.pairCount,
    ...(missingNodeIds.length > 0 ? { missingNodeIds } : {}),
  };

  return { data: result };
}
