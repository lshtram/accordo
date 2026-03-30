/**
 * Public barrel for @accordo/comments.
 *
 * Re-exports the public API that is safe for external consumption:
 * pure types, interfaces, and VSCode-free classes only.
 *
 * CommentStore is intentionally excluded — it imports vscode and is an
 * internal VSCode-adapter concern.
 */

// ── Domain types (no vscode) ──────────────────────────────────────────────────
export type {
  ListThreadsOptions,
  ListThreadsResult,
  ThreadSummary,
  CreateCommentParams,
  CreateCommentResult,
  ReplyParams,
  ReplyResult,
  ResolveParams,
  DeleteParams,
  DocumentChangeInfo,
  ChangeListener,
} from "./comment-repository.js";

// ── Pure domain class (no vscode) ────────────────────────────────────────────
export { CommentRepository } from "./comment-repository.js";

// ── Tool schemas (no vscode) ─────────────────────────────────────────────────
export type { ToolSchema } from "./comment-tools/definitions.js";
export { commentToolSchemas } from "./comment-tools/definitions.js";

// ── Tool handler factory + utilities (no vscode) ─────────────────────────────
export { buildCommentToolHandlers } from "./comment-tools/handlers.js";
export { normalizeCommentUri } from "./comment-tools/handlers.js";
export type { CommentUINotifier } from "./comment-tools/handlers.js";
export { CompositeCommentUINotifier } from "./comment-tools/handlers.js";
export { CreateRateLimiter } from "./comment-tools/handlers.js";
