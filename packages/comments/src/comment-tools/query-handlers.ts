import type { ExtensionToolDefinition } from "@accordo/bridge-types";
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
      const rawBrowserUrl = optionalString(scope?.["url"]);
      const hasPrimaryFilter = rawUri !== undefined || rawBrowserUrl !== undefined || optionalString(args["updatedSince"]) !== undefined;
      const status = optionalEnum(args["status"], ["open", "resolved", "all"] as const);
      const hasModalityScope = typeof scope?.["modality"] === "string" && (scope["modality"] as string).trim().length > 0;
      const applySecondaryFilters = !ignoreGatewayDefaultFilters && (!hasModalityScope || hasPrimaryFilter || (status !== undefined && status !== "all"));
      let anchorKind = applySecondaryFilters
        ? optionalEnum(args["anchorKind"], ["text", "surface", "file"] as const)
        : undefined;
      let surfaceType: string | undefined;
      let browserUrl: string | undefined;

      if (!ignoreGatewayDefaultFilters && scope?.["modality"]) {
        const modality = scope["modality"] as string;
        if (modality === "text") {
          anchorKind = "text";
        } else {
          anchorKind = "surface";
          surfaceType = modality;
        }
        if (modality === "browser") {
          if (!rawUri) browserUrl = rawBrowserUrl;
        }
      }

      const uri =
        browserUrl !== undefined
          ? browserUrl
          : rawUri !== undefined
          ? normalizeCommentUri(rawUri, store.getWorkspaceRoot())
          : undefined;
      const listParams = {
        uri,
        status,
        intent: applySecondaryFilters
          ? optionalEnum(args["intent"], ["fix", "explain", "refactor", "review", "design", "question"] as const)
          : undefined,
        anchorKind,
        surfaceType,
        updatedSince: optionalString(args["updatedSince"]),
        lastAuthor: applySecondaryFilters
          ? optionalEnum(args["lastAuthor"], ["user", "agent"] as const)
          : undefined,
        limit: args["limit"] as number | undefined,
        offset: args["offset"] as number | undefined,
      };

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
