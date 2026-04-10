/**
 * SharedRelayClient — Hub-side client implementing BrowserRelayLike.
 *
 * Connects to a SharedBrowserRelayServer as a Hub client. All browser tools
 * consume this via the unchanged BrowserRelayLike interface — they are unaware
 * of the shared relay model.
 *
 * @module shared-relay-client
 * @see docs/10-architecture/shared-browser-relay-architecture.md §4.2
 * @see docs/20-requirements/requirements-shared-browser-relay.md §1.2
 */

import type { BrowserRelayAction, BrowserRelayLike, BrowserRelayRequest, BrowserRelayResponse } from "./types.js";
import type { SharedRelayClientOptions, ChromeStatusEvent, SharedRelayRequest } from "./shared-relay-types.js";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

export class SharedRelayClient implements BrowserRelayLike {
  /** Optional error listener — called whenever the relay returns an error response. */
  onError?: (error: string) => void;

  /** Optional interceptor for Chrome→Hub events. */
  onRelayRequest?: (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse>;

  private readonly options: SharedRelayClientOptions;
  private ws: WebSocket | null = null;
  private chromeConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set to true during stop() so the close handler doesn't schedule a reconnect */
  private isStopping = false;

  /** Map of requestId → resolve function */
  private readonly pending = new Map<string, (value: BrowserRelayResponse) => void>();

  constructor(options: SharedRelayClientOptions) {
    this.options = options;
    if (options.onRelayRequest) {
      this.onRelayRequest = options.onRelayRequest;
    }
  }

  private get wsUrl(): string {
    const { host, port, hubId, token } = this.options;
    return `ws://${host}:${port}/hub?hubId=${hubId}&token=${token}`;
  }

  /**
   * SBR-F-013: Open WebSocket connection to the shared relay.
   * Auto-reconnects on disconnect with a 2s timer.
   */
  start(): void {
    if (this.ws) return;
    this.connect();
  }

  private connect(): void {
    this.isStopping = false;
    const url = this.wsUrl;
    this.ws = new WebSocket(url);

    // Defensive: some test environments use minimal WS mocks without .on
    if (typeof this.ws.on !== "function") return;

    this.ws.on("open", () => {
      // SBR-F-003: send HubClientRegistration immediately after connect
      this.ws?.send(JSON.stringify({ kind: "hub-register", hubId: this.options.hubId, label: this.options.label }));
    });

    this.ws.on("message", (raw: Buffer) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      // SBR-F-014: ChromeStatusEvent handling
      if (typeof parsed["kind"] === "string" && parsed["kind"] === "chrome-status") {
        const connected = parsed["connected"];
        this.chromeConnected = typeof connected === "boolean" ? connected : false;
        return;
      }

      // SBR-F-015: Chrome→Hub event routing via onRelayRequest
      if (typeof parsed["action"] === "string" && this.onRelayRequest) {
        const action = parsed["action"] as BrowserRelayAction;
        const payload = (parsed["payload"] as Record<string, unknown>) ?? {};
        const requestId = (parsed["requestId"] as string | undefined) ?? randomUUID();
        void this.onRelayRequest(action, payload)
          .then((result) => {
            // Send response back to server (which routes to Chrome)
            this.ws?.send(JSON.stringify({ ...result, requestId }));
          })
          .catch(() => {
            // Send explicit failure so Chrome doesn't hang on a pending request
            const failResponse = { success: false, error: "action-failed", requestId };
            this.ws?.send(JSON.stringify(failResponse));
          });
        return;
      }

      // Hub → Chrome: response to our own pending request
      if (typeof parsed["success"] !== "undefined") {
        const requestId = parsed["requestId"] as string | undefined;
        if (!requestId) return;
        const resolve = this.pending.get(requestId);
        if (!resolve) return;
        this.pending.delete(requestId);
        resolve({
          requestId,
          success: parsed["success"] as boolean,
          data: parsed["data"],
          error: parsed["error"] as BrowserRelayResponse["error"],
        });
      }
    });

    this.ws.on("close", () => {
      this.chromeConnected = false;
      this.ws = null;
      // Only schedule reconnect if this was not an explicit stop()
      if (!this.isStopping) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", () => {
      // Errors are followed by close events — handle in close handler
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.ws === null) {
        this.connect();
      }
    }, 2000);
  }

  /**
   * Close the WebSocket connection and stop reconnection attempts.
   */
  stop(): void {
    this.isStopping = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
    // Resolve all pending with browser-not-connected
    for (const resolve of this.pending.values()) {
      resolve({ requestId: "", success: false, error: "browser-not-connected" });
    }
    this.pending.clear();
  }

  /**
   * SBR-F-010, SBR-F-011: Send a request through the shared relay to Chrome.
   * The request envelope includes `hubId` for response routing.
   *
   * @param action - The browser relay action to perform
   * @param payload - Action-specific parameters
   * @param timeoutMs - Request timeout in milliseconds (default: 3000)
   * @returns The response from Chrome, routed back via the shared relay
   */
  async request(
    action: BrowserRelayAction,
    payload: Record<string, unknown>,
    timeoutMs: number = 3000,
  ): Promise<BrowserRelayResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.onError?.("browser-not-connected");
      return { requestId: "", success: false, error: "browser-not-connected" };
    }

    const requestId = randomUUID();
    const envelope: SharedRelayRequest = { requestId, action, payload, hubId: this.options.hubId };

    const response = await new Promise<BrowserRelayResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.onError?.("timeout");
        resolve({ requestId, success: false, error: "timeout" });
      }, timeoutMs);

      this.pending.set(requestId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });

      this.ws?.send(JSON.stringify(envelope));
    });

    return response;
  }

  /**
   * SBR-F-010: Fire-and-forget push through the shared relay to Chrome.
   *
   * @param action - The browser relay action
   * @param payload - Action-specific parameters
   */
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const requestId = randomUUID();
    const envelope: SharedRelayRequest = { requestId, action, payload, hubId: this.options.hubId };
    this.ws.send(JSON.stringify(envelope));
  }

  /**
   * SBR-F-012: Returns true only when:
   * 1. The WebSocket to the shared relay is OPEN, AND
   * 2. Chrome is reported connected (via ChromeStatusEvent)
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.chromeConnected;
  }
}
