/**
 * M110-TC — Browser Health Tool
 *
 * Reports connection health, recent errors, and uptime for the browser relay.
 * Designed for agents to check if the browser connection is functional before
 * attempting other browser operations.
 *
 * GAP-H1 / MCP-ER-004.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";

/** Input for browser_health — no parameters required. */
export interface HealthArgs {
  // Empty — health check takes no parameters
}

/** Response from browser_health. MCP-ER-004. */
export interface HealthResponse {
  /** Whether the browser relay is currently connected. */
  connected: boolean;
  /** WebSocket debugger URL if connected. */
  debuggerUrl?: string;
  /** Recent error messages (last 10, most recent first). */
  recentErrors: string[];
  /** Seconds since the relay server started. */
  uptimeSeconds: number;
}

/** Maximum number of recent errors to retain. */
export const MAX_RECENT_ERRORS = 10;

/**
 * Build the browser_health MCP tool.
 *
 * Queries the relay server directly (no relay round-trip) to report
 * connection health and recent error history.
 */
export function buildHealthTool(
  relay: BrowserRelayLike,
): ExtensionToolDefinition {
  const recentErrors: string[] = [];
  const startTime = Date.now();

  // Register error listener so the ring buffer gets populated when the relay
  // returns error responses (browser-not-connected, timeout, etc.)
  relay.onError = (error: string) => {
    recentErrors.unshift(error);
    if (recentErrors.length > MAX_RECENT_ERRORS) {
      recentErrors.pop();
    }
  };

  const handler = async (): Promise<HealthResponse> => {
    const connected = relay.isConnected();
    const debuggerUrl = connected
      ? (relay.getDebuggerUrl?.() ?? "ws://localhost:9222")
      : undefined;
    const uptimeSeconds = Math.max(1, Math.floor((Date.now() - startTime) / 1000));

    return {
      connected,
      debuggerUrl,
      recentErrors: recentErrors.slice(0, MAX_RECENT_ERRORS),
      uptimeSeconds,
    };
  };

  return {
    name: "browser_health",
    description:
      "Reports browser relay connection health, recent errors, and uptime. Use before attempting browser operations to verify the connection is functional.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    dangerLevel: "safe",
    idempotent: true,
    handler,
  };
}
