/**
 * browser-comment-relay-handler.ts
 *
 * Handles inbound comment CRUD actions from the browser extension.
 * Called when the relay server receives a comment action from Chrome.
 *
 * Flow:
 *   BrowserExtension/VscodeRelayAdapter.send(action, payload)
 *     → relay WebSocket → accordo-browser relay server
 *     → handleBrowserCommentAction(action, payload, relay)
 *     → browserActionToUnifiedTool(action, payload) → { toolName, args }
 *     → vscode.commands.executeCommand(toolName, args)
 *     → relay.onRelayRequest returns BrowserRelayResponse → SharedRelayClient sends it back
 */

import * as vscode from "vscode";
import { browserActionToUnifiedTool } from "./comment-notifier.js";
import type { SharedRelayClient } from "./shared-relay-client.js";
import type { BrowserRelayAction, BrowserRelayResponse } from "./types.js";

// ── Handler ────────────────────────────────────────────────────────────────────

/**
 * Handle an inbound comment CRUD action from the browser extension.
 *
 * @param action   - The relay action name (e.g. "create_comment", "reply_comment")
 * @param payload  - The action payload
 * @param relay    - The relay client (SharedRelayClient)
 * @param correlationId - Optional correlation ID for response routing
 */
export function handleBrowserCommentAction(
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
  relay: SharedRelayClient,
  correlationId?: string,
): Promise<BrowserRelayResponse> {
  const mapping = browserActionToUnifiedTool(action, payload);
  if (!mapping) {
    return Promise.resolve({
      requestId: correlationId ?? action,
      success: false,
      error: "action-failed" as const,
    });
  }

  const { toolName, args } = mapping;

  return Promise.resolve(vscode.commands.executeCommand(toolName, ...Object.values(args))).then(
    (result) => ({
      requestId: correlationId ?? action,
      success: true,
      data: result,
    }),
    () => ({
      requestId: correlationId ?? action,
      success: false,
      error: "action-failed" as const,
    }),
  );
}

/**
 * Adapter to wire handleBrowserCommentAction as a SharedRelayClient.onRelayRequest handler.
 * SharedRelayClient.onRelayRequest expects (action, payload) => Promise<BrowserRelayResponse>,
 * so we curry the relay instance and correlationId.
 */
export function createBrowserCommentRelayHandler(
  relay: SharedRelayClient,
  correlationId?: string,
): (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse> {
  return (action, payload) => handleBrowserCommentAction(action, payload, relay, correlationId);
}
