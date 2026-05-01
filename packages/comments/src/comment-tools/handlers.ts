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
import { normalizeCommentUri, ExternalFanoutNotifier } from "./notifier.js";
import type { CommentUINotifier } from "./notifier.js";
import type { CreateRateLimiter } from "./rate-limiter.js";

// Re-export for consumers that import from handlers.ts
export { normalizeCommentUri } from "./notifier.js";
export type { CommentUINotifier } from "./notifier.js";
export { ExternalFanoutNotifier } from "./notifier.js";
export { CreateRateLimiter } from "./rate-limiter.js";

/**
 * Build the full ExtensionToolDefinition array for comment MCP tools,
 * combining schemas from definitions.ts with handlers that close over store + external notifier.
 *
 * Source: comments-architecture.md §6, requirements-comments.md M38-CT-01..11
 *
 * NOTIFIER ARCHITECTURE (comments-sync-hardening):
 *   - external: ExternalFanoutNotifier — notifies ONLY external observers (browser relay)
 *   - Native widget mutation happens via store.onChanged -> nc.reconcile() ONLY
 *   - ui parameter is renamed to external to make the architecture explicit
 */
export function buildCommentToolHandlers(
  store: CommentStore,
  external: CommentUINotifier | undefined,
  rateLimiter: CreateRateLimiter,
): ExtensionToolDefinition[] {
  const handlers = buildCommentHandlers(store, external, rateLimiter);

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
