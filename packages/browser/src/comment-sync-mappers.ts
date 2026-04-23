import type { RemoteBrowserComment, RemoteBrowserThread } from "./comment-sync-types.js";

export function remoteThreadToCreateArgs(thread: RemoteBrowserThread): Record<string, unknown> {
  const firstComment = thread.comments[0];
  return {
    scope: { modality: "browser", url: thread.pageUrl },
    anchor: { kind: "browser", anchorKey: thread.anchorKey },
    body: firstComment?.body ?? "",
    threadId: thread.id,
    commentId: firstComment?.id,
    context: thread.anchorContext
      ? {
          surfaceMetadata: {
            anchorKey: thread.anchorKey,
            tagName: thread.anchorContext.tagName,
            textSnippet: thread.anchorContext.textSnippet,
            ariaLabel: thread.anchorContext.ariaLabel,
            pageTitle: thread.anchorContext.pageTitle,
          },
        }
      : { surfaceMetadata: { anchorKey: thread.anchorKey } },
    authorKind: firstComment?.author?.kind === "user" ? "user" : "agent",
    authorName: firstComment?.author?.name,
  };
}

export function remoteCommentToReplyArgs(comment: RemoteBrowserComment): Record<string, unknown> {
  return {
    threadId: comment.threadId,
    body: comment.body,
    commentId: comment.id,
    authorKind: comment.author?.kind === "user" ? "user" : "agent",
    authorName: comment.author?.name,
  };
}
