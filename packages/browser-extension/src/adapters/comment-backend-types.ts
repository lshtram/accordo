import type { BrowserCommentThread } from "../types.js";

export interface CommentThreadSummary {
  threadId: string;
  status: "open" | "resolved";
  anchorKey: string;
  anchorContext?: {
    tagName?: string;
    frameId?: string;
    textSnippet?: string;
    ariaLabel?: string;
    pageTitle?: string;
    snapshotId?: string;
    confidence?: "high" | "medium" | "low" | "none";
    resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
    snapshotDrift?: boolean;
  };
  lastComment: string;
  lastAuthor: string;
  lastActivity: string;
  commentCount: number;
}

export interface CreateThreadParams {
  url: string;
  anchorKey: string;
  body: string;
  authorName?: string;
  commentId?: string;
  threadId?: string;
  anchorContext?: BrowserCommentThread["anchorContext"];
}

export interface ReplyParams {
  threadId: string;
  body: string;
  commentId?: string;
  authorName?: string;
}

export interface CommentBackendAdapter {
  listThreads(url: string): Promise<CommentThreadSummary[]>;
  createThread(params: CreateThreadParams): Promise<{ threadId: string; commentId: string; pageUrl: string }>;
  reply(params: ReplyParams): Promise<{ commentId: string; body: string; pageUrl: string }>;
  resolve(threadId: string, resolutionNote?: string): Promise<void>;
  reopen(threadId: string): Promise<void>;
  delete(threadId: string, commentId?: string): Promise<void>;
  isConnected(): boolean;
}

export interface StandaloneMcpAdapterConfig {
  serverUrl: string;
  authToken?: string;
}

export function toSummary(thread: BrowserCommentThread): CommentThreadSummary {
  const activeComments = thread.comments.filter((c) => !c.deletedAt);
  const lastComment = activeComments[activeComments.length - 1];
  return {
    threadId: thread.id,
    status: thread.status,
    anchorKey: thread.anchorKey,
    anchorContext: thread.anchorContext,
    lastComment: lastComment?.body ?? "",
    lastAuthor: lastComment?.author.name ?? "anonymous",
    lastActivity: thread.lastActivity,
    commentCount: activeComments.length,
  };
}
