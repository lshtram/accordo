import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";
import { isMissingThreadError, readCommentGetFailure, readThread, resolveCommentAnchorMetadata } from "./comment-context-recovery.js";
import { handleGetPageMap, type PageMapResponse, type PageToolError } from "./page-tool-handlers.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleGetDomExcerpt, handleInspectElement } from "./page-tool-handlers.js";

function isPageToolError(result: unknown): result is PageToolError {
  return typeof result === "object" && result !== null && typeof (result as { error?: unknown }).error === "string";
}

function isFoundResult(result: unknown): result is { found: boolean } {
  return typeof result === "object" && result !== null && typeof (result as { found?: unknown }).found === "boolean";
}

function normalizeComparableUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function normalizeComparableText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function matchesStoredMetadata(
  surfaceMetadata: Record<string, string | undefined> | undefined,
  inspect: unknown,
  excerpt: unknown,
  redactPII: boolean,
): boolean {
  if (!surfaceMetadata) return true;
  const inspectObject = typeof inspect === "object" && inspect !== null ? (inspect as { element?: { tag?: string; ariaLabel?: string; textContent?: string } }) : undefined;
  const excerptObject = typeof excerpt === "object" && excerpt !== null ? (excerpt as { text?: string }) : undefined;
  if (surfaceMetadata.tagName && surfaceMetadata.tagName !== "unknown" && inspectObject?.element?.tag && inspectObject.element.tag !== surfaceMetadata.tagName) {
    return false;
  }
  if (!redactPII && surfaceMetadata.ariaLabel && inspectObject?.element?.ariaLabel !== surfaceMetadata.ariaLabel) {
    return false;
  }
  if (!redactPII && surfaceMetadata.textSnippet) {
    const excerptText = normalizeComparableText(excerptObject?.text);
    const inspectText = normalizeComparableText(inspectObject?.element?.textContent);
    const snippet = normalizeComparableText(surfaceMetadata.textSnippet);
    if (!excerptText.includes(snippet) && !inspectText.includes(snippet)) {
      return false;
    }
  }
  return true;
}

function shouldRetryFrameAgnosticRecovery(
  anchorKey: string,
  inspect: unknown,
  excerpt: unknown,
): boolean {
  if (isPageToolError(inspect) || isPageToolError(excerpt)) return true;
  if (isFoundResult(inspect) && isFoundResult(excerpt) && inspect.found === false && excerpt.found === false) return true;
  if (!anchorKey.startsWith("body:")) return false;
  return (
    typeof inspect === "object" &&
    inspect !== null &&
    ((inspect as { element?: { tag?: string } }).element?.tag === "body" ||
      ((inspect as { canonicalAnchorKey?: string }).canonicalAnchorKey?.startsWith("body:") ?? false))
  );
}

async function retryAcrossFrames(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  baseArgs: Record<string, unknown>,
  surfaceMetadata?: Record<string, string | undefined>,
  redactPII: boolean = false,
  preferredFrameId?: string,
): Promise<{ inspect: unknown; excerpt: unknown } | undefined> {
  const collectFrameIds = (iframes: readonly { frameId: string; sameOrigin: boolean; iframes?: readonly unknown[] }[] | undefined): string[] => {
    if (!iframes) return [];
    const result: string[] = [];
    for (const iframe of iframes) {
      if (iframe.sameOrigin) result.push(iframe.frameId);
      result.push(...collectFrameIds(iframe.iframes as readonly { frameId: string; sameOrigin: boolean; iframes?: readonly unknown[] }[] | undefined));
    }
    return result;
  };
  const pageMap = await handleGetPageMap(
    relay,
    {
      traverseFrames: true,
      tabId: baseArgs.tabId as number | undefined,
      allowedOrigins: baseArgs.allowedOrigins as string[] | undefined,
      deniedOrigins: baseArgs.deniedOrigins as string[] | undefined,
      redactPII: baseArgs.redactPII as boolean | undefined,
    },
    store,
    security,
  );
  if (isPageToolError(pageMap)) return undefined;
  const discoveredFrames = collectFrameIds((pageMap as PageMapResponse).iframes as readonly { frameId: string; sameOrigin: boolean; iframes?: readonly unknown[] }[] | undefined);
  const candidateFrames = preferredFrameId
    ? [preferredFrameId, ...discoveredFrames.filter((frameId) => frameId !== preferredFrameId), "main"]
    : ["main", ...discoveredFrames];
  for (const frameId of candidateFrames) {
    const attemptArgs = { ...baseArgs, frameId };
    const inspect = await handleInspectElement(relay, attemptArgs, store, security);
    const excerpt = await handleGetDomExcerpt(relay, attemptArgs, store, security);
    const inspectFound = !isPageToolError(inspect) && isFoundResult(inspect) && inspect.found === true;
    const excerptFound = !isPageToolError(excerpt) && isFoundResult(excerpt) && excerpt.found === true;
    if (inspectFound && excerptFound && matchesStoredMetadata(surfaceMetadata, inspect, excerpt, redactPII)) {
      return { inspect, excerpt };
    }
  }
  return undefined;
}

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
        tabId: { type: "number", description: "Optional browser tab ID to target" },
        maxDepth: { type: "number", description: "Maximum DOM excerpt depth (default 3)" },
        maxLength: { type: "number", description: "Maximum DOM excerpt length (default 2000)" },
        allowedOrigins: { type: "array", items: { type: "string" }, description: "Only allow data from these origins. Empty = use global policy." },
        deniedOrigins: { type: "array", items: { type: "string" }, description: "Block data from these origins. Takes precedence over allowedOrigins." },
        redactPII: { type: "boolean", description: "When true, redact PII from the returned browser context." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: async (args): Promise<unknown> => {
      const threadId = args["threadId"] as string;
      const commentId = args["commentId"] as string | undefined;
      let threadResult: unknown;
      try {
        threadResult = await bridge.invokeTool("comment_get", { threadId });
      } catch (error) {
        if (!isMissingThreadError(error)) {
          return {
            success: false,
            error: "comment-get-failed",
            threadId,
            message: error instanceof Error ? error.message : String(error),
          };
        }
        return { success: false, error: "thread-not-found", threadId };
      }
      const threadFailure = readCommentGetFailure(threadResult);
      if (threadFailure) {
        if (threadFailure.error === "thread-not-found") {
          return { success: false, error: "thread-not-found", threadId };
        }
        return {
          success: false,
          error: "comment-get-failed",
          threadId,
          message: threadFailure.message ?? threadFailure.error ?? "comment_get failed",
        };
      }
      const thread = readThread(threadResult);
      if (!thread) {
        return { success: false, error: "thread-not-found", threadId };
      }

      const resolved = resolveCommentAnchorMetadata(thread, commentId);
      if (resolved.error === "comment-not-found") {
        return { success: false, error: "comment-not-found", threadId, commentId };
      }
      if (!resolved.anchorKey) {
        return { success: false, error: "browser-anchor-missing", threadId, commentId: resolved.commentId };
      }

      const sharedArgs = {
        tabId: args["tabId"] as number | undefined,
        anchorKey: resolved.anchorKey,
        frameId: resolved.frameId,
        creationSnapshotId: resolved.creationSnapshotId,
        allowedOrigins: args["allowedOrigins"] as string[] | undefined,
        deniedOrigins: args["deniedOrigins"] as string[] | undefined,
        redactPII: args["redactPII"] as boolean | undefined,
      };

      const inspect = await handleInspectElement(relay, sharedArgs, store, security);
      const excerpt = await handleGetDomExcerpt(
        relay,
        {
          ...sharedArgs,
          maxDepth: args["maxDepth"] as number | undefined,
          maxLength: args["maxLength"] as number | undefined,
        },
        store,
        security,
      );

      const currentPage = await handleGetPageMap(
        relay,
        {
          tabId: sharedArgs.tabId,
          allowedOrigins: sharedArgs.allowedOrigins,
          deniedOrigins: sharedArgs.deniedOrigins,
          redactPII: sharedArgs.redactPII,
        },
        store,
        security,
      );
      if (!isPageToolError(currentPage) && resolved.pageUrl && normalizeComparableUrl(resolved.pageUrl) !== normalizeComparableUrl(currentPage.pageUrl)) {
        return {
          success: false,
          error: "context-mismatch",
          threadId,
          commentId: resolved.commentId,
          commentBody: resolved.commentBody,
          storedFrameId: resolved.frameId,
          creationSnapshotId: resolved.creationSnapshotId,
          metadata: resolved.surfaceMetadata,
          inspect,
          excerpt,
        };
      }

      const staleFrameRetry = resolved.frameId && (shouldRetryFrameAgnosticRecovery(resolved.anchorKey, inspect, excerpt) || !matchesStoredMetadata(resolved.surfaceMetadata, inspect, excerpt, sharedArgs.redactPII === true))
        ? await retryAcrossFrames(relay, store, security, { ...sharedArgs, maxDepth: args["maxDepth"] as number | undefined, maxLength: args["maxLength"] as number | undefined }, resolved.surfaceMetadata, sharedArgs.redactPII === true, resolved.frameId)
        : undefined;
      const finalInspect = staleFrameRetry?.inspect ?? inspect;
      const finalExcerpt = staleFrameRetry?.excerpt ?? excerpt;

      if (isPageToolError(finalInspect) || isPageToolError(finalExcerpt)) {
        return {
          success: false,
          error: "context-resolution-failed",
          threadId,
          commentId: resolved.commentId,
          commentBody: resolved.commentBody,
          anchorKey: resolved.anchorKey,
          storedFrameId: resolved.frameId,
          creationSnapshotId: resolved.creationSnapshotId,
          metadata: resolved.surfaceMetadata,
          inspect: finalInspect,
          excerpt: finalExcerpt,
        };
      }

      if (isFoundResult(finalInspect) && isFoundResult(finalExcerpt) && finalInspect.found === false && finalExcerpt.found === false) {
        return {
          success: false,
          error: "context-resolution-failed",
          threadId,
          commentId: resolved.commentId,
          commentBody: resolved.commentBody,
          anchorKey: resolved.anchorKey,
          storedFrameId: resolved.frameId,
          creationSnapshotId: resolved.creationSnapshotId,
          metadata: resolved.surfaceMetadata,
          inspect: finalInspect,
          excerpt: finalExcerpt,
        };
      }

      if (!isFoundResult(finalInspect) || !isFoundResult(finalExcerpt) || finalInspect.found !== true || finalExcerpt.found !== true) {
        return {
          success: false,
          error: "context-resolution-failed",
          threadId,
          commentId: resolved.commentId,
          commentBody: resolved.commentBody,
          anchorKey: resolved.anchorKey,
          storedFrameId: resolved.frameId,
          creationSnapshotId: resolved.creationSnapshotId,
          metadata: resolved.surfaceMetadata,
          inspect: finalInspect,
          excerpt: finalExcerpt,
        };
      }

      if (!matchesStoredMetadata(resolved.surfaceMetadata, finalInspect, finalExcerpt, sharedArgs.redactPII === true)) {
        return {
          success: false,
          error: "context-mismatch",
          threadId,
          commentId: resolved.commentId,
          commentBody: resolved.commentBody,
          anchorKey: resolved.anchorKey,
          storedFrameId: resolved.frameId,
          resolvedFrameId:
            (typeof finalInspect === "object" && finalInspect !== null ? (finalInspect as { frameId?: string }).frameId : undefined) ??
            (typeof finalExcerpt === "object" && finalExcerpt !== null ? (finalExcerpt as { frameId?: string }).frameId : undefined),
          creationSnapshotId: resolved.creationSnapshotId,
          metadata: resolved.surfaceMetadata,
          inspect: finalInspect,
          excerpt: finalExcerpt,
        };
      }

      return {
        success: true,
        threadId,
        commentId: resolved.commentId,
        commentBody: resolved.commentBody,
        anchorKey: resolved.anchorKey,
        storedFrameId: resolved.frameId,
        resolvedFrameId:
          (typeof finalInspect === "object" && finalInspect !== null ? (finalInspect as { frameId?: string }).frameId : undefined) ??
          (typeof finalExcerpt === "object" && finalExcerpt !== null ? (finalExcerpt as { frameId?: string }).frameId : undefined),
        creationSnapshotId: resolved.creationSnapshotId,
        metadata: resolved.surfaceMetadata,
        inspect: finalInspect,
        excerpt: finalExcerpt,
      };
    },
  };
}
