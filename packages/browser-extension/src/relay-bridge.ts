import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import type { RelayTransport } from "./relay-transport.js";

const DEFAULT_RELAY_HOST = "127.0.0.1";
const DEFAULT_RELAY_PORT = 40111;
const RELAY_TOKEN_STORAGE_KEY = "relayToken";

type RelayActionHandler = (request: RelayActionRequest) => Promise<RelayActionResponse>;

/**
 * WebSocket client that connects the Chrome extension to the Accordo browser relay.
 *
 * Supports two modes:
 * - Default: manages its own WebSocket connection directly (legacy mode)
 * - Transport mode: delegates to a RelayTransport instance for connection management
 *
 * On each connection attempt, reads the relay token from `chrome.storage.local`.
 * If no token is stored (not yet paired), schedules a retry without opening a
 * WebSocket. If the server rejects the token with close code 1008, the stored
 * token is cleared so the popup can prompt for re-pairing.
 *
 * @see PAIR-01 — Token read from chrome.storage.local on each connect attempt
 * @see PAIR-02 — No token → schedule retry (wait until user completes pairing)
 * @see PAIR-03 — Close code 1008 → clear stored token, schedule retry
 */
export class RelayBridgeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly handler: RelayActionHandler;
  /** RelayTransport instance for connection management (optional). */
  private readonly transport: RelayTransport | undefined;
  /** Pending request callbacks awaiting a response from accordo-browser */
  private pending = new Map<string, (response: { requestId: string; success: boolean; data?: unknown; error?: string }) => void>();

  /**
   * Create a RelayBridgeClient.
   * @param handler - Async handler for incoming relay action requests
   * @param transport - Optional RelayTransport instance. When provided, the bridge
   *                    delegates WebSocket connection lifecycle to the transport.
   */
  constructor(handler: RelayActionHandler, transport?: RelayTransport) {
    this.handler = handler;
    this.transport = transport;
  }

  /**
   * Start the relay bridge connection.
   *
   * If a RelayTransport was provided at construction, delegates to transport.start()
   * and sets up the message/event handlers on the transport.
   *
   * Otherwise, reads the relay token from chrome.storage.local directly and
   * opens a WebSocket (legacy mode).
   *
   * @see PAIR-01 — Token read from chrome.storage.local on each connect attempt
   * @see PAIR-02 — No token → no WebSocket, schedule reconnect
   */
  start(): void {
    this.stopped = false;

    if (this.transport) {
      // Transport mode: delegate connection lifecycle to RelayTransport
      this.transport.startPolling();
      this.transport.start();
      return;
    }

    // Legacy direct WebSocket mode
    this.startDirect();
  }

  private startDirect(): void {
    if (typeof WebSocket === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    void chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY]).then((result) => {
      // Guard: if stopped while awaiting storage read, abort
      if (this.stopped) return;
      // Guard: if a connection was established while awaiting, abort
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const token = result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;

      if (!token) {
        // PAIR-02: Not yet paired — retry later
        this.scheduleReconnect();
        return;
      }

      // Connect using stored token
      const url = `ws://${DEFAULT_RELAY_HOST}:${DEFAULT_RELAY_PORT}/chrome?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onmessage = (event): void => {
        void this.handleIncoming(event.data);
      };
      socket.onclose = (event): void => {
        this.stopHeartbeat();
        this.ws = null;
        if (event.code === 1008) {
          // PAIR-03: Token rejected — clear it and wait for user to re-pair
          void chrome.storage.local.remove(RELAY_TOKEN_STORAGE_KEY);
        }
        this.scheduleReconnect();
      };
      socket.onopen = (): void => {
        this.startHeartbeat();
      };
      socket.onerror = (): void => {
        socket.close();
      };
    }).catch(() => {
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.transport) {
      this.transport.stop();
    }
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
    // In transport mode, messages come through the transport's onMessage callback
    // This method is only used in direct WS mode
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }

    // Check if this is a response (has `success` field) BEFORE attempting to
    // parse as a request.
    if (typeof parsed["success"] !== "undefined") {
      const requestId = parsed["requestId"] as string | undefined;
      if (!requestId) return;
      const resolve = this.pending.get(requestId);
      if (resolve) {
        this.pending.delete(requestId);
        resolve({
          requestId,
          success: parsed["success"] as boolean,
          data: parsed["data"],
          error: parsed["error"] as string | undefined,
        });
      }
      return;
    }

    if (typeof parsed["action"] !== "string" || typeof parsed["requestId"] !== "string") {
      return;
    }

    const request = parsed as unknown as RelayActionRequest;
    const response = await this.handler(request);
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
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
   *
   * @param action - The relay action name
   * @param payload - The action payload
   * @param timeoutMs - Timeout in ms (default: 5000)
   */
  async send(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (this.transport) {
      // Transport mode: use transport.send()
      // Note: transport mode still needs message routing for responses
      // This is a simplified implementation — full response tracking requires
      // additional integration between transport and bridge message handling
      const transport = this.transport;
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

        const sent = transport.send(JSON.stringify(envelope));
        if (!sent) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve({ success: false, error: "browser-not-connected" });
        }
      });
    }

    // Legacy direct mode
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

      const ws = this.ws;
      if (!ws) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ success: false, error: "browser-not-connected" });
        return;
      }
      ws.send(JSON.stringify(envelope));
    });
  }

  /**
   * Handle an incoming message from the RelayTransport.
   * Parses the message and resolves any matching pending request callback.
   *
   * This is called by the transport's onMessage callback to route
   * inbound responses back to the correct pending Promise resolver.
   */
  handleTransportMessage(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    // Response path: resolve any pending send() promise by requestId.
    if (typeof parsed["success"] !== "undefined") {
      const requestId = parsed["requestId"] as string | undefined;
      if (!requestId) return;

      const resolve = this.pending.get(requestId);
      if (resolve) {
        this.pending.delete(requestId);
        resolve({
          requestId,
          success: parsed["success"] as boolean,
          data: parsed["data"],
          error: parsed["error"] as string | undefined,
        });
      }
      return;
    }

    // Request path: transport mode must also process incoming action requests
    // from the relay server and send the handler response back.
    if (typeof parsed["action"] !== "string" || typeof parsed["requestId"] !== "string") {
      return;
    }

    const request = parsed as unknown as RelayActionRequest;
    void this.handler(request)
      .then((response) => {
        const payload = JSON.stringify(response);
        if (this.transport) {
          this.transport.send(payload);
          return;
        }
        const ws = this.ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      })
      .catch(() => {
        // Best-effort: mirror direct mode behavior by returning an explicit
        // action-failed response to avoid leaving server-side requests pending.
        const failure = JSON.stringify({
          requestId: request.requestId,
          success: false,
          error: "action-failed",
        });
        if (this.transport) {
          this.transport.send(failure);
          return;
        }
        const ws = this.ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(failure);
        }
      });
  }

  /** Check if the WebSocket is connected */
  isConnected(): boolean {
    if (this.transport) {
      return this.transport.isConnected();
    }
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
