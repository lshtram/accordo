import type { BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse } from "./types.js";
import type { SharedRelayClientOptions } from "./shared-relay-types.js";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { pushViaSharedRelay, requestViaSharedRelay } from "./shared-relay-client-requests.js";

export class SharedRelayClient implements BrowserRelayLike {
  onError?: (error: string) => void;
  onRelayRequest?: (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse>;
  private ws: WebSocket | null = null;
  private relayConnected = false;
  private chromeConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isStopping = false;
  private readonly pending = new Map<string, (value: BrowserRelayResponse) => void>();

  constructor(private readonly options: SharedRelayClientOptions) {
    if (options.onRelayRequest) this.onRelayRequest = options.onRelayRequest;
  }

  private emit(event: string, details?: Record<string, unknown>): void {
    this.options.onEvent?.(event, details);
  }

  private get wsUrl(): string {
    const { host, port, hubId, token } = this.options;
    const labelQuery = this.options.label ? `&label=${encodeURIComponent(this.options.label)}` : "";
    return `ws://${host}:${port}/hub?hubId=${hubId}&token=${token}${labelQuery}`;
  }

  start(): void {
    if (this.ws) return;
    this.connect();
  }

  private connect(): void {
    this.isStopping = false;
    this.ws = new WebSocket(this.wsUrl);
    if (typeof this.ws.on !== "function") return;

    this.ws.on("open", () => {
      this.relayConnected = true;
      this.emit("relay-connected", { hubId: this.options.hubId });
    });

    this.ws.on("message", (raw: Buffer) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (parsed["kind"] === "hub-register-ack") {
        this.chromeConnected = parsed["chromeConnected"] === true;
        this.emit("chrome-status", { connected: this.chromeConnected, source: "ack" });
        return;
      }

      if (parsed["kind"] === "chrome-status") {
        this.chromeConnected = parsed["connected"] === true;
        this.emit("chrome-status", { connected: this.chromeConnected, source: "event" });
        return;
      }

      if (typeof parsed["action"] === "string" && this.onRelayRequest) {
        const action = parsed["action"] as BrowserRelayAction;
        const payload = (parsed["payload"] as Record<string, unknown>) ?? {};
        const requestId = (parsed["requestId"] as string | undefined) ?? randomUUID();
        void this.onRelayRequest(action, payload)
          .then((result) => {
            this.ws?.send(JSON.stringify({ ...result, requestId }));
          })
          .catch(() => {
            this.ws?.send(JSON.stringify({ success: false, error: "action-failed", requestId }));
          });
        return;
      }

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
      this.relayConnected = false;
      this.chromeConnected = false;
      this.ws = null;
      this.emit("relay-disconnected", { hubId: this.options.hubId });
      this.emit("chrome-status", { connected: false, source: "close" });
      if (!this.isStopping) this.scheduleReconnect();
    });

    this.ws.on("error", () => {});
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.ws === null) this.connect();
    }, 2000);
  }

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
    this.relayConnected = false;
    this.chromeConnected = false;
    for (const resolve of this.pending.values()) resolve({ requestId: "", success: false, error: "browser-not-connected" });
    this.pending.clear();
  }

  async request(action: BrowserRelayAction, payload: Record<string, unknown>, timeoutMs: number = 3000): Promise<BrowserRelayResponse> {
    return await requestViaSharedRelay(this.ws, this.options.hubId, action, payload, this.pending, this.onError, timeoutMs);
  }

  push(action: BrowserRelayAction, payload: Record<string, unknown>): void {
    pushViaSharedRelay(this.ws, this.options.hubId, action, payload);
  }

  isConnected(): boolean {
    return this.relayConnected && this.chromeConnected;
  }
  isRelayConnected(): boolean {
    return this.relayConnected;
  }
}
