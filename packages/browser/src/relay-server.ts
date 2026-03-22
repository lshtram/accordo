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
      socket.on("message", (raw: Buffer) => {
        if (this.client !== socket) return;
        try {
          const parsed = JSON.parse(String(raw)) as BrowserRelayResponse;
          const resolve = this.pending.get(parsed.requestId);
          if (!resolve) return;
          this.pending.delete(parsed.requestId);
          resolve(parsed);
        } catch {
          // ignore invalid frames
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

  async request(action: BrowserRelayAction, payload: Record<string, unknown>, timeoutMs = 3000): Promise<BrowserRelayResponse> {
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
