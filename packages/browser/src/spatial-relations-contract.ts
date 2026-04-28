/**
 * spatial-relations-contract.ts — Request contract (facade)
 *
 * Input schema definition and runtime argument narrowing for
 * browser_get_spatial_relations.
 * Narrowing helpers extracted to spatial-relations-contract-narrow.ts.
 *
 * @module
 */

import type { GetSpatialRelationsArgs } from "./page-tool-meta-types.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";
import {
  narrowSnapshotId,
  narrowNodeIds,
  narrowUids,
  narrowTabId,
  narrowOrigins,
  hasNonEmptyNodeIds,
  hasNonEmptyUids,
} from "./spatial-relations-contract-narrow.js";

// ── Input Schema ────────────────────────────────────────────────────────────

// Type the schema as a plain object, explicitly annotating the required field
// to avoid "readonly tuple" inference issues from `as const`.
type SpatialInputSchema = {
  type: "object";
  properties: {
    tabId?: { type: "number"; description: string };
    snapshotId: { type: "string"; description: string };
    nodeIds?: { type: "array"; items: { type: "integer" }; description: string; minItems: number; maxItems: number };
    uids?: { type: "array"; items: { type: "string" }; description: string; minItems: number; maxItems: number };
    allowedOrigins?: { type: "array"; items: { type: "string" }; description: string };
    deniedOrigins?: { type: "array"; items: { type: "string" }; description: string };
  };
  required: string[];
};

export const SPATIAL_INPUT_SCHEMA: SpatialInputSchema = {
  type: "object",
  properties: {
    tabId: {
      type: "number",
      description: IMPLICIT_TARGET_TAB_DESCRIPTION,
    },
    snapshotId: {
      type: "string",
      description:
        "snapshotId from a prior get_page_map response. " +
        "Required for spatial relations requests. " +
        "Format: '{pageId}:{version}'.",
    },
    nodeIds: {
      type: "array",
      items: { type: "integer" },
      description:
        "Node IDs from a prior get_page_map call (with includeBounds: true). " +
        "Maximum 50 requested identities — pairwise computation is O(n²). " +
        "Alternative to uids. nodeIds and uids are mutually exclusive.",
      minItems: 1,
      maxItems: 50,
    },
    uids: {
      type: "array",
      items: { type: "string" },
      description:
        "Canonical node identities from a prior get_page_map call. " +
        'Format: "{frameId}:{nodeId}" (e.g. "main:3"). Alternative to nodeIds. ' +
        "All uids must be from the same frame. nodeIds and uids are mutually exclusive.",
      minItems: 1,
      maxItems: 50,
    },
    allowedOrigins: {
      type: "array",
      items: { type: "string" },
      description: "Only allow data from these origins. Empty = use global policy.",
    },
    deniedOrigins: {
      type: "array",
      items: { type: "string" },
      description: "Block data from these origins. Takes precedence over allowedOrigins.",
    },
  },
  required: ["snapshotId"],
};

// ── Runtime type guards ────────────────────────────────────────────────────────

/**
 * Narrow an unknown value to GetSpatialRelationsArgs.
 * Validates required snapshotId and at least one non-empty array of nodeIds or uids.
 * (<= 30 lines — delegates to helpers)
 */
export function narrowSpatialArgs(raw: unknown): GetSpatialRelationsArgs | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const snapshotId = narrowSnapshotId(obj);
  if (snapshotId === null) return null;

  const result: GetSpatialRelationsArgs = { snapshotId };
  narrowNodeIds(obj, result);
  narrowUids(obj, result);

  if (!hasNonEmptyNodeIds(obj) && !hasNonEmptyUids(obj)) return null;
  narrowTabId(obj, result);
  narrowOrigins(obj, result);

  return result;
}