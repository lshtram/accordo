import type { CommentThread } from "@accordo/bridge-types";

/**
 * Canonical read envelope for browser comment relay responses.
 *
 * All read actions (`get_comments`, `get_all_comments`) must produce this shape
 * regardless of relay mode.
 */
export interface BrowserCommentReadEnvelope {
  threads: CommentThread[];
}

/**
 * Comment relay actions that are routed through the unified comment tool set.
 */
export type BrowserRelayCommentAction =
  | "get_comments"
  | "get_all_comments"
  | "create_comment"
  | "reply_comment"
  | "resolve_thread"
  | "reopen_thread"
  | "delete_comment"
  | "delete_thread";

/**
 * Generic browser relay response wrapper for comment relay actions.
 */
export interface BrowserRelayResponse<TData = unknown> {
  requestId: string;
  success: boolean;
  data?: TData;
  error?: "browser-not-connected" | "unauthorized" | "timeout" | "action-failed" | "invalid-request";
}

/**
 * Normalize unknown read payloads into the canonical `{ threads }` envelope.
 *
 * Must produce mode-invariant output for both shared-relay and per-window relay
 * activation paths.
 */
export function normalizeReadResult(data: unknown): BrowserCommentReadEnvelope {
  void data;
  throw new Error("not implemented");
}

/**
 * Shape a comment relay action result into the canonical relay response.
 */
export function shapeRelayResponse<TData>(
  action: BrowserRelayCommentAction,
  result: TData,
): BrowserRelayResponse<TData | BrowserCommentReadEnvelope> {
  void action;
  void result;
  throw new Error("not implemented");
}
