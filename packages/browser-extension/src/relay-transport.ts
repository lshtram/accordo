/**
 * relay-transport.ts — Relay Transport Layer for Chrome Extension
 *
 * @module
 */

import type { RelayConfig } from "./relay-config.js";
import { dbg } from "./relay-transport-constants.js";
import type { RelayTransportEvents, TransportState } from "./relay-transport-types.js";
import {
  attachSocketListeners,
  buildRelayUrl,
  clearTransportTimers,
  closeTransportSocket,
  hasActiveSocket,
  loadTransportToken,
} from "./relay-transport-runtime.js";

export type { RelayTransportEvents, TransportState } from "./relay-transport-types.js";

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
  readonly events: RelayTransportEvents;

  constructor(config: RelayConfig, events: RelayTransportEvents) {
    this.config = config;
    this.events = events;
  }

  getState(): TransportState {
    return this.state;
  }

  start(): void {
    if (this.stopped) throw new Error("transport has been stopped");
    if (this.state === "connected" || this.state === "connecting") {
      dbg("start() no-op — already", this.state);
      return;
    }
    dbg("start() called — fetching token before connect");
    this.setState("connecting");
    this.started = true;

    void loadTransportToken(this.config.tokenProvider, this.currentToken).then((token) => {
      if (this.stopped) return;
      if (hasActiveSocket(this.ws)) return;

      if (token !== undefined) this.currentToken = token;
      const url = buildRelayUrl(this.config, this.currentToken);
      this.ws = new WebSocket(url);

      attachSocketListeners(this.ws, this.events, {
        onOpen: () => {
          this.setState("connected");
          this.startHeartbeat();
        },
        onClose: () => {
          if (!this.stopped) this.scheduleReconnect();
        },
      });
    });
  }

  startPolling(): void {
    if (!this.config.tokenProvider || !this.config.tokenPollIntervalMs) return;
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.pollToken();
    }, this.config.tokenPollIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    this.clearTimers();
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.ws = closeTransportSocket(this.ws);
    this.setState("disconnected");
  }

  send(data: string): boolean {
    if (this.started && !this.stopped) {
      try {
        this.ws?.send(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  isConnected(): boolean {
    return this.state === "connected";
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
      if (newToken !== undefined && newToken !== this.currentToken) {
        this.currentToken = newToken;
        this.ws = closeTransportSocket(this.ws);
        if (!this.stopped) this.scheduleReconnect();
      }
    } catch {
      // best-effort polling
    }
  }

  private async refreshTokenAndReconnect(): Promise<void> {
    if (this.stopped) return;
    if (this.config.tokenProvider) this.currentToken = await loadTransportToken(this.config.tokenProvider, this.currentToken);
    if (!this.stopped) this.start();
  }

  private clearTimers(): void {
    clearTransportTimers({ reconnectTimer: this.reconnectTimer, heartbeatTimer: this.heartbeatTimer });
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }
}
