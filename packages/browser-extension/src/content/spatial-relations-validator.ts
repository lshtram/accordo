/**
 * GAP-D1 — Spatial Relations Validation Pipeline (content-script)
 *
 * Implements the fixed validation/error precedence for get_spatial_relations:
 * 1. request shape/raw-count validation -> invalid-request
 * 2. snapshotId type/shape validation -> invalid-request
 * 3. UID validation and same-frame validation -> invalid-request
 * 4. nodeIds[] main-frame rule / mixed nodeIds+uids -> invalid-request
 * 5. Snapshot classification: current owner, stale, not-found
 *
 * @module
 */

import {
  validateUidsArray,
  validateNodeIdsArray,
} from "./spatial-relations-validate.js";
import { mapSpatialValidationError } from "./spatial-relations-errors.js";
import { validateSnapshotIdShape } from "./spatial-shape-steps.js";
import {
  isKnownPageMapOwner,
  isCurrentOwner,
} from "./spatial-snapshot-registry.js";

// ── Validation pipeline result types ─────────────────────────────────────────

export interface ValidatedSpatialRequest {
  snapshotId: string;
  nodeIds: number[];
  uids: string[];
  frameId: string | undefined;
  hasNodeIds: boolean;
  hasUids: boolean;
}

export type ValidationFailure =
  | { ok: false; error: string }
  | { ok: true; request: ValidatedSpatialRequest };

// ── Step 1: non-empty array + count cap ───────────────────────────────────────

function step1ShapeAndCap(
  rawNodeIds: unknown[],
  rawUids: unknown[],
): ValidationFailure | null {
  if (!Array.isArray(rawNodeIds) && !Array.isArray(rawUids)) {
    return { ok: false, error: "nodeIds-required" };
  }
  if (rawNodeIds.length === 0 && rawUids.length === 0) {
    return { ok: false, error: "nodeIds-required" };
  }
  if (rawNodeIds.length + rawUids.length > 50) {
    return { ok: false, error: "too-many-nodes" };
  }
  return null;
}

// ── Step 3: UID validation + same-frame ───────────────────────────────────────

function validateStep3Uids(
  rawUids: unknown[],
): { ok: true; frameId: string | undefined; validUids: string[] } | { ok: false; error: string } {
  const uidsResult = validateUidsArray(rawUids);
  if (!uidsResult.valid) {
    return { ok: false, error: mapSpatialValidationError(uidsResult.reason).error };
  }
  return { ok: true, frameId: uidsResult.frameId, validUids: uidsResult.uids };
}

// ── Step 4: nodeId type + mixed nodeIds+uids check ─────────────────────────────

function step4NodeIdsAndMixed(
  rawNodeIds: unknown[] | undefined,
  validUids: string[],
): { ok: true; validNodeIds: number[] } | ValidationFailure {
  if (rawNodeIds === undefined) {
    return { ok: true, validNodeIds: [] };
  }
  const result = validateNodeIdsArray(rawNodeIds);
  if (!result.valid) {
    return { ok: false, error: mapSpatialValidationError(result.reason).error };
  }
  if (result.nodeIds.length > 0 && validUids.length > 0) {
    return { ok: false, error: mapSpatialValidationError("mixed nodeIds and uids not allowed").error };
  }
  return { ok: true, validNodeIds: result.nodeIds };
}

// ── Request assembly ──────────────────────────────────────────────────────────

function assembleSpatialRequest(
  snapshotId: string,
  validNodeIds: number[],
  validUids: string[],
  frameId: string | undefined,
): ValidatedSpatialRequest {
  return {
    snapshotId,
    nodeIds: validNodeIds,
    uids: validUids,
    frameId,
    hasNodeIds: validNodeIds.length > 0,
    hasUids: validUids.length > 0,
  };
}

// ── Steps 1–4: main entry point ───────────────────────────────────────────────

/** Validates steps 1-4: shape, snapshotId, UIDs, and nodeIds. */
export function validateSpatialShape(
  obj: Record<string, unknown>,
): ValidationFailure {
  const normalizedObj = normalizeAdapterIdentityPlaceholders(obj);
  const rawNodeIds = (normalizedObj["nodeIds"] as unknown[] | undefined) ?? [];
  const rawUids = (normalizedObj["uids"] as unknown[] | undefined) ?? [];

  const shapeCheck = step1ShapeAndCap(rawNodeIds, rawUids);
  if (shapeCheck) return shapeCheck;

  const snapshotIdResult = validateSnapshotIdShape(normalizedObj["snapshotId"]);
  if (!snapshotIdResult.ok) return snapshotIdResult;
  const snapshotId = (snapshotIdResult as { ok: true; snapshotId: string }).snapshotId;

  let frameId: string | undefined;
  let validUids: string[] = [];
  if (rawUids.length > 0) {
    const uidsResult = validateStep3Uids(rawUids);
    if (!uidsResult.ok) return uidsResult;
    frameId = uidsResult.frameId;
    validUids = uidsResult.validUids;
  }

  const nodeIdsResult = step4NodeIdsAndMixed(normalizedObj["nodeIds"] as unknown[] | undefined, validUids);
  if (!nodeIdsResult.ok) return nodeIdsResult;
  const validNodeIds = (nodeIdsResult as { ok: true; validNodeIds: number[] }).validNodeIds;

  return { ok: true, request: assembleSpatialRequest(snapshotId, validNodeIds, validUids, frameId) };
}

function normalizeAdapterIdentityPlaceholders(obj: Record<string, unknown>): Record<string, unknown> {
  const nodeIds = obj["nodeIds"];
  const uids = obj["uids"];
  const hasNodeIds = Array.isArray(nodeIds) && nodeIds.length > 0;
  const hasUids = Array.isArray(uids) && uids.length > 0;
  if (hasNodeIds && hasUids && uids.length === 1 && uids[0] === "") {
    return { ...obj, uids: [] };
  }
  return obj;
}

// ── Step 5: Snapshot classification ──────────────────────────────────────────

/**
 * Classify a validated snapshotId against the page-map-owner registry.
 */
export function classifySpatialSnapshot(
  snapshotId: string,
): "current" | "not-found" | "stale" {
  if (!isKnownPageMapOwner(snapshotId)) return "not-found";
  if (!isCurrentOwner(snapshotId)) return "stale";
  return "current";
}
