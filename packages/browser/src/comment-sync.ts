/**
 * comment-sync.ts — Browser Comment Synchronization
 *
 * Extracts the Chrome ↔ VSCode comment sync logic from extension.ts into a
 * focused module. Handles:
 *   - Remote browser thread/comment type definitions
 *   - Mapping remote threads/comments to unified comment_* tool args
 *   - Full bidirectional sync algorithm (upsert + delete)
 *   - Periodic sync scheduler with in-flight guard
 *
 * @module
 */

import type * as vscode from "vscode";
export type {
  GetCommentsResponse,
  RemoteBrowserComment,
  RemoteBrowserThread,
} from "./comment-sync-types.js";
export {
  remoteCommentToReplyArgs,
  remoteThreadToCreateArgs,
} from "./comment-sync-mappers.js";
export { syncBrowserComments } from "./comment-sync-runtime.js";
export { BrowserCommentSyncScheduler, SYNC_INTERVAL_MS } from "./comment-sync-scheduler.js";
