import type { RelayBridgeClient } from "../relay-bridge.js";
import type { CommentBackendAdapter, CommentThreadSummary, CreateThreadParams, ReplyParams } from "./comment-backend-types.js";

export class VscodeRelayAdapter implements CommentBackendAdapter {
  constructor(private readonly relay: RelayBridgeClient) {}

  async listThreads(url: string): Promise<CommentThreadSummary[]> {
    const res = await this.relay.send("get_comments", { url });
    if (!res.success) return [];

    let threads: Array<{
      id: string;
      anchorKey: string;
      anchorContext?: { tagName?: string; frameId?: string; textSnippet?: string; ariaLabel?: string; pageTitle?: string; snapshotId?: string; confidence?: "high" | "medium" | "low" | "none"; resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6; snapshotDrift?: boolean };
      status: "open" | "resolved";
      comments: Array<{ id: string; body: string; author: { kind: string; name: string }; createdAt: string }>;
      lastActivity: string;
    }>;

    if (Array.isArray(res.data)) {
      threads = res.data;
    } else if (res.data && typeof res.data === "object" && "threads" in res.data && Array.isArray((res.data as { threads?: unknown }).threads)) {
      threads = (res.data as { threads: typeof threads }).threads;
    } else {
      return [];
    }

    return threads.map((t) => {
      const activeComments = t.comments.filter((c) => c.body.length > 0);
      const last = activeComments[activeComments.length - 1];
      return {
        threadId: t.id,
        status: t.status,
        anchorKey: t.anchorKey,
        anchorContext: t.anchorContext,
        lastComment: last?.body ?? "",
        lastAuthor: last?.author.name ?? "anonymous",
        lastActivity: t.lastActivity,
        commentCount: activeComments.length,
      };
    });
  }

  async createThread(params: CreateThreadParams): Promise<{ threadId: string; commentId: string; pageUrl: string }> {
    const res = await this.relay.send("create_comment", {
      body: params.body,
      url: params.url,
      anchorKey: params.anchorKey,
      authorName: params.authorName,
      threadId: params.threadId,
      commentId: params.commentId,
      anchorContext: params.anchorContext,
    });
    if (!res.success || !res.data) throw new Error(res.error ?? "Create thread failed");
    return res.data as { threadId: string; commentId: string; pageUrl: string };
  }

  async reply(params: ReplyParams): Promise<{ commentId: string; body: string; pageUrl: string }> {
    const res = await this.relay.send("reply_comment", {
      threadId: params.threadId,
      body: params.body,
      commentId: params.commentId,
      authorName: params.authorName,
    });
    if (!res.success || !res.data) throw new Error(res.error ?? "Reply failed");
    return res.data as { commentId: string; body: string; pageUrl: string };
  }

  async resolve(threadId: string, resolutionNote?: string): Promise<void> {
    const res = await this.relay.send("resolve_thread", { threadId, resolutionNote });
    if (!res.success) throw new Error(res.error ?? "Resolve failed");
  }

  async reopen(threadId: string): Promise<void> {
    const res = await this.relay.send("reopen_thread", { threadId });
    if (!res.success) throw new Error(res.error ?? "Reopen failed");
  }

  async delete(threadId: string, commentId?: string): Promise<void> {
    const action = commentId ? "delete_comment" : "delete_thread";
    const payload = commentId ? { threadId, commentId } : { threadId };
    const res = await this.relay.send(action, payload);
    if (!res.success) throw new Error(res.error ?? "Delete failed");
  }

  isConnected(): boolean {
    return this.relay.isConnected();
  }
}
