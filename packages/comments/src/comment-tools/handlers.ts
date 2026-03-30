/**
 * Comment tool handler factory — builds ExtensionToolDefinition[] by attaching
 * handler functions to the schemas in definitions.ts.
 *
 * Source: comments-architecture.md §6, requirements-comments.md M38-CT-01..11
 */

import type { ExtensionToolDefinition, CommentThread } from "@accordo/bridge-types";
import { COMMENT_CREATE_RATE_LIMIT } from "@accordo/bridge-types";
import type { CommentStore } from "../comment-store.js";
import type { CommentIntent, CommentRetention, CommentContext } from "@accordo/bridge-types";
import { commentToolSchemas } from "./definitions.js";
import { normalizeCommentUri } from "./notifier.js";
import type { CommentUINotifier } from "./notifier.js";
import { buildAnchor } from "./anchor.js";
import type { CreateRateLimiter } from "./rate-limiter.js";

// Re-export for consumers that import from handlers.ts
export { normalizeCommentUri } from "./notifier.js";
export type { CommentUINotifier } from "./notifier.js";
export { CompositeCommentUINotifier } from "./notifier.js";
export { CreateRateLimiter } from "./rate-limiter.js";

/**
 * Build the full ExtensionToolDefinition array for comment MCP tools,
 * combining schemas from definitions.ts with handlers that close over store + ui.
 *
 * Source: comments-architecture.md §6, requirements-comments.md M38-CT-01..11
 */
export function buildCommentToolHandlers(
  store: CommentStore,
  ui: CommentUINotifier | undefined,
  rateLimiter: CreateRateLimiter,
): ExtensionToolDefinition[] {
  const handlers: Record<string, ExtensionToolDefinition["handler"]> = {
    comment_list: async (args) => {
      const scope = args["scope"] as Record<string, unknown> | undefined;
      const rawUri = (scope?.["uri"] as string | undefined) ?? (args["uri"] as string | undefined);
      let anchorKind = args["anchorKind"] as "text" | "surface" | "file" | undefined;
      let surfaceType: string | undefined;
      let browserUrl: string | undefined;
      let isBrowserModality = false;

      if (scope?.["modality"]) {
        const modality = scope["modality"] as string;
        if (modality === "text") {
          anchorKind = "text";
        } else {
          anchorKind = "surface";
          surfaceType = modality;
        }
        if (modality === "browser") {
          isBrowserModality = true;
          if (!rawUri && scope["url"]) browserUrl = scope["url"] as string;
        }
      }

      // Browser page URLs are passed through as-is; file URIs are canonicalized.
      const uri =
        browserUrl !== undefined
          ? browserUrl
          : rawUri !== undefined
          ? normalizeCommentUri(rawUri, store.getWorkspaceRoot())
          : undefined;

      const detail = args["detail"] as boolean | undefined;

      const listParams = {
        uri,
        status: args["status"] as "open" | "resolved" | undefined,
        intent: args["intent"] as CommentIntent | undefined,
        anchorKind,
        surfaceType,
        updatedSince: args["updatedSince"] as string | undefined,
        lastAuthor: args["lastAuthor"] as "user" | "agent" | undefined,
        limit: args["limit"] as number | undefined,
        offset: args["offset"] as number | undefined,
      };

      // When detail=true + browser: return full CommentThread[] so Chrome gets all data.
      if (detail === true && isBrowserModality) {
        const listResult = store.listThreads(listParams);
        const fullThreads: CommentThread[] = [];
        for (const summary of listResult.threads) {
          const thread = store.getThread(summary.id);
          if (thread !== undefined) fullThreads.push(thread);
        }
        return fullThreads;
      }

      return store.listThreads(listParams);
    },

    comment_get: async (args) => {
      const threadId = args["threadId"] as string;
      const thread = store.getThread(threadId);
      if (!thread) throw new Error(`Thread not found: ${threadId}`);
      return { success: true, thread };
    },

    comment_create: async (args) => {
      const scope = args["scope"] as Record<string, unknown> | undefined;
      const rawUri = (scope?.["uri"] as string | undefined) ?? (args["uri"] as string | undefined);
      const uri = rawUri !== undefined ? normalizeCommentUri(rawUri, store.getWorkspaceRoot()) : undefined;
      const anchorInput = args["anchor"] as Record<string, unknown> | undefined;
      const body = args["body"] as string;
      const intent = args["intent"] as CommentIntent | undefined;
      const agentId = (args["agentId"] as string | undefined) ?? "default";
      const modality = scope?.["modality"] as string | undefined;
      const threadId = args["threadId"] as string | undefined;
      const commentId = args["commentId"] as string | undefined;
      const contextArg = args["context"] as Record<string, unknown> | undefined;
      const authorKind = args["authorKind"] as "user" | "agent" | undefined;
      const authorName = args["authorName"] as string | undefined;

      if (!rateLimiter.isAllowed(agentId)) {
        throw new Error(`Rate limit exceeded: max ${COMMENT_CREATE_RATE_LIMIT} comment creates per minute`);
      }
      rateLimiter.record(agentId);

      const retention: CommentRetention = modality === "browser" ? "volatile-browser" : "standard";
      const finalUri = uri ?? (scope?.["url"] as string | undefined) ?? "";
      if (!finalUri) throw new Error("Either uri or scope.url is required");

      const anchor = buildAnchor(
        finalUri,
        anchorInput ?? { kind: modality === "text" ? "text" : "file" },
        modality,
      );
      const commentContext = (contextArg as CommentContext | undefined) ?? undefined;
      const browserAnchorKey = anchorInput?.["anchorKey"] as string | undefined;
      if (browserAnchorKey && commentContext) {
        commentContext.surfaceMetadata = {
          ...(commentContext.surfaceMetadata ?? {}),
          anchorKey: browserAnchorKey,
        };
      }

      const author =
        authorKind === "user"
          ? { kind: "user" as const, name: authorName ?? "User" }
          : { kind: "agent" as const, name: "agent", agentId };

      const result = await store.createThread({
        uri: finalUri,
        anchor,
        body,
        intent,
        context:
          commentContext ??
          (browserAnchorKey ? { surfaceMetadata: { anchorKey: browserAnchorKey } } : undefined),
        retention,
        author,
        threadId,
        commentId,
      });
      const newThread = store.getThread(result.threadId);
      if (newThread) ui?.addThread(newThread);
      return { success: true, created: true, threadId: result.threadId, commentId: result.commentId };
    },

    comment_reply: async (args) => {
      const threadId = args["threadId"] as string;
      const body = args["body"] as string;
      const commentId = args["commentId"] as string | undefined;
      const agentId = (args["agentId"] as string | undefined) ?? "default";
      const authorKind = args["authorKind"] as "user" | "agent" | undefined;
      const authorName = args["authorName"] as string | undefined;
      const author =
        authorKind === "user"
          ? { kind: "user" as const, name: authorName ?? "User" }
          : { kind: "agent" as const, name: "agent", agentId };
      const result = await store.reply({ threadId, body, commentId, author });
      const repliedThread = store.getThread(threadId);
      if (repliedThread) ui?.updateThread(repliedThread);
      return { success: true, replied: true, commentId: result.commentId };
    },

    comment_resolve: async (args) => {
      const threadId = args["threadId"] as string;
      const resolutionNote = args["resolutionNote"] as string;
      const agentId = (args["agentId"] as string | undefined) ?? "default";
      await store.resolve({
        threadId,
        resolutionNote,
        author: { kind: "agent", name: "agent", agentId },
      });
      const resolvedThread = store.getThread(threadId);
      if (resolvedThread) ui?.updateThread(resolvedThread);
      return { success: true, resolved: true, threadId };
    },

    comment_reopen: async (args) => {
      const threadId = args["threadId"] as string;
      const agentId = (args["agentId"] as string | undefined) ?? "default";
      await store.reopen(threadId, { kind: "agent", name: "agent", agentId });
      const reopenedThread = store.getThread(threadId);
      if (reopenedThread) ui?.updateThread(reopenedThread);
      return { success: true, reopened: true, threadId };
    },

    comment_delete: async (args) => {
      const deleteScope = args["deleteScope"] as Record<string, unknown> | undefined;

      // Bulk delete by modality (M38-CT-07)
      if (deleteScope && deleteScope["all"] === true && deleteScope["modality"]) {
        const modality = deleteScope["modality"] as string;
        const count = await store.deleteAllByModality(modality);
        return { success: true, deleted: true, deletedCount: count };
      }

      const threadId = args["threadId"] as string;
      if (!threadId) throw new Error("Either threadId or deleteScope is required");
      const commentId = args["commentId"] as string | undefined;
      await store.delete({ threadId, commentId });
      if (commentId) {
        const updatedThread = store.getThread(threadId);
        if (updatedThread) ui?.updateThread(updatedThread);
      } else {
        ui?.removeThread(threadId);
      }
      return { success: true, deleted: true };
    },

    comment_sync_version: async () => {
      const info = store.getVersionInfo();
      return {
        success: true,
        version: info.version,
        threadCount: info.threadCount,
        lastActivity: info.lastActivity,
      };
    },
  };

  return commentToolSchemas.map(schema => {
    const def: ExtensionToolDefinition = {
      name: schema.name,
      group: schema.group,
      description: schema.description,
      dangerLevel: schema.dangerLevel,
      idempotent: schema.idempotent,
      inputSchema: schema.inputSchema,
      handler: handlers[schema.name] as ExtensionToolDefinition["handler"],
    };
    return def;
  });
}
