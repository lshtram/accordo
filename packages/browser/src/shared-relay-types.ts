/**
 * Shared Browser Relay — Wire Protocol Types
 *
 * These types define the communication protocol between Hub clients
 * and the SharedBrowserRelayServer. Chrome never sees these types —
 * the server strips Hub-specific fields before forwarding to Chrome.
 *
 * @module shared-relay-types
 * @see docs/10-architecture/shared-browser-relay-architecture.md
 */

import type { BrowserRelayAction, BrowserRelayRequest, BrowserRelayResponse } from "./types.js";

// ── Hub Client → Shared Relay ─────────────────────────────────────────────────

/**
 * SBR-F-003, SBR-F-011: Extended relay request that includes the Hub client
 * identifier for response routing. The server strips `hubId` before forwarding
 * to Chrome (SBR-F-005).
 */
export interface SharedRelayRequest extends BrowserRelayRequest {
  /** UUID identifying the Hub client that sent this request. */
  hubId: string;
}

// ── Hub Client Registration ───────────────────────────────────────────────────

/**
 * SBR-F-003: Sent by a Hub client immediately after WebSocket open.
 * The server uses this to register the client in the routing table.
 */
export interface HubClientRegistration {
  kind: "hub-register";
  hubId: string;
  /** Human-readable label for debugging (e.g., workspace folder name). */
  label?: string;
}

/**
 * Server acknowledgement of a Hub client registration.
 */
export interface HubClientRegistrationAck {
  kind: "hub-register-ack";
  hubId: string;
  /** Whether Chrome is currently connected to the shared relay. */
  chromeConnected: boolean;
}

// ── Chrome Connection Status ──────────────────────────────────────────────────

/**
 * SBR-F-009: Broadcast to all Hub clients when Chrome connects or disconnects.
 * Hub clients use this to update their `isConnected()` state (SBR-F-012, SBR-F-014).
 */
export interface ChromeStatusEvent {
  kind: "chrome-status";
  connected: boolean;
}

// ── Hub Client Info ───────────────────────────────────────────────────────────

/**
 * Metadata about a connected Hub client, as tracked by the shared relay server.
 */
export interface HubClientInfo {
  hubId: string;
  label?: string;
  connectedAt: string;
}

// ── Relay Discovery ───────────────────────────────────────────────────────────

/**
 * SBR-F-033: Schema for `~/.accordo/shared-relay.json`.
 * Written by the Owner window, read by other windows to discover the shared relay.
 *
 * The `token` is a single shared authentication token used by all connections
 * (Chrome and Hub clients alike). See DECISION-SBR-06.
 *
 * The `port` is always 40111 (canonical, fixed). See DECISION-SBR-05.
 *
 * This file is an explicit exception to DECISION-MS-10 (which limits `~/.accordo/`
 * to logs and audit). See shared-browser-relay-architecture.md §4.4 for lifecycle rules.
 */
export interface SharedRelayInfo {
  /** Port the shared relay server is listening on (always 40111). */
  port: number;
  /** PID of the process hosting the shared relay server. */
  pid: number;
  /** Single shared authentication token for all connections. */
  token: string;
  /** ISO 8601 timestamp when the shared relay was started. */
  startedAt: string;
  /** hubId of the VS Code window that owns the shared relay process. */
  ownerHubId: string;
}

// ── Server Options ────────────────────────────────────────────────────────────

/**
 * Configuration for SharedBrowserRelayServer.
 *
 * Uses a single shared token for all connections (Chrome + Hub clients).
 * See DECISION-SBR-06 in shared-browser-relay-architecture.md §12.
 */
export interface SharedRelayServerOptions {
  /** Fixed canonical port (40111). See DECISION-SBR-05. */
  port: number;
  host: string;
  /** Single shared authentication token for all connections (Chrome + Hub clients). */
  token: string;
  /** Event callback for logging/diagnostics. */
  onEvent?: (event: string, details?: Record<string, unknown>) => void;
}

// ── Client Options ────────────────────────────────────────────────────────────

/**
 * Configuration for SharedRelayClient.
 */
export interface SharedRelayClientOptions {
  host: string;
  port: number;
  hubId: string;
  /** Shared token read from `~/.accordo/shared-relay.json`. Same token used by Chrome. */
  token: string;
  /** Human-readable label for debugging. */
  label?: string;
  /** Event callback for logging/diagnostics. */
  onEvent?: (event: string, details?: Record<string, unknown>) => void;
  /** Interceptor for Chrome→Hub events. */
  onRelayRequest?: (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse>;
}

// ── Write Lease ───────────────────────────────────────────────────────────────

/**
 * SBR-F-020..027: Configuration for the write lease manager.
 */
export interface WriteLeaseOptions {
  /** Duration of the write lease in ms. Default: 10_000. */
  leaseDurationMs?: number;
  /** Extension time after a successful mutation in ms. Default: 2_000. */
  leaseExtensionMs?: number;
  /** Maximum number of queued write requests. Default: 8. */
  maxQueueDepth?: number;
}

/**
 * Mutating browser actions that require a write lease (SBR-F-020).
 */
export const MUTATING_ACTIONS: readonly BrowserRelayAction[] = [
  "navigate",
  "click",
  "type",
  "press_key",
] as const;
