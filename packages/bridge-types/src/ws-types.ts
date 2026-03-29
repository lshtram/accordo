/**
 * WebSocket message types for Hub ↔ Bridge communication.
 *
 * Sources:
 *   - requirements-hub.md §3.1 (Hub → Bridge messages)
 *   - requirements-hub.md §3.2 (Bridge → Hub messages)
 */

import type { IDEState } from "./ide-types.js";
import type { ToolRegistration } from "./tool-types.js";

// ─── WebSocket Messages: Hub → Bridge ────────────────────────────────────────

/**
 * Invoke a tool on the Bridge side.
 * Source: requirements-hub.md §3.1
 */
export interface InvokeMessage {
  type: "invoke";
  /** UUID v4 correlation ID */
  id: string;
  /** Fully qualified tool name, e.g. "accordo_editor_open" */
  tool: string;
  /** Tool arguments matching the inputSchema */
  args: Record<string, unknown>;
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Cancel an in-flight invocation.
 * Source: requirements-hub.md §3.1
 */
export interface CancelMessage {
  type: "cancel";
  /** UUID of the InvokeMessage to cancel */
  id: string;
}

/**
 * Request a full state snapshot from Bridge.
 * Source: requirements-hub.md §3.1
 */
export interface GetStateMessage {
  type: "getState";
  /** UUID v4 correlation ID */
  id: string;
}

/**
 * Heartbeat from Hub.
 * Source: requirements-hub.md §3.1
 */
export interface PingMessage {
  type: "ping";
  /** Date.now() timestamp */
  ts: number;
}

/** Union of all Hub → Bridge message types */
export type HubToBridgeMessage =
  | InvokeMessage
  | CancelMessage
  | GetStateMessage
  | PingMessage;

// ─── WebSocket Messages: Bridge → Hub ────────────────────────────────────────

/**
 * Tool invocation result.
 * Source: requirements-hub.md §3.2
 */
export interface ResultMessage {
  type: "result";
  /** Correlates with InvokeMessage.id */
  id: string;
  success: boolean;
  /** Tool-specific return value (if success) */
  data?: unknown;
  /** Human-readable error (if !success) */
  error?: string;
}

/**
 * Partial state update (changed fields only).
 * Source: requirements-hub.md §3.2
 */
export interface StateUpdateMessage {
  type: "stateUpdate";
  patch: Partial<IDEState>;
}

/**
 * Full state snapshot. Sent on connect/reconnect.
 * Source: requirements-hub.md §3.2
 */
export interface StateSnapshotMessage {
  type: "stateSnapshot";
  /** Protocol version for compatibility checking. "1" for Phase 1. */
  protocolVersion: string;
  state: IDEState;
}

/**
 * Full replacement of the tool registry.
 * Source: requirements-hub.md §3.2
 */
export interface ToolRegistryMessage {
  type: "toolRegistry";
  /** Complete list — replaces previous registry */
  tools: ToolRegistration[];
}

/**
 * Heartbeat response.
 * Source: requirements-hub.md §3.2
 */
export interface PongMessage {
  type: "pong";
  /** Echo back the Hub's timestamp */
  ts: number;
}

/**
 * Acknowledgement that a cancellation was processed.
 * Source: requirements-hub.md §3.2
 */
export interface CancelledMessage {
  type: "cancelled";
  /** Correlates with CancelMessage.id */
  id: string;
  /** true if the handler completed before cancel arrived */
  late: boolean;
}

/** Union of all Bridge → Hub message types */
export type BridgeToHubMessage =
  | ResultMessage
  | StateUpdateMessage
  | StateSnapshotMessage
  | ToolRegistryMessage
  | PongMessage
  | CancelledMessage;

/** Union of ALL WebSocket messages (either direction) */
export type WsMessage = HubToBridgeMessage | BridgeToHubMessage;
