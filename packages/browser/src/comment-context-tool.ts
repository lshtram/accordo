import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";
import {
  buildErrorResponse,
  buildSharedArgs,
  buildSuccessResponse,
  fetchThread,
  inspectAndExcerpt,
  isResolvedContextUsable,
  matchesStoredMetadata,
  resolveAnchor,
  resolveWithFrameRetry,
  verifyPageUrl,
} from "./comment-context-resolution.js";

export function buildCommentContextTool(
  bridge: BrowserBridgeAPI,
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_resolve_comment_context",
    description:
      "Resolve browser page context directly from a stored comment thread. " +
      "Looks up the thread via comment_get, recovers the browser anchor metadata, and returns both element inspection and DOM excerpt without requiring the caller to manually pass anchorKey or snapshot metadata. " +
      "Top-level metadata fields are the recovered stored browser-comment values; nested inspect/excerpt anchorStrategy fields describe actual re-resolution, and nested canonicalAnchor* fields describe the best current anchor for the found element. " +
      "Structured failures: thread-not-found, comment-not-found, browser-anchor-missing, comment-get-failed, context-resolution-failed, context-mismatch.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "Comment thread ID to resolve" },
        commentId: { type: "string", description: "Optional specific comment ID within the thread" },
        tabId: { type: "number", description: IMPLICIT_TARGET_TAB_DESCRIPTION },
        maxDepth: { type: "number", description: "Maximum DOM excerpt depth (default 3)" },
        maxLength: { type: "number", description: "Maximum DOM excerpt length (default 2000)" },
        allowedOrigins: { type: "array", items: { type: "string" }, description: "Only allow data from these origins. Empty = use global policy." },
        deniedOrigins: { type: "array", items: { type: "string" }, description: "Block data from these origins. Takes precedence over allowedOrigins." },
        redactPII: { type: "boolean", description: "When true, redact PII from the returned browser context." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args): Promise<unknown> => resolveCommentContext(bridge, relay, store, security, args),
  };
}

async function resolveCommentContext(
  bridge: BrowserBridgeAPI,
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  args: Record<string, unknown>,
): Promise<unknown> {
  const threadId = args["threadId"] as string;
  const threadResult = await fetchThread(bridge, threadId);
  if (!threadResult.ok) return threadFailureResponse(threadResult, threadId);

  const anchorResult = resolveAnchor(threadResult.result, args["commentId"] as string | undefined);
  if (!anchorResult.ok) return anchorFailureResponse(anchorResult, threadId);

  const resolved = anchorResult.resolved;
  const sharedArgs = buildSharedArgs(resolved, args);
  const { inspect, excerpt } = await inspectAndExcerpt(relay, store, security, sharedArgs, args);
  const pageVerification = await verifyPageUrl(relay, store, security, sharedArgs, resolved.pageUrl);
  if (!pageVerification.ok) return buildErrorResponse("context-mismatch", threadId, resolved, inspect, excerpt);

  const final = await resolveWithFrameRetry(relay, store, security, sharedArgs, resolved, inspect, excerpt, args);
  if (!isResolvedContextUsable(final.inspect, final.excerpt)) {
    return buildErrorResponse("context-resolution-failed", threadId, resolved, final.inspect, final.excerpt);
  }
  if (!matchesStoredMetadata(resolved.surfaceMetadata, final.inspect, final.excerpt, sharedArgs.redactPII === true)) {
    const resolvedFrameId = readResolvedFrameId(final.inspect, final.excerpt);
    return buildErrorResponse("context-mismatch", threadId, resolved, final.inspect, final.excerpt, { resolvedFrameId });
  }
  return buildSuccessResponse(threadId, resolved, final.inspect, final.excerpt);
}

function threadFailureResponse(threadResult: { error: string; code: string }, threadId: string): Record<string, unknown> {
  const response: Record<string, unknown> = { success: false, error: threadResult.code, threadId };
  if (threadResult.code === "comment-get-failed") response.message = threadResult.error;
  return response;
}

function anchorFailureResponse(anchorResult: { code: string; commentId?: string }, threadId: string): Record<string, unknown> {
  const response: Record<string, unknown> = { success: false, error: anchorResult.code, threadId };
  if (anchorResult.commentId !== undefined) response.commentId = anchorResult.commentId;
  return response;
}

function readResolvedFrameId(inspect: unknown, excerpt: unknown): string | undefined {
  return (typeof inspect === "object" && inspect !== null ? (inspect as { frameId?: string }).frameId : undefined)
    ?? (typeof excerpt === "object" && excerpt !== null ? (excerpt as { frameId?: string }).frameId : undefined);
}
