import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import type { RelayTransport } from "./relay-transport.js";
import { DEFAULT_RELAY_HOST, DEFAULT_RELAY_PORT, RELAY_TOKEN_STORAGE_KEY } from "./relay-bridge-constants.js";
import { routeIncomingRequest, tryResolvePending, type PendingResolver, type RelayActionHandler } from "./relay-bridge-routing.js";
import { sendViaTransport, sendViaWebSocket } from "./relay-bridge-send.js";

export class RelayBridgeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly handler: RelayActionHandler;
  private readonly transport: RelayTransport | undefined;
  private pending = new Map<string, PendingResolver>();

  constructor(handler: RelayActionHandler, transport?: RelayTransport) {
    this.handler = handler;
    this.transport = transport;
  }

  start(): void {
    this.stopped = false;
    if (this.transport) {
      this.transport.startPolling();
      this.transport.start();
      return;
    }
    this.startDirect();
  }

  private startDirect(): void {
    if (typeof WebSocket === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    void chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY]).then((result) => {
      if (this.stopped) return;
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

      const token = result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;
      if (!token) {
        this.scheduleReconnect();
        return;
      }

      const url = `ws://${DEFAULT_RELAY_HOST}:${DEFAULT_RELAY_PORT}/chrome?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onmessage = (event): void => { void this.handleIncoming(event.data); };
      socket.onclose = (event): void => {
        this.stopHeartbeat();
        this.ws = null;
        if (event.code === 1008) void chrome.storage.local.remove(RELAY_TOKEN_STORAGE_KEY);
        this.scheduleReconnect();
      };
      socket.onopen = (): void => { this.startHeartbeat(); };
      socket.onerror = (): void => { socket.close(); };
    }).catch(() => {
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.transport) this.transport.stop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stopHeartbeat();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, 2000);
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }

    if (tryResolvePending(parsed, this.pending)) return;
    routeIncomingRequest(parsed, this.handler, undefined, this.ws);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ kind: "ping", ts: Date.now() }));
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async send(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (this.transport) {
      return sendViaTransport(this.transport, this.pending, action, payload, timeoutMs);
    }
    return sendViaWebSocket(this.ws, this.pending, action, payload, timeoutMs);
  }

  handleTransportMessage(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (tryResolvePending(parsed, this.pending)) return;
    routeIncomingRequest(parsed, this.handler, this.transport, this.ws);
  }

  isConnected(): boolean {
    if (this.transport) return this.transport.isConnected();
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
