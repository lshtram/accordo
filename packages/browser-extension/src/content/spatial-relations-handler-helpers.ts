/**
 * GAP-D1 — Spatial Relations Handler Helpers
 *
 * Extracted from spatial-relations-handler.ts so the coordinator stays <= 30 lines.
 * Each helper <= 30 lines.
 *
 * @module
 */

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import { getUidByNodeId } from "./page-map-traversal.js";
import { computeSpatialRelations, MAX_SPATIAL_NODE_IDS } from "./spatial-helpers.js";
import { validateSpatialShape, classifySpatialSnapshot, type ValidatedSpatialRequest } from "./spatial-relations-validator.js";
import { mapSpatialValidationError } from "./spatial-relations-errors.js";
import { getOwnerFrameIdForSnapshot } from "./spatial-snapshot-registry.js";
import { resolveUidsToNodeIds, collectBoundingBoxes } from "./spatial-node-resolution.js";

// ── Validation + classification ─────────────────────────────────────────────

interface ValidationResult {
  ok: true;
  request: ValidatedSpatialRequest;
  classification: "current";
}

export function validateAndClassify(
  obj: Record<string, unknown>,
): { ok: false; error: string } | ValidationResult {
  const shapeResult = validateSpatialShape(obj);
  if (!shapeResult.ok) return { ok: false, error: shapeResult.error };
  const classification = classifySpatialSnapshot(shapeResult.request.snapshotId);
  if (classification === "not-found") return { ok: false, error: mapSpatialValidationError("snapshot-not-found").error };
  if (classification === "stale") return { ok: false, error: mapSpatialValidationError("snapshot-stale").error };
  return { ok: true, request: shapeResult.request, classification: "current" };
}

// ── Owner-frame contract validation ─────────────────────────────────────────

export function checkOwnerFrameContract(request: ValidatedSpatialRequest): string | null {
  const ownerFrame = getOwnerFrameIdForSnapshot(request.snapshotId);
  if (request.hasNodeIds && ownerFrame !== undefined && ownerFrame !== "main") {
    return mapSpatialValidationError("nodeIds are only supported for main-frame owner snapshots").error;
  }
  if (request.hasUids) {
    const uidsFrame = request.frameId;
    if (ownerFrame !== undefined && uidsFrame !== undefined && uidsFrame !== ownerFrame) {
      return mapSpatialValidationError("uids must target the same frame as the owner snapshot").error;
    }
  }
  return null;
}

// ── Response shaping ──────────────────────────────────────────────────────────

interface SpatialComputationResult {
  relations: readonly { sourceNodeId: number; targetNodeId: number; leftOf: boolean; above: boolean; contains: boolean; containedBy: boolean; overlap: number; distance: number }[];
  nodeCount: number;
  pairCount: number;
}

export function buildSpatialResponse(
  request: ValidatedSpatialRequest,
  resolvedNodeIds: number[],
  spatialResult: SpatialComputationResult,
  missingNodeIds: number[],
): Record<string, unknown> {
  const envelope = captureSnapshotEnvelope("dom");
  const relations = spatialResult.relations.map((rel) => {
    const sourceUid = getUidByNodeId(rel.sourceNodeId);
    const targetUid = getUidByNodeId(rel.targetNodeId);
    return {
      ...rel,
      ...(sourceUid !== undefined ? { sourceUid } : {}),
      ...(targetUid !== undefined ? { targetUid } : {}),
    };
  });
  return {
    data: {
      ...envelope,
      pageUrl: typeof document !== "undefined" ? document.location?.href ?? "" : "",
      relations,
      nodeCount: spatialResult.nodeCount,
      pairCount: spatialResult.pairCount,
      ...(missingNodeIds.length > 0 ? { missingNodeIds } : {}),
    },
  };
}

// ── Resolution + computation pipeline ─────────────────────────────────────────

interface ResolveResult {
  resolvedNodeIds: number[];
  missingNodeIds: number[];
  spatialResult: SpatialComputationResult;
  error?: string;
}

export function resolveAndCompute(
  request: ValidatedSpatialRequest,
): ResolveResult {
  const resolvedNodeIds = resolveUidsToNodeIds(request.uids, request.nodeIds);
  if (resolvedNodeIds.length === 0) return { resolvedNodeIds: [], missingNodeIds: [], spatialResult: { relations: [], nodeCount: 0, pairCount: 0 }, error: "nodeIds-required" };
  if (resolvedNodeIds.length > MAX_SPATIAL_NODE_IDS) return { resolvedNodeIds: [], missingNodeIds: [], spatialResult: { relations: [], nodeCount: 0, pairCount: 0 }, error: "too-many-nodes" };
  const { nodes, missingNodeIds } = collectBoundingBoxes(resolvedNodeIds);
  const spatialResult = computeSpatialRelations(nodes);
  return { resolvedNodeIds, missingNodeIds, spatialResult };
}