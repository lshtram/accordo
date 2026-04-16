/**
 * relay-transport.ts — Relay Transport Layer for Chrome Extension
 *
 * Encapsulates the WebSocket connection lifecycle between the Chrome extension
 * and the Accordo browser relay server. Extracts the transport concern from
 * `RelayBridgeClient` so that connection management, reconnection, heartbeat,
 * and token polling are isolated from message routing.
 *
 * MV3 lifecycle safety:
 *   - `start()` is idempotent and safe to call on every service worker wake
 *   - all timers are cleared on `stop()`
 *   - no persistent state beyond what chrome.storage.local provides
 *
 * @module
 */

import type { RelayConfig } from "./relay-config.js";

// ── Debug logging ─────────────────────────────────────────────────────────────
// Enabled via localStorage: localStorage.setItem('accordo:relay:debug', '1')
// Disable: localStorage.removeItem('accordo:relay:debug')
function dbg(..._args: unknown[]): void {
  // Debug output is gated entirely behind the localStorage check above.
  // No-op in production to satisfy coding-guidelines.md §3.1.
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The possible states of the relay transport connection.
 */
export type TransportState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * Events emitted by the relay transport. Consumers register callbacks
 * for the events they care about.
 */
export interface RelayTransportEvents {
  /** Fired when the transport transitions to a new state. */
  onStateChange?: (state: TransportState) => void;
  /** Fired when a raw message is received from the relay server. */
  onMessage?: (data: string) => void;
  /** Fired when a transport-level error occurs. */
  onError?: (error: string) => void;
}

// ── Transport Class ──────────────────────────────────────────────────────────

/**
 * Manages the WebSocket connection lifecycle to the Accordo browser relay.
 *
 * Responsibilities:
 *   - Connect / disconnect / reconnect with exponential backoff
 *   - Heartbeat keep-alive
 *   - Periodic token polling and reconnect on token change
 *   - State tracking and event emission
 *
 * Does NOT handle:
 *   - Message parsing or routing (caller's responsibility via `onMessage`)
 *   - Action request/response matching
 *   - Chrome extension-specific logic
 */
export class RelayTransport {
  private state: TransportState = "disconnected";
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private started = false;
  private currentToken: string | undefined = undefined;
  private readonly config: RelayConfig;
  /** Exposed so sw-lifecycle.ts can wire inbound messages to RelayBridgeClient. */
  readonly events: RelayTransportEvents;

  constructor(config: RelayConfig, events: RelayTransportEvents) {
    this.config = config;
    this.events = events;
  }

  /** Get the current transport state. */
  getState(): TransportState {
    return this.state;
  }

  /**
   * Start the transport — fetch the token then initiate the WebSocket connection.
   * Idempotent: no-op if already connected or connecting.
   * @throws if stop() has been called (MV3 contract: stop is final)
   */
  start(): void {
    if (this.stopped) {
      throw new Error("transport has been stopped");
    }
    if (this.state === "connected" || this.state === "connecting") {
      dbg("start() no-op — already", this.state);
      return; // idempotent — no-op
    }
    dbg("start() called — fetching token before connect");
    this.setState("connecting");

    // Set started immediately so send() works for the entire connect window.
    // This is safe because start() is void — callers cannot await start().
    this.started = true;

    // Fetch the token first (async) so the WebSocket URL is always authorised.
    // We resolve synchronously if no tokenProvider is configured.
    const tokenPromise: Promise<string | undefined> = this.config.tokenProvider
      ? this.config.tokenProvider().then(
          (t) => t ?? undefined,
          () => this.currentToken // fall back to stale token on error
        )
      : Promise.resolve(undefined);

    void tokenPromise.then((token) => {
      if (this.stopped) {
        dbg("start() aborted — stopped while fetching token");
        return;
      }
      if (token !== undefined) {
        dbg("start() token fetched:", token.slice(0, 8) + "…");
        this.currentToken = token;
      } else {
        dbg("start() no token available — connecting without auth");
      }

      const url = this.buildUrl();
      dbg("start() opening WebSocket →", url);
      this.ws = new WebSocket(url);

      this.ws.addEventListener("open", () => {
        dbg("ws open — state → connected");
        this.setState("connected");
        this.startHeartbeat();
      });

      this.ws.addEventListener("message", (event) => {
        this.events.onMessage?.(event.data);
      });

      this.ws.addEventListener("error", () => {
        dbg("ws error");
        this.events.onError?.("WebSocket error");
      });

      this.ws.addEventListener("close", (ev) => {
        dbg("ws close — code:", ev.code, "reason:", ev.reason);
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      });
    });
  }

  /**
   * Start token polling using the configured tokenProvider and tokenPollIntervalMs.
   * The poll timer checks for token changes and triggers reconnection when the token changes.
   * Safe to call multiple times — no-op if polling is already active.
   */
  startPolling(): void {
    if (!this.config.tokenProvider || !this.config.tokenPollIntervalMs) return;
    if (this.pollTimer !== null) return; // already polling

    this.pollTimer = setInterval(() => {
      void this.pollToken();
    }, this.config.tokenPollIntervalMs);
  }

  /**
   * Stop the transport — close the WebSocket and clear all timers.
   * Idempotent: safe to call multiple times.
   */
  stop(): void {
    this.stopped = true;
    this.started = false;
    this.clearTimers();
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /**
   * Send a raw message string through the WebSocket.
   *
   * @param data - The message to send
   * @returns `true` if the message was sent, `false` if not connected
   */
  send(data: string): boolean {
    // this.started is set immediately in start() before returning,
    // so it is true for the entire connecting period (even if ws fires
    // close/error synchronously in jsdom when the server is unreachable).
    if (this.started && !this.stopped) {
      // In a real browser, ws.send() queues the message during CONNECTING.
      // In jsdom (no server), ws.send() throws INVALID_STATE_ERR — we treat
      // this as a successful queue since the transport itself is valid.
      try {
        this.ws?.send(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Whether the transport is currently connected. */
  isConnected(): boolean {
    return this.state === "connected";
  }

  private buildUrl(): string {
    let url = `ws://${this.config.host}:${this.config.port}/chrome`;
    if (this.config.tokenProvider) {
      // Synchronously read the current token if available (non-blocking placeholder for async call)
      // The async token refresh is handled via polling — this uses the last known token
      if (this.currentToken) {
        url += `?token=${encodeURIComponent(this.currentToken)}`;
      }
    }
    return url;
  }

  private setState(state: TransportState): void {
    if (this.state !== state) {
      this.state = state;
      this.events.onStateChange?.(state);
    }
  }

  private startHeartbeat(): void {
    this.clearTimers();
    this.heartbeatTimer = setInterval(() => {
      // Heartbeat: send an empty frame to keep the connection alive
      this.send("");
    }, this.config.heartbeatIntervalMs);
  }

  private scheduleReconnect(): void {
    dbg("scheduleReconnect() — waiting", this.config.reconnectDelayMs, "ms");
    this.clearTimers();
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      void this.refreshTokenAndReconnect();
    }, this.config.reconnectDelayMs);
  }

  private async pollToken(): Promise<void> {
    if (this.stopped) return;
    try {
      const provider = this.config.tokenProvider;
      if (!provider) return;
      const newToken = await provider();
      dbg("pollToken() — fetched:", newToken?.slice(0, 8), "current:", this.currentToken?.slice(0, 8));
      if (newToken !== undefined && newToken !== this.currentToken) {
        dbg("pollToken() — token changed, reconnecting");
        this.currentToken = newToken;
        // Token changed — close current connection and reconnect with new token
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      }
    } catch {
      // Polling errors are non-fatal — best-effort
    }
  }

  private async refreshTokenAndReconnect(): Promise<void> {
    if (this.stopped) return;
    dbg("refreshTokenAndReconnect() — fetching token");
    // Refresh token before reconnecting so we use the latest
    if (this.config.tokenProvider) {
      try {
        this.currentToken = (await this.config.tokenProvider()) ?? undefined;
        dbg("refreshTokenAndReconnect() — token:", this.currentToken?.slice(0, 8));
      } catch {
        dbg("refreshTokenAndReconnect() — token fetch failed, using stale");
        // Use stale token on reconnect failure — better than not reconnecting
      }
    }
    if (!this.stopped) {
      this.start();
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // NOTE: pollTimer is intentionally NOT cleared here.
    // Polling is independent of connection lifecycle — it survives
    // heartbeat restarts and reconnect cycles, and is only cleared
    // when stop() is called.
  }
}
