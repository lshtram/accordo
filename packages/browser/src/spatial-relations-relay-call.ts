/**
 * GAP-D1 — Spatial Relations Relay Call
 *
 * Constructs the relay request payload and issues the forward call.
 * Single responsibility: serialize args into the wire format and await response.
 *
 * @module
 */

import type { BrowserRelayLike } from "./types.js";
import type { GetSpatialRelationsArgs } from "./page-tool-meta-types.js";
import { SPATIAL_RELATIONS_TIMEOUT_MS } from "./page-tool-meta-types.js";

/**
 * Build the wire payload for get_spatial_relations from typed args.
 */
export function buildSpatialPayload(args: GetSpatialRelationsArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = { snapshotId: args.snapshotId };
  if (args.nodeIds !== undefined && args.nodeIds.length > 0) {
    payload["nodeIds"] = args.nodeIds;
  }
  if (args.uids !== undefined && args.uids.length > 0) {
    payload["uids"] = args.uids;
  }
  if (args.tabId !== undefined) {
    payload["tabId"] = args.tabId;
  }
  return payload;
}

/**
 * Forward a spatial relations request through the relay.
 * Returns the raw RelayActionResponse — callers handle error classification.
 */
export async function forwardSpatialRelations(
  relay: BrowserRelayLike,
  args: GetSpatialRelationsArgs,
): Promise<unknown> {
  const payload = buildSpatialPayload(args);
  return relay.request("get_spatial_relations", payload, SPATIAL_RELATIONS_TIMEOUT_MS);
}
