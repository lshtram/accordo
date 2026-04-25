import { createThread, addComment, reopenThread, resolveThread, softDeleteComment, softDeleteThread } from "./store.js";
import { MESSAGE_TYPES } from "./constants.js";
import { getMergedThreads } from "./sw-comment-sync.js";
import type { RelayBridgeClient } from "./relay-bridge.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import type { SwMessage, SwResponse, ForwardFn, BroadcastFn } from "./sw-router.js";

export async function handleCommentMessage(
  relayBridge: RelayBridgeClient,
  forwardToAccordoBrowser: ForwardFn,
  broadcastCommentsUpdated: BroadcastFn,
  message: SwMessage,
): Promise<SwResponse | undefined> {
  const payload = message.payload as Record<string, unknown> | undefined;
  switch (message.type) {
    case MESSAGE_TYPES.GET_THREADS: {
      const url = (payload?.url as string | undefined) ?? "";
      const threads = await getMergedThreads(relayBridge, url);
      return { success: true, data: threads };
    }
    case MESSAGE_TYPES.CREATE_THREAD: {
      const url = payload?.url as string;
      const anchorKey = payload?.anchorKey as string;
      const body = payload?.body as string;
      const author = payload?.author as { kind: "user"; name: string };
      const anchorContext = payload?.anchorContext as {
        tagName: string;
        frameId?: string;
        textSnippet?: string;
        ariaLabel?: string;
        pageTitle?: string;
        snapshotId?: string;
        confidence?: "high" | "medium" | "low" | "none";
        resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
        snapshotDrift?: boolean;
      } | undefined;
      const thread = await createThread(url, anchorKey, { body, author }, anchorContext);
      void forwardToAccordoBrowser("create_comment", { body, url, anchorKey, authorName: author?.name, threadId: thread.id, commentId: thread.comments[0]?.id, anchorContext });
      await broadcastCommentsUpdated(thread.pageUrl);
      return { success: true, data: thread };
    }
    case MESSAGE_TYPES.ADD_COMMENT: {
      const threadId = payload?.threadId as string;
      const body = payload?.body as string;
      const author = payload?.author as { kind: "user"; name: string };
      const callerCommentId = payload?.commentId as string | undefined;
      try {
        const comment = await addComment(threadId, { body, author, commentId: callerCommentId });
        void forwardToAccordoBrowser("reply_comment", { threadId, body, authorName: author?.name, commentId: comment.id });
        await broadcastCommentsUpdated(comment.pageUrl);
        return { success: true, data: comment };
      } catch {
        return { success: false, error: "action-failed" };
      }
    }
    case MESSAGE_TYPES.SOFT_DELETE_COMMENT: {
      const threadId = payload?.threadId as string;
      const commentId = payload?.commentId as string;
      const url = await softDeleteComment(threadId, commentId);
      void forwardToAccordoBrowser("delete_comment", { threadId, commentId });
      await broadcastCommentsUpdated(url ?? undefined);
      return { success: true };
    }
    case MESSAGE_TYPES.SOFT_DELETE_THREAD: {
      const threadId = payload?.threadId as string;
      const url = await softDeleteThread(threadId);
      if (!url) return { success: false, error: "thread not found" };
      void forwardToAccordoBrowser("delete_thread", { threadId });
      await broadcastCommentsUpdated(url ?? undefined);
      return { success: true };
    }
    case MESSAGE_TYPES.RESOLVE_THREAD: {
      const threadId = payload?.threadId as string;
      const resolutionNote = payload?.resolutionNote as string | undefined;
      const url = await resolveThread(threadId, resolutionNote);
      void forwardToAccordoBrowser("resolve_thread", { threadId, resolutionNote });
      await broadcastCommentsUpdated(url ?? undefined);
      return { success: true };
    }
    case MESSAGE_TYPES.REOPEN_THREAD: {
      const threadId = payload?.threadId as string;
      const url = await reopenThread(threadId);
      void forwardToAccordoBrowser("reopen_thread", { threadId });
      await broadcastCommentsUpdated(url ?? undefined);
      return { success: true };
    }
    case MESSAGE_TYPES.BROWSER_RELAY_ACTION: {
      return undefined;
    }
    default:
      return undefined;
  }
}
