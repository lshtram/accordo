/**
 * GAP-D1 — Spatial Relations Tool Runtime
 *
 * Orchestrates audit, relay forwarding, response validation, and origin policy
 * for browser_get_spatial_relations.
 *
 * @module
 */

import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import type { SpatialRelationsToolError } from "./spatial-relations-tool.js";
import { buildStructuredError, type GetSpatialRelationsArgs, type SpatialRelationsResponse } from "./page-tool-meta-types.js";
import { beginSpatialAudit } from "./spatial-relations-audit.js";
import {
  guardCapAndAudit,
  forwardWithAudit,
  classifyRelayErrorResponse,
  narrowAndStore,
} from "./spatial-relations-runtime-relay.js";

// Handler (14 lines)
export async function handleGetSpatialRelationsRuntime(
  relay: BrowserRelayLike,
  args: GetSpatialRelationsArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): Promise<SpatialRelationsToolError | SpatialRelationsResponse> {
  if (!relay.isConnected()) return buildStructuredError("browser-not-connected") as SpatialRelationsToolError;
  const { entry, startTime } = beginSpatialAudit(security);
  const capErr = guardCapAndAudit(security, entry, startTime, args.nodeIds, args.uids);
  if (capErr) return capErr;
  const resp = await forwardWithAudit(relay, args, security, entry, startTime);
  if ("error" in resp) return resp as SpatialRelationsToolError;
  const relayErr = classifyRelayErrorResponse(resp, security, entry, startTime);
  if (relayErr) return relayErr;
  return narrowAndStore(resp, store, security, args, entry, startTime);
}
