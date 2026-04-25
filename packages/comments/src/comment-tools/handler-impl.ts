import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { CommentStore } from "../comment-store.js";
import { buildCommentMutationHandlers } from "./mutation-handlers.js";
import type { CommentUINotifier } from "./notifier.js";
import { buildCommentQueryHandlers } from "./query-handlers.js";
import type { CreateRateLimiter } from "./rate-limiter.js";

export function buildCommentHandlers(
  store: CommentStore,
  ui: CommentUINotifier | undefined,
  rateLimiter: CreateRateLimiter,
): Record<string, ExtensionToolDefinition["handler"]> {
  return {
    ...buildCommentQueryHandlers(store),
    ...buildCommentMutationHandlers(store, ui, rateLimiter),
  };
}
