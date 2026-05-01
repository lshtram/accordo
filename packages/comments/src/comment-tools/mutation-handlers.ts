import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { COMMENT_CREATE_RATE_LIMIT } from "@accordo/bridge-types";
import type { CommentStore } from "../comment-store.js";
import type { CommentContext, CommentIntent, CommentRetention } from "@accordo/bridge-types";
import { normalizeCommentUri } from "./notifier.js";
import type { CommentUINotifier } from "./notifier.js";
import { buildAnchor } from "./anchor.js";
import type { CreateRateLimiter } from "./rate-limiter.js";

/**
 * Build comment mutation handlers that notify external observers only.
 *
 * Canonical architecture (comments-sync-hardening):
 *   - Store mutations go through CommentStore methods
 *   - store.onChanged → nc.reconcile(store.getAllThreads()) is the ONLY native widget mutation path
 *   - MCP handlers notify external observers (browser relay) via the _external notifier
 *   - _external is ExternalFanoutNotifier — never NativeComments
 */
export function buildCommentMutationHandlers(
  store: CommentStore,
  _external: CommentUINotifier | undefined,
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
      // Pass raw IDs to store for validation per M36-CS-13.
      // Empty/whitespace IDs will be rejected with exact stable error codes.
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
      // Notify external observers (e.g. browser relay) only.
      // Native widget mutation happens via store.onChanged -> nc.reconcile (canonical path).
      const thread = store.getThread(result.threadId);
      if (_external && thread) _external.addThread(thread);
      return { success: true, created: true, threadId: result.threadId, commentId: result.commentId };
    },

    comment_reply: async (args) => {
      const threadId = args["threadId"] as string;
      const body = args["body"] as string;
      // Pass raw commentId to store for validation per M36-CS-13.
      const commentId = args["commentId"] as string | undefined;
      const agentId = (args["agentId"] as string | undefined) ?? "default";
      const authorKind = args["authorKind"] as "user" | "agent" | undefined;
      const authorName = args["authorName"] as string | undefined;
      const author =
        authorKind === "user"
          ? { kind: "user" as const, name: authorName ?? "User" }
          : { kind: "agent" as const, name: "agent", agentId };
      const result = await store.reply({ threadId, body, commentId, author });
      // Notify external observers only.
      // Native widget mutation happens via store.onChanged -> nc.reconcile (canonical path).
      const updatedThread = store.getThread(threadId);
      if (_external && updatedThread) _external.updateThread(updatedThread);
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
      // Notify external observers only.
      // Native widget mutation happens via store.onChanged -> nc.reconcile (canonical path).
      const updatedThread = store.getThread(threadId);
      if (_external && updatedThread) _external.updateThread(updatedThread);
      return { success: true, resolved: true, threadId };
    },

    comment_reopen: async (args) => {
      const threadId = args["threadId"] as string;
      const agentId = (args["agentId"] as string | undefined) ?? "default";
      await store.reopen(threadId, { kind: "agent", name: "agent", agentId });
      // Notify external observers only.
      // Native widget mutation happens via store.onChanged -> nc.reconcile (canonical path).
      const updatedThread = store.getThread(threadId);
      if (_external && updatedThread) _external.updateThread(updatedThread);
      return { success: true, reopened: true, threadId };
    },

    comment_delete: async (args) => {
      const deleteScope = args["deleteScope"] as Record<string, unknown> | undefined;
      if (args["all"] === true || (deleteScope && deleteScope["all"] === true && !deleteScope["modality"])) {
        // store.deleteAll -> store.onChanged -> nc.reconcile handles widget removal.
        const result = await store.deleteAll();
        return { success: true, deleted: true, deletedCount: result.count };
      }

      if (deleteScope && deleteScope["all"] === true && deleteScope["modality"]) {
        const modality = deleteScope["modality"] as string;
        // store.deleteAllByModality -> store.onChanged -> nc.reconcile handles widget removal.
        const result = await store.deleteAllByModality(modality);
        return { success: true, deleted: true, deletedCount: result.count };
      }

      const threadId = args["threadId"] as string;
      if (!threadId) throw new Error("Either threadId or deleteScope is required");
      // Pass raw commentId to store for validation per M36-CS-13.
      const rawCommentId = args["commentId"] as string | undefined;
      // store.delete -> store.onChanged -> nc.reconcile handles widget update/removal.
      await store.delete({ threadId, commentId: rawCommentId });
      return { success: true, deleted: true };
    },
  };
}
