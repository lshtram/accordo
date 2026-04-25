import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import {
  CONTROL_ACTION_TIMEOUT_MS,
  type ClickArgs,
  type NavigateArgs,
  NAVIGATE_DEFAULT_TIMEOUT_MS,
  NAVIGATE_MAX_TIMEOUT_MS,
  type PressKeyArgs,
  type TypeArgs,
} from "./control-tool-contracts.js";
import { handleClick, handleNavigate, handlePressKey, handleType } from "./control-tool-handlers.js";

export function buildNavigateTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "accordo_browser_navigate",
    description:
      "Navigate to a URL or perform back/forward/reload in the browser tab. " +
      "Requires user-granted control permission for the target tab. If permission has not been granted yet, ask the user to grant browser control for that tab in the Accordo browser extension popup, then retry. Read-only browser tools may still work without this permission.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
        type: { type: "string", enum: ["url", "back", "forward", "reload"], description: "Navigation type. Default: 'url'" },
        url: { type: "string", description: "Target URL (required when type is 'url')" },
        timeout: { type: "number", description: `Maximum wait time for navigation in ms (default: ${NAVIGATE_DEFAULT_TIMEOUT_MS}, max: ${NAVIGATE_MAX_TIMEOUT_MS})` },
        waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"], description: "GAP-A1: Wait for document readyState before returning. Default: 'domcontentloaded'" },
      },
    },
    dangerLevel: "moderate",
    idempotent: false,
    handler: (args) => handleNavigate(relay, args as NavigateArgs),
  };
}

export function buildClickTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "accordo_browser_click",
    description:
      "Click an element in the browser page by uid, selector, or coordinates. " +
      "Requires user-granted control permission for the target tab. If permission has not been granted yet, ask the user to grant browser control for that tab in the Accordo browser extension popup, then retry. Read-only browser tools may still work without this permission.",
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
        dblClick: { type: "boolean", description: `Whether to double-click. Default: false` },
      },
    },
    dangerLevel: "moderate",
    idempotent: false,
    handler: (args) => handleClick(relay, args as ClickArgs),
  };
}

export function buildTypeTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "accordo_browser_type",
    description:
      "Type text into an element or the page. " +
      "Requires user-granted control permission for the target tab. If permission has not been granted yet, ask the user to grant browser control for that tab in the Accordo browser extension popup, then retry. Read-only browser tools may still work without this permission.",
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
    name: "accordo_browser_press_key",
    description:
      "Press a keyboard key or key combination in the browser. " +
      "Requires user-granted control permission for the target tab. If permission has not been granted yet, ask the user to grant browser control for that tab in the Accordo browser extension popup, then retry. Read-only browser tools may still work without this permission.",
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

export function buildControlTools(relay: BrowserRelayLike): ExtensionToolDefinition[] {
  return [
    buildNavigateTool(relay),
    buildClickTool(relay),
    buildTypeTool(relay),
    buildPressKeyTool(relay),
  ];
}
