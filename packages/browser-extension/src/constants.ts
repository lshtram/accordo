/**
 * M80-CONST — Extension-wide message type constants.
 *
 * Centralised here so popup, content scripts, and service worker all share
 * the same constants without any of them importing from service-worker.ts
 * (which would pull service-worker-only runtime dependencies into every bundle).
 *
 * Kept separate from types.ts so that types.ts remains 100% runtime-free
 * (required by BR-F-06).
 */

export const MESSAGE_TYPES = {
  TOGGLE_COMMENTS_MODE: "TOGGLE_COMMENTS_MODE",
  GET_THREADS: "GET_THREADS",
  CREATE_THREAD: "CREATE_THREAD",
  ADD_COMMENT: "ADD_COMMENT",
  RESOLVE_THREAD: "RESOLVE_THREAD",
  REOPEN_THREAD: "REOPEN_THREAD",
  SOFT_DELETE_THREAD: "SOFT_DELETE_THREAD",
  SOFT_DELETE_COMMENT: "SOFT_DELETE_COMMENT",
  COMMENTS_UPDATED: "COMMENTS_UPDATED",
  UPDATE_COMMENT: "UPDATE_COMMENT",
  EXPORT: "EXPORT",
  GET_TAB_COMMENTS_MODE: "GET_TAB_COMMENTS_MODE",
  SET_BADGE_TEXT: "SET_BADGE_TEXT",
  MCP_GET_COMMENTS: "MCP_GET_COMMENTS",
  MCP_GET_SCREENSHOT: "MCP_GET_SCREENSHOT",
  BROWSER_RELAY_ACTION: "BROWSER_RELAY_ACTION",
  RELAY_RECONNECT: "RELAY_RECONNECT",
  FOCUS_THREAD: "FOCUS_THREAD",
  "mcp:get_comments": "mcp:get_comments",
  "mcp:get_screenshot": "mcp:get_screenshot",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
