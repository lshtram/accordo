import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, isVersionedSnapshot, actionFailed } from "./relay-definitions.js";
import { resolveRequestedUrl, resolveTargetTabId, forwardToMainFrame, ensureContentScriptInjected, NO_CONTENT_SCRIPT } from "./relay-forwarder.js";
import { readBoundsLiteral } from "./relay-type-guards.js";
import { isOriginBlockedByPolicy, mintAuditId, applyRedaction, attachRedactionWarning, enrichWithAuditLog, parseOriginPolicy } from "./relay-privacy.js";
import { appendPaginationMetadata, clampOffsetLimit } from "./relay-page-runtime.js";
import { stitchFrameNodesIntoPageMap } from "./relay-page-frames.js";

export async function handleGetPageMap(request: RelayActionRequest): Promise<RelayActionResponse> {
  if (typeof document !== "undefined") {
    const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
    if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
      const origin = window.location.origin;
      if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
        const auditId = mintAuditId();
        const blockedResp: RelayActionResponse = {
          requestId: request.requestId,
          success: false,
          error: "origin-blocked",
          retryable: false,
          auditId,
        };
        enrichWithAuditLog({ auditId, toolName: request.action, pageId: "", origin, action: "blocked", redacted: false, durationMs: 0, response: blockedResp });
        return blockedResp;
      }
    }

    const { collectPageMap } = await import("./content/page-map-collector.js");
    const p = request.payload;
    const regionFilter = readBoundsLiteral(p.regionFilter);
    const result = collectPageMap({
      maxDepth: typeof p.maxDepth === "number" ? p.maxDepth : undefined,
      maxNodes: typeof p.maxNodes === "number" ? p.maxNodes : undefined,
      includeBounds: typeof p.includeBounds === "boolean" ? p.includeBounds : undefined,
      viewportOnly: typeof p.viewportOnly === "boolean" ? p.viewportOnly : undefined,
      visibleOnly: typeof p.visibleOnly === "boolean" ? p.visibleOnly : undefined,
      interactiveOnly: typeof p.interactiveOnly === "boolean" ? p.interactiveOnly : undefined,
      roles: Array.isArray(p.roles) ? p.roles.filter((r): r is string => typeof r === "string") : undefined,
      textMatch: typeof p.textMatch === "string" ? p.textMatch : undefined,
      selector: typeof p.selector === "string" ? p.selector : undefined,
      regionFilter,
      piercesShadow: typeof p.piercesShadow === "boolean" ? p.piercesShadow : undefined,
      traverseFrames: typeof p.traverseFrames === "boolean" ? p.traverseFrames : undefined,
      logicalFrameId: typeof p.logicalFrameId === "string" ? p.logicalFrameId : undefined,
    });

    const pagination = clampOffsetLimit(p as Record<string, unknown>, 200, 500, "maxNodes");
    if (pagination.hasPagination) {
      const totalAvailable = typeof result.filterSummary?.totalAfterFilter === "number" ? result.filterSummary.totalAfterFilter : result.totalElements;
      appendPaginationMetadata(result as unknown as Record<string, unknown>, { itemsKey: "nodes", totalAvailable, offset: pagination.offset, limit: pagination.limit });
    }

    if (isVersionedSnapshot(result)) {
      await defaultStore.save(result.pageId, result);
    }

    const auditId = mintAuditId();
    const redactPII = request.payload.redactPII === true;
    const response: RelayActionResponse = { requestId: request.requestId, success: true, data: result, auditId };
    attachRedactionWarning(response, redactPII);
    enrichWithAuditLog({ auditId, toolName: request.action, pageId: result.pageId ?? "", origin: window.location.origin, action: "allowed", redacted: false, durationMs: 0, response: response as unknown as Record<string, unknown> });
    return response;
  }

  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
  }

  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  const startMs = Date.now();
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
      enrichWithAuditLog({ auditId, toolName: request.action, pageId: `tab-${tabId}`, origin, action: "blocked", redacted: false, durationMs: Date.now() - startMs, response: blockedResp as unknown as Record<string, unknown> });
      return blockedResp;
    }
  }

  const traverseFrames = request.payload.traverseFrames === true;
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

  const result = data as Record<string, unknown>;
  if (traverseFrames && Array.isArray(result.iframes)) {
    await stitchFrameNodesIntoPageMap(tabId, result, request.payload as Record<string, unknown>);
  }
  if (isVersionedSnapshot(result)) {
    await defaultStore.save((result as { pageId: string }).pageId, result as Parameters<typeof defaultStore.save>[1]);
  }

  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  let finalData: unknown = result;
  let redactionApplied = false;

  if (redactPII) {
    try {
      const redactionResult = applyRedaction(result);
      finalData = redactionResult.data;
      redactionApplied = redactionResult.redactionApplied;
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
  enrichWithAuditLog({ auditId, toolName: request.action, pageId: (result as { pageId?: string }).pageId ?? "", origin, action: "allowed", redacted: redactionApplied, durationMs: Date.now() - startMs, response: response as unknown as Record<string, unknown> });
  return response;
}
