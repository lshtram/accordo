/**
 * GAP-D1 — Spatial Relations MCP Tool
 *
 * Defines the `browser_get_spatial_relations` MCP tool that gives AI agents
 * the ability to query pairwise spatial relationships between page elements.
 *
 * The tool takes a list of node IDs (from a prior `get_page_map` call with
 * `includeBounds: true`) and a snapshotId, and returns directional,
 * containment, overlap, and distance relationships for all pairs.
 *
 * Architecture (modularity split per B5a):
 * - Tool definition lives here (follows `semantic-graph-tool.ts` pattern)
 * - Runtime handler in `spatial-relations-runtime.ts`
 * - Contract/input schema in `spatial-relations-contract.ts`
 * - Geometry computation runs in the content script (`spatial-helpers.ts`)
 * - Relay action: `get_spatial_relations`
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import {
  buildStructuredError,
  type GetSpatialRelationsArgs,
  type SpatialRelationsResponse,
  type PageToolError,
} from "./page-tool-meta-types.js";
import { SPATIAL_INPUT_SCHEMA, narrowSpatialArgs } from "./spatial-relations-contract.js";
import { handleGetSpatialRelationsRuntime } from "./spatial-relations-runtime.js";

// ── Tool Result Types ─────────────────────────────────────────────────────────

/**
 * Error response from the spatial relations tool.
 * First-class structured errors: invalid-request, snapshot-not-found, snapshot-stale.
 */
export interface SpatialRelationsToolError {
  success: false;
  error:
    | "browser-not-connected"
    | "timeout"
    | "invalid-request"
    | "snapshot-not-found"
    | "snapshot-stale"
    | "origin-blocked"
    | "too-many-nodes"
    | "no-bounds";
}

// ── Tool Definition ────────────────────────────────────────────────────────

/**
 * Build the `browser_get_spatial_relations` tool definition.
 *
 * GAP-D1: Registers a separate MCP tool with dangerLevel "safe"
 * and idempotent: true. Takes node IDs or uids from a prior page map
 * and returns pairwise spatial relationships.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store
 * @param security — Security configuration
 * @returns A single tool definition for `browser_get_spatial_relations`
 */
export function buildSpatialRelationsTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_spatial_relations",
    description:
      "Compute pairwise spatial relationships between page elements. " +
      "Takes node IDs or uids from a prior get_page_map call (with includeBounds: true) " +
      "and returns directional (leftOf, above), containment, overlap (IoU), " +
      "and distance relationships for all pairs. " +
      "Maximum 50 requested identities per request. " +
      "B2-UID-001: Pass uids (\"{frameId}:{nodeId}\") instead of nodeIds for cross-frame identity. " +
      "Requires snapshotId from the get_page_map response.",
    inputSchema: SPATIAL_INPUT_SCHEMA,
    dangerLevel: "safe",
    idempotent: true,
    handler: async (
      rawArgs,
    ): Promise<SpatialRelationsResponse | SpatialRelationsToolError | PageToolError> => {
      const args = narrowSpatialArgs(rawArgs);
      if (!args) {
        return buildStructuredError(
          "invalid-request",
          "snapshotId is required and nodeIds or uids must be a non-empty array",
        );
      }
      return handleGetSpatialRelationsRuntime(relay, args, store, security);
    },
  };
}
