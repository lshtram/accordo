/**
 * SharedBrowserRelayServer — Multiplexing relay for multiple Hub clients + one Chrome client.
 *
 * Accepts multiple Hub client WebSocket connections and one Chrome client connection.
 * Routes requests from Hub clients to Chrome, and responses back to the originating Hub.
 *
 * @module shared-relay-server
 * @see docs/10-architecture/shared-browser-relay-architecture.md §4.1
 * @see docs/20-requirements/requirements-shared-browser-relay.md §1.1
 */

import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserRelayAction, BrowserRelayRequest, BrowserRelayResponse } from "./types.js";
import type { SharedRelayServerOptions, HubClientInfo, ChromeStatusEvent } from "./shared-relay-types.js";
import { WriteLeaseManager } from "./write-lease.js";
import { MUTATING_ACTIONS } from "./shared-relay-types.js";
import { isAuthorizedToken } from "./relay-auth.js";

interface HubSocket {
  socket: WebSocket;
  hubId: string;
  label?: string;
}

export class SharedBrowserRelayServer {
  private readonly options: SharedRelayServerOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wsServer: WebSocketServer | null = null;
  private chromeSocket: WebSocket | null = null;

  /** Map of hubId → HubSocket */
  private readonly hubs = new Map<string, HubSocket>();

  /** Map of requestId → hubId for routing responses */
  private readonly requestIdToHub = new Map<string, string>();

  /** Map of hubId → pending request resolve functions */
  private readonly pendingByHub = new Map<string, Map<string, (value: BrowserRelayResponse) => void>>();

  private readonly writeLease: WriteLeaseManager;
  private chromeConnected = false;

  constructor(options: SharedRelayServerOptions) {
    this.options = options;
    this.writeLease = new WriteLeaseManager({});
  }

  private emit(event: string, details?: Record<string, unknown>): void {
    this.options.onEvent?.(event, details);
  }

  /**
   * SBR-F-001, SBR-F-002: Start the WebSocket server and begin accepting connections.
   */
  async start(): Promise<void> {
    if (this.httpServer || this.wsServer) return;

    this.httpServer = createServer();
    this.wsServer = new WebSocketServer({ server: this.httpServer });

    this.wsServer.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", `http://${this.options.host}:${this.options.port}`);
      const token = url.searchParams.get("token");

      // AUTH-04: Unified auth validation — delegate to isAuthorizedToken()
      if (!isAuthorizedToken(token, this.options.token)) {
        this.emit("relay-unauthorized", { remote: req.socket.remoteAddress ?? "unknown" });
        socket.close(1008, "unauthorized");
        return;
      }

      const path = url.pathname;
      if (path === "/chrome") {
        this.handleChromeConnection(socket);
      } else if (path === "/hub") {
        const hubId = url.searchParams.get("hubId");
        const label = url.searchParams.get("label") ?? undefined;
        if (!hubId) {
          socket.close(1008, "missing hubId");
          return;
        }
        this.handleHubConnection(socket, hubId, label);
      } else {
        socket.close(1008, "unknown path");
      }
    });

    this.httpServer.on("error", (err) => {
      this.emit("relay-start-error", { message: err.message });
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
    }).catch((err: Error) => {
      // Clean up server state on failure
      this.httpServer = null;
      this.wsServer = null;
      throw err;
    });

    this.emit("relay-started", { host: this.options.host, port: this.options.port });
  }

  private handleChromeConnection(socket: WebSocket): void {
    // SBR-F-002: exactly one Chrome client — new replaces previous
    if (this.chromeSocket && this.chromeSocket !== socket) {
      this.chromeSocket.close(1000, "replaced");
    }
    this.chromeSocket = socket;
    this.chromeConnected = true;

    const remote = (socket as WebSocket & { remoteAddress?: string }).remoteAddress;
    this.emit("chrome-connected", { remote: remote ?? "unknown" });
    this.broadcastChromeStatus(true);

    socket.on("message", (raw: Buffer) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      // Distinguish response vs. request
      if (typeof parsed["success"] !== "undefined") {
        // Chrome → Hub: response to a pending request
        const requestId = parsed["requestId"] as string | undefined;
        if (!requestId) return;
        const hubId = this.requestIdToHub.get(requestId);
        if (!hubId) return;
        this.requestIdToHub.delete(requestId);

        const pendingMap = this.pendingByHub.get(hubId);
        if (pendingMap) {
          const resolve = pendingMap.get(requestId);
          if (resolve) {
            pendingMap.delete(requestId);
            resolve({
              requestId,
              success: parsed["success"] as boolean,
              data: parsed["data"],
              error: parsed["error"] as BrowserRelayResponse["error"],
            });
          }
        }
        return;
      }

      // Chrome → Hub: incoming event (BrowserRelayRequest without hubId)
      // SBR-F-006: route to specific Hub (if hubId present) or broadcast to all Hubs
      if (typeof parsed["action"] === "string") {
        const hubId = parsed["hubId"] as string | undefined;
        this.emit("chrome-event", { action: parsed["action"], hubId });
        if (hubId) {
          // SBR-F-006: directed event → route to specific Hub
          const hub = this.hubs.get(hubId);
          if (hub && hub.socket.readyState === WebSocket.OPEN) {
            hub.socket.send(JSON.stringify(parsed));
          }
        } else {
          // SBR-F-006: broadcast → send to all Hub sockets
          for (const [, h] of this.hubs) {
            if (h.socket.readyState === WebSocket.OPEN) {
              h.socket.send(JSON.stringify(parsed));
            }
          }
        }
      }
    });

    socket.on("close", () => {
      if (this.chromeSocket === socket) {
        this.chromeSocket = null;
        this.chromeConnected = false;
      }
      this.emit("chrome-disconnected");
      this.broadcastChromeStatus(false);
      // Resolve all pending requests
      this.resolvePendingWithError("browser-not-connected");
    });
  }

  private handleHubConnection(socket: WebSocket, hubId: string, label?: string): void {
    // SBR-F-007: clean up any prior connection from same hubId
    const prior = this.hubs.get(hubId);
    if (prior) {
      prior.socket.close(1000, "replaced");
    }

    const hubSocket: HubSocket = { socket, hubId, label };
    this.hubs.set(hubId, hubSocket);
    this.pendingByHub.set(hubId, new Map());

    this.emit("hub-connected", { hubId, label });

    // SBR-F-003: send registration acknowledgement
    const ack = { kind: "hub-register-ack" as const, hubId, chromeConnected: this.chromeSocket !== null };
    socket.send(JSON.stringify(ack));

    socket.on("message", (raw: Buffer) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const action = parsed["action"] as BrowserRelayAction | undefined;
      if (!action) return;

      // SBR-F-011: hubId must be present in SharedRelayRequest and must match this hub's id
      const parsedHubId = parsed["hubId"];
      if (typeof parsedHubId !== "string" || parsedHubId !== hubId) return;
      const requestId = (parsed["requestId"] as string | undefined) ?? randomUUID();

      // SBR-F-011: Check write lease for mutating actions before forwarding
      const isMutating = MUTATING_ACTIONS.includes(action as (typeof MUTATING_ACTIONS)[number]);

      const doForward = async (): Promise<void> => {
        // SBR-F-004: store requestId → hubId mapping AND register resolve in pendingByHub
        this.requestIdToHub.set(requestId, hubId);
        const pendingMap = this.pendingByHub.get(hubId);
        if (pendingMap) {
          pendingMap.set(requestId, (response: BrowserRelayResponse) => {
            // Send response back to this hub socket
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(response));
            }
            // Release write lease after Chrome response is sent back
            if (isMutating) {
              this.writeLease.release(hubId);
            }
          });
        }

        // SBR-F-005: strip hubId before forwarding to Chrome
        const chromeRequest: BrowserRelayRequest = {
          requestId,
          action,
          payload: (parsed["payload"] as Record<string, unknown>) ?? {},
        };

        // Forward to Chrome
        if (this.chromeSocket && this.chromeSocket.readyState === WebSocket.OPEN) {
          this.chromeSocket.send(JSON.stringify(chromeRequest));
        } else {
          // Chrome not connected — resolve immediately with error
          if (pendingMap) {
            const resolve = pendingMap.get(requestId);
            if (resolve) {
              pendingMap.delete(requestId);
              resolve({ requestId, success: false, error: "browser-not-connected" });
            }
          }
          this.requestIdToHub.delete(requestId);
          if (isMutating) {
            this.writeLease.release(hubId);
          }
        }
      };

      if (isMutating) {
        // Block until write lease is acquired, then forward
        (async () => {
          try {
            await this.writeLease.acquire(hubId);
          } catch {
            // Queue full — reject immediately
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ requestId, success: false, error: "action-failed" }));
            }
            return;
          }
          await doForward();
        })();
      } else {
        // Non-mutating: forward immediately
        doForward().catch(() => { /* best-effort */ });
      }
    });

    socket.on("close", () => {
      this.hubs.delete(hubId);
      this.pendingByHub.delete(hubId);
      this.emit("hub-disconnected", { hubId });
      // SBR-F-007: release write lease for this Hub
      this.writeLease.releaseAll(hubId);
    });
  }

  private broadcastChromeStatus(connected: boolean): void {
    const event: ChromeStatusEvent = { kind: "chrome-status", connected };
    for (const [, hub] of this.hubs) {
      if (hub.socket.readyState === WebSocket.OPEN) {
        hub.socket.send(JSON.stringify(event));
      }
    }
  }

  private resolvePendingWithError(error: BrowserRelayResponse["error"]): void {
    for (const [, pendingMap] of this.pendingByHub) {
      for (const [requestId, resolve] of pendingMap) {
        resolve({ requestId, success: false, error });
      }
      pendingMap.clear();
    }
    this.requestIdToHub.clear();
  }

  /**
   * SBR-F-003: Return metadata for all currently connected Hub clients.
   */
  getConnectedHubs(): ReadonlyMap<string, HubClientInfo> {
    const result = new Map<string, HubClientInfo>();
    for (const [hubId, hub] of this.hubs) {
      result.set(hubId, {
        hubId,
        label: hub.label,
        connectedAt: new Date().toISOString(),
      });
    }
    return result;
  }

  /**
   * SBR-F-002: Check if Chrome is currently connected.
   */
  isChromeConnected(): boolean {
    return this.chromeSocket !== null && this.chromeSocket.readyState === WebSocket.OPEN;
  }

  /**
   * Fire-and-forget push to the connected Chrome client.
   * Used by the Owner VSCode to notify Chrome of comment mutations so Chrome
   * can refresh its popup without subscribing to all document-change events.
   */
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void {
    if (!this.chromeSocket || this.chromeSocket.readyState !== WebSocket.OPEN) return;
    const requestId = randomUUID();
    this.chromeSocket.send(JSON.stringify({ requestId, action, payload }));
  }

  /**
   * Stop the server and close all connections.
   * Pending requests resolve with `browser-not-connected`.
   */
  async stop(): Promise<void> {
    this.resolvePendingWithError("browser-not-connected");

    if (this.chromeSocket) {
      const cs = this.chromeSocket;
      this.chromeSocket = null;
      cs.close();
    }

    for (const [, hub] of this.hubs) {
      hub.socket.close(1000, "server-shutdown");
    }
    this.hubs.clear();
    this.pendingByHub.clear();

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
}
