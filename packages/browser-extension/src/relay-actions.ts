import { addComment, createThread, getActiveThreads, getCommentPageSummaries, normalizeUrl, reopenThread, resolveThread, softDeleteComment, softDeleteThread } from "./store.js";

export type RelayAction =
  | "get_all_comments"
  | "get_comments"
  | "create_comment"
  | "reply_comment"
  | "resolve_thread"
  | "reopen_thread"
  | "delete_comment"
  | "delete_thread";

export interface RelayActionRequest {
  requestId: string;
  action: RelayAction;
  payload: Record<string, unknown>;
}

export interface RelayActionResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: "action-failed" | "unsupported-action" | "invalid-request";
}

async function getActiveTabUrl(): Promise<string | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tabs[0]?.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
  return normalizeUrl(url);
}

async function resolveRequestedUrl(payload: Record<string, unknown>): Promise<string | null> {
  const explicitUrl = payload.url as string | undefined;
  if (explicitUrl && explicitUrl.trim().length > 0) {
    return normalizeUrl(explicitUrl);
  }
  return await getActiveTabUrl();
}

export async function handleRelayAction(request: RelayActionRequest): Promise<RelayActionResponse> {
  try {
    switch (request.action) {
      case "get_all_comments": {
        const pages = await getCommentPageSummaries();
        return {
          requestId: request.requestId,
          success: true,
          data: {
            pages,
            totalPages: pages.length,
          },
        };
      }

      case "get_comments": {
        const url = await resolveRequestedUrl(request.payload);
        if (!url) {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }
        const threads = await getActiveThreads(url);
        return {
          requestId: request.requestId,
          success: true,
          data: {
            url,
            activeTabUrl: await getActiveTabUrl(),
            threads,
            threadSummaries: threads.map((t) => {
              const latest = t.comments[t.comments.length - 1];
              return {
                threadId: t.id,
                status: t.status,
                anchorKey: t.anchorKey,
                anchorContext: t.anchorContext,
                lastComment: latest?.body ?? "",
                lastAuthor: latest?.author?.name ?? "",
                lastActivity: t.lastActivity,
                commentCount: t.comments.length,
              };
            }),
            totalThreads: threads.length,
            openThreads: threads.filter((t) => t.status === "open").length,
          },
        };
      }

      case "create_comment": {
        const body = request.payload.body as string;
        if (!body || !body.trim()) {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }
        const url = await resolveRequestedUrl(request.payload);
        if (!url) {
          return { requestId: request.requestId, success: false, error: "invalid-request" };
        }
        const anchorKey = (request.payload.anchorKey as string | undefined) ?? "body:0:center";
        const authorName = (request.payload.authorName as string | undefined) ?? "Agent";
        const anchorContext = request.payload.anchorContext as {
          tagName: string;
          textSnippet?: string;
          ariaLabel?: string;
          pageTitle?: string;
        } | undefined;

        const thread = await createThread(
          url,
          anchorKey,
          { body, author: { kind: "user", name: authorName } },
          anchorContext,
        );
        return { requestId: request.requestId, success: true, data: { ...thread, pageUrl: thread.pageUrl } };
      }

      case "reply_comment": {
        const threadId = request.payload.threadId as string;
        const body = request.payload.body as string;
        const authorName = (request.payload.authorName as string | undefined) ?? "Agent";
        const comment = await addComment(threadId, {
          body,
          author: { kind: "user", name: authorName },
        });
        return { requestId: request.requestId, success: true, data: { ...comment, pageUrl: comment.pageUrl } };
      }

      case "delete_comment": {
        const threadId = request.payload.threadId as string;
        const commentId = request.payload.commentId as string;
        const pageUrl = await softDeleteComment(threadId, commentId);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      case "resolve_thread": {
        const threadId = request.payload.threadId as string;
        const resolutionNote = request.payload.resolutionNote as string | undefined;
        const pageUrl = await resolveThread(threadId, resolutionNote);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      case "reopen_thread": {
        const threadId = request.payload.threadId as string;
        const pageUrl = await reopenThread(threadId);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      case "delete_thread": {
        const threadId = request.payload.threadId as string;
        const pageUrl = await softDeleteThread(threadId);
        if (!pageUrl) {
          return { requestId: request.requestId, success: false, error: "action-failed" };
        }
        return { requestId: request.requestId, success: true, data: { pageUrl } };
      }

      default:
        return { requestId: request.requestId, success: false, error: "unsupported-action" };
    }
  } catch {
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }
}
