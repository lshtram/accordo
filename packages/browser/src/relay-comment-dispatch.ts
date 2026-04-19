import type {
  BrowserRelayCommentAction,
  BrowserRelayResponse,
} from "./comment-relay-contract.js";

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
  let toolName: string;
  let args: Record<string, unknown>;

  switch (action) {
    case "get_comments":
      toolName = "comment_list";
      args = { url: (payload as Record<string, unknown>).url as string };
      break;
    case "get_all_comments":
      toolName = "comment_list";
      args = { allWindows: true };
      break;
    case "create_comment":
      toolName = "comment_create";
      args = payload as Record<string, unknown>;
      break;
    case "reply_comment":
      toolName = "comment_reply";
      args = {
        threadId: (payload as Record<string, unknown>).threadId as string,
        body: (payload as Record<string, unknown>).body as string,
        ...(("authorName" in (payload as Record<string, unknown>))
          ? { authorName: (payload as Record<string, unknown>).authorName as string }
          : {}),
      };
      break;
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
    case "delete_comment":
      toolName = "comment_delete";
      args = {
        threadId: (payload as Record<string, unknown>).threadId as string,
        commentId: (payload as Record<string, unknown>).commentId as string | undefined,
      };
      break;
    case "delete_thread":
      toolName = "comment_delete";
      args = { threadId: (payload as Record<string, unknown>).threadId as string };
      break;
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
