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
 */

import { toggleCommentsMode, getCommentsMode, loadCommentsModeFromStorage } from "./state-machine.js";
import { getActiveThreads, createThread, addComment, normalizeUrl, reopenThread, resolveThread, softDeleteComment, softDeleteThread } from "./store.js";
import { captureScreenshot } from "./screenshot.js";
import { handleGetComments, handleGetScreenshot } from "./mcp-handlers.js";
import { handleRelayAction, type RelayActionRequest } from "./relay-actions.js";
import { RelayBridgeClient } from "./relay-bridge.js";
import { MESSAGE_TYPES } from "./constants.js";
import type { McpToolRequest, GetCommentsArgs, GetScreenshotArgs } from "./types.js";
import type { MessageType } from "./constants.js";

export { MESSAGE_TYPES };
export type { MessageType };

// ── Relay bridge to accordo-browser ───────────────────────────────────────────
// Created early so forwardToAccordoBrowser (below) can reference it.
// Started in the Bootstrap section after registerListeners().
const relayBridge = new RelayBridgeClient(handleRelayActionWithBroadcast);

// ── Debug logger ─────────────────────────────────────────────────────────────────

function dbg(msg: string, ...args: unknown[]): void {
  console.log(`[Accordo SW] ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]): void {
  console.error(`[Accordo SW ERROR] ${msg}`, ...args);
}

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
            dbgErr(`broadcastCommentsUpdated: tab ${tab.id} send failed — ${(err as Error)?.message ?? err}`);
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

async function handleRelayActionWithBroadcast(req: RelayActionRequest): Promise<SwResponse> {
  const response = await handleRelayAction(req);
  if (
    response.success
    && ["create_comment", "reply_comment", "delete_comment", "delete_thread", "resolve_thread", "reopen_thread"].includes(req.action)
  ) {
    const pageUrl = (response.data as { pageUrl?: string } | undefined)?.pageUrl;
    await broadcastCommentsUpdated(pageUrl);
  }
  return response;
}

dbg("Service worker module loaded");

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
  dbg(`handleMessage: type=${message.type} tabId=${sender.tab?.id ?? "no-tab"} url=${sender.tab?.url ?? "no-url"}`);

  switch (message.type) {
    case MESSAGE_TYPES.TOGGLE_COMMENTS_MODE: {
      const tabId = (payload?.tabId as number | undefined) ?? 1;
      dbg(`TOGGLE_COMMENTS_MODE: tabId=${tabId}`);
      await toggleCommentsMode(tabId);
      const isOn = getCommentsMode(tabId);
      dbg(`TOGGLE_COMMENTS_MODE: new state isOn=${isOn}`);
      if (sender.tab?.id) {
        const msgType = isOn ? "comments-mode-on" : "comments-mode-off";
        dbg(`TOGGLE_COMMENTS_MODE: sending "${msgType}" to tab ${sender.tab.id}`);
        chrome.tabs.sendMessage(sender.tab.id, { type: msgType }).catch((err) => {
          if (!isNoReceiverError(err)) {
            dbgErr(`TOGGLE_COMMENTS_MODE: tabs.sendMessage failed — ${err?.message ?? err}`);
          }
        });
      } else {
        dbg(`TOGGLE_COMMENTS_MODE: sender has no tab id, skipping tabs.sendMessage`);
      }
      return { success: true };
    }

    case MESSAGE_TYPES.GET_TAB_COMMENTS_MODE: {
      const tabId = sender.tab?.id ?? 0;
      dbg(`GET_TAB_COMMENTS_MODE: tabId=${tabId}`);
      await loadCommentsModeFromStorage();
      const isOn = getCommentsMode(tabId);
      dbg(`GET_TAB_COMMENTS_MODE: isOn=${isOn} (storage loaded fresh)`);
      return { success: true, isOn };
    }

    case MESSAGE_TYPES.SET_BADGE_TEXT: {
      const text = (payload?.text as string | undefined) ?? "";
      const tabId = sender.tab?.id;
      dbg(`SET_BADGE_TEXT: text="${text}" tabId=${tabId}`);
      if (tabId !== undefined) {
        chrome.action.setBadgeText({ text, tabId });
      } else {
        chrome.action.setBadgeText({ text });
      }
      return { success: true };
    }

    case MESSAGE_TYPES.GET_THREADS: {
      const url = (payload?.url as string | undefined) ?? "";
      dbg(`GET_THREADS: url=${url}`);
      const threads = await getActiveThreads(url);
      dbg(`GET_THREADS: url=${url} → returning ${threads.length} threads`);
      return { success: true, data: threads };
    }

    case MESSAGE_TYPES.CREATE_THREAD: {
      const url = payload?.url as string;
      const anchorKey = payload?.anchorKey as string;
      const body = payload?.body as string;
      const author = payload?.author as { kind: "user"; name: string };
      const anchorContext = payload?.anchorContext as { tagName: string; textSnippet?: string; ariaLabel?: string; pageTitle?: string } | undefined;
      dbg(`CREATE_THREAD: url=${url} anchorKey=${anchorKey}`);
      const thread = await createThread(url, anchorKey, { body, author }, anchorContext);
      dbg(`CREATE_THREAD: created thread id=${thread.id} — forwarding to accordo-browser`);
      // Forward to accordo-browser so it persists to VS Code's CommentStore
      // (non-blocking: popup still works even if accordo-browser is unreachable)
      void forwardToAccordoBrowser("create_comment", { body, url, anchorKey, authorName: author?.name });
      await broadcastCommentsUpdated(thread.pageUrl);
      return { success: true, data: thread };
    }

    case MESSAGE_TYPES.ADD_COMMENT: {
      const threadId = payload?.threadId as string;
      const body = payload?.body as string;
      const author = payload?.author as { kind: "user"; name: string };
      dbg(`ADD_COMMENT: threadId=${threadId}`);
      try {
        const comment = await addComment(threadId, { body, author });
        dbg(`ADD_COMMENT: created comment id=${comment.id}`);
        void forwardToAccordoBrowser("reply_comment", { threadId, body, authorName: author?.name });
        await broadcastCommentsUpdated(comment.pageUrl);
        return { success: true, data: comment };
      } catch (err) {
        dbgErr(`ADD_COMMENT: failed — ${(err as Error)?.message ?? err}`);
        return { success: false, error: "add comment failed" };
      }
    }

    case MESSAGE_TYPES.SOFT_DELETE_COMMENT: {
      const threadId = payload?.threadId as string;
      const commentId = payload?.commentId as string;
      dbg(`SOFT_DELETE_COMMENT: threadId=${threadId} commentId=${commentId}`);
      const url = await softDeleteComment(threadId, commentId);
      void forwardToAccordoBrowser("delete_comment", { threadId, commentId });
      await broadcastCommentsUpdated(url ?? undefined);
      return { success: true };
    }

    case MESSAGE_TYPES.SOFT_DELETE_THREAD: {
      const threadId = payload?.threadId as string;
      dbg(`SOFT_DELETE_THREAD: threadId=${threadId}`);
      const url = await softDeleteThread(threadId);
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
      dbg(`EXPORT: tabId=${tabId} url=${url} format=${format}`);
      try {
        const screenshotRecord = await captureScreenshot(tabId);
        const threads = await getActiveThreads(url);
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
        dbg(`EXPORT: success, text length=${text.length}`);
        return { success: true, data: { text } };
      } catch (err) {
        dbgErr(`EXPORT: failed — ${err}`);
        return { success: false, error: "export failed" };
      }
    }

    case MESSAGE_TYPES.MCP_GET_COMMENTS:
    case MESSAGE_TYPES["mcp:get_comments"]: {
      const req = message.payload as McpToolRequest<GetCommentsArgs>;
      dbg(`MCP_GET_COMMENTS: requestId=${req?.requestId}`);
      return await handleGetComments(req);
    }

    case MESSAGE_TYPES.MCP_GET_SCREENSHOT:
    case MESSAGE_TYPES["mcp:get_screenshot"]: {
      const req = message.payload as McpToolRequest<GetScreenshotArgs>;
      dbg(`MCP_GET_SCREENSHOT: requestId=${req?.requestId}`);
      return await handleGetScreenshot(req);
    }

    case MESSAGE_TYPES.BROWSER_RELAY_ACTION: {
      const req = message.payload as RelayActionRequest;
      dbg(`BROWSER_RELAY_ACTION: action=${req?.action} requestId=${req?.requestId}`);
      return await handleRelayActionWithBroadcast(req);
    }

    default:
      dbgErr(`handleMessage: unrecognised type="${message.type}"`);
      return { success: false, error: "unknown message type" };
  }
}

// ── Event listeners ─────────────────────────────────────────────────────────────

export function registerListeners(): void {
  dbg("registerListeners: attaching chrome.runtime.onMessage");
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      dbg(`onMessage fired: type=${(message as SwMessage)?.type}`);
      handleMessage(message as SwMessage, sender).then((resp) => {
        dbg(`onMessage response for type=${(message as SwMessage)?.type}:`, resp);
        sendResponse(resp);
      }).catch((err) => {
        dbgErr(`onMessage handler threw: ${err}`);
        sendResponse({ success: false, error: String(err) });
      });
      return true; // keep channel open for async response
    }
  );

  dbg("registerListeners: attaching chrome.commands.onCommand");
  chrome.commands.onCommand.addListener(async (command) => {
    dbg(`onCommand: "${command}"`);
    if (command === "toggle-comments-mode") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      dbg(`onCommand: active tab id=${tab?.id} url=${tab?.url}`);
      if (!tab?.id) {
        dbgErr("onCommand: no active tab found — aborting");
        return;
      }
      const tabId = tab.id;
      await toggleCommentsMode(tabId);
      const isOn = getCommentsMode(tabId);
      dbg(`onCommand: toggled tabId=${tabId} isOn=${isOn}`);
      chrome.action.setBadgeText({ text: isOn ? "ON" : "", tabId });
      chrome.action.setBadgeBackgroundColor({ color: isOn ? "#4a90d9" : "#888", tabId });
      const msgType = isOn ? "comments-mode-on" : "comments-mode-off";
      dbg(`onCommand: sending "${msgType}" to tab ${tabId}`);
      try {
        await chrome.tabs.sendMessage(tabId, { type: msgType });
        dbg(`onCommand: tabs.sendMessage succeeded`);
      } catch (err) {
        if (!isNoReceiverError(err)) {
          dbgErr(`onCommand: tabs.sendMessage failed — ${(err as Error)?.message ?? err}`);
        }
      }
    }
  });
}

export async function onInstalled(
  details: chrome.runtime.InstalledDetails
): Promise<void> {
  dbg(`onInstalled: reason=${details.reason}`);
  await chrome.storage.local.set({
    settings: { commentsMode: false, userName: "Guest" },
  });
  dbg("onInstalled: storage initialised");
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
dbg("Bootstrap: calling registerListeners()");
registerListeners();
dbg("Bootstrap: attaching onInstalled listener");
chrome.runtime.onInstalled.addListener(onInstalled);
relayBridge.start();
dbg("Bootstrap: complete");

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
      dbgErr(`forwardToAccordoBrowser(${action}): accordo-browser error=${result.error}`);
    }
  } catch (err) {
    // Non-fatal — Chrome local storage is primary; accordo-browser is secondary sync.
    dbgErr(`forwardToAccordoBrowser(${action}): ${err}`);
  }
}
