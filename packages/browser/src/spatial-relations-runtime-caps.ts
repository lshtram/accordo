/**
 * spatial-relations-runtime-caps.ts — Count-cap + response-guard helpers.
 *
 * Extracted from spatial-relations-runtime-helpers.ts.
 * Each function <= 30 lines.
 *
 * @module
 */

import { buildSpatialError, classifySpatialError } from "./spatial-relations-error-map.js";
import type { SpatialRelationsToolError } from "./spatial-relations-tool.js";

// Stage 3 — count cap gate
export function checkCountCap(
  nodeIds: unknown[] | undefined,
  uids: unknown[] | undefined,
): SpatialRelationsToolError | null {
  const total = (nodeIds?.length ?? 0) + (uids?.length ?? 0);
  if (total > 50) return buildSpatialError("too-many-nodes");
  return null;
}

// Stage 3 — response guard
export function guardResponseObject(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== "object") return null;
  return response as Record<string, unknown>;
}