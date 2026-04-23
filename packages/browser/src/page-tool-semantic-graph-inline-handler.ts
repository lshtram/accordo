import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import {
  checkOrigin,
  DEFAULT_SECURITY_CONFIG,
  extractOrigin,
  mergeOriginPolicy,
  redactSemanticGraphResponse,
} from "./security/index.js";
import type { GetSemanticGraphArgs } from "./page-tool-types.js";
import { classifyRelayError, SEMANTIC_GRAPH_TIMEOUT_MS } from "./page-tool-types.js";
import type { SemanticGraphResponse } from "./semantic-graph-tool-contracts.js";

type SemanticGraphInlineResult = SemanticGraphResponse;

export async function handleGetSemanticGraphInline(
  relay: BrowserRelayLike,
  args: GetSemanticGraphArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  const auditEntry = security.auditLog.createEntry("accordo_browser_get_semantic_graph", undefined, undefined);
  const startTime = Date.now();

  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.maxDepth !== undefined) payload["maxDepth"] = args.maxDepth;
    if (args.visibleOnly !== undefined) payload["visibleOnly"] = args.visibleOnly;
    if (args.piercesShadow !== undefined) payload["piercesShadow"] = args.piercesShadow;
    if (args.frameId !== undefined) payload["frameId"] = args.frameId;
    if (args.allowedOrigins !== undefined) payload["allowedOrigins"] = args.allowedOrigins;
    if (args.deniedOrigins !== undefined) payload["deniedOrigins"] = args.deniedOrigins;
    if (args.redactPII !== undefined) payload["redactPII"] = args.redactPII;

    const response = await relay.request("get_semantic_graph", payload, SEMANTIC_GRAPH_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return { success: false, error: response.error ?? "action-failed" };
    }

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
        return { success: false, error: "origin-blocked" };
      }
    }

    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data as SnapshotEnvelopeFields);
    }

    const result = response.data as SemanticGraphInlineResult;
    result.auditId = auditEntry.auditId;

    if (args.redactPII) {
      try {
        result.redactionApplied = redactSemanticGraphResponse(result, security.redactionPolicy);
      } catch {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return { success: false, error: "redaction-failed" };
      }
    } else {
      result.redactionWarning = "PII may be present in response";
    }

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!result.redactionApplied,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return { success: false, error: classifyRelayError(err) };
  }
}
