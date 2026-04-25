import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import {
  buildSemanticGraphPayload,
  finalizeSemanticGraphResult,
  mapSemanticGraphResponseError,
} from "./semantic-graph-tool-runtime.js";
import { classifyThrownRelayError } from "./relay-error-policy.js";
import {
  SEMANTIC_GRAPH_TOOL_TIMEOUT_MS,
  type GetSemanticGraphArgs,
  type SemanticGraphResponse,
  type SemanticGraphToolError,
} from "./semantic-graph-tool-contracts.js";

export async function handleGetSemanticGraph(
  relay: BrowserRelayLike,
  args: GetSemanticGraphArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): Promise<SemanticGraphResponse | SemanticGraphToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as SemanticGraphToolError;
  }

  const auditEntry = security.auditLog.createEntry("accordo_browser_get_semantic_graph", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request("get_semantic_graph", buildSemanticGraphPayload(args), SEMANTIC_GRAPH_TOOL_TIMEOUT_MS);
    const responseError = mapSemanticGraphResponseError(response);
    if (responseError) return completeBlocked(auditEntry, startTime, security, responseError);

    const result = finalizeSemanticGraphResult(response.data, args, store, security, auditEntry.auditId);
    if (isSemanticGraphToolError(result)) {
      return completeBlocked(auditEntry, startTime, security, result);
    }

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!result.redactionApplied,
      durationMs: Date.now() - startTime,
    });
    return result;
  } catch (err: unknown) {
    return completeBlocked(
      auditEntry,
      startTime,
      security,
      buildStructuredError(classifyThrownRelayError(err)) as SemanticGraphToolError,
    );
  }
}

function completeBlocked(
  auditEntry: ReturnType<SecurityConfig["auditLog"]["createEntry"]>,
  startTime: number,
  security: SecurityConfig,
  error: SemanticGraphToolError,
): SemanticGraphToolError {
  security.auditLog.completeEntry(auditEntry, {
    action: "blocked",
    redacted: false,
    durationMs: Date.now() - startTime,
  });
  return error;
}

function isSemanticGraphToolError(result: SemanticGraphResponse | SemanticGraphToolError): result is SemanticGraphToolError {
  return "success" in result && result.success === false;
}
