import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";

/** Default timeout for navigate operations (ms). */
export const NAVIGATE_DEFAULT_TIMEOUT_MS = 15_000;

/** Maximum allowed timeout for navigate operations (ms). */
export const NAVIGATE_MAX_TIMEOUT_MS = 30_000;

/** Relay-level timeout for navigate action. */
export const NAVIGATE_RELAY_TIMEOUT_MS = 35_000;

/** Default/relay timeout for click, type, press_key actions (ms). */
export const CONTROL_ACTION_TIMEOUT_MS = 5_000;

export interface NavigateArgs {
  tabId?: number;
  type?: "url" | "back" | "forward" | "reload";
  url?: string;
  timeout?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

export interface NavigateResponse {
  success: boolean;
  url?: string;
  title?: string;
  readyState?: "loading" | "interactive" | "complete";
  error?: "control-not-granted" | "tab-not-found" | "unsupported-page" | "invalid-request" | "invalid-url" | "navigation-failed" | "timeout" | "browser-not-connected" | "action-failed";
  message?: string;
  agentAction?: string;
  userAction?: string;
}

export interface ClickArgs {
  tabId?: number;
  uid?: string;
  selector?: string;
  coordinates?: { x: number; y: number };
  dblClick?: boolean;
}

export interface ClickResponse {
  success: boolean;
  target?: string;
  error?: "control-not-granted" | "tab-not-found" | "element-not-found" | "element-off-screen" | "no-target" | "browser-not-connected" | "timeout" | "action-failed" | "invalid-request" | "iframe-cross-origin" | "no-content-script";
  message?: string;
  agentAction?: string;
  userAction?: string;
}

export interface TypeArgs {
  tabId?: number;
  text: string;
  uid?: string;
  selector?: string;
  clearFirst?: boolean;
  submitKey?: string;
}

export interface TypeResponse {
  success: boolean;
  error?: "control-not-granted" | "tab-not-found" | "element-not-found" | "element-not-focusable" | "no-target" | "browser-not-connected" | "timeout" | "action-failed" | "invalid-request" | "iframe-cross-origin" | "no-content-script";
  message?: string;
  agentAction?: string;
  userAction?: string;
}

export interface PressKeyArgs {
  tabId?: number;
  key: string;
}

export interface PressKeyResponse {
  success: boolean;
  key?: string;
  error?: "control-not-granted" | "tab-not-found" | "invalid-key" | "browser-not-connected" | "timeout" | "action-failed" | "invalid-request";
  message?: string;
  agentAction?: string;
  userAction?: string;
}

export type ControlToolBuilder<TArgs> = (relay: BrowserRelayLike) => ExtensionToolDefinition & {
  handler: (args: TArgs) => Promise<unknown>;
};
