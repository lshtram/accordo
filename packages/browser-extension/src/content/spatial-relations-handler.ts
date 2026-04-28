/**
 * GAP-D1 — Spatial Relations Content Script Handler
 *
 * Dispatched by `message-handlers.ts` when the relay sends a
 * `get_spatial_relations` action.
 *
 * Coordinator (handleGetSpatialRelationsAction <= 30 lines).
 * Validation/computation helpers in spatial-relations-handler-helpers.ts.
 *
 * @module
 */

import {
  validateAndClassify,
  checkOwnerFrameContract,
  resolveAndCompute,
  buildSpatialResponse,
} from "./spatial-relations-handler-helpers.js";

// ── Handler coordinator (<= 30 lines) ───────────────────────────────────────

export function handleGetSpatialRelationsAction(
  payload: unknown,
): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return { error: "invalid-payload" };
  const obj = payload as Record<string, unknown>;

  const validation = validateAndClassify(obj);
  if (!validation.ok) return { error: validation.error };

  const ownerErr = checkOwnerFrameContract(validation.request);
  if (ownerErr) return { error: ownerErr };

  const resolveResult = resolveAndCompute(validation.request);
  if (resolveResult.error) return { error: resolveResult.error };

  return buildSpatialResponse(validation.request, resolveResult.resolvedNodeIds, resolveResult.spatialResult, resolveResult.missingNodeIds);
}