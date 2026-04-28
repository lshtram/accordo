/**
 * GAP-D1 — Spatial Relations Error Classification
 *
 * Maps relay-level and content-script errors to canonical error codes.
 * Ensures first-class spatial-relations error codes propagate correctly
 * through the browser package boundary.
 *
 * @module
 */

import { buildStructuredError } from "./page-tool-meta-types.js";
import type { SpatialRelationsToolError } from "./spatial-relations-tool.js";

type SpatialErrorCode =
  | "browser-not-connected"
  | "timeout"
  | "invalid-request"
  | "snapshot-not-found"
  | "snapshot-stale"
  | "origin-blocked"
  | "too-many-nodes";

const VALID_ERROR_CODES: SpatialErrorCode[] = [
  "browser-not-connected",
  "timeout",
  "invalid-request",
  "snapshot-not-found",
  "snapshot-stale",
  "origin-blocked",
  "too-many-nodes",
];

/**
 * Classify a raw relay error code into a canonical spatial error.
 * Unknown codes map to "action-failed".
 */
export function classifySpatialError(raw: string | undefined): SpatialErrorCode | "action-failed" {
  if (raw === undefined) return "action-failed";
  return VALID_ERROR_CODES.includes(raw as SpatialErrorCode)
    ? (raw as SpatialErrorCode)
    : "action-failed";
}

/**
 * Build a structured error from a classified error code.
 * Includes a details message for too-many-nodes.
 */
export function buildSpatialError(code: SpatialErrorCode | "action-failed"): SpatialRelationsToolError {
  if (code === "too-many-nodes") {
    return buildStructuredError(code, "Maximum 50 requested identities allowed") as SpatialRelationsToolError;
  }
  // action-failed is a valid runtime error; cast through PageToolError which accepts any error string
  return buildStructuredError(code) as SpatialRelationsToolError;
}
