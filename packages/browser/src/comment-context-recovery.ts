interface BrowserCommentThreadShape {
  id: string;
  anchor?: {
    kind?: string;
    surfaceType?: string;
    coordinates?: { type?: string; blockId?: string; x?: number; y?: number };
  };
  comments?: BrowserCommentShape[];
}

interface BrowserCommentShape {
  id: string;
  body?: string;
  context?: { surfaceMetadata?: Record<string, string | undefined> };
}

interface CommentGetFailureShape {
  success?: boolean;
  error?: string;
  message?: string;
}

export interface ResolvedCommentAnchorMetadata {
  error?: "comment-not-found";
  commentId?: string;
  commentBody?: string;
  pageUrl?: string;
  anchorKey?: string;
  frameId?: string;
  creationSnapshotId?: string;
  surfaceMetadata?: Record<string, string | undefined>;
}

function toViewportAnchorKey(x: number, y: number): string {
  return `body:${Math.round(x * 100)}%x${Math.round(y * 100)}%`;
}

function normalizeStoredAnchorKey(anchorKey: string | undefined): string | undefined {
  if (!anchorKey) return undefined;
  const normalizedMatch = anchorKey.match(/^(-?\d*\.?\d+):(-?\d*\.?\d+)$/);
  if (!normalizedMatch) return anchorKey;
  const x = Number.parseFloat(normalizedMatch[1]);
  const y = Number.parseFloat(normalizedMatch[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? toViewportAnchorKey(x, y) : anchorKey;
}

function isBrowserSurfaceAnchor(thread: BrowserCommentThreadShape): boolean {
  return thread.anchor?.kind === "surface" && thread.anchor.surfaceType === "browser";
}

function getThreadAnchorKey(thread: BrowserCommentThreadShape): string | undefined {
  if (!isBrowserSurfaceAnchor(thread)) return undefined;
  if (thread.anchor?.coordinates?.type === "block") return thread.anchor.coordinates.blockId;
  if (
    thread.anchor?.coordinates?.type === "normalized" &&
    typeof thread.anchor.coordinates.x === "number" &&
    typeof thread.anchor.coordinates.y === "number"
  ) {
    return toViewportAnchorKey(thread.anchor.coordinates.x, thread.anchor.coordinates.y);
  }
  return undefined;
}

function findAnchorBearingComment(thread: BrowserCommentThreadShape): BrowserCommentShape | undefined {
  const comments = Array.isArray(thread.comments) ? thread.comments : [];
  return comments.find((comment) => {
    const metadata = comment.context?.surfaceMetadata;
    return typeof metadata?.anchorKey === "string" || typeof metadata?.snapshotId === "string";
  });
}

export function isMissingThreadError(error: unknown): boolean {
  return error instanceof Error && /thread not found/i.test(error.message);
}

export function readThread(result: unknown): BrowserCommentThreadShape | undefined {
  if (!result || typeof result !== "object") return undefined;
  const thread = (result as { thread?: unknown }).thread;
  return thread && typeof thread === "object" ? (thread as BrowserCommentThreadShape) : undefined;
}

export function readCommentGetFailure(result: unknown): CommentGetFailureShape | undefined {
  if (!result || typeof result !== "object") return undefined;
  const maybeFailure = result as CommentGetFailureShape;
  if (maybeFailure.success === false || typeof maybeFailure.error === "string") {
    return maybeFailure;
  }
  return undefined;
}

export function resolveCommentAnchorMetadata(thread: BrowserCommentThreadShape, commentId?: string): ResolvedCommentAnchorMetadata {
  const comments = Array.isArray(thread.comments) ? thread.comments : [];
  const explicitComment = commentId ? comments.find((comment) => comment.id === commentId) : undefined;
  if (commentId && !explicitComment) {
    return { error: "comment-not-found" };
  }
  const targetComment = explicitComment ?? comments[0];
  const anchorBearingComment = targetComment?.context?.surfaceMetadata?.anchorKey || targetComment?.context?.surfaceMetadata?.snapshotId
    ? targetComment
    : findAnchorBearingComment(thread);
  const surfaceMetadata = {
    ...(anchorBearingComment?.context?.surfaceMetadata ?? {}),
    ...(targetComment?.context?.surfaceMetadata ?? {}),
  };
  const anchorKey = normalizeStoredAnchorKey(surfaceMetadata?.anchorKey) ?? getThreadAnchorKey(thread);

  return {
    commentId: targetComment?.id,
    commentBody: targetComment?.body,
    pageUrl: isBrowserSurfaceAnchor(thread) ? (thread as { anchor?: { uri?: string } }).anchor?.uri : undefined,
    anchorKey,
    frameId: surfaceMetadata?.frameId,
    creationSnapshotId: surfaceMetadata?.snapshotId,
    surfaceMetadata,
  };
}
