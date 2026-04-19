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
  // null or undefined → safe empty
  if (data === null || data === undefined) {
    return [];
  }

  let threads: HubCommentThread[] = [];

  // Canonical { threads } envelope
  if (
    typeof data === "object" &&
    !Array.isArray(data) &&
    data !== null &&
    "threads" in data &&
    Array.isArray((data as Record<string, unknown>).threads)
  ) {
    threads = (data as Record<string, unknown>).threads as HubCommentThread[];
  } else if (Array.isArray(data)) {
    // Bare array (legacy compat) — treat as threads directly
    threads = data as HubCommentThread[];
  } else {
    // Malformed → defensive empty
    return [];
  }

  // Filter out threads that lack required fields (shallow validation)
  return threads.filter((thread) => {
    if (!thread || typeof thread !== "object") return false;
    // Clone to plain object for safe dynamic property access
    const t = Object.assign({}, thread) as unknown as Record<string, unknown>;
    if (typeof t.id !== "string") return false;
    if (!t.anchor || typeof t.anchor !== "object") return false;
    if (!Array.isArray(t.comments)) return false;
    return true;
  });
}

/**
 * Encode a browser comment action payload for relay transport.
 */
export function encodeBrowserCommentAction(
  action: BrowserRelayCommentAction,
  payload: unknown,
): unknown {
  const wire: Record<string, unknown> = {
    action,
    payload,
  };

  switch (action) {
    case "get_comments":
    case "get_all_comments":
    case "create_comment":
    case "reply_comment":
    case "resolve_thread":
    case "reopen_thread":
    case "delete_comment":
    case "delete_thread":
      return wire;
    default:
      throw new Error("not implemented");
  }
}
