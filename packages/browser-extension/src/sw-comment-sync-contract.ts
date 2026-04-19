import type { HubCommentThread } from "./sw-comment-sync.js";

/**
 * Comment relay actions encoded on the browser-extension relay wire.
 *
 * This mirrors the browser package comment relay action union.
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
 * Decode hub thread payloads into a normalized thread list.
 *
 * Canonical input shape is `{ threads: HubCommentThread[] }`. Legacy bare-array
 * payloads may be tolerated for backward compatibility.
 */
export function decodeHubThreadsPayload(data: unknown): HubCommentThread[] {
  void data;
  throw new Error("not implemented");
}

/**
 * Encode a browser comment action payload for relay transport.
 */
export function encodeBrowserCommentAction(
  action: BrowserRelayCommentAction,
  payload: unknown,
): unknown {
  void action;
  void payload;
  throw new Error("not implemented");
}
