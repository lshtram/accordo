/**
 * GAP-D1 — Spatial Relations Relay Page Remote
 *
 * Implements snapshot-aware relay routing for get_spatial_relations:
 * - frame derives only from validated payload.uids[] via canonical UID parser
 * - legacy payload.frameId / singular payload.uid are ignored for routing
 * - nodeIds[] path routes to main frame
 * - malformed/mixed-frame/mixed uids[] falls through to main frame (content → invalid-request)
 *
 * For all other actions: delegates to existing frame routing (payload.frameId / singular uid).
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { resolveTargetTabId } from "./relay-forwarder.js";
import { checkOriginBlocked, forwardMainWithAudit } from "./relay-page-remote-origin.js";
import { getSpatialRoutingFrame, deriveFrameId } from "./relay-page-remote-helpers.js";

// ── Spatial branch handler ───────────────────────────────────────────────────

async function handleSpatialBranch(
  request: RelayActionRequest,
  tabId: number,
  saveToStore: boolean,
  handleFrameIdRequest: ((request: RelayActionRequest, tabId: number, frameId: string, saveToStore: boolean) => Promise<RelayActionResponse>) | undefined,
): Promise<RelayActionResponse | null> {
  const spatialFrame = getSpatialRoutingFrame(request.payload as Record<string, unknown>);
  if (spatialFrame === "main") {
    const result = await forwardMainWithAudit(request, tabId, saveToStore);
    if (result === null) return actionFailed(request, "no-content-script");
    return result;
  }
  if (spatialFrame !== undefined && handleFrameIdRequest) {
    return handleFrameIdRequest(request, tabId, spatialFrame, saveToStore);
  }
  return null; // fall through
}

// ── Generic frame routing ────────────────────────────────────────────────────

async function handleGenericFrameRouting(
  request: RelayActionRequest,
  tabId: number,
  saveToStore: boolean,
  handleFrameIdRequest?: (request: RelayActionRequest, tabId: number, frameId: string, saveToStore: boolean) => Promise<RelayActionResponse>,
): Promise<RelayActionResponse | null> {
  const frameId = deriveFrameId(request.payload as Record<string, unknown>);
  if (frameId === undefined) return null;
  if (!handleFrameIdRequest) return actionFailed(request, "action-failed");
  return handleFrameIdRequest(request, tabId, frameId, saveToStore);
}

// ── Main handler coordinator (<= 30 lines) ─────────────────────────────────

export async function handleRemotePageUnderstandingAction(
  request: RelayActionRequest,
  saveToStore: boolean,
  handleFrameIdRequest?: (request: RelayActionRequest, tabId: number, frameId: string, saveToStore: boolean) => Promise<RelayActionResponse>,
): Promise<RelayActionResponse> {
  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) return actionFailed(request);

  const blocked = await checkOriginBlocked(request, tabId);
  if (blocked) return blocked;

  // GAP-D1: get_spatial_relations — spatial branch
  if (request.action === "get_spatial_relations") {
    const spatial = await handleSpatialBranch(request, tabId, saveToStore, handleFrameIdRequest);
    if (spatial !== null) return spatial;
  }

  // All other actions — generic frame routing
  const generic = await handleGenericFrameRouting(request, tabId, saveToStore, handleFrameIdRequest);
  if (generic !== null) return generic;

  // Default main-frame path
  const result = await forwardMainWithAudit(request, tabId, saveToStore);
  if (result === null) return actionFailed(request, "no-content-script");
  return result;
}