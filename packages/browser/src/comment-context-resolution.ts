import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";
import type { PageMapResponse } from "./page-tool-handlers.js";
import { handleGetPageMap, handleGetDomExcerpt, handleInspectElement } from "./page-tool-handlers.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { isMissingThreadError, readCommentGetFailure, readThread, resolveCommentAnchorMetadata } from "./comment-context-recovery.js";
import { isPageToolError, isFoundResult, matchesStoredMetadata, normalizeComparableUrl, retryAcrossFrames, shouldRetryFrameAgnosticRecovery } from "./comment-context-helpers.js";

export type ResolvedCommentAnchor = {
  anchorKey: string;
  frameId?: string;
  creationSnapshotId?: string;
  surfaceMetadata?: Record<string, string | undefined>;
  commentId?: string;
  commentBody?: string;
  pageUrl?: string;
};

export function buildSharedArgs(resolved: ResolvedCommentAnchor, args: Record<string, unknown>): Record<string, unknown> {
  return {
    tabId: args["tabId"] as number | undefined,
    anchorKey: resolved.anchorKey,
    frameId: resolved.frameId,
    creationSnapshotId: resolved.creationSnapshotId,
    allowedOrigins: args["allowedOrigins"] as string[] | undefined,
    deniedOrigins: args["deniedOrigins"] as string[] | undefined,
    redactPII: args["redactPII"] as boolean | undefined,
  };
}

export async function fetchThread(bridge: BrowserBridgeAPI, threadId: string): Promise<{ ok: true; result: unknown } | { ok: false; error: string; code: "comment-get-failed" | "thread-not-found" }> {
  try {
    const result = await bridge.invokeTool("comment_get", { threadId });
    const failure = readCommentGetFailure(result);
    if (!failure) return { ok: true, result };
    if (failure.error === "thread-not-found") return { ok: false, error: "thread-not-found", code: "thread-not-found" };
    return { ok: false, error: failure.message ?? failure.error ?? "comment_get failed", code: "comment-get-failed" };
  } catch (error) {
    if (isMissingThreadError(error)) return { ok: false, error: "thread-not-found", code: "thread-not-found" };
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: "comment-get-failed" };
  }
}

export function resolveAnchor(threadResult: unknown, commentId?: string): { ok: true; resolved: ResolvedCommentAnchor } | { ok: false; error: string; code: "thread-not-found" | "comment-not-found" | "browser-anchor-missing" | "comment-get-failed"; commentId?: string } {
  const threadFailure = readCommentGetFailure(threadResult);
  if (threadFailure?.error === "thread-not-found") return { ok: false, error: "thread-not-found", code: "thread-not-found" };
  if (threadFailure) return { ok: false, error: threadFailure.message ?? threadFailure.error ?? "comment_get failed", code: "comment-get-failed" };
  const thread = readThread(threadResult);
  if (!thread) return { ok: false, error: "thread-not-found", code: "thread-not-found" };
  const resolved = resolveCommentAnchorMetadata(thread, commentId);
  if (resolved.error === "comment-not-found") return { ok: false, error: "comment-not-found", code: "comment-not-found", commentId };
  if (!resolved.anchorKey) return { ok: false, error: "browser-anchor-missing", code: "browser-anchor-missing" };
  return { ok: true, resolved: resolved as ResolvedCommentAnchor };
}

export async function verifyPageUrl(relay: BrowserRelayLike, store: SnapshotRetentionStore, security: SecurityConfig, sharedArgs: Record<string, unknown>, resolvedPageUrl?: string): Promise<{ ok: true; pageMap?: PageMapResponse } | { ok: false }> {
  if (!resolvedPageUrl) return { ok: true };
  const currentPage = await handleGetPageMap(relay, {
    tabId: sharedArgs.tabId as number | undefined,
    allowedOrigins: sharedArgs.allowedOrigins as string[] | undefined,
    deniedOrigins: sharedArgs.deniedOrigins as string[] | undefined,
    redactPII: sharedArgs.redactPII as boolean | undefined,
  }, store, security);
  if (isPageToolError(currentPage)) return { ok: false };
  return normalizeComparableUrl(resolvedPageUrl) === normalizeComparableUrl((currentPage as PageMapResponse).pageUrl)
    ? { ok: true, pageMap: currentPage as PageMapResponse }
    : { ok: false };
}

export async function inspectAndExcerpt(relay: BrowserRelayLike, store: SnapshotRetentionStore, security: SecurityConfig, sharedArgs: Record<string, unknown>, args: Record<string, unknown>): Promise<{ inspect: unknown; excerpt: unknown }> {
  const inspect = await handleInspectElement(relay, sharedArgs, store, security);
  const excerpt = await handleGetDomExcerpt(relay, { ...sharedArgs, maxDepth: args["maxDepth"] as number | undefined, maxLength: args["maxLength"] as number | undefined }, store, security);
  return { inspect, excerpt };
}

export async function resolveWithFrameRetry(relay: BrowserRelayLike, store: SnapshotRetentionStore, security: SecurityConfig, sharedArgs: Record<string, unknown>, resolved: ResolvedCommentAnchor, inspect: unknown, excerpt: unknown, args: Record<string, unknown>): Promise<{ inspect: unknown; excerpt: unknown }> {
  const needsRetry = resolved.frameId && (shouldRetryFrameAgnosticRecovery(resolved.anchorKey, inspect, excerpt) || !matchesStoredMetadata(resolved.surfaceMetadata, inspect, excerpt, sharedArgs.redactPII === true));
  if (!needsRetry) return { inspect, excerpt };
  return await retryAcrossFrames(relay, store, security, { ...sharedArgs, maxDepth: args["maxDepth"] as number | undefined, maxLength: args["maxLength"] as number | undefined }, resolved.surfaceMetadata, sharedArgs.redactPII === true, resolved.frameId) ?? { inspect, excerpt };
}

export function buildErrorResponse(error: string, threadId: string, resolved: ResolvedCommentAnchor, inspect: unknown, excerpt: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  return { success: false, error, threadId, commentId: resolved.commentId, commentBody: resolved.commentBody, anchorKey: resolved.anchorKey, storedFrameId: resolved.frameId, creationSnapshotId: resolved.creationSnapshotId, metadata: resolved.surfaceMetadata, inspect, excerpt, ...extra };
}

export function buildSuccessResponse(threadId: string, resolved: ResolvedCommentAnchor, finalInspect: unknown, finalExcerpt: unknown): Record<string, unknown> {
  const resolvedFrameId = (typeof finalInspect === "object" && finalInspect !== null ? (finalInspect as { frameId?: string }).frameId : undefined) ?? (typeof finalExcerpt === "object" && finalExcerpt !== null ? (finalExcerpt as { frameId?: string }).frameId : undefined);
  return { success: true, threadId, commentId: resolved.commentId, commentBody: resolved.commentBody, anchorKey: resolved.anchorKey, storedFrameId: resolved.frameId, resolvedFrameId, creationSnapshotId: resolved.creationSnapshotId, metadata: resolved.surfaceMetadata, inspect: finalInspect, excerpt: finalExcerpt };
}

export function isResolvedContextUsable(inspect: unknown, excerpt: unknown): boolean {
  if (isPageToolError(inspect) || isPageToolError(excerpt)) return false;
  if (isFoundResult(inspect) && isFoundResult(excerpt) && inspect.found === false && excerpt.found === false) return false;
  return isFoundResult(inspect) && isFoundResult(excerpt) && inspect.found === true && excerpt.found === true;
}

export { matchesStoredMetadata };
