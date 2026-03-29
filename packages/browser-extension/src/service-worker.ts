/**
 * M80-SW — Background Service Worker
 *
 * Manages Comments Mode state and communicates with content scripts.
 *
 * Communication pattern in MV3:
 * - Popup → Service Worker: chrome.runtime.sendMessage (reliable)
 * - Service Worker → Content Script: chrome.tabs.sendMessage (can fail if tab/script not ready)
 * - Content Script → Service Worker: chrome.runtime.sendMessage (reliable)
 *
 * Strategy: Store state in chrome.storage.local. Content script reads state on injection
 * and also listens for messages. Service worker sends messages but doesn't rely on it.
 *
 * Unified Comment Store: chrome.storage.local is the primary store for anchorKey and
 * anchorContext (DOM-specific data that only the browser extension knows). The Hub's
 * CommentStore (accessed via accordo-browser relay) holds authoritative comment body,
 * author, status, and threading data. On GET_THREADS, we merge both sources to give
 * the popup a unified view.
 */

import { toggleCommentsMode, getCommentsMode, loadCommentsModeFromStorage } from "./state-machine.js";
import { getActiveThreads, getAllThreads, createThread, addComment, normalizeUrl, reopenThread, resolveThread, softDeleteComment, softDeleteThread } from "./store.js";
import { captureScreenshot } from "./screenshot.js";
import { handleGetComments, handleGetScreenshot } from "./mcp-handlers.js";
import { handleRelayAction, handleNavigationReset, type RelayActionRequest, type RelayActionResponse } from "./relay-actions.js";
import { RelayBridgeClient } from "./relay-bridge.js";
import { MESSAGE_TYPES } from "./constants.js";
import type { McpToolRequest, GetCommentsArgs, GetScreenshotArgs, BrowserCommentThread, BrowserComment } from "./types.js";
import type { MessageType } from "./constants.js";

export { MESSAGE_TYPES };
export type { MessageType };

// ── Hub CommentThread → BrowserCommentThread adapter ──────────────────────────
// The Hub's CommentStore uses CommentThread (bridge-types). The Chrome extension
// uses BrowserCommentThread (types.ts). This adapter converts Hub threads to
// the browser extension format so they can be displayed in the popup alongside
// chrome.storage.local threads.
//
// Hub coordinates are normalized (0-1). We convert to anchorKey "body:50%x50%"
// format for display consistency with chrome.storage.local threads.

interface HubComment {
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

interface HubCommentThread {
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
function urlsMatch(hubUri: string, chromeUrl: string): boolean {
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

function coordinatesToAnchorKey(
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

function hubThreadToBrowserThread(hubThread: HubCommentThread): BrowserCommentThread {
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

// ── Relay bridge to accordo-browser ───────────────────────────────────────────
// Created early so forwardToAccordoBrowser (below) can reference it.
// Started in the Bootstrap section after registerListeners().
const relayBridge = new RelayBridgeClient(handleRelayActionWithBroadcast);


function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
}

async function broadcastCommentsUpdated(url?: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const normalized = url ? normalizeUrl(url) : undefined;
  await Promise.all(
    tabs
      .filter((tab) => {
        if (!tab.id || !tab.url) return false;
        if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) return false;
        if (!normalized) return true;
        return normalizeUrl(tab.url) === normalized;
      })
      .map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id!, {
            type: MESSAGE_TYPES.COMMENTS_UPDATED,
            payload: { url: normalized },
          });
        } catch (err) {
          if (!isNoReceiverError(err)) {
          }
        }
      }),
  );

  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COMMENTS_UPDATED, payload: { url: normalized } });
  } catch {
    // Popup/content runtime listeners may not exist; safe to ignore.
  }
}

async function handleRelayActionWithBroadcast(req: RelayActionRequest): Promise<RelayActionResponse> {
  const response = await handleRelayAction(req);
  if (
    response.success
    && ["create_comment", "reply_comment", "delete_comment", "delete_thread", "resolve_thread", "reopen_thread", "notify_comments_updated"].includes(req.action)
  ) {
    const pageUrl = (response.data as { pageUrl?: string; url?: string } | undefined)?.pageUrl
      ?? (response.data as { pageUrl?: string; url?: string } | undefined)?.url;
    await broadcastCommentsUpdated(pageUrl);
  }
  return response;
}


export interface SwMessage {
  type: MessageType;
  payload?: unknown;
}

export interface SwResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  requestId?: string;
  isOn?: boolean;
}

// ── Message handler ─────────────────────────────────────────────────────────────

export async function handleMessage(
  message: SwMessage,
  sender: chrome.runtime.MessageSender
): Promise<SwResponse> {
  const payload = message.payload as Record<string, unknown> | undefined;

  switch (message.type) {
    case MESSAGE_TYPES.TOGGLE_COMMENTS_MODE: {
      const tabId = (payload?.tabId as number | undefined) ?? 1;
      await toggleCommentsMode(tabId);
      const isOn = getCommentsMode(tabId);
      if (sender.tab?.id) {
        const msgType = isOn ? "comments-mode-on" : "comments-mode-off";
        chrome.tabs.sendMessage(sender.tab.id, { type: msgType }).catch((err) => {
          if (!isNoReceiverError(err)) {
          }
        });
      } else {
      }
      return { success: true };
    }

    case MESSAGE_TYPES.GET_TAB_COMMENTS_MODE: {
      const tabId = sender.tab?.id ?? 0;
      await loadCommentsModeFromStorage();
      const isOn = getCommentsMode(tabId);
      return { success: true, isOn };
    }

    case MESSAGE_TYPES.SET_BADGE_TEXT: {
      const text = (payload?.text as string | undefined) ?? "";
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        chrome.action.setBadgeText({ text, tabId });
      } else {
        chrome.action.setBadgeText({ text });
      }
      return { success: true };
    }

    case MESSAGE_TYPES.GET_THREADS: {
      const url = (payload?.url as string | undefined) ?? "";

      // 1. Get local threads from chrome.storage.local
      const localThreads = await getActiveThreads(url);
      const localAllThreads = await getAllThreads(url);
      const deletedLocalIds = new Set(localAllThreads.filter((t) => !!t.deletedAt).map((t) => t.id));

      // 2. Get Hub threads via accordo-browser relay
      // (fire-and-forget: if accordo-browser is unreachable, still return local)
      let hubThreads: BrowserCommentThread[] = [];
      try {
        const hubResult = await relayBridge.send("get_comments", { url }, 3000);
        if (hubResult.success && hubResult.data) {
          const raw = hubResult.data as { threads?: HubCommentThread[] };
          if (raw.threads && Array.isArray(raw.threads)) {
            hubThreads = raw.threads
              .filter((t) => urlsMatch(t.anchor.uri, normalizeUrl(url)))
              .map(hubThreadToBrowserThread);
          }
        }
      } catch {
        // Non-fatal: chrome.storage.local is the primary store
      }

      // 3. Merge: local anchoring wins; Hub content/state wins for matching IDs.
      //    Use localAllThreads (including soft-deleted comments) for merge so
      //    comment-level tombstones can suppress hub resurrection (P0-2).
      const localAllMap = new Map<string, BrowserCommentThread>();
      for (const t of localAllThreads) {
        localAllMap.set(t.id, t);
      }
      const mergedMap = new Map<string, BrowserCommentThread>();
      for (const t of localThreads) {
        mergedMap.set(t.id, t);
      }
      for (const t of hubThreads) {
        // Local tombstone wins over Hub thread to prevent deleted thread resurrection.
        if (deletedLocalIds.has(t.id)) {
          continue;
        }
        const localFull = localAllMap.get(t.id);
        if (localFull) {
          mergedMap.set(t.id, mergeLocalAndHubThread(localFull, t));
        } else {
          mergedMap.set(t.id, t);
        }
      }

      const threads = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
      );
      return { success: true, data: threads };
    }

    case MESSAGE_TYPES.CREATE_THREAD: {
      const url = payload?.url as string;
      const anchorKey = payload?.anchorKey as string;
      const body = payload?.body as string;
      const author = payload?.author as { kind: "user"; name: string };
      const anchorContext = payload?.anchorContext as { tagName: string; textSnippet?: string; ariaLabel?: string; pageTitle?: string } | undefined;
      const thread = await createThread(url, anchorKey, { body, author }, anchorContext);
      // Forward to accordo-browser so it persists to VS Code's CommentStore
      // (non-blocking: popup still works even if accordo-browser is unreachable)
      void forwardToAccordoBrowser("create_comment", {
        body,
        url,
        anchorKey,
        authorName: author?.name,
        threadId: thread.id,
        commentId: thread.comments[0]?.id,
      });
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
      } catch (err) {
        return { success: false, error: "add comment failed" };
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
      if (!url) {
        return { success: false, error: "thread not found" };
      }
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

    case MESSAGE_TYPES.EXPORT: {
      const tabId = (payload?.tabId as number | undefined) ?? 1;
      const url = (payload?.url as string | undefined) ?? "";
      const format = (payload?.format as "markdown" | "json" | undefined) ?? "markdown";
      try {
        const screenshotRecord = await captureScreenshot(tabId);
        const localThreads = await getActiveThreads(url);

        // Get Hub threads via accordo-browser relay for unified export
        let hubThreads: BrowserCommentThread[] = [];
        try {
          const hubResult = await relayBridge.send("get_comments", { url }, 3000);
          if (hubResult.success && hubResult.data) {
            const raw = hubResult.data as { threads?: HubCommentThread[] };
            if (raw.threads && Array.isArray(raw.threads)) {
              hubThreads = raw.threads
                .filter((t) => urlsMatch(t.anchor.uri, normalizeUrl(url)))
                .map(hubThreadToBrowserThread);
            }
          }
        } catch {
          // Non-fatal: include local threads only
        }

        // Merge: local anchoring wins; Hub content/state wins for matching IDs.
        const mergedMap = new Map<string, BrowserCommentThread>();
        for (const t of localThreads) mergedMap.set(t.id, t);
        for (const t of hubThreads) {
          const local = mergedMap.get(t.id);
          if (local) {
            mergedMap.set(t.id, mergeLocalAndHubThread(local, t));
          } else {
            mergedMap.set(t.id, t);
          }
        }
        const threads = Array.from(mergedMap.values()).sort(
          (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
        );

        const { formatAsMarkdown } = await import("./exporter.js");
        let text: string;
        if (format === "json") {
          const filtered = threads.filter((t) => !t.deletedAt).map((t) => ({
            ...t,
            comments: t.comments.filter((c) => !c.deletedAt),
          }));
          const exportPayload = { url, exportedAt: new Date().toISOString(), threads: filtered, screenshot: screenshotRecord };
          text = JSON.stringify(exportPayload, null, 2);
        } else {
          text = formatAsMarkdown({ url, exportedAt: new Date().toISOString(), threads, screenshot: screenshotRecord });
        }
        return { success: true, data: { text } };
      } catch (err) {
        return { success: false, error: "export failed" };
      }
    }

    case MESSAGE_TYPES.MCP_GET_COMMENTS:
    case MESSAGE_TYPES["mcp:get_comments"]: {
      const req = message.payload as McpToolRequest<GetCommentsArgs>;
      return await handleGetComments(req);
    }

    case MESSAGE_TYPES.MCP_GET_SCREENSHOT:
    case MESSAGE_TYPES["mcp:get_screenshot"]: {
      const req = message.payload as McpToolRequest<GetScreenshotArgs>;
      return await handleGetScreenshot(req);
    }

    case MESSAGE_TYPES.BROWSER_RELAY_ACTION: {
      const req = message.payload as RelayActionRequest;
      return await handleRelayActionWithBroadcast(req);
    }

    default:
      return { success: false, error: "unknown message type" };
  }
}

// ── Event listeners ─────────────────────────────────────────────────────────────

export function registerListeners(): void {
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      handleMessage(message as SwMessage, sender).then((resp) => {
        sendResponse(resp);
      }).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true; // keep channel open for async response
    }
  );

  chrome.webNavigation.onCommitted.addListener((details) => {
    // B2-SV-005: Reset snapshot version counter on top-level frame navigations.
    // The content script's SnapshotStore is inherently reset because Chrome
    // destroys and re-injects the content script on navigation. The service
    // worker's local counter must also be reset to stay in sync.
    if (details.frameId === 0) {
      handleNavigationReset();
    }
  });

  chrome.commands.onCommand.addListener(async (command: string) => {
    if (command === "toggle-comments-mode") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return;
      }
      const tabId = tab.id;
      await toggleCommentsMode(tabId);
      const isOn = getCommentsMode(tabId);
      chrome.action.setBadgeText({ text: isOn ? "ON" : "", tabId });
      chrome.action.setBadgeBackgroundColor({ color: isOn ? "#4a90d9" : "#888", tabId });
      const msgType = isOn ? "comments-mode-on" : "comments-mode-off";
      try {
        await chrome.tabs.sendMessage(tabId, { type: msgType });
      } catch (err) {
        if (!isNoReceiverError(err)) {
        }
      }
    }
  });
}

export async function onInstalled(
  details: chrome.runtime.InstalledDetails
): Promise<void> {
  await chrome.storage.local.set({
    settings: { commentsMode: false, userName: "Guest" },
  });
}

// ── Periodic full-sync ─────────────────────────────────────────────────────────
/**
 * Poll VS Code's comment store version every 30 seconds.
 * If the version changed since last sync, refresh all tab threads via GET_THREADS.
 * This reconciles drift that can occur when notify_comments_updated is missed
 * (e.g. extension was unloaded or WS was temporarily disconnected).
 */
const SYNC_INTERVAL_MS = 30_000;
const SYNC_STORAGE_KEY = "commentsSyncState";

interface SyncState {
  version: number;
  lastSyncedAt: string;
}

async function getStoredSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const stored = result[SYNC_STORAGE_KEY] as SyncState | undefined;
  return stored ?? { version: -1, lastSyncedAt: new Date(0).toISOString() };
}

async function setStoredSyncState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: state });
}

export async function checkAndSync(): Promise<void> {
  try {
    // P1-3: Rehydrate in-memory mode map from storage before checking tabs.
    // After SW restart, the in-memory map is empty; without this, tabs with
    // Comments Mode ON would be silently skipped.
    await loadCommentsModeFromStorage();

    const result = await relayBridge.send("get_comments_version", {}, 5000);
    if (!result.success || typeof result.data !== "object") return;

    const { version } = result.data as { version: number };
    const prev = await getStoredSyncState();
    if (version !== prev.version) {
      await setStoredSyncState({ version, lastSyncedAt: new Date().toISOString() });
      // Refresh all tabs that have Comments Mode on
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id || !tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) continue;
        const isOn = getCommentsMode(tab.id);
        if (!isOn) continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "COMMENTS_UPDATED", payload: { url: tab.url } });
        } catch {
          // Tab may not have content script injected — non-fatal
        }
      }
    }
  } catch (err) {
  }
}

let _syncIntervalId: ReturnType<typeof setInterval> | null = null;

export function startPeriodicSync(): void {
  if (_syncIntervalId) return;
  // Run an immediate sync on start
  void checkAndSync();
  _syncIntervalId = setInterval(() => { void checkAndSync(); }, SYNC_INTERVAL_MS);
}

export function stopPeriodicSync(): void {
  if (_syncIntervalId) {
    clearInterval(_syncIntervalId);
    _syncIntervalId = null;
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
registerListeners();
chrome.runtime.onInstalled.addListener(onInstalled);
relayBridge.start();
startPeriodicSync();

// ── Forwarder to accordo-browser ────────────────────────────────────────────
/**
 * Forward a mutation action to accordo-browser through the WebSocket relay.
 * accordo-browser will call the unified comment_* tools to persist the action
 * to VS Code's CommentStore, which updates the Comments Panel.
 *
 * This is fire-and-forget for the Chrome popup — the local chrome.storage.local
 * write is the primary store for popup rendering. If accordo-browser is
 * unreachable, the popup still works (offline-first).
 */
async function forwardToAccordoBrowser(
  action: "create_comment" | "reply_comment" | "resolve_thread" | "reopen_thread" | "delete_comment" | "delete_thread",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await relayBridge.send(action, payload, 5000);
    if (!result.success) {
    }
  } catch (err) {
    // Non-fatal — Chrome local storage is primary; accordo-browser is secondary sync.
  }
}
