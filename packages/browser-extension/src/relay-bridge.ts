import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";

const DEFAULT_RELAY_HOST = "127.0.0.1";
const DEFAULT_RELAY_PORT = 40111;
const DEFAULT_RELAY_TOKEN = "accordo-local-dev-token";

type RelayActionHandler = (request: RelayActionRequest) => Promise<RelayActionResponse>;

export class RelayBridgeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly handler: RelayActionHandler;

  constructor(handler: RelayActionHandler) {
    this.handler = handler;
  }

  start(): void {
    this.stopped = false;
    if (typeof WebSocket === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const url = `ws://${DEFAULT_RELAY_HOST}:${DEFAULT_RELAY_PORT}/?token=${encodeURIComponent(DEFAULT_RELAY_TOKEN)}`;
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onmessage = (event) => {
      void this.handleIncoming(event.data);
    };
    socket.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      this.scheduleReconnect();
    };
    socket.onopen = () => {
      this.startHeartbeat();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  stop(): void {
    this.stopped = true;
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
    if (this.stopped) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, 2000);
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let request: RelayActionRequest | null = null;
    try {
      request = JSON.parse(String(raw)) as RelayActionRequest;
    } catch {
      return;
    }
    if (!request || typeof request.requestId !== "string" || typeof request.action !== "string") return;

    const response = await this.handler(request);
    this.ws.send(JSON.stringify(response));
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
}
