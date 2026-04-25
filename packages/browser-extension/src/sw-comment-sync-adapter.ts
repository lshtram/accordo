import type { RelayBridgeClient } from "./relay-bridge.js";
import { normalizeIncomingAnchorKey } from "./content/anchor-resolution-metadata.js";
import { getActiveThreads, getAllThreads, normalizeUrl } from "./store.js";
import type { BrowserComment, BrowserCommentThread } from "./types.js";
import { hasRelevantSurfaceMetadata, mergeAnchorContexts, surfaceMetadataToAnchorContext } from "./sw-comment-sync-anchor-context.js";
import type { HubCommentThread } from "./sw-comment-sync-types.js";

export function urlsMatch(hubUri: string, chromeUrl: string): boolean {
  try {
    const normalize = (u: string): string => {
      const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
      return `${parsed.origin}${parsed.pathname}`;
    };
    return normalize(hubUri) === normalize(chromeUrl);
  } catch {
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
    return coords.blockId && coords.blockId.trim().length > 0 ? coords.blockId : "body:center";
  }
  const xPct = Math.round(coords.x * 100);
  const yPct = Math.round(coords.y * 100);
  return `body:${xPct}%x${yPct}%`;
}

export function hubThreadToBrowserThread(hubThread: HubCommentThread): BrowserCommentThread {
  const pageUrl = hubThread.anchor.uri;
  const anchorMetadata = hubThread.comments.find(
    (c) => hasRelevantSurfaceMetadata(c.context?.surfaceMetadata),
  )?.context?.surfaceMetadata;
  const anchorKeyFromContext = anchorMetadata?.anchorKey ? normalizeIncomingAnchorKey(anchorMetadata.anchorKey) : undefined;
  const anchorKey = anchorKeyFromContext ?? (hubThread.anchor.coordinates ? coordinatesToAnchorKey(hubThread.anchor.coordinates) : "body:center");

  const browserComments: BrowserComment[] = hubThread.comments.map((c) => ({
    id: c.id,
    threadId: c.threadId,
    createdAt: c.createdAt,
    author: { kind: "user" as const, name: c.author.name },
    body: c.body,
    anchorKey,
    pageUrl,
    status: c.status,
    resolutionNote: c.resolutionNote,
  }));

  return {
    id: hubThread.id,
    anchorKey,
    ...(surfaceMetadataToAnchorContext(anchorMetadata)
      ? { anchorContext: surfaceMetadataToAnchorContext(anchorMetadata) }
      : {}),
    pageUrl,
    status: hubThread.status,
    comments: browserComments,
    createdAt: hubThread.createdAt,
    lastActivity: hubThread.lastActivity,
  };
}

export async function fetchHubThreads(
  relayBridge: RelayBridgeClient,
  url: string,
): Promise<BrowserCommentThread[]> {
  try {
    const hubResult = await relayBridge.send("get_comments", { url }, 3000);
    if (!hubResult.success || !hubResult.data) return [];
    const raw = hubResult.data as { threads?: HubCommentThread[] };
    if (!raw.threads || !Array.isArray(raw.threads)) return [];
    return raw.threads.filter((t) => urlsMatch(t.anchor.uri, normalizeUrl(url))).map(hubThreadToBrowserThread);
  } catch {
    return [];
  }
}

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

  return Array.from(mergedMap.values()).sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
}

export function mergeLocalAndHubThread(
  local: BrowserCommentThread,
  hub: BrowserCommentThread,
): BrowserCommentThread {
  const anchorKey = local.anchorKey;
  const pageUrl = local.pageUrl;
  const localDeletedCommentIds = new Set(local.comments.filter((c) => !!c.deletedAt).map((c) => c.id));
  const mergedComments: BrowserComment[] = hub.comments
    .filter((c) => !localDeletedCommentIds.has(c.id))
    .map((c) => ({ ...c, anchorKey, pageUrl }));

  return {
    id: local.id,
    anchorKey,
    anchorContext: mergeAnchorContexts(local.anchorContext, hub.anchorContext),
    pageUrl,
    status: hub.status,
    comments: mergedComments,
    createdAt: hub.createdAt,
    lastActivity: hub.lastActivity,
    deletedAt: local.deletedAt ?? hub.deletedAt,
    deletedBy: local.deletedBy ?? hub.deletedBy,
  };
}
