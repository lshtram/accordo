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
 *     → dispatchBrowserCommentAction(deps, action, payload, correlationId)
 *     → bridge.invokeTool(toolName, args)
 *     → on success: push notify_comments_updated to browser extension (mutation push)
 *     → relay.onRelayRequest returns BrowserRelayResponse → SharedRelayClient sends it back
 */

import * as vscode from "vscode";
import { browserActionToUnifiedTool } from "./comment-notifier.js";
import type { BrowserRelayLike } from "./types.js";
import type { BrowserRelayAction, BrowserRelayResponse } from "./types.js";
import { dispatchBrowserCommentAction } from "./relay-comment-dispatch.js";
import type { RelayDispatchDeps } from "./relay-comment-dispatch.js";
import { normalizeReadResult } from "./comment-relay-contract.js";
import type { BrowserRelayCommentAction } from "./comment-relay-contract.js";

const MUTATING = ["create_comment", "reply_comment", "resolve_thread", "reopen_thread", "delete_comment", "delete_thread"] as const;
const READ_ACTIONS = ["get_comments", "get_all_comments"] as const;

// ── Handler ────────────────────────────────────────────────────────────────────

/**
 * Handle an inbound comment CRUD action from the browser extension.
 *
 * @param action   - The relay action name (e.g. "create_comment", "reply_comment")
 * @param payload  - The action payload
 * @param relay    - The relay (SharedRelayClient or BrowserRelayServer) for mutation push
 * @param correlationId - Optional correlation ID for response routing
 */
export function handleBrowserCommentAction(
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
  relay: BrowserRelayLike,
  correlationId?: string,
): Promise<BrowserRelayResponse> {
  // Handle get_comments_version and focus_thread via the existing mapping
  // (dispatchBrowserCommentAction only handles the 8 CRUD actions)
  if (action === "get_comments_version" || action === "focus_thread") {
    const mapped = browserActionToUnifiedTool(action, payload);
    if (!mapped) {
      return Promise.resolve({
        requestId: correlationId ?? action,
        success: false,
        error: "action-failed" as const,
      });
    }
    return Promise.resolve(
      vscode.commands.executeCommand(mapped.toolName, ...Object.values(mapped.args)),
    ).then(
      (result) => ({ requestId: correlationId ?? action, success: true, data: result }),
      () => ({ requestId: correlationId ?? action, success: false, error: "action-failed" as const }),
    );
  }

  const deps: RelayDispatchDeps = {
    invokeTool: (toolName, args) =>
      vscode.commands.executeCommand(toolName, ...Object.values(args)) as Promise<unknown>,
  };

  return dispatchBrowserCommentAction(
    deps,
    action as BrowserRelayCommentAction,
    payload,
    correlationId,
  ).then((result) => {
    // For read operations, normalize the result to the canonical { threads } envelope
    if ((action === "get_comments" || action === "get_all_comments") && result.success && result.data) {
      return { ...result, data: normalizeReadResult(result.data) };
    }

    // For mutations: push notify_comments_updated to the browser extension so it
    // refreshes its local store. This is the bidirectional sync path — without this,
    // the browser extension never learns about agent mutations routed via the Hub.
    if (result.success && (MUTATING as readonly string[]).includes(action)) {
      const url = payload["url"] as string | undefined;
      try {
        relay.push("notify_comments_updated", url ? { url } : {});
      } catch {
        // push is best-effort
      }
    }

    return result;
  });
}

/**
 * Adapter to wire handleBrowserCommentAction as a SharedRelayClient.onRelayRequest handler.
 * SharedRelayClient.onRelayRequest expects (action, payload) => Promise<BrowserRelayResponse>,
 * so we curry the relay instance and correlationId.
 */
export function createBrowserCommentRelayHandler(
  relay: BrowserRelayLike,
  correlationId?: string,
): (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse> {
  return (action, payload) => handleBrowserCommentAction(action, payload, relay, correlationId);
}
