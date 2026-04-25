import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { COMMENT_CREATE_RATE_LIMIT } from "@accordo/bridge-types";
import type { CommentStore } from "../comment-store.js";
import type { CommentContext, CommentIntent, CommentRetention } from "@accordo/bridge-types";
import { normalizeCommentUri } from "./notifier.js";
import type { CommentUINotifier } from "./notifier.js";
import { buildAnchor } from "./anchor.js";
import type { CreateRateLimiter } from "./rate-limiter.js";

export function buildCommentMutationHandlers(
  store: CommentStore,
  ui: CommentUINotifier | undefined,
  rateLimiter: CreateRateLimiter,
): Pick<
  Record<string, ExtensionToolDefinition["handler"]>,
  "comment_create" | "comment_reply" | "comment_resolve" | "comment_reopen" | "comment_delete"
> {
  return {
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
      if (deleteScope && deleteScope["all"] === true && deleteScope["modality"]) {
        const modality = deleteScope["modality"] as string;
        const result = await store.deleteAllByModality(modality);
        if (result.deletedIds.length > 0) {
          ui?.removeThreads(result.deletedIds);
        }
        return { success: true, deleted: true, deletedCount: result.count };
      }

      const threadId = args["threadId"] as string;
      if (!threadId) throw new Error("Either threadId or deleteScope is required");
      const rawCommentId = args["commentId"] as string | undefined;
      const commentId = rawCommentId !== undefined && rawCommentId.trim() !== "" ? rawCommentId : undefined;
      await store.delete({ threadId, commentId });
      if (commentId) {
        const updatedThread = store.getThread(threadId);
        if (updatedThread) ui?.updateThread(updatedThread);
      } else {
        ui?.removeThread(threadId);
      }
      return { success: true, deleted: true };
    },
  };
}
