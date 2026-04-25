import type { PageCommentStore } from "./types.js";

export interface CommentPageSummary {
  url: string;
  lastActivity: string;
  totalThreads: number;
  openThreads: number;
  totalComments: number;
}

export async function getCommentPageSummaries(): Promise<CommentPageSummary[]> {
  const all = await chrome.storage.local.get(null);
  const summaries: CommentPageSummary[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("comments:")) continue;
    const store = value as PageCommentStore | undefined;
    if (!store || !Array.isArray(store.threads)) continue;

    const threads = store.threads;
    if (threads.length === 0) continue;

    const sortedByActivity = [...threads].sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
    const lastActivity = sortedByActivity[0]?.lastActivity ?? new Date(0).toISOString();
    const activeThreads = threads.filter((t) => !t.deletedAt);
    const openThreads = activeThreads.filter((t) => t.status === "open").length;
    const totalComments = activeThreads.reduce((sum, t) => sum + t.comments.filter((c) => !c.deletedAt).length, 0);

    summaries.push({
      url: store.url,
      lastActivity,
      totalThreads: activeThreads.length,
      openThreads,
      totalComments,
    });
  }

  summaries.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  return summaries;
}
