/**
 * relay-get-page-map-origin.ts — Origin-blocked check for relay-get-page-map.ts.
 *
 * Handles the remote (non-document) origin policy check.
 * Returns a blocked response or null when allowed.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { resolveRequestedUrl } from "./relay-forwarder.js";
import { enrichWithAuditLog, isOriginBlockedByPolicy, mintAuditId, parseOriginPolicy } from "./relay-privacy.js";

/**
 * Checks origin policy for the remote (tab) path in handleGetPageMap.
 * Returns a blocked response or null when allowed.
 */
export async function checkGetPageMapOrigin(
  request: RelayActionRequest,
  tabId: number,
): Promise<RelayActionResponse | null> {
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  if (allowedOrigins === undefined && deniedOrigins === undefined) return null;
  const startMs = Date.now();
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
    action: "blocked", redacted: false, durationMs: Date.now() - startMs,
    response: blockedResp as unknown as Record<string, unknown>,
  });
  return blockedResp;
}
