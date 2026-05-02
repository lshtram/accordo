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
  error?: "browser-not-connected" | "unauthorized" | "timeout" | "action-failed" | "invalid-request" | "action-unsupported";
}

/**
 * Normalize unknown read payloads into the canonical `{ threads }` envelope.
 *
 * Must produce mode-invariant output for both shared-relay and per-window relay
 * activation paths.
 */
export function normalizeReadResult(data: unknown): BrowserCommentReadEnvelope {
  // null or undefined → safe empty
  if (data === null || data === undefined) {
    return { threads: [] };
  }

  // Canonical { threads } envelope — return as-is
  if (
    typeof data === "object" &&
    !Array.isArray(data) &&
    data !== null &&
    "threads" in data &&
    Array.isArray((data as Record<string, unknown>).threads)
  ) {
    return { threads: (data as Record<string, unknown>).threads as CommentThread[] };
  }

  // Bare array (legacy compat) — wrap as { threads: data }
  if (Array.isArray(data)) {
    return { threads: data as CommentThread[] };
  }

  // Malformed shapes ({ threads: null }, { threads: "bad" }, etc.) → defensive empty
  return { threads: [] };
}

/**
 * Shape a comment relay action result into the canonical relay response.
 */
export function shapeRelayResponse<TData>(
  _action: BrowserRelayCommentAction,
  result: TData,
): BrowserRelayResponse<TData | BrowserCommentReadEnvelope> {
  const requestId = crypto.randomUUID();

  // Error-like: has an `error` field (but success:true from invokeTool may also have this)
  // or is an Error instance
  if (result instanceof Error) {
    return { requestId, success: false, error: "action-failed" };
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof (result as Record<string, unknown>).error === "string"
  ) {
    return {
      requestId,
      success: false,
      error: (result as Record<string, unknown>).error as BrowserRelayResponse["error"],
    };
  }

  return { requestId, success: true, data: result };
}
