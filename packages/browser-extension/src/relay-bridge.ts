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
  /** Pending request callbacks awaiting a response from accordo-browser */
  private pending = new Map<string, (response: { requestId: string; success: boolean; data?: unknown; error?: string }) => void>();

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
      // Try parsing as a response to a pending request
      let response: { requestId: string; success: boolean; data?: unknown; error?: string } | null = null;
      try {
        response = JSON.parse(String(raw)) as typeof response;
      } catch {
        return;
      }
      if (!response || typeof response.requestId !== "string") return;
      const resolve = this.pending.get(response.requestId);
      if (resolve) {
        this.pending.delete(response.requestId);
        resolve(response);
      }
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

  /**
   * Send a relay request to accordo-browser through the WebSocket.
   * Used to forward Chrome events (e.g. CREATE_THREAD) so accordo-browser can
   * persist them to VS Code's CommentStore and update the Comments Panel.
   *
   * @param action - The relay action name
   * @param payload - The action payload
   * @param timeoutMs - Timeout in ms (default: 5000)
   * @returns The relay response, or an error response if not connected
   */
  async send(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "browser-not-connected" };
    }

    const requestId = crypto.randomUUID();
    const envelope: RelayActionRequest = { requestId, action: action as RelayActionRequest["action"], payload };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ success: false, error: "timeout" });
      }, timeoutMs);

      this.pending.set(requestId, (response) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(response);
      });

      this.ws!.send(JSON.stringify(envelope));
    });
  }

  /** Check if the WebSocket is connected */
  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
