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
 */
export async function dispatchBrowserCommentAction(
  deps: RelayDispatchDeps,
  action: BrowserRelayCommentAction,
  payload: unknown,
): Promise<BrowserRelayResponse> {
  void deps;
  void action;
  void payload;
  throw new Error("not implemented");
}
