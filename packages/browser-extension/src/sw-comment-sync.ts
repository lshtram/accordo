/**
 * sw-comment-sync.ts — Comment store sync logic
 *
 * Contains Hub ↔ Browser adapter types and functions:
 * - Hub CommentThread → BrowserCommentThread conversion
 * - URL-aware comparison for Hub vs Chrome URLs
 * - mergeLocalAndHubThread: merges chrome.storage.local anchor data with
 *   Hub content/state to produce a unified BrowserCommentThread for the popup
 * - getMergedThreads: fetches and merges local + hub threads for a URL
 */

import type { BrowserCommentThread, BrowserComment } from "./types.js";
import { getActiveThreads, getAllThreads, normalizeUrl } from "./store.js";
import type { RelayBridgeClient } from "./relay-bridge.js";

// ── Hub CommentThread → BrowserCommentThread adapter ──────────────────────────

export interface HubComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user" | "agent"; name: string; agentId?: string };
  body: string;
  intent?: string;
  status: "open" | "resolved";
  resolutionNote?: string;
  context?: {
    surfaceMetadata?: Record<string, string>;
  };
}

export interface HubCommentThread {
  id: string;
  anchor: {
    kind: "text" | "surface" | "file" | "browser";
    uri: string;
    range?: { startLine: number; startChar: number; endLine: number; endChar: number };
    surfaceType?: string;
    coordinates?:
      | { type: "normalized"; x: number; y: number }
      | { type: "block"; blockId?: string; blockType?: string };
  };
  status: "open" | "resolved";
  commentCount: number;
  lastActivity: string;
  lastAuthor: string;
  firstComment: HubComment;
  comments: HubComment[];
  retention?: string;
  createdAt: string;
}

/**
 * URL-aware comparison that normalizes both sides before comparing.
 * Handles the case where the Hub may store URLs in a slightly different form
 * than Chrome's normalizeUrl() produces (e.g. trailing slashes, protocol).
 * Falls back to strict string comparison for non-HTTP URIs (file:// etc.).
 */
export function urlsMatch(hubUri: string, chromeUrl: string): boolean {
  try {
    const normalize = (u: string): string => {
      const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
      return `${parsed.origin}${parsed.pathname}`;
    };
    return normalize(hubUri) === normalize(chromeUrl);
  } catch {
    // Fall back to string comparison for non-URLs (file URIs, etc.)
    return hubUri === chromeUrl;
  }
}

export function coordinatesToAnchorKey(
  coords:
    | { type: "normalized"; x: number; y: number }
    | { type: "block"; blockId?: string; blockType?: string }
    | undefined,
): string {
  if (!coords) return "body:center";
  if (coords.type === "block") {
    return coords.blockId && coords.blockId.trim().length > 0
      ? coords.blockId
      : "body:center";
  }
  const xPct = Math.round(coords.x * 100);
  const yPct = Math.round(coords.y * 100);
  return `body:${xPct}%x${yPct}%`;
}

export function hubThreadToBrowserThread(hubThread: HubCommentThread): BrowserCommentThread {
  const pageUrl = hubThread.anchor.uri;
  const anchorKeyFromContext = hubThread.comments.find(
    (c) => typeof c.context?.surfaceMetadata?.anchorKey === "string" && c.context.surfaceMetadata.anchorKey.length > 0,
  )?.context?.surfaceMetadata?.anchorKey;
  const anchorKey = anchorKeyFromContext
    ?? (hubThread.anchor.coordinates
      ? coordinatesToAnchorKey(hubThread.anchor.coordinates)
      : "body:center");

  const browserComments: BrowserComment[] = hubThread.comments.map((c) => ({
    id: c.id,
    threadId: c.threadId,
    createdAt: c.createdAt,
    author: c.author.kind === "agent"
      ? { kind: "user" as const, name: c.author.name } // agents appear as "user" in browser popup
      : { kind: "user" as const, name: c.author.name },
    body: c.body,
    anchorKey,
    pageUrl,
    status: c.status,
    resolutionNote: c.resolutionNote,
  }));

  return {
    id: hubThread.id,
    anchorKey,
    pageUrl,
    status: hubThread.status,
    comments: browserComments,
    createdAt: hubThread.createdAt,
    lastActivity: hubThread.lastActivity,
  };
}

/**
 * Fetch Hub threads via relay bridge and convert them to BrowserCommentThread[].
 * Returns an empty array if the relay is unreachable.
 */
export async function fetchHubThreads(
  relayBridge: RelayBridgeClient,
  url: string,
): Promise<BrowserCommentThread[]> {
  try {
    const hubResult = await relayBridge.send("get_comments", { url }, 3000);
    if (!hubResult.success || !hubResult.data) return [];
    const raw = hubResult.data as { threads?: HubCommentThread[] };
    if (!raw.threads || !Array.isArray(raw.threads)) return [];
    return raw.threads
      .filter((t) => urlsMatch(t.anchor.uri, normalizeUrl(url)))
      .map(hubThreadToBrowserThread);
  } catch {
    // Non-fatal: chrome.storage.local is the primary store
    return [];
  }
}

/**
 * Get local + hub threads merged for a given URL.
 * Local tombstones suppress hub threads/comments.
 */
export async function getMergedThreads(
  relayBridge: RelayBridgeClient,
  url: string,
): Promise<BrowserCommentThread[]> {
  const localThreads = await getActiveThreads(url);
  const localAllThreads = await getAllThreads(url);
  const deletedLocalIds = new Set(localAllThreads.filter((t) => !!t.deletedAt).map((t) => t.id));
  const hubThreads = await fetchHubThreads(relayBridge, url);

  const localAllMap = new Map<string, BrowserCommentThread>();
  for (const t of localAllThreads) localAllMap.set(t.id, t);

  const mergedMap = new Map<string, BrowserCommentThread>();
  for (const t of localThreads) mergedMap.set(t.id, t);
  for (const t of hubThreads) {
    if (deletedLocalIds.has(t.id)) continue;
    const localFull = localAllMap.get(t.id);
    if (localFull) {
      mergedMap.set(t.id, mergeLocalAndHubThread(localFull, t));
    } else {
      mergedMap.set(t.id, t);
    }
  }

  return Array.from(mergedMap.values()).sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
  );
}

/**
 * Merge a local chrome.storage.local thread with its Hub counterpart.
 *
 * Contract:
 * - Anchoring fields (anchorKey, anchorContext, pageUrl) come from local:
 *   the browser extension holds the authoritative DOM anchor.
 * - Content/state fields (status, comments, lastActivity, createdAt) come
 *   from the Hub: the Hub is authoritative for agent replies, deletions, and
 *   status transitions.
 * - Soft-delete markers prefer local so offline deletes are not lost.
 * - Each hub comment's anchorKey and pageUrl are rewritten to the local
 *   values so the UI renders them consistently.
 *
 * Caller contract: local.id === hub.id.
 */
export function mergeLocalAndHubThread(
  local: BrowserCommentThread,
  hub: BrowserCommentThread,
): BrowserCommentThread {
  const anchorKey = local.anchorKey;
  const pageUrl = local.pageUrl;

  // Build set of locally soft-deleted comment IDs to suppress hub resurrection (P0-2)
  const localDeletedCommentIds = new Set(
    local.comments
      .filter((c) => !!c.deletedAt)
      .map((c) => c.id),
  );

  const mergedComments: BrowserComment[] = hub.comments
    .filter((c) => !localDeletedCommentIds.has(c.id))
    .map((c) => ({
      ...c,
      anchorKey,
      pageUrl,
    }));

  return {
    id: local.id,
    anchorKey,
    anchorContext: local.anchorContext,
    pageUrl,
    status: hub.status,
    comments: mergedComments,
    createdAt: hub.createdAt,
    lastActivity: hub.lastActivity,
    deletedAt: local.deletedAt ?? hub.deletedAt,
    deletedBy: local.deletedBy ?? hub.deletedBy,
  };
}
