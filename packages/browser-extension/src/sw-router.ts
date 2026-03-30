/**
 * sw-router.ts — chrome.runtime.onMessage dispatcher
 *
 * Thin routing shell: reads message type, routes to handler, returns response.
 * Dependencies (relayBridge, forwardToAccordoBrowser) are injected so this
 * module has no circular references with sw-lifecycle.ts.
 */

import { toggleCommentsMode, getCommentsMode, loadCommentsModeFromStorage } from "./state-machine.js";
import { createThread, addComment, reopenThread, resolveThread, softDeleteComment, softDeleteThread } from "./store.js";
import { captureScreenshot } from "./screenshot.js";
import { handleGetComments, handleGetScreenshot } from "./mcp-handlers.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import { MESSAGE_TYPES } from "./constants.js";
import type { McpToolRequest, GetCommentsArgs, GetScreenshotArgs } from "./types.js";
import type { MessageType } from "./constants.js";
import { getMergedThreads } from "./sw-comment-sync.js";
import type { RelayBridgeClient } from "./relay-bridge.js";

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

export type ForwardFn = (
  action: "create_comment" | "reply_comment" | "resolve_thread" | "reopen_thread" | "delete_comment" | "delete_thread",
  payload: Record<string, unknown>,
) => Promise<void>;

export type BroadcastFn = (url?: string) => Promise<void>;

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
}

/**
 * Create the message handler with injected relay bridge and forward/broadcast functions.
 * This factory pattern avoids circular module dependencies.
 */
export function createHandleMessage(
  relayBridge: RelayBridgeClient,
  forwardToAccordoBrowser: ForwardFn,
  broadcastCommentsUpdated: BroadcastFn,
  handleRelayActionWithBroadcast: (req: RelayActionRequest) => Promise<RelayActionResponse>,
): (message: SwMessage, sender: chrome.runtime.MessageSender) => Promise<SwResponse> {
  return async function handleMessage(
    message: SwMessage,
    sender: chrome.runtime.MessageSender,
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
        const threads = await getMergedThreads(relayBridge, url);
        return { success: true, data: threads };
      }

      case MESSAGE_TYPES.CREATE_THREAD: {
        const url = payload?.url as string;
        const anchorKey = payload?.anchorKey as string;
        const body = payload?.body as string;
        const author = payload?.author as { kind: "user"; name: string };
        const anchorContext = payload?.anchorContext as { tagName: string; textSnippet?: string; ariaLabel?: string; pageTitle?: string } | undefined;
        const thread = await createThread(url, anchorKey, { body, author }, anchorContext);
        void forwardToAccordoBrowser("create_comment", {
          body, url, anchorKey, authorName: author?.name,
          threadId: thread.id, commentId: thread.comments[0]?.id,
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
        } catch {
          return { success: false, error: "action-failed" };
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
        if (!url) return { success: false, error: "thread not found" };
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
          const threads = await getMergedThreads(relayBridge, url);
          const { formatAsMarkdown } = await import("./exporter.js");
          let text: string;
          if (format === "json") {
            const filtered = threads.filter((t) => !t.deletedAt).map((t) => ({
              ...t, comments: t.comments.filter((c) => !c.deletedAt),
            }));
            text = JSON.stringify({ url, exportedAt: new Date().toISOString(), threads: filtered, screenshot: screenshotRecord }, null, 2);
          } else {
            text = formatAsMarkdown({ url, exportedAt: new Date().toISOString(), threads, screenshot: screenshotRecord });
          }
          return { success: true, data: { text } };
        } catch {
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
  };
}

