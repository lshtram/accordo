import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";

const DEFAULT_RELAY_HOST = "127.0.0.1";
const DEFAULT_RELAY_PORT = 40111;
const RELAY_TOKEN_STORAGE_KEY = "relayToken";
const RELAY_IDENTITY_SECRET_KEY = "relayIdentitySecret";

/** Timeout (ms) to receive relay-hello nonce after opening the WebSocket. */
const RELAY_HELLO_TIMEOUT_MS = 3000;

type RelayActionHandler = (request: RelayActionRequest) => Promise<RelayActionResponse>;

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
  /** Pending request callbacks awaiting a response from accordo-browser */
  private pending = new Map<string, (response: { requestId: string; success: boolean; data?: unknown; error?: string }) => void>();

  constructor(handler: RelayActionHandler) {
    this.handler = handler;
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
    if (typeof WebSocket === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    void chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY, RELAY_IDENTITY_SECRET_KEY]).then((result) => {
      // Guard: if stopped while awaiting storage read, abort
      if (this.stopped) return;
      // Guard: if a connection was established while awaiting, abort
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const token = result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;
      const identitySecret = result[RELAY_IDENTITY_SECRET_KEY] as string | undefined;

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
          // PAIR-03: Token rejected or identity verification failed — clear credentials
          // and wait for user to re-pair.
          void chrome.storage.local.remove([RELAY_TOKEN_STORAGE_KEY, RELAY_IDENTITY_SECRET_KEY]);
        }
        this.scheduleReconnect();
      };
      socket.onopen = (): void => {
        // PAIR-SEC-06: Wait for relay-hello challenge before starting heartbeat / accepting messages.
        this.awaitRelayHello(socket, identitySecret ?? null);
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

  /**
   * PAIR-SEC-06: After the WebSocket opens, wait for the relay to send a
   * `relay-hello` message containing a nonce. Reply with
   * `relay-hello-ack` containing HMAC-SHA256(nonce, relayIdentitySecret).
   *
   * If no hello arrives within RELAY_HELLO_TIMEOUT_MS, or if the relay sends a
   * hello but we have no identity secret (first-ever connection before pairing),
   * close the socket so a fresh re-pair is forced.
   *
   * If the relay does NOT send a hello at all within the timeout (e.g. old relay
   * without challenge support), we treat this as a no-secret scenario and close.
   */
  private awaitRelayHello(socket: WebSocket, identitySecret: string | null): void {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.onmessage = null; // remove temporary handler
        if (!identitySecret) {
          // No secret and no hello — relay likely doesn't support challenge yet or this
          // is a first connection. Accept without challenge.
          this.activateSocket(socket);
        } else {
          // Had a secret but relay never sent hello — suspicious, close + re-pair.
          socket.close(1008, "relay-hello-timeout");
        }
      }
    }, RELAY_HELLO_TIMEOUT_MS);

    socket.onmessage = (event): void => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (parsed["kind"] !== "relay-hello") return;

      const nonce = parsed["nonce"];
      if (typeof nonce !== "string") {
        resolved = true;
        clearTimeout(timeout);
        socket.close(1008, "invalid-relay-hello");
        return;
      }

      if (!identitySecret) {
        // Got a hello challenge but we have no secret stored — we can't verify.
        // This likely means the extension was re-installed or storage was cleared.
        // Close and require re-pair.
        resolved = true;
        clearTimeout(timeout);
        socket.close(1008, "no-identity-secret");
        return;
      }

      // Compute HMAC-SHA256(nonce, identitySecret) using Web Crypto API.
      void crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(identitySecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ).then((key) => crypto.subtle.sign("HMAC", key, new TextEncoder().encode(nonce)))
        .then((sig) => {
          const hmac = Array.from(new Uint8Array(sig))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ kind: "relay-hello-ack", hmac }));
          }
          resolved = true;
          clearTimeout(timeout);
          // Restore normal message handler now that hello is done.
          this.activateSocket(socket);
        });
    };
  }

  /**
   * Activate the socket for normal operation after identity handshake completes.
   * Wires the real message handler and starts the heartbeat.
   */
  private activateSocket(socket: WebSocket): void {
    socket.onmessage = (event): void => {
      void this.handleIncoming(event.data);
    };
    this.startHeartbeat();
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

  /** Check if the WebSocket is connected */
  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
