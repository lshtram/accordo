/**
 * CommentTools — entry point (delegation shell).
 *
 * Exports `createCommentTools` and `ExternalFanoutNotifier` for `extension.ts`.
 * Implementation lives in:
 *   ./comment-tools/definitions.ts — schema objects
 *   ./comment-tools/handlers.ts    — handler logic, rate limiting, anchor builders
 *
 * Source: comments-architecture.md §6
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { CommentStore } from "./comment-store.js";
import type { CommentUINotifier } from "./comment-tools/handlers.js";
import { CreateRateLimiter, buildCommentToolHandlers, ExternalFanoutNotifier } from "./comment-tools/handlers.js";

// Re-export the public API — tests and extension.ts import from this file.
export { normalizeCommentUri } from "./comment-tools/handlers.js";
export type { CommentUINotifier } from "./comment-tools/handlers.js";
export { ExternalFanoutNotifier } from "./comment-tools/handlers.js";
export { CreateRateLimiter } from "./comment-tools/handlers.js";

/**
 * Create the array of 8 ExtensionToolDefinition for comment MCP tools.
 *
 * Tools: comment_list, comment_get, comment_create, comment_reply,
 * comment_resolve, comment_reopen, comment_delete, comment_sync_version
 *
 * NOTIFIER ARCHITECTURE (comments-sync-hardening):
 *   - external: ExternalFanoutNotifier — notified by MCP mutation handlers
 *   - NativeComments receives mutations ONLY via store.onChanged -> nc.reconcile()
 *   - external is NOT passed NativeComments — it's for browser relay only
 *
 * Source: comments-architecture.md §6, §10.4, requirements-comments.md M38-CT-01..11
 */
export function createCommentTools(
  store: CommentStore,
  external?: CommentUINotifier,
): ExtensionToolDefinition[] {
  const rateLimiter = new CreateRateLimiter();
  return buildCommentToolHandlers(store, external, rateLimiter);
}
