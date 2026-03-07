/**
 * Bridge WebSocket Client
 *
 * Manages the WebSocket connection from Bridge to Hub.
 * Handles authentication, reconnection, heartbeat, message routing,
 * and protocol version validation.
 *
 * Requirements: requirements-bridge.md §5 (WS-01 to WS-10)
 */

import WebSocket from "ws";
import type {
  IDEState,
  ToolRegistration,
  HubToBridgeMessage,
  BridgeToHubMessage,
  InvokeMessage,
  CancelMessage,
  GetStateMessage,
  ResultMessage,
  PingMessage,
} from "@accordo/bridge-types";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";

// ── Connection State ─────────────────────────────────────────────────────────

/** WebSocket connection states */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/** Close codes with special handling */
export const WS_CLOSE_AUTH_FAILURE = 4001;
export const WS_CLOSE_PROTOCOL_MISMATCH = 4002;

/** Max reconnect backoff in ms */
export const MAX_RECONNECT_BACKOFF_MS = 30000;

/** Max inbound message size in bytes (1MB) */
export const MAX_MESSAGE_SIZE = 1024 * 1024;

// ── Events ───────────────────────────────────────────────────────────────────

/**
 * Events emitted by the WsClient.
 */
export interface WsClientEvents {
  /** Fired when connection is established and initial messages sent */
  onConnected: () => void;
  /** Fired when connection is lost (before reconnect attempts) */
  onDisconnected: (code: number, reason: string) => void;
  /** Fired on auth failure (4001). Caller must rotate secrets + respawn Hub. */
  onAuthFailure: () => void;
  /** Fired on protocol mismatch (4002). No reconnect possible. */
  onProtocolMismatch: (message: string) => void;
  /** Fired when Hub sends an invoke message */
  onInvoke: (message: InvokeMessage) => void;
  /** Fired when Hub sends a cancel message */
  onCancel: (message: CancelMessage) => void;
  /**
   * Fired when Hub sends a getState request.
   * Caller must call StatePublisher.sendSnapshot() in response.
   * §6.3: Hub pull → full stateSnapshot reply.
   */
  onGetState: (message: GetStateMessage) => void;
}

// ── WsClient ─────────────────────────────────────────────────────────────────

/**
 * WebSocket client for Bridge → Hub communication.
 *
 * WS-01: Connects to ws://localhost:{port}/bridge
 * WS-02: Passes x-accordo-secret in upgrade headers
 * WS-03: On open: sends stateSnapshot with protocolVersion
 * WS-04: On open: sends toolRegistry with all registered tools
 * WS-05: Responds to ping with pong within 5 seconds
 * WS-06: On close: reconnect backoff (1s, 2s, 4s, 8s, 16s, max 30s)
 * WS-07: On reconnect: re-sends stateSnapshot and toolRegistry
 * WS-08: Messages > 1MB rejected (log warning, skip)
 * WS-09: Close code 4001 → no reconnect, force secret rotation
 * WS-10: Close code 4002 → no reconnect, show version mismatch error
 */
export class WsClient {
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: WebSocket | null = null;
  private lastState: IDEState | null = null;
  private lastTools: ToolRegistration[] = [];
  private noReconnect = false;

  constructor(
    private port: number,
    private secret: string,
    private events: WsClientEvents,
    /**
     * Optional live provider for the current tool registry.
     * When supplied, `ws.on("open")` snapshots tools at connection-open time
     * rather than at `connect()` call time, eliminating the activation-race
     * window and making the post-connect REG-SYNC re-send unnecessary.
     * Both the initial connect AND every automatic reconnect benefit.
     */
    private getToolsProvider?: () => ToolRegistration[],
  ) {}

  /**
   * WS-01 + WS-02: Connect to Hub WebSocket server.
   * Sends stateSnapshot and toolRegistry on open (WS-03, WS-04).
   *
   * @param currentState - Current IDE state for initial snapshot
   * @param currentTools - Current registered tools
   */
  async connect(
    currentState: IDEState,
    currentTools: ToolRegistration[],
  ): Promise<void> {
    this.lastState = currentState;
    this.lastTools = currentTools;
    this.noReconnect = false;
    this.state = "connecting";

    const ws = new WebSocket(`ws://localhost:${this.port}/bridge`, {
      headers: { "x-accordo-secret": this.secret },
    });
    this.ws = ws;

    ws.on("open", () => {
      this.state = "connected";
      this.reconnectAttempts = 0;
      // Snapshot the registry at open-time if a live provider is available.
      // This covers any registerTools() calls that arrived between connect()
      // being invoked and the WS handshake completing, without needing a
      // deferred re-send workaround.
      const tools = this.getToolsProvider ? this.getToolsProvider() : currentTools;
      this.sendStateSnapshot(currentState);
      this.sendToolRegistry(tools);
      this.events.onConnected();
    });

    ws.on("message", (data: Buffer) => {
      if (data.length > MAX_MESSAGE_SIZE) return;
      let msg: HubToBridgeMessage;
      try {
        msg = JSON.parse(data.toString()) as HubToBridgeMessage;
      } catch {
        // Drop malformed messages — Hub should never send non-JSON, but guard defensively.
        return;
      }
      if (msg.type === "ping") {
        this.sendPong((msg as PingMessage).ts);
        return;
      }
      if (msg.type === "invoke") {
        this.events.onInvoke(msg as InvokeMessage);
        return;
      }
      if (msg.type === "cancel") {
        this.events.onCancel(msg as CancelMessage);
        return;
      }
      if (msg.type === "getState") {
        this.events.onGetState(msg as GetStateMessage);
        return;
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      this.state = "disconnected";
      const reasonStr = reason.toString();
      this.events.onDisconnected(code, reasonStr);
      if (code === WS_CLOSE_AUTH_FAILURE) {
        this.events.onAuthFailure();
        return;
      }
      if (code === WS_CLOSE_PROTOCOL_MISMATCH) {
        this.events.onProtocolMismatch(reasonStr);
        return;
      }
      if (!this.noReconnect) {
        this._scheduleReconnect();
      }
    });
  }

  private _scheduleReconnect(): void {
    const delay = this.getReconnectDelay(this.reconnectAttempts);
    this.reconnectAttempts++;
    this.state = "reconnecting";
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.lastState !== null) {
        this.connect(this.lastState, this.lastTools).catch(() => {});
      }
    }, delay);
  }

  /**
   * Gracefully close the connection. No reconnect after explicit close.
   */
  async disconnect(): Promise<void> {
    this.noReconnect = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null) {
      this.ws.close(1000);
      this.ws = null;
    }
  }

  /**
   * Send a result message back to Hub.
   *
   * @param result - Tool invocation result
   */
  sendResult(result: ResultMessage): void {
    this.ws?.send(JSON.stringify(result));
  }

  /**
   * Send a state update (partial patch) to Hub.
   *
   * @param patch - Changed IDE state fields
   */
  sendStateUpdate(patch: Partial<IDEState>): void {
    this.ws?.send(JSON.stringify({ type: "stateUpdate", patch }));
  }

  /**
   * Send a full state snapshot to Hub.
   * Used on connect/reconnect (WS-03, WS-07).
   *
   * @param state - Complete IDE state
   */
  sendStateSnapshot(state: IDEState): void {
    // Always refresh the reconnect cache so WS-07 replays the latest state.
    this.lastState = state;
    this.ws?.send(
      JSON.stringify({
        type: "stateSnapshot",
        protocolVersion: ACCORDO_PROTOCOL_VERSION,
        state,
      }),
    );
  }

  /**
   * Send the full tool registry to Hub.
   * Used on connect/reconnect (WS-04, WS-07).
   *
   * @param tools - All registered tools (wire format, no handlers)
   */
  sendToolRegistry(tools: ToolRegistration[]): void {
    // Always refresh the reconnect cache so WS-07 replays the latest tools.
    this.lastTools = tools;
    this.ws?.send(JSON.stringify({ type: "toolRegistry", tools }));
  }

  /**
   * Send a pong response to a Hub ping message (WS-05).
   *
   * @param ts - Timestamp from the ping message
   */
  sendPong(ts: number): void {
    this.ws?.send(JSON.stringify({ type: "pong", ts }));
  }

  /**
   * Send a cancelled acknowledgement to Hub.
   *
   * @param id - Invocation ID
   * @param late - Whether the handler completed before cancel arrived
   */
  sendCancelled(id: string, late: boolean): void {
    this.ws?.send(JSON.stringify({ type: "cancelled", id, late }));
  }

  /**
   * Get the current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected to Hub.
   */
  isConnected(): boolean {
    return this.state === "connected";
  }

  /**
   * Update the secret for reconnection after rotation.
   *
   * @param newSecret - New bridge secret
   */
  updateSecret(newSecret: string): void {
    this.secret = newSecret;
  }

  /**
   * WS-06: Calculate reconnect delay with exponential backoff.
   * Sequence: 1s, 2s, 4s, 8s, 16s, 30s (capped).
   *
   * @param attempt - Zero-based attempt number
   * @returns Delay in milliseconds
   */
  getReconnectDelay(attempt: number): number {
    const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_BACKOFF_MS);
    return delay;
  }
}
