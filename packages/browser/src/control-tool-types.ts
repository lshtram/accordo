/**
 * M110-TC — Browser Tab Control Tool Types
 *
 * Type interfaces and timeout constants for the 4 control tools:
 * browser_navigate, browser_click, browser_type, browser_press_key.
 *
 * REQ-TC-001..REQ-TC-017
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import { classifyRelayError } from "./page-tool-types.js";

// ── Timeout Constants ─────────────────────────────────────────────────────────

/** Default timeout for navigate operations (ms). */
export const NAVIGATE_DEFAULT_TIMEOUT_MS = 15_000;

/** Maximum allowed timeout for navigate operations (ms). */
export const NAVIGATE_MAX_TIMEOUT_MS = 30_000;

/**
 * Relay-level timeout for navigate action.
 * Must be larger than NAVIGATE_MAX_TIMEOUT_MS.
 */
export const NAVIGATE_RELAY_TIMEOUT_MS = 35_000;

/** Default/relay timeout for click, type, press_key actions (ms). */
export const CONTROL_ACTION_TIMEOUT_MS = 5_000;

// ── browser_navigate ─────────────────────────────────────────────────────────

/**
 * Input for `browser_navigate`.
 *
 * REQ-TC-001: Creates new tab when no tabId provided, navigates to URL.
 * REQ-TC-002: Navigates existing tab when tabId provided.
 */
export interface NavigateArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Navigation type. Default: "url" */
  type?: "url" | "back" | "forward" | "reload";
  /** Target URL (required when type is "url") */
  url?: string;
  /** Maximum wait time for navigation in ms (default: 15000, max: 30000) */
  timeout?: number;
}

/**
 * Response from `browser_navigate`.
 */
export interface NavigateResponse {
  success: boolean;
  /** Final URL after navigation */
  url?: string;
  /** Page title after navigation */
  title?: string;
  error?: "control-not-granted" | "invalid-url" | "navigation-failed" | "timeout" | "browser-not-connected";
}

// ── browser_click ─────────────────────────────────────────────────────────────

/**
 * Input for `browser_click`.
 *
 * REQ-TC-005: Resolves uid to viewport coordinates via RESOLVE_ELEMENT_COORDS.
 * REQ-TC-006: Dispatches Input.dispatchMouseEvent with correct x/y (center of element).
 * REQ-TC-008: Supports dblClick: true option.
 */
export interface ClickArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Element UID from a page snapshot (primary identifier) */
  uid?: string;
  /** CSS selector to find the element (alternative to uid) */
  selector?: string;
  /** Explicit viewport coordinates to click (alternative to uid/selector) */
  coordinates?: { x: number; y: number };
  /** Whether to double-click. Default: false */
  dblClick?: boolean;
}

/**
 * Response from `browser_click`.
 */
export interface ClickResponse {
  success: boolean;
  /** What was clicked (uid, selector, or coordinates) */
  target?: string;
  error?: "control-not-granted" | "element-not-found" | "element-off-screen" | "no-target" | "browser-not-connected" | "timeout" | "action-failed";
}

// ── browser_type ─────────────────────────────────────────────────────────────

/**
 * Input for `browser_type`.
 *
 * REQ-TC-009: Resolves uid to input area coordinates.
 * REQ-TC-010: Dispatches Input.dispatchKeyEvent for each character.
 * REQ-TC-012: Supports pressEnter, pressTab, pressEscape shortcuts.
 */
export interface TypeArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Text to type into the element */
  text: string;
  /** Element UID to focus before typing (from snapshot) */
  uid?: string;
  /** CSS selector to focus before typing (alternative to uid) */
  selector?: string;
  /** Whether to clear existing content before typing. Default: false */
  clearFirst?: boolean;
  /** Optional key to press after typing (e.g., "Enter", "Tab") */
  submitKey?: string;
}

/**
 * Response from `browser_type`.
 */
export interface TypeResponse {
  success: boolean;
  error?: "control-not-granted" | "element-not-found" | "element-not-focusable" | "no-target" | "browser-not-connected" | "timeout" | "action-failed";
}

// ── browser_press_key ────────────────────────────────────────────────────────

/**
 * Input for `browser_press_key`.
 *
 * REQ-TC-013: Dispatches correct Input.dispatchKeyEvent for the given key.
 * REQ-TC-014: Handles modifier keys (Shift, Control, Alt, Meta) via modifiers bitmask.
 * REQ-TC-015: Uses KeyCodeMap for named keys.
 */
export interface PressKeyArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Key or key combination (e.g., "Enter", "Control+A", "Control+Shift+R") */
  key: string;
}

/**
 * Response from `browser_press_key`.
 */
export interface PressKeyResponse {
  success: boolean;
  /** The key that was pressed (echoed back) */
  key?: string;
  error?: "control-not-granted" | "invalid-key" | "browser-not-connected" | "timeout" | "action-failed";
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

export async function handleNavigate(
  relay: BrowserRelayLike,
  args: NavigateArgs,
): Promise<NavigateResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.type !== undefined) payload["type"] = args.type;
    if (args.url !== undefined) payload["url"] = args.url;
    if (args.timeout !== undefined) payload["timeout"] = args.timeout;

    const response = await relay.request("navigate", payload, NAVIGATE_RELAY_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object") {
      const d = response.data as Record<string, unknown>;
      return {
        success: true,
        url: d.url as string | undefined,
        title: d.title as string | undefined,
      };
    }
    return { success: false, error: (response.error as NavigateResponse["error"]) ?? "navigation-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

export async function handleClick(
  relay: BrowserRelayLike,
  args: ClickArgs,
): Promise<ClickResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.uid !== undefined) payload["uid"] = args.uid;
    if (args.selector !== undefined) payload["selector"] = args.selector;
    if (args.coordinates !== undefined) payload["coordinates"] = args.coordinates;
    if (args.dblClick !== undefined) payload["dblClick"] = args.dblClick;

    const response = await relay.request("click", payload, CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true, target: args.uid ?? args.selector ?? (args.coordinates ? `${args.coordinates.x},${args.coordinates.y}` : undefined) };
    }
    return { success: false, error: (response.error as ClickResponse["error"]) ?? "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

export async function handleType(
  relay: BrowserRelayLike,
  args: TypeArgs,
): Promise<TypeResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = { text: args.text };
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.uid !== undefined) payload["uid"] = args.uid;
    if (args.selector !== undefined) payload["selector"] = args.selector;
    if (args.clearFirst !== undefined) payload["clearFirst"] = args.clearFirst;
    if (args.submitKey !== undefined) payload["submitKey"] = args.submitKey;

    const response = await relay.request("type", payload, CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true };
    }
    return { success: false, error: (response.error as TypeResponse["error"]) ?? "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

export async function handlePressKey(
  relay: BrowserRelayLike,
  args: PressKeyArgs,
): Promise<PressKeyResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = { key: args.key };
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;

    const response = await relay.request("press_key", payload, CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true, key: args.key };
    }
    return { success: false, error: (response.error as PressKeyResponse["error"]) ?? "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

// ── Tool Builders ─────────────────────────────────────────────────────────────

export function buildNavigateTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "browser_navigate",
    description: "Navigate to a URL or perform back/forward/reload in the browser tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
        type: { type: "string", enum: ["url", "back", "forward", "reload"], description: "Navigation type. Default: 'url'" },
        url: { type: "string", description: "Target URL (required when type is 'url')" },
        timeout: { type: "number", description: "Maximum wait time for navigation in ms (default: 15000, max: 30000)" },
      },
    },
    dangerLevel: "moderate",
    idempotent: false,
    handler: (args) => handleNavigate(relay, args as NavigateArgs),
  };
}

export function buildClickTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "browser_click",
    description: "Click an element in the browser page by uid, selector, or coordinates",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
        uid: { type: "string", description: "Element UID from a page snapshot (primary identifier)" },
        selector: { type: "string", description: "CSS selector to find the element (alternative to uid)" },
        coordinates: {
          type: "object",
          description: "Explicit viewport coordinates to click (alternative to uid/selector)",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
        },
        dblClick: { type: "boolean", description: "Whether to double-click. Default: false" },
      },
    },
    dangerLevel: "moderate",
    idempotent: false,
    handler: (args) => handleClick(relay, args as ClickArgs),
  };
}

export function buildTypeTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "browser_type",
    description: "Type text into an element or the page",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
        text: { type: "string", description: "Text to type into the element" },
        uid: { type: "string", description: "Element UID to focus before typing (from snapshot)" },
        selector: { type: "string", description: "CSS selector to focus before typing (alternative to uid)" },
        clearFirst: { type: "boolean", description: "Whether to clear existing content before typing. Default: false" },
        submitKey: { type: "string", description: "Optional key to press after typing (e.g., 'Enter', 'Tab', 'Escape')" },
      },
    },
    dangerLevel: "moderate",
    idempotent: false,
    handler: (args) => handleType(relay, args as unknown as TypeArgs),
  };
}

export function buildPressKeyTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "browser_press_key",
    description: "Press a keyboard key or key combination in the browser",
    inputSchema: {
      type: "object",
      required: ["key"],
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
        key: { type: "string", description: "Key or key combination (e.g., 'Enter', 'Control+A', 'Control+Shift+R')" },
      },
    },
    dangerLevel: "moderate",
    idempotent: false,
    handler: (args) => handlePressKey(relay, args as unknown as PressKeyArgs),
  };
}

/** Convenience: returns all 4 control tools as an array. */
export function buildControlTools(relay: BrowserRelayLike): ExtensionToolDefinition[] {
  return [
    buildNavigateTool(relay),
    buildClickTool(relay),
    buildTypeTool(relay),
    buildPressKeyTool(relay),
  ];
}
