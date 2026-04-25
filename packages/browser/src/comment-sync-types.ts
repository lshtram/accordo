/** Remote browser thread data returned by Chrome relay `get_comments` action. */
export interface RemoteBrowserThread {
  id: string;
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
  pageUrl: string;
  status: "open" | "resolved";
  comments: RemoteBrowserComment[];
  createdAt: string;
  lastActivity: string;
  deletedAt?: string;
}

/** A single comment inside a RemoteBrowserThread. */
export interface RemoteBrowserComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user"; name: string };
  body: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  resolutionNote?: string;
  deletedAt?: string;
}

/** Shape returned by the Chrome relay `get_comments` action for a single page. */
export interface GetCommentsResponse {
  url: string;
  threads: RemoteBrowserThread[];
}
