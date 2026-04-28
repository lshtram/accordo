/**
 * GAP-D1 — Spatial Relations Response Narrowing
 *
 * Runtime response narrowing for SpatialRelationsResponse.
 *
 * @module
 */

import type { SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SpatialRelationsResponse } from "./page-tool-meta-types.js";

/**
 * Narrow an unknown relay data payload to SpatialRelationsResponse.
 * Returns undefined when the payload is not valid.
 */
export function narrowSpatialRelationsResponse(
  data: unknown,
): SpatialRelationsResponse | undefined {
  if (typeof data !== "object" || data === null) return undefined;

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj["relations"])) return undefined;
  if (typeof obj["nodeCount"] !== "number") return undefined;
  if (typeof obj["pairCount"] !== "number") return undefined;
  if (typeof obj["pageUrl"] !== "string") return undefined;

  if (!hasSnapshotEnvelope(data)) return undefined;

  return data as SpatialRelationsResponse;
}

/**
 * Extract pageId from a relay response data payload.
 */
export function extractPageId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  return (data as SnapshotEnvelopeFields).pageId;
}
