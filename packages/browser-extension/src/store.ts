/**
 * M80-STORE — Comment Storage Manager facade
 *
 * @module
 */

export type { CommentPageSummary } from "./store-summaries.js";
export { getCommentPageSummaries } from "./store-summaries.js";
export { getStorageKey, normalizeUrl } from "./store-keys.js";
export { findThreadAndStore, getPageStore, savePageStore } from "./store-page-store.js";
export {
  addComment,
  createThread,
  getActiveThreads,
  getAllThreads,
  reopenThread,
  resolveThread,
  softDeleteComment,
  softDeleteThread,
  updateComment,
} from "./store-thread-mutations.js";
