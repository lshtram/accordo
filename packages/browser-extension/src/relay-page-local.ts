import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import { attachRedactionWarning, enrichWithAuditLog, isOriginBlockedByPolicy, mintAuditId, parseOriginPolicy } from "./relay-privacy.js";

export async function handleLocalPageUnderstandingAction(
  request: RelayActionRequest,
  localHandler: (() => Promise<unknown>) | null,
  saveToStore: boolean,
): Promise<RelayActionResponse | undefined> {
  if (typeof document === "undefined" || !localHandler) {
    return undefined;
  }

  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  if (allowedOrigins !== undefined || deniedOrigins !== undefined) {
    const origin = window.location.origin;
    if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
      const auditId = mintAuditId();
      const blockedResp = {
        requestId: request.requestId,
        success: false as const,
        error: "origin-blocked" as const,
        retryable: false as const,
        auditId,
      };
      enrichWithAuditLog({ auditId, toolName: request.action, pageId: "", origin, action: "blocked", redacted: false, durationMs: 0, response: blockedResp });
      return blockedResp;
    }
  }

  const result = await localHandler();
  if (saveToStore && isVersionedSnapshot(result)) {
    await defaultStore.save(result.pageId, result);
  }

  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  const response: RelayActionResponse = { requestId: request.requestId, success: true, data: result, auditId };
  attachRedactionWarning(response, redactPII);

  enrichWithAuditLog({
    auditId,
    toolName: request.action,
    pageId: typeof result === "object" && result !== null ? (result as { pageId?: string }).pageId ?? "" : "",
    origin: window.location.origin,
    action: "allowed",
    redacted: false,
    durationMs: 0,
    response: response as unknown as Record<string, unknown>,
  });

  return response;
}
