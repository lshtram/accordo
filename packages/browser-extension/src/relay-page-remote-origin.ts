/**
 * relay-page-remote-origin.ts — Origin check and main-frame forwarding helpers.
 *
 * Extracted from relay-page-remote-helpers.ts (≤30 lines per function).
 * Handles origin policy checks and forward-to-main-frame with retry.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import { forwardToMainFrame, NO_CONTENT_SCRIPT, reinjectAndForwardToFrame, resolveRequestedUrl } from "./relay-forwarder.js";
import { enrichWithAuditLog, isOriginBlockedByPolicy, mintAuditId, parseOriginPolicy } from "./relay-privacy.js";
import { buildSpatialErrorResponse, readSpatialError } from "./relay-page-spatial-errors.js";
import { buildAuditedSuccess } from "./relay-page-remote-audit.js";

/**
 * Returns null when origin is allowed.
 * Returns a blocked RelayActionResponse when origin is denied.
 */
export async function checkOriginBlocked(
  request: RelayActionRequest,
  tabId: number,
): Promise<RelayActionResponse | null> {
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  if (allowedOrigins === undefined && deniedOrigins === undefined) return null;
  const pageUrl = await resolveRequestedUrl(request.payload);
  let origin = "unknown";
  if (pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }
  if (!isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) return null;
  const auditId = mintAuditId();
  const blockedResp: RelayActionResponse = {
    requestId: request.requestId,
    success: false,
    error: "origin-blocked",
    retryable: false,
    auditId,
  };
  enrichWithAuditLog({
    auditId, toolName: request.action, pageId: `tab-${tabId}`, origin,
    action: "blocked", redacted: false, durationMs: 0,
    response: blockedResp as unknown as Record<string, unknown>,
  });
  return blockedResp;
}

/**
 * Forwards to main frame; if NO_CONTENT_SCRIPT, retries via reinjectAndForwardToFrame.
 * Returns null when both attempts return NO_CONTENT_SCRIPT or null.
 */
export async function forwardToMainOrRetry(
  request: RelayActionRequest,
  tabId: number,
): Promise<null | { data: unknown }> {
  let data = await forwardToMainFrame(tabId, request.action, request.payload);
  if (data === NO_CONTENT_SCRIPT) {
    data = await reinjectAndForwardToFrame(tabId, 0, request.action, request.payload);
    if (data === NO_CONTENT_SCRIPT || data === null) return null;
  } else if (data === null) {
    return null;
  }
  return { data };
}

export function isRelayActionResponse(data: unknown): data is RelayActionResponse {
  return typeof data === "object" && data !== null
    && typeof (data as { requestId?: unknown }).requestId === "string"
    && typeof (data as { success?: unknown }).success === "boolean";
}

export function unwrapForwardData(
  request: RelayActionRequest,
  data: unknown,
): RelayActionResponse | unknown {
  const spatialError = readSpatialError(request.action, data);
  if (spatialError) return buildSpatialErrorResponse(request, spatialError);
  return data;
}

export async function saveForwardedSnapshot(
  data: unknown,
  saveToStore: boolean,
): Promise<unknown> {
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }
  return data;
}

/**
 * Main-frame forward with redaction + audit.
 * Combines forward/unwrap/save/audit into a single call.
 */
export async function forwardMainWithAudit(
  request: RelayActionRequest,
  tabId: number,
  saveToStore: boolean,
): Promise<RelayActionResponse | null> {
  const result = await forwardToMainOrRetry(request, tabId);
  if (result === null) return null;
  const data = unwrapForwardData(request, result.data);
  if (isRelayActionResponse(data)) return data;
  const saved = await saveForwardedSnapshot(data, saveToStore);
  return buildAuditedSuccess(request, saved);
}
