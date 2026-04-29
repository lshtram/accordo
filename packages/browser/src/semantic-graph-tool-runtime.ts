import type { SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy, redactSemanticGraphResponse } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import { narrowSemanticGraphResponse } from "./semantic-graph-tool-narrowing.js";
import type { GetSemanticGraphArgs, SemanticGraphResponse, SemanticGraphToolError } from "./semantic-graph-tool-contracts.js";

export function buildSemanticGraphPayload(args: GetSemanticGraphArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (args.maxDepth !== undefined) payload["maxDepth"] = args.maxDepth;
  if (args.visibleOnly !== undefined) payload["visibleOnly"] = args.visibleOnly;
  if (args.piercesShadow !== undefined) payload["piercesShadow"] = args.piercesShadow;
  if (args.tabId !== undefined) payload["tabId"] = args.tabId;
  if (args.frameId !== undefined) payload["frameId"] = args.frameId;
  if (args.redactPII !== undefined) payload["redactPII"] = args.redactPII;
  if (args.allowedOrigins !== undefined) payload["allowedOrigins"] = args.allowedOrigins;
  if (args.deniedOrigins !== undefined) payload["deniedOrigins"] = args.deniedOrigins;
  return payload;
}

export function mapSemanticGraphResponseError(response: { success: boolean; error?: string; data?: unknown }): SemanticGraphToolError | undefined {
  if (response.success && response.data !== undefined) return undefined;

  const errCode = response.error ?? "action-failed";
  const mappedError: SemanticGraphToolError["error"] =
    errCode === "browser-not-connected" ? "browser-not-connected"
    : errCode === "timeout" ? "timeout"
    : errCode === "iframe-cross-origin" ? "iframe-cross-origin"
    : errCode === "no-content-script" ? "no-content-script"
    : "action-failed";
  return buildStructuredError(mappedError) as SemanticGraphToolError;
}

export function finalizeSemanticGraphResult(
  data: unknown,
  args: GetSemanticGraphArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  auditId: string,
): SemanticGraphResponse | SemanticGraphToolError {
  const originError = getSemanticGraphOriginError(data, args, security);
  if (originError) return originError;

  if (hasSnapshotEnvelope(data)) {
    store.save(data.pageId, data as SnapshotEnvelopeFields);
  }

  const result = narrowSemanticGraphResponse(data);
  if (result === undefined) {
    return buildStructuredError("action-failed") as SemanticGraphToolError;
  }

  if (args.redactPII) {
    try {
      result.redactionApplied = redactSemanticGraphResponse(result, security.redactionPolicy) || result.redactionApplied === true;
    } catch {
      return buildStructuredError("redaction-failed") as SemanticGraphToolError;
    }
  } else {
    result.redactionWarning = "PII may be present in response";
  }

  result.auditId = auditId;
  return { ...result };
}

function getSemanticGraphOriginError(
  data: unknown,
  args: GetSemanticGraphArgs,
  security: SecurityConfig,
): SemanticGraphToolError | undefined {
  const relayPageUrl = (data as { pageUrl?: string }).pageUrl;
  if (!relayPageUrl) return undefined;

  const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
  const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
  if (checkOrigin(origin, policy) === "block") {
    return buildStructuredError("origin-blocked") as SemanticGraphToolError;
  }

  return undefined;
}
