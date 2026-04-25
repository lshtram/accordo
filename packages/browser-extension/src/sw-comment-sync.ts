/**
 * sw-comment-sync.ts — Comment store sync facade
 */

export type { HubComment, HubCommentThread } from "./sw-comment-sync-types.js";
export {
  coordinatesToAnchorKey,
  fetchHubThreads,
  getMergedThreads,
  hubThreadToBrowserThread,
  mergeLocalAndHubThread,
  urlsMatch,
} from "./sw-comment-sync-adapter.js";
