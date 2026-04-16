/**
 * Hub-internal tool types.
 *
 * Extends the wire-format ToolRegistration with a `localHandler` field
 * for tools that execute directly in the Hub process
 * without routing through BridgeServer.invoke().
 *
 * IMPORTANT: This type NEVER crosses the package boundary. It lives in
 * the Hub only. The wire-format ToolRegistration in bridge-types does NOT
 * contain handler functions (architecture.md §4.5, AGENTS.md §4.3).
 */

import type { ToolRegistration } from "@accordo/bridge-types";

/**
 * A tool registration that can be handled locally in the Hub process.
 *
 * When McpCallExecutor encounters a tool with a `localHandler`, it calls
 * the handler directly instead of routing through `bridgeServer.invoke()`.
 * This is used for Hub-native tools (script runner, discover) that do not
 * need the Bridge/extension host.
 */
export interface HubToolRegistration extends ToolRegistration {
  /**
   * Handler function that executes in the Hub process.
   * Returns the tool result data (same shape as what Bridge handlers return).
   * Throws on error — the executor wraps it in an MCP error response.
   *
   * NEVER serialised. NEVER sent over the wire.
   */
  localHandler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Type guard: check if a ToolRegistration has a localHandler.
 */
export function isHubTool(tool: ToolRegistration): tool is HubToolRegistration {
  return typeof (tool as HubToolRegistration).localHandler === "function";
}
