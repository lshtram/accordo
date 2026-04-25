import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import { ensureContentScriptInjected, forwardToMainFrame, NO_CONTENT_SCRIPT, resolveRequestedUrl, resolveTargetTabId } from "./relay-forwarder.js";
import { attachRedactionWarning, enrichWithAuditLog, isOriginBlockedByPolicy, mintAuditId, parseOriginPolicy, applyRedaction } from "./relay-privacy.js";

export async function handleRemotePageUnderstandingAction(
  request: RelayActionRequest,
  saveToStore: boolean,
  handleFrameIdRequest?: (request: RelayActionRequest, tabId: number, frameId: string, saveToStore: boolean) => Promise<RelayActionResponse>,
): Promise<RelayActionResponse> {
  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
  }

  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
    const pageUrl = await resolveRequestedUrl(request.payload);
    let origin = "unknown";
    if (pageUrl) {
      try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
    }
    if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
      const auditId = mintAuditId();
      const blockedResp: RelayActionResponse = {
        requestId: request.requestId,
        success: false,
        error: "origin-blocked",
        retryable: false,
        auditId,
      };
      enrichWithAuditLog({ auditId, toolName: request.action, pageId: `tab-${tabId}`, origin, action: "blocked", redacted: false, durationMs: 0, response: blockedResp as unknown as Record<string, unknown> });
      return blockedResp;
    }
  }

  const rawFrameId = request.payload.frameId;
  const uid = typeof request.payload.uid === "string" ? request.payload.uid : undefined;
  const uidFrameId = uid && uid.includes(":") ? uid.slice(0, uid.lastIndexOf(":")) : undefined;
  const frameId = typeof rawFrameId === "string" && rawFrameId.trim().length > 0 ? rawFrameId : uidFrameId;
  if (frameId !== undefined) {
    if (!handleFrameIdRequest) {
      return actionFailed(request, "action-failed");
    }
    return handleFrameIdRequest(request, tabId, frameId, saveToStore);
  }

  const startMs = Date.now();
  let data = await forwardToMainFrame(tabId, request.action, request.payload);
  if (data === NO_CONTENT_SCRIPT) {
    try {
      await ensureContentScriptInjected(tabId);
      data = await forwardToMainFrame(tabId, request.action, request.payload);
    } catch {
      return actionFailed(request, "no-content-script");
    }
    if (data === NO_CONTENT_SCRIPT) {
      return actionFailed(request, "no-content-script");
    }
  }
  if (data === null) {
    return actionFailed(request);
  }
  if (saveToStore && isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }

  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  let finalData: unknown = data;
  let redactionApplied = false;

  if (redactPII) {
    try {
      const result = applyRedaction(data);
      finalData = result.data;
      redactionApplied = result.redactionApplied;
      if (finalData !== null && typeof finalData === "object") {
        (finalData as Record<string, unknown>).redactionApplied = redactionApplied;
      }
    } catch {
      return { requestId: request.requestId, success: false, error: "redaction-failed", retryable: false, auditId };
    }
  }

  const response: RelayActionResponse = { requestId: request.requestId, success: true, data: finalData, auditId };
  attachRedactionWarning(response, redactPII);
  const pageUrl = await resolveRequestedUrl(request.payload);
  let origin = "unknown";
  if (pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }
  enrichWithAuditLog({ auditId, toolName: request.action, pageId: typeof data === "object" && data !== null ? (data as { pageId?: string }).pageId ?? "" : "", origin, action: "allowed", redacted: redactionApplied, durationMs: Date.now() - startMs, response: response as unknown as Record<string, unknown> });
  return response;
}
