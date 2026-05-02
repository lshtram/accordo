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
      const ignoreGatewayDefaultFilters = isGatewayDefaultUnfilteredList(args, scope);
      const rawUri = optionalString(scope?.["uri"]) ?? optionalString(args["uri"]);
      let anchorKind = ignoreGatewayDefaultFilters
        ? undefined
        : optionalEnum(args["anchorKind"], ["text", "surface", "file"] as const);
      let surfaceType: string | undefined;
      let browserUrl: string | undefined;
      let isBrowserModality = false;

      if (!ignoreGatewayDefaultFilters && scope?.["modality"]) {
        const modality = scope["modality"] as string;
        if (modality === "text") {
          anchorKind = "text";
        } else {
          anchorKind = "surface";
          surfaceType = modality;
        }
        if (modality === "browser") {
          isBrowserModality = true;
          if (!rawUri) browserUrl = optionalString(scope["url"]);
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
        status: optionalEnum(args["status"], ["open", "resolved", "all"] as const),
        intent: ignoreGatewayDefaultFilters
          ? undefined
          : optionalEnum(args["intent"], ["fix", "explain", "refactor", "review", "design", "question"] as const),
        anchorKind,
        surfaceType,
        updatedSince: optionalString(args["updatedSince"]),
        lastAuthor: ignoreGatewayDefaultFilters
          ? undefined
          : optionalEnum(args["lastAuthor"], ["user", "agent"] as const),
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

function isGatewayDefaultUnfilteredList(args: Record<string, unknown>, scope: Record<string, unknown> | undefined): boolean {
  return (
    optionalString(scope?.["uri"]) === undefined &&
    optionalString(scope?.["url"]) === undefined &&
    optionalString(args["uri"]) === undefined &&
    optionalString(args["updatedSince"]) === undefined &&
    scope?.["modality"] === "text" &&
    args["status"] === "all" &&
    args["intent"] === "question" &&
    args["anchorKind"] === "text" &&
    args["lastAuthor"] === "agent"
  );
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  if (typeof value !== "string") return undefined;
  if (value.trim().length === 0) return undefined;
  return (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}
