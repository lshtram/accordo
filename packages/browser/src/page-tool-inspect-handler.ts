import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import {
  checkOrigin,
  DEFAULT_SECURITY_CONFIG,
  extractOrigin,
  mergeOriginPolicy,
  redactInspectElementResponse,
} from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import type { InspectElementArgs, InspectElementResponse, PageToolError } from "./page-tool-types.js";
import { classifyRelayError, INSPECT_TIMEOUT_MS } from "./page-tool-types.js";
import { mapRelayError } from "./page-tool-relay-errors.js";

export async function handleInspectElement(
  relay: BrowserRelayLike,
  args: InspectElementArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<InspectElementResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as PageToolError;
  }

  const auditEntry = security.auditLog.createEntry("accordo_browser_inspect_element", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request("inspect_element", args as Record<string, unknown>, INSPECT_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError(mapRelayError(response.error)) as PageToolError;
    }
    if (
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;
      if (relayPageUrl) {
        const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
        const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
        if (checkOrigin(origin, policy) === "block") {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("origin-blocked") as PageToolError;
        }
      }

      store.save(response.data.pageId, response.data);
      const result = response.data as InspectElementResponse;
      result.auditId = auditEntry.auditId;

      if (args.redactPII) {
        try {
          result.redactionApplied = redactInspectElementResponse(result, security.redactionPolicy);
        } catch {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("redaction-failed") as PageToolError;
        }
      } else {
        result.redactionWarning = "PII may be present in response";
      }

      security.auditLog.completeEntry(auditEntry, {
        action: "allowed",
        redacted: !!result.redactionApplied,
        durationMs: Date.now() - startTime,
      });

      return { ...result };
    }
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError("action-failed") as PageToolError;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as PageToolError;
  }
}
