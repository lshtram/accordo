import type { ExtensionToolDefinition } from "@accordo/bridge-types";

export type BrowserRelayAction =
  | "get_all_comments"
  | "get_comments"
  | "get_comments_version"
  | "create_comment"
  | "reply_comment"
  | "resolve_thread"
  | "reopen_thread"
  | "delete_comment"
  | "delete_thread"
  | "notify_comments_updated"
  | "get_page_map"
  | "inspect_element"
  | "get_dom_excerpt"
  | "capture_region";

export interface BrowserRelayRequest {
  requestId: string;
  action: BrowserRelayAction;
  payload: Record<string, unknown>;
}

export interface BrowserRelayResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: "browser-not-connected" | "unauthorized" | "timeout" | "action-failed" | "invalid-request";
}

export interface BrowserRelayLike {
  request(action: BrowserRelayAction, payload: Record<string, unknown>, timeoutMs?: number): Promise<BrowserRelayResponse>;
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void;
  isConnected(): boolean;
  /**
   * Optional interceptor: if set, the relay calls this instead of forwarding
   * to Chrome. The extension uses this to route browser events through the
   * unified comment_* tools.
   *
   * Return a BrowserRelayResponse to short-circuit the Chrome round-trip.
   */
  onRelayRequest?: (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse>;
}

export interface BrowserBridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): { dispose(): void };
  publishState(extensionId: string, state: Record<string, unknown>): void;
  /**
   * Invoke a registered tool directly, routing Chrome relay events through
   * unified comment_* tools.
   */
  invokeTool(toolName: string, args: Record<string, unknown>, timeout?: number): Promise<unknown>;
}
