/**
 * CommentTools — entry point (delegation shell).
 *
 * Exports `createCommentTools` and `CompositeCommentUINotifier` for `extension.ts`.
 * Implementation lives in:
 *   ./comment-tools/definitions.ts — schema objects
 *   ./comment-tools/handlers.ts    — handler logic, rate limiting, anchor builders
 *
 * Source: comments-architecture.md §6
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { CommentStore } from "./comment-store.js";
import type { CommentUINotifier } from "./comment-tools/handlers.js";
import { CreateRateLimiter, buildCommentToolHandlers } from "./comment-tools/handlers.js";

// Re-export the public API — tests and extension.ts import from this file.
export { normalizeCommentUri } from "./comment-tools/handlers.js";
export type { CommentUINotifier } from "./comment-tools/handlers.js";
export { CompositeCommentUINotifier } from "./comment-tools/handlers.js";
export { CreateRateLimiter } from "./comment-tools/handlers.js";

/**
 * Create the array of 8 ExtensionToolDefinition for comment MCP tools.
 *
 * Tools: comment_list, comment_get, comment_create, comment_reply,
 * comment_resolve, comment_reopen, comment_delete, comment_sync_version
 *
 * Source: comments-architecture.md §6, §10.4, requirements-comments.md M38-CT-01..11
 */
export function createCommentTools(
  store: CommentStore,
  ui?: CommentUINotifier,
): ExtensionToolDefinition[] {
  const rateLimiter = new CreateRateLimiter();
  return buildCommentToolHandlers(store, ui, rateLimiter);
}
