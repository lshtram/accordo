import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserRelayAction, BrowserRelayLike, BrowserRelayRequest, BrowserRelayResponse } from "./types.js";
import { isAuthorizedToken } from "./relay-auth.js";

interface RelayServerOptions {
  port: number;
  host: string;
  token: string;
  onEvent?: (event: string, details?: Record<string, unknown>) => void;
  /** If set, relay.request() calls this instead of forwarding to Chrome */
  onRelayRequest?: BrowserRelayLike["onRelayRequest"];
}

export class BrowserRelayServer implements BrowserRelayLike {
  private readonly options: RelayServerOptions;
  private httpServer: HttpServer | null = null;
  private wsServer: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pending = new Map<string, (value: BrowserRelayResponse) => void>();

  constructor(options: RelayServerOptions) {
    this.options = options;
  }

  private emit(event: string, details?: Record<string, unknown>): void {
    this.options.onEvent?.(event, details);
  }

  async start(): Promise<void> {
    if (this.httpServer || this.wsServer) return;

    this.httpServer = createServer();
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.emit("relay-starting", { host: this.options.host, port: this.options.port });
    this.httpServer.on("error", (err) => {
      this.emit("relay-start-error", { message: err.message });
    });

    this.wsServer.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", `http://${this.options.host}:${this.options.port}`);
      const token = url.searchParams.get("token");
      if (!isAuthorizedToken(token, this.options.token)) {
        this.emit("relay-unauthorized", { remote: req.socket.remoteAddress ?? "unknown" });
        socket.close(1008, "unauthorized");
        return;
      }

      if (this.client && this.client !== socket) {
        this.client.close(1000, "replaced");
      }
      this.client = socket;
      this.emit("relay-client-connected", { remote: req.socket.remoteAddress ?? "unknown" });
      socket.on("message", async (raw: Buffer) => {
        if (this.client !== socket) return;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(String(raw)) as Record<string, unknown>;
        } catch {
          return;
        }

        // Incoming message from Chrome has an `action` field (BrowserRelayRequest).
        // Outgoing response from Chrome to our own pending call has a `success` field.
        if (typeof parsed["action"] === "string" && this.options.onRelayRequest) {
          // Chrome → VS Code: route through onRelayRequest interceptor
          // Echo the requestId so the caller can match the response to a pending promise
          const requestId = (parsed["requestId"] as string | undefined) ?? "";
          const result = await this.options.onRelayRequest(
            parsed["action"] as Parameters<typeof this.options.onRelayRequest>[0],
            (parsed["payload"] as Record<string, unknown>) ?? {},
          );
          socket.send(JSON.stringify({ ...result, requestId }));
          return;
        }

        if (typeof parsed["success"] !== "undefined") {
          // Chrome → VS Code: response to our own pending request
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
      socket.on("close", () => {
        if (this.client === socket) this.client = null;
        this.emit("relay-client-disconnected");
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        this.httpServer?.off("error", onError);
        reject(err);
      };
      this.httpServer?.once("error", onError);
      this.httpServer?.listen(this.options.port, this.options.host, () => {
        this.httpServer?.off("error", onError);
        resolve();
      });
    });
    this.emit("relay-started", { host: this.options.host, port: this.options.port });
  }

  async stop(): Promise<void> {
    for (const resolve of this.pending.values()) {
      resolve({ requestId: "", success: false, error: "browser-not-connected" });
    }
    this.pending.clear();

    if (this.client) {
      this.client.close();
      this.client = null;
    }
    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => resolve());
      });
      this.httpServer = null;
    }
    this.emit("relay-stopped");
  }

  isConnected(): boolean {
    return !!this.client && this.client.readyState === WebSocket.OPEN;
  }

  /**
   * Fire-and-forget push to the connected Chrome client.
   * Sends a frame directly over the WebSocket without registering a pending
   * promise — no response is expected. Safe to call from within onRelayRequest
   * because it bypasses the interceptor entirely.
   */
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
    const requestId = randomUUID();
    this.client.send(JSON.stringify({ requestId, action, payload }));
  }

  async request(action: BrowserRelayAction, payload: Record<string, unknown>, timeoutMs = 3000): Promise<BrowserRelayResponse> {
    // Short-circuit: if the extension set an interceptor (used to route Chrome
    // events through unified comment_* tools), call it directly.
    if (this.options.onRelayRequest) {
      return this.options.onRelayRequest(action, payload);
    }

    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      this.emit("relay-request-disconnected", { action });
      return { requestId: "", success: false, error: "browser-not-connected" };
    }

    const requestId = randomUUID();
    const envelope: BrowserRelayRequest = { requestId, action, payload };

    const response = await new Promise<BrowserRelayResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ requestId, success: false, error: "timeout" });
      }, timeoutMs);

      this.pending.set(requestId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });

      this.client?.send(JSON.stringify(envelope));
    });

    return response;
  }
}
