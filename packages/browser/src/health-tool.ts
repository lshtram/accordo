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
  /**
   * Telemetry policy disclosure.
   *
   * I4: Agents and users can inspect this field to understand what data
   * is collected and how to opt out. Accordo does not send telemetry to
   * external services; all captured data (snapshots, screenshots, page maps)
   * stays on-device and is subject to the configured retention policy.
   */
  telemetryPolicy: {
    /** Whether any telemetry is collected. */
    enabled: boolean;
    /** What is collected (or empty string if disabled). */
    scope: string;
    /** How to disable telemetry collection. */
    optOut: string;
  };
  /**
   * Session and storage isolation information.
   *
   * I3: Describes the browser profile and isolation model in use.
   * The relay operates against the user's active Chrome profile — no
   * automatic session sandboxing is applied. Use separate Chrome profiles
   * or Incognito mode for isolated sessions.
   */
  sessionIsolation: {
    /** Profile isolation model. */
    model: "shared-profile" | "incognito" | "separate-profile";
    /** Human-readable description of the current isolation mode. */
    description: string;
  };
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
      telemetryPolicy: {
        enabled: false,
        scope: "",
        optOut:
          "No action required — Accordo does not transmit telemetry to external services. " +
          "All captured data (snapshots, screenshots, page maps) remains on-device and is " +
          "managed by the snapshot retention policy (accordo_browser_manage_snapshots).",
      },
      sessionIsolation: {
        model: "shared-profile",
        description:
          "The relay operates against the user's active Chrome profile. " +
          "No automatic session sandboxing is applied. " +
          "For isolated sessions, use a separate Chrome profile or launch Chrome with --incognito.",
      },
    };
  };

  return {
    name: "accordo_browser_health",
    description:
      "Reports browser relay connection health, recent errors, and uptime. Use before attempting browser operations to verify the connection is functional. Also surfaces telemetry policy and session isolation model.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    dangerLevel: "safe",
    idempotent: true,
    handler,
  };
}
