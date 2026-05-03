import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserRelayAction, BrowserRelayResponse } from "./types.js";
import type { SharedRelayServerOptions, HubClientInfo } from "./shared-relay-types.js";
import { WriteLeaseManager } from "./write-lease.js";
import { isAuthorizedToken } from "./relay-auth.js";
import { createPairCode } from "./shared-relay-pairing.js";
import { attachChromeConnection } from "./shared-relay-server-chrome.js";
import { attachHubConnection } from "./shared-relay-server-hub.js";
import { createSharedRelayHttpServer } from "./shared-relay-server-http.js";
import { buildConnectedHubInfo, broadcastChromeStatusToHubs, type HubSocket, pushToChrome, resolvePendingResponses, stopSharedRelayServer } from "./shared-relay-server-state.js";

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

  export class SharedBrowserRelayServer {
  private httpServer: HttpServer | null = null;
  private wsServer: WebSocketServer | null = null;
  private chromeSocket: WebSocket | null = null;
  private readonly hubs = new Map<string, HubSocket>();
  private readonly requestIdToHub = new Map<string, string>();
  private readonly pendingByHub = new Map<string, Map<string, (value: BrowserRelayResponse) => void>>();
  private readonly writeLease: WriteLeaseManager = new WriteLeaseManager({});
  /** Tracks requestIds that originated from Chrome and are awaiting a response from Hub. */
  private readonly chromeOriginatedRequestIds = new Set<string>();
  private pairCode: string | null = null;
  private pairCodeExpiry = 0;

  constructor(private readonly options: SharedRelayServerOptions) {}
  private emit(event: string, details?: Record<string, unknown>): void { this.options.onEvent?.(event, details); }

  async start(): Promise<void> {
    if (this.httpServer || this.wsServer) return;
    const thisRef = this;
    this.httpServer = createSharedRelayHttpServer(
      this.options,
      {
        get pairCode() { return thisRef.pairCode; },
        set pairCode(value: string | null) { thisRef.pairCode = value; },
        get pairCodeExpiry() { return thisRef.pairCodeExpiry; },
        set pairCodeExpiry(value: number) { thisRef.pairCodeExpiry = value; },
      },
      () => this.generatePairCode(),
      (event, details) => this.emit(event, details),
    );
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.wsServer.on("connection", (socket: WebSocket, req: IncomingMessage) => this.handleSocketConnection(socket, req));
    this.httpServer.on("error", (err) => this.emit("relay-start-error", { message: err.message }));

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
    }).catch((err: Error) => {
      this.httpServer = null;
      this.wsServer = null;
      throw err;
    });

    this.emit("relay-started", { host: this.options.host, port: this.options.port });
  }

  generatePairCode(): string {
    const { code, expiresAt } = createPairCode();
    this.pairCode = code;
    this.pairCodeExpiry = expiresAt;
    this.emit("pair-code-issued");
    return code;
  }

  private handleSocketConnection(socket: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? "/", `http://${this.options.host}:${this.options.port}`);
    const token = url.searchParams.get("token");
    const isChromePath = url.pathname === "/chrome";
    // TODO: Remove this bypass and reinstate proper pairing flow.
    if (DEV_BROWSER_PAIRING_BYPASS && isChromePath) {
      this.emit("relay-client-connected", {
        remote: req.socket.remoteAddress ?? "unknown",
        devBypass: true,
        note: "PAIRING DISABLED — DEV ONLY",
      });
    } else if (!isAuthorizedToken(token, this.options.token)) {
      this.emit("relay-unauthorized", { remote: req.socket.remoteAddress ?? "unknown" });
      socket.close(1008, "unauthorized");
      return;
    }

    if (isChromePath) {
      attachChromeConnection({
        socket,
        currentChromeSocket: this.chromeSocket,
        hubs: this.hubs,
        requestIdToHub: this.requestIdToHub,
        pendingByHub: this.pendingByHub,
        chromeOriginatedRequestIds: this.chromeOriginatedRequestIds,
        onChromeConnected: () => {
          this.chromeSocket = socket;
          broadcastChromeStatusToHubs(this.hubs, true);
        },
        onChromeDisconnected: (closedSocket) => {
          if (this.chromeSocket === closedSocket) this.chromeSocket = null;
          broadcastChromeStatusToHubs(this.hubs, false);
          this.resolvePendingWithError("browser-not-connected");
        },
        emit: (event, details) => this.emit(event, details),
      });
      return;
    }

    if (url.pathname !== "/hub") {
      socket.close(1008, "unknown path");
      return;
    }

    const hubId = url.searchParams.get("hubId");
    const label = url.searchParams.get("label") ?? undefined;
    if (!hubId) {
      socket.close(1008, "missing hubId");
      return;
    }

    attachHubConnection({
      socket,
      hubId,
      label,
      hubs: this.hubs,
      pendingByHub: this.pendingByHub,
      requestIdToHub: this.requestIdToHub,
      writeLease: this.writeLease,
      getChromeSocket: () => this.chromeSocket,
      chromeOriginatedRequestIds: this.chromeOriginatedRequestIds,
      emit: (event, details) => this.emit(event, details),
    });
  }

  private resolvePendingWithError(error: BrowserRelayResponse["error"]): void {
    resolvePendingResponses(this.pendingByHub, this.requestIdToHub, error);
  }

  getConnectedHubs(): ReadonlyMap<string, HubClientInfo> { return buildConnectedHubInfo(this.hubs); }
  isChromeConnected(): boolean { return this.chromeSocket !== null && this.chromeSocket.readyState === WebSocket.OPEN; }
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void { pushToChrome(this.chromeSocket, action, payload); }

  async stop(): Promise<void> {
    const stopped = await stopSharedRelayServer({
      chromeSocket: this.chromeSocket,
      hubs: this.hubs,
      pendingByHub: this.pendingByHub,
      wsServer: this.wsServer,
      httpServer: this.httpServer,
      onResolvedPending: () => this.resolvePendingWithError("browser-not-connected"),
    });
    this.chromeSocket = stopped.chromeSocket;
    this.wsServer = stopped.wsServer;
    this.httpServer = stopped.httpServer;
    this.emit("relay-stopped");
  }
}
