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
import { getActiveThreads, createThread } from "./store.js";
import { captureScreenshot } from "./screenshot.js";
import { handleGetComments, handleGetScreenshot } from "./mcp-handlers.js";
import { MESSAGE_TYPES } from "./constants.js";
import type { McpToolRequest, GetCommentsArgs, GetScreenshotArgs } from "./types.js";
import type { MessageType } from "./constants.js";

export { MESSAGE_TYPES };
export type { MessageType };

// ── Debug logger ─────────────────────────────────────────────────────────────────

function dbg(msg: string, ...args: unknown[]): void {
  console.log(`[Accordo SW] ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]): void {
  console.error(`[Accordo SW ERROR] ${msg}`, ...args);
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
          dbgErr(`TOGGLE_COMMENTS_MODE: tabs.sendMessage failed — ${err?.message ?? err}`);
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
      dbg(`GET_THREADS: returning ${threads.length} threads`);
      return { success: true, data: threads };
    }

    case MESSAGE_TYPES.CREATE_THREAD: {
      const url = payload?.url as string;
      const anchorKey = payload?.anchorKey as string;
      const body = payload?.body as string;
      const author = payload?.author as { kind: "user"; name: string };
      dbg(`CREATE_THREAD: url=${url} anchorKey=${anchorKey}`);
      const thread = await createThread(url, anchorKey, { body, author });
      dbg(`CREATE_THREAD: created thread id=${thread.id}`);
      return { success: true, data: thread };
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
        dbgErr(`onCommand: tabs.sendMessage failed — ${(err as Error)?.message ?? err}`);
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
dbg("Bootstrap: complete");
