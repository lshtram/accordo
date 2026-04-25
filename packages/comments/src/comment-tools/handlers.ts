/**
 * Comment tool handler factory — builds ExtensionToolDefinition[] by attaching
 * handler functions to the schemas in definitions.ts.
 *
 * Source: comments-architecture.md §6, requirements-comments.md M38-CT-01..11
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { CommentStore } from "../comment-store.js";
import { commentToolSchemas } from "./definitions.js";
import { buildCommentHandlers } from "./handler-impl.js";
import { normalizeCommentUri } from "./notifier.js";
import type { CommentUINotifier } from "./notifier.js";
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
  const handlers = buildCommentHandlers(store, ui, rateLimiter);

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
