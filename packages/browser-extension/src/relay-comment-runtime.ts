import type { RelayBridgeClient } from "./relay-bridge.js";
import { selectAdapter, LocalStorageAdapter, type CommentBackendAdapter } from "./adapters/comment-backend.js";
import type { BrowserCommentThread } from "./types.js";

let relayClient: RelayBridgeClient | null = null;

export function setRelayClient(relay: RelayBridgeClient): void {
  relayClient = relay;
}

export function getAdapter(): CommentBackendAdapter {
  if (!relayClient) {
    return new LocalStorageAdapter();
  }
  return selectAdapter(relayClient);
}

export function toThreadSummary(thread: BrowserCommentThread): {
  threadId: string;
  status: "open" | "resolved";
  anchorKey: string;
  anchorContext: BrowserCommentThread["anchorContext"];
  lastComment: string;
  lastAuthor: string;
  lastActivity: string;
  commentCount: number;
} {
  const latest = thread.comments[thread.comments.length - 1];
  return {
    threadId: thread.id,
    status: thread.status,
    anchorKey: thread.anchorKey,
    anchorContext: thread.anchorContext,
    lastComment: latest?.body ?? "",
    lastAuthor: latest?.author?.name ?? "",
    lastActivity: thread.lastActivity,
    commentCount: thread.comments.length,
  };
}
