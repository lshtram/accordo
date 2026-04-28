/**
 * relay-page-remote-audit.ts — Redaction and audit helpers for page-remote relay.
 *
 * Extracted from relay-page-remote-helpers.ts (≤30 lines per function).
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { resolveRequestedUrl } from "./relay-forwarder.js";
import { applyRedaction, attachRedactionWarning, enrichWithAuditLog, mintAuditId } from "./relay-privacy.js";

/**
 * Applies PII redaction to forwarded data.
 * Returns null on redaction failure (caller should return action-failed).
 */
export function redactForwardedData(
  request: RelayActionRequest,
  data: unknown,
): unknown | null {
  const redactPII = request.payload.redactPII === true;
  if (!redactPII) return data;
  try {
    const redactionResult = applyRedaction(data);
    if (redactionResult.data !== null && typeof redactionResult.data === "object") {
      (redactionResult.data as Record<string, unknown>)["redactionApplied"] = redactionResult.redactionApplied;
    }
    return redactionResult.data;
  } catch {
    return null;
  }
}

/**
 * Builds a success response with audit log for forwarded page data.
 */
export async function buildAuditedSuccess(
  request: RelayActionRequest,
  data: unknown,
): Promise<RelayActionResponse | null> {
  const pageUrl = await resolveRequestedUrl(request.payload);
  let origin = "unknown";
  if (pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }
  const redacted = redactForwardedData(request, data);
  if (redacted === null) return null;
  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  const response: RelayActionResponse = { requestId: request.requestId, success: true, data: redacted, auditId };
  attachRedactionWarning(response, redactPII);
  enrichWithAuditLog({
    auditId, toolName: request.action,
    pageId: typeof redacted === "object" && redacted !== null ? (redacted as { pageId?: string }).pageId ?? "" : "",
    origin, action: "allowed", redacted: redactPII,
    durationMs: 0,
    response: response as unknown as Record<string, unknown>,
  });
  return response;
}
