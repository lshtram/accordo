import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserRelayAction, BrowserRelayLike, BrowserRelayResponse } from "./types.js";
import { isAuthorizedToken } from "./relay-auth.js";
import { pushToBrowserClient, requestFromBrowserClient } from "./relay-server-requests.js";
import { DEFAULT_RELAY_REQUEST_TIMEOUT_MS } from "./relay-transport-constants.js";

/**
 * DEV-BYPASS-FLAG — Temporary insecure dev-only pairing bypass.
 *
 * When true, /chrome WebSocket connections are accepted without a relay token.
 * /hub connections remain token-protected.
 *
 * TODO: Remove this flag and reinstate redesigned pairing flow before any
 * production release. This is intentionally insecure and must never be
 * enabled outside of local development environments.
 */
const DEV_BROWSER_PAIRING_BYPASS = process.env.NODE_ENV !== "test";

interface RelayServerOptions {
  port: number;
  host: string;
  token: string;
  onEvent?: (event: string, details?: Record<string, unknown>) => void;
  onRelayRequest?: BrowserRelayLike["onRelayRequest"];
}

export class BrowserRelayServer implements BrowserRelayLike {
  private httpServer: HttpServer | null = null;
  private wsServer: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pending = new Map<string, (value: BrowserRelayResponse) => void>();
  onError?: (error: string) => void;

  constructor(private readonly options: RelayServerOptions) {}

  private emit(event: string, details?: Record<string, unknown>): void {
    this.options.onEvent?.(event, details);
  }

  async start(): Promise<void> {
    if (this.httpServer || this.wsServer) return;

    this.httpServer = createServer();
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.emit("relay-starting", { host: this.options.host, port: this.options.port });
    this.httpServer.on("error", (err) => this.emit("relay-start-error", { message: err.message }));

    this.wsServer.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", `http://${this.options.host}:${this.options.port}`);
      const path = url.pathname.replace(/\/$/, "");
      const token = DEV_BROWSER_PAIRING_BYPASS && path === "/chrome"
        ? null
        : url.searchParams.get("token");

      // TODO: Remove this bypass and reinstate proper pairing flow.
      if (DEV_BROWSER_PAIRING_BYPASS && path === "/chrome") {
        if (this.client && this.client !== socket) this.client.close(1000, "replaced");
        this.client = socket;
        this.emit("relay-client-connected", {
          remote: req.socket.remoteAddress ?? "unknown",
          devBypass: true,
          note: "PAIRING DISABLED — DEV ONLY",
        });
      } else {
        if (!isAuthorizedToken(token, this.options.token)) {
          this.emit("relay-unauthorized", { remote: req.socket.remoteAddress ?? "unknown" });
          socket.close(1008, "unauthorized");
          return;
        }
        if (this.client && this.client !== socket) this.client.close(1000, "replaced");
        this.client = socket;
        this.emit("relay-client-connected", { remote: req.socket.remoteAddress ?? "unknown" });
      }
      socket.on("message", (raw: Buffer): void => {
        void (async (): Promise<void> => {
          if (this.client !== socket) return;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(String(raw)) as Record<string, unknown>;
          } catch {
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
            return;
          }

          if (typeof parsed["action"] === "string" && this.options.onRelayRequest) {
            const requestId = (parsed["requestId"] as string | undefined) ?? "";
            const result = await this.options.onRelayRequest(
              parsed["action"] as Parameters<typeof this.options.onRelayRequest>[0],
              (parsed["payload"] as Record<string, unknown>) ?? {},
            );
            socket.send(JSON.stringify({ ...result, requestId }));
          }
        })().catch(() => {});
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
    for (const resolve of this.pending.values()) resolve({ requestId: "", success: false, error: "browser-not-connected" });
    this.pending.clear();

    if (this.client) {
      const clientSocket = this.client;
      this.client = null;
      clientSocket.close();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
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

  getDebuggerUrl(): string | undefined {
    return undefined;
  }
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void {
    pushToBrowserClient(this.client, action, payload);
  }

  async request(action: BrowserRelayAction, payload: Record<string, unknown>, timeoutMs = DEFAULT_RELAY_REQUEST_TIMEOUT_MS): Promise<BrowserRelayResponse> {
    return await requestFromBrowserClient(
      this.client,
      action,
      payload,
      this.pending,
      () => {
        this.emit("relay-request-disconnected", { action });
        this.onError?.("browser-not-connected");
      },
      () => this.onError?.("timeout"),
      timeoutMs,
    );
  }
}
