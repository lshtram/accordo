import type { ExtensionToolDefinition, CommentThread } from "@accordo/bridge-types";
import type { CommentStore } from "../comment-store.js";
import type { CommentIntent } from "@accordo/bridge-types";
import { normalizeCommentUri } from "./notifier.js";

export function buildCommentQueryHandlers(
  store: CommentStore,
): Pick<Record<string, ExtensionToolDefinition["handler"]>, "comment_list" | "comment_get" | "comment_sync_version"> {
  return {
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

      const uri =
        browserUrl !== undefined
          ? browserUrl
          : rawUri !== undefined
          ? normalizeCommentUri(rawUri, store.getWorkspaceRoot())
          : undefined;
      const detail = args["detail"] as boolean | undefined;
      const listParams = {
        uri,
        status: args["status"] as "open" | "resolved" | "all" | undefined,
        intent: args["intent"] as CommentIntent | undefined,
        anchorKind,
        surfaceType,
        updatedSince: args["updatedSince"] as string | undefined,
        lastAuthor: args["lastAuthor"] as "user" | "agent" | undefined,
        limit: args["limit"] as number | undefined,
        offset: args["offset"] as number | undefined,
      };

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
}
