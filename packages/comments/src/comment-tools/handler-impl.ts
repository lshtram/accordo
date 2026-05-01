import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { CommentStore } from "../comment-store.js";
import { buildCommentMutationHandlers } from "./mutation-handlers.js";
import type { CommentUINotifier } from "./notifier.js";
import { buildCommentQueryHandlers } from "./query-handlers.js";
import type { CreateRateLimiter } from "./rate-limiter.js";

/**
 * Build all comment handlers (query + mutation), closing over store + external notifier.
 *
 * NOTIFIER ARCHITECTURE (comments-sync-hardening):
 *   - external: ExternalFanoutNotifier — browser relay, NOT NativeComments
 *   - Native widget mutation via store.onChanged -> nc.reconcile() ONLY
 */
export function buildCommentHandlers(
  store: CommentStore,
  external: CommentUINotifier | undefined,
  rateLimiter: CreateRateLimiter,
): Record<string, ExtensionToolDefinition["handler"]> {
  return {
    ...buildCommentQueryHandlers(store),
    ...buildCommentMutationHandlers(store, external, rateLimiter),
  };
}
