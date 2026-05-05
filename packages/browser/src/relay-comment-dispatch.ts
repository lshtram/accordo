import type {
  BrowserRelayCommentAction,
  BrowserRelayResponse,
} from "./comment-relay-contract.js";
import { hydrateBrowserCommentThreads } from "./comment-thread-hydration.js";

/**
 * External dependency boundary for comment relay dispatch.
 *
 * Keeps tool invocation transport swappable and testable.
 */
export interface RelayDispatchDeps {
  invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown>;
}

/**
 * Dispatch a browser comment relay action to the unified comment tool layer.
 *
 * In full-state sync mode, deprecated mutation actions (create_comment,
 * reply_comment, delete_comment, delete_thread, update_comment) are rejected
 * with "action-unsupported". The browser extension uses sync_comment_state
 * for all data exchange, and request_comment_state_sync for wakeup.
 *
 * @param deps          - Relay dispatch dependencies (invokeTool)
 * @param action        - The browser relay comment action
 * @param payload       - The action payload
 * @param correlationId  - Optional request ID for the BrowserRelayResponse.requestId field.
 *                          Uses action name when omitted (for backward compatibility).
 */
export async function dispatchBrowserCommentAction(
  deps: RelayDispatchDeps,
  action: BrowserRelayCommentAction,
  payload: unknown,
  correlationId?: string,
): Promise<BrowserRelayResponse> {
  // Deprecated mutation actions — replaced by full-state sync
  const deprecatedMutationActions = [
    "create_comment",
    "reply_comment",
    "delete_comment",
    "delete_thread",
    "update_comment",
  ] as const;

  if (deprecatedMutationActions.includes(action as (typeof deprecatedMutationActions)[number])) {
    return {
      requestId: correlationId ?? crypto.randomUUID(),
      success: false,
      error: "action-unsupported",
    };
  }

  let toolName: string;
  let args: Record<string, unknown>;

  switch (action) {
    case "get_comments":
      try {
        return {
          requestId: correlationId ?? crypto.randomUUID(),
          success: true,
          data: await hydrateBrowserCommentThreads(deps, {
            scope: { modality: "browser", url: (payload as Record<string, unknown>).url as string },
          }),
        };
      } catch {
        return {
          requestId: correlationId ?? crypto.randomUUID(),
          success: false,
          error: "action-failed",
        };
      }
    case "get_all_comments":
      try {
        return {
          requestId: correlationId ?? crypto.randomUUID(),
          success: true,
          data: await hydrateBrowserCommentThreads(deps, {
            scope: { modality: "browser" },
          }),
        };
      } catch {
        return {
          requestId: correlationId ?? crypto.randomUUID(),
          success: false,
          error: "action-failed",
        };
      }
    case "resolve_thread":
      toolName = "comment_resolve";
      args = {
        threadId: (payload as Record<string, unknown>).threadId as string,
        resolutionNote: (payload as Record<string, unknown>).resolutionNote as string | undefined,
      };
      break;
    case "reopen_thread":
      toolName = "comment_reopen";
      args = { threadId: (payload as Record<string, unknown>).threadId as string };
      break;
    default:
      // Any unhandled action is unsupported
      return {
        requestId: correlationId ?? crypto.randomUUID(),
        success: false,
        error: "action-unsupported",
      };
  }

  try {
    const result = await deps.invokeTool(toolName, args, undefined);
    if (
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof (result as Record<string, unknown>).error === "string"
    ) {
      return {
        requestId: correlationId ?? crypto.randomUUID(),
        success: false,
        error: (result as Record<string, unknown>).error as BrowserRelayResponse["error"],
      };
    }
    return {
      requestId: correlationId ?? crypto.randomUUID(),
      success: true,
      data: result,
    };
  } catch {
    return {
      requestId: correlationId ?? crypto.randomUUID(),
      success: false,
      error: "action-failed",
    };
  }
}
