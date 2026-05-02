import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
import type { RelayTransport } from "./relay-transport.js";
import { DEFAULT_RELAY_HOST, DEFAULT_RELAY_PORT, RELAY_TOKEN_STORAGE_KEY } from "./relay-bridge-constants.js";
import { routeIncomingRequest, tryResolvePending, type PendingResolver, type RelayActionHandler } from "./relay-bridge-routing.js";
import { sendViaTransport, sendViaWebSocket } from "./relay-bridge-send.js";

const RELAY_IDENTITY_SECRET_STORAGE_KEY = "relayIdentitySecret";
const RELAY_HELLO_TIMEOUT_MS = 3000;

/**
 * WebSocket client that connects the Chrome extension to the Accordo browser relay.
 *
 * Authentication flow:
 *   1. On each connection attempt, reads the relay token from `chrome.storage.local`.
 *      If no token is stored (not yet paired), schedules a retry.
 *   2. If the server rejects the token with close code 1008, the stored token and
 *      identity secret are cleared so the popup can prompt for re-pairing.
 *   3. After the WS opens, the relay sends a `relay-hello` challenge (nonce). The
 *      extension computes HMAC-SHA256(nonce, relayIdentitySecret) and replies with
 *      `relay-hello-ack`. If the secret is not stored or the relay doesn't send a
 *      hello within RELAY_HELLO_TIMEOUT_MS, the connection is closed (re-pair required).
 *
 * @see PAIR-01 — Token read from chrome.storage.local on each connect attempt
 * @see PAIR-02 — No token → schedule retry (wait until user completes pairing)
 * @see PAIR-03 — Close code 1008 → clear stored token, schedule retry
 * @see PAIR-SEC-06 — relay-hello challenge/response for relay identity verification
 */
export class RelayBridgeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly handler: RelayActionHandler;
  private readonly transport: RelayTransport | undefined;
  private pending = new Map<string, PendingResolver>();
  private relayHelloTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingRelayHello = false;
  private relayIdentitySecret: string | undefined;

  constructor(handler: RelayActionHandler, transport?: RelayTransport) {
    this.handler = handler;
    this.transport = transport;
  }

  /**
   * Start the relay bridge connection.
   *
   * Reads the relay token from chrome.storage.local. If present, opens a WebSocket
   * to the relay. If absent (not paired yet), schedules a reconnect.
   *
   * @see PAIR-01 — Token read from chrome.storage.local on each connect attempt
   * @see PAIR-02 — No token → no WebSocket, schedule reconnect
   */
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

    void chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY, RELAY_IDENTITY_SECRET_STORAGE_KEY]).then((result) => {
      if (this.stopped) return;
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

      const token = result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;
      this.relayIdentitySecret = result[RELAY_IDENTITY_SECRET_STORAGE_KEY] as string | undefined;
      if (!token) {
        this.scheduleReconnect();
        return;
      }

      const url = `ws://${DEFAULT_RELAY_HOST}:${DEFAULT_RELAY_PORT}/chrome?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onmessage = (event): void => {
        void this.handleSocketMessage(event.data, socket);
      };
      socket.onclose = (event): void => {
        this.stopHeartbeat();
        this.stopRelayHelloTimer();
        this.awaitingRelayHello = false;
        this.ws = null;
        this.scheduleReconnect();
      };
      socket.onopen = (): void => {
        this.startHeartbeat();
        this.startRelayHelloHandshake(socket);
      };
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
    this.stopRelayHelloTimer();
    this.awaitingRelayHello = false;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, 2000);
  }

  private startRelayHelloHandshake(socket: WebSocket): void {
    this.stopRelayHelloTimer();
    this.awaitingRelayHello = true;
    this.relayHelloTimer = setTimeout(() => {
      if (!this.awaitingRelayHello) return;
      this.awaitingRelayHello = false;
      if (this.relayIdentitySecret && socket.readyState === WebSocket.OPEN) {
        socket.close(1008, "relay-hello-timeout");
      }
      // No identity secret: legacy path stays active.
    }, RELAY_HELLO_TIMEOUT_MS);
  }

  private stopRelayHelloTimer(): void {
    if (this.relayHelloTimer) {
      clearTimeout(this.relayHelloTimer);
      this.relayHelloTimer = null;
    }
  }

  private async handleSocketMessage(raw: unknown, socket: WebSocket): Promise<void> {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }

    if (this.awaitingRelayHello && parsed.kind === "relay-hello") {
      const nonce = parsed.nonce;
      if (typeof nonce !== "string" || nonce.length === 0) {
        socket.close(1008, "invalid-relay-hello");
        return;
      }
      if (!this.relayIdentitySecret) {
        socket.close(1008, "no-identity-secret");
        return;
      }

      const hmac = await this.computeRelayHelloHmac(nonce, this.relayIdentitySecret);
      socket.send(JSON.stringify({ kind: "relay-hello-ack", hmac }));
      this.awaitingRelayHello = false;
      this.stopRelayHelloTimer();
      return;
    }

    await this.handleIncoming(parsed);
  }

  private async computeRelayHelloHmac(nonce: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(nonce));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const parsed = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;

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
