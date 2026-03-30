/**
 * @accordo/comments — Public API
 *
 * Public (stable — safe to import from other packages):
 *   CommentRepository,
 *   ListThreadsOptions, ListThreadsResult, ThreadSummary,
 *   CreateCommentParams, CreateCommentResult,
 *   ReplyParams, ReplyResult,
 *   ResolveParams, DeleteParams,
 *   DocumentChangeInfo, ChangeListener,
 *   ToolSchema, commentToolSchemas,
 *   buildCommentToolHandlers(), normalizeCommentUri(),
 *   CommentUINotifier, CompositeCommentUINotifier, CreateRateLimiter,
 *   all types from @accordo/bridge-types that are used as parameters.
 *
 * Internal (for package use only — may change without notice):
 *   comment-store-ops.ts, comment-query-ops.ts, comment-mutation-ops.ts,
 *   comment-tools/handlers.ts (use buildCommentToolHandlers() instead),
 *   comment-tools/notifier.ts, comment-tools/rate-limiter.ts,
 *   native-comment-controller.ts, native-comment-sync.ts, native-comments.ts,
 *   comment-store.ts, comment-store-io.ts,
 *   panel-*.ts, panel/, bridge-integration.ts,
 *   state-contribution.ts, comments-bootstrap.ts,
 *   anchor.ts, comment-tools.ts, extension.ts
 *
 * Not exported (dead ends — internal utilities):
 *   index.ts (this file)
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
