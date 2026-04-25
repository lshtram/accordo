/**
 * sw-router.ts — chrome.runtime.onMessage dispatcher
 *
 * Thin routing shell: reads message type, routes to handler, returns response.
 * Dependencies (relayBridge, forwardToAccordoBrowser) are injected so this
 * module has no circular references with sw-lifecycle.ts.
 */

import { toggleCommentsMode, getCommentsMode, loadCommentsModeFromStorage } from "./state-machine.js";
import { handleGetComments, handleGetScreenshot } from "./mcp-handlers.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import { MESSAGE_TYPES } from "./constants.js";
import type { McpToolRequest, GetCommentsArgs, GetScreenshotArgs } from "./types.js";
import type { MessageType } from "./constants.js";
import type { RelayBridgeClient } from "./relay-bridge.js";
import { handleCommentMessage } from "./sw-router-comment-cases.js";
import { handleExportAndFocusMessage } from "./sw-router-focus-export-cases.js";
import { handleUiMessage } from "./sw-router-ui-cases.js";

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

function actionFailed(): SwResponse {
  return { success: false, error: "action-failed" };
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

    const uiResponse = await handleUiMessage(message, sender);
    if (uiResponse) return uiResponse;

    const commentResponse = await handleCommentMessage(relayBridge, forwardToAccordoBrowser, broadcastCommentsUpdated, message);
    if (commentResponse) return commentResponse;

    const focusResponse = await handleExportAndFocusMessage(relayBridge, message);
    if (focusResponse) return focusResponse;

    switch (message.type) {
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

      case MESSAGE_TYPES.RELAY_RECONNECT: {
        // Triggered by the popup immediately after storing a new pairing token.
        // Calling start() here avoids waiting for the next token-poll cycle (up to 60s).
        relayBridge.start();
        return { success: true };
      }

      default:
        return { success: false, error: "unknown message type" };
    }
  };
}
