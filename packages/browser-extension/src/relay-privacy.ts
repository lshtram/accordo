/**
 * relay-privacy.ts — Shared privacy/security middleware facade.
 *
 * @module
 */

export type { AuditLogEntry } from "./relay-privacy-audit.js";
export { AuditStore, auditStore, enrichWithAuditLog, mintAuditId } from "./relay-privacy-audit.js";
export {
  buildBlockedResponse,
  checkOriginBlocked,
  isOriginBlockedByPolicy,
  parseOriginPolicy,
} from "./relay-privacy-origin.js";
export {
  applyRedaction,
  attachRedactionWarning,
  buildRedactionFailedResponse,
} from "./relay-privacy-redaction.js";

import { mintAuditId, enrichWithAuditLog } from "./relay-privacy-audit.js";
import { checkOriginBlocked } from "./relay-privacy-origin.js";

export async function runPrivacyMiddlewareSW(opts: {
  request: { requestId: string; payload: Record<string, unknown> };
  pageId: string;
  origin: string;
}): Promise<
  | { blocked: true; response: { requestId: string; success: false; error: "origin-blocked"; retryable: false; auditId: string } }
  | { blocked: false; auditId: string }
> {
  const auditId = mintAuditId();
  const originCheck = await checkOriginBlocked(opts.request);

  if (originCheck.blocked) {
    const blockedResponse = { ...originCheck.response, auditId };
    enrichWithAuditLog({
      auditId,
      toolName: "unknown",
      pageId: opts.pageId,
      origin: opts.origin,
      action: "blocked",
      redacted: false,
      durationMs: 0,
      response: blockedResponse,
    });
    return { blocked: true, response: blockedResponse };
  }

  return { blocked: false, auditId };
}
