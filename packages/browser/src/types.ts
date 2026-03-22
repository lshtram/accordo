import type { ExtensionToolDefinition } from "@accordo/bridge-types";

export type BrowserRelayAction =
  | "get_all_comments"
  | "get_comments"
  | "create_comment"
  | "reply_comment"
  | "resolve_thread"
  | "reopen_thread"
  | "delete_comment"
  | "delete_thread";

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
  isConnected(): boolean;
}

export interface BrowserBridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): { dispose(): void };
  publishState(extensionId: string, state: Record<string, unknown>): void;
}
