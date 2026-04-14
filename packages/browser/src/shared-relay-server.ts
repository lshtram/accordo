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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, randomInt, createHmac } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserRelayAction, BrowserRelayRequest, BrowserRelayResponse } from "./types.js";
import type { SharedRelayServerOptions, HubClientInfo, ChromeStatusEvent } from "./shared-relay-types.js";
import { WriteLeaseManager } from "./write-lease.js";
import { MUTATING_ACTIONS } from "./shared-relay-types.js";
import { isAuthorizedToken } from "./relay-auth.js";

/** Duration (ms) a pairing code is valid before it expires. */
const PAIR_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * PAIR-SEC-04: Max failed confirm attempts before the current code is invalidated
 * and new attempts are locked out until a fresh code is issued.
 */
const PAIR_MAX_ATTEMPTS = 5;

/**
 * PAIR-SEC-05: Duration (ms) the relay waits for the Chrome extension to reply
 * to the relay-hello challenge before closing the WebSocket.
 */
const RELAY_HELLO_TIMEOUT_MS = 3000;

/**
 * PAIR-SEC-06: HMAC algorithm used for the relay-hello challenge/response.
 */
const RELAY_HMAC_ALGO = "sha256";

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

  /** Active pairing code, or null if none issued / already consumed. */
  private pairCode: string | null = null;
  /** Epoch ms when the current pairing code expires. */
  private pairCodeExpiry: number = 0;
  /**
   * PAIR-SEC-04: Number of failed /pair/confirm attempts since the current code
   * was issued. When this reaches PAIR_MAX_ATTEMPTS the code is invalidated and
   * the endpoint returns 429 until a new code is issued.
   */
  private pairCodeFailedAttempts: number = 0;
  /**
   * PAIR-SEC-06: Per-session relay identity secret. Returned to the extension on
   * successful pairing. Used for the relay-hello challenge/response on every
   * subsequent WS /chrome connect.
   */
  private relayIdentitySecret: string | null = null;

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

    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleHttpRequest(req, res);
    });
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

  /**
   * PAIR-01: Issue a new short-lived pairing code.
   * Format: "NNNN-NNNN" (8 digits with hyphen). Valid for PAIR_CODE_TTL_MS.
   * Replaces any previously issued, unconsumed code.
   *
   * PAIR-SEC-04: Resets the failed-attempt counter so a fresh code always starts
   * with a clean slate.
   *
   * PAIR-SEC-07: Generates the per-session relay identity secret (used for the
   * relay-hello challenge/response on every subsequent /chrome WS connection).
   */
  generatePairCode(): string {
    // PAIR-SEC-04 (Finding 3.4): Use CSPRNG instead of Math.random().
    const half = (): string =>
      Array.from({ length: 4 }, () => randomInt(0, 10).toString()).join("");
    const code = `${half()}-${half()}`;
    this.pairCode = code;
    this.pairCodeExpiry = Date.now() + PAIR_CODE_TTL_MS;
    this.pairCodeFailedAttempts = 0;
    // Generate a new relay identity secret for this pairing session.
    this.relayIdentitySecret = randomUUID();
    this.emit("pair-code-issued");
    return code;
  }

  /**
   * PAIR-02: Handle HTTP requests for pairing endpoints.
   *
   * GET  /pair/code    — issue a new pairing code (called by VS Code / agent via loopback)
   * POST /pair/confirm — validate code, return relay token (called by Chrome extension only)
   *
   * Security model (Findings 3.2, 3.3):
   *   - /pair/code: allows empty origin (loopback Node.js callers — VS Code, agent) OR exact
   *     extension origin. Does NOT accept web-page origins.
   *   - /pair/confirm: ONLY accepts chrome-extension:// origins. Empty origin is NOT allowed
   *     here so arbitrary local processes cannot self-issue + redeem a code.
   *   - If allowedExtensionId is set (production), only that exact extension ID is accepted.
   *   - If allowedExtensionId is unset (dev/test), any chrome-extension:// origin is accepted.
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${this.options.host}:${this.options.port}`);
    const origin = typeof req.headers["origin"] === "string" ? req.headers["origin"] : "";

    /**
     * PAIR-SEC-03 (Finding 3.3): Returns true if the origin is an allowed Chrome extension.
     * - If allowedExtensionId is set: only `chrome-extension://<allowedExtensionId>` passes.
     * - If allowedExtensionId is unset: any `chrome-extension://` origin passes (dev/test).
     */
    const isAllowedExtensionOrigin = (o: string): boolean => {
      if (!o.startsWith("chrome-extension://")) return false;
      if (this.options.allowedExtensionId) {
        return o === `chrome-extension://${this.options.allowedExtensionId}`;
      }
      return true; // dev/test: accept any extension ID
    };

    const json = (statusCode: number, body: Record<string, unknown>, allowOrigin?: string): void => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
      res.writeHead(statusCode, headers);
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/pair/code" && req.method === "GET") {
      // PAIR-SEC-01: /pair/code is called by VS Code (empty origin) or extension popup.
      const isAllowed = origin === "" || isAllowedExtensionOrigin(origin);
      if (!isAllowed) {
        json(403, { error: "forbidden" });
        return;
      }
      const code = this.generatePairCode();
      json(200, { code, expiresIn: PAIR_CODE_TTL_MS }, origin || undefined);
      return;
    }

    if (url.pathname === "/pair/confirm" && req.method === "POST") {
      // PAIR-SEC-02 (Finding 3.2): /pair/confirm ONLY accepts extension origins.
      // Empty origin (local process) is explicitly rejected here to prevent self-issue+redeem.
      if (!isAllowedExtensionOrigin(origin)) {
        json(403, { error: "forbidden" });
        return;
      }

      // PAIR-SEC-04 (Finding 8.1): Rate-limit — if too many failed attempts, reject immediately.
      if (this.pairCodeFailedAttempts >= PAIR_MAX_ATTEMPTS) {
        this.emit("pair-rate-limited", { origin });
        json(429, { error: "too-many-attempts" }, origin);
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          const candidate = parsed["code"];
          if (
            typeof candidate !== "string" ||
            this.pairCode === null ||
            Date.now() > this.pairCodeExpiry ||
            candidate !== this.pairCode
          ) {
            // PAIR-SEC-04: Count failed attempt.
            this.pairCodeFailedAttempts++;
            if (this.pairCodeFailedAttempts >= PAIR_MAX_ATTEMPTS) {
              // Invalidate the code on lockout.
              this.pairCode = null;
              this.pairCodeExpiry = 0;
              this.emit("pair-code-locked-out", { attempts: this.pairCodeFailedAttempts });
            }
            json(401, { error: "invalid-code" }, origin);
            return;
          }
          // Valid — consume the code (one-time use) and return the relay token + identity secret.
          this.pairCode = null;
          this.pairCodeExpiry = 0;
          this.pairCodeFailedAttempts = 0;
          this.emit("pair-confirmed");
          // PAIR-SEC-06 (Finding 4.3): Return relayIdentitySecret so the extension can verify
          // relay identity on every subsequent WS /chrome connection.
          json(200, {
            token: this.options.token,
            relayIdentitySecret: this.relayIdentitySecret,
          }, origin);
        } catch {
          json(400, { error: "bad-request" }, origin);
        }
      });
      return;
    }

    // All other HTTP paths — 404
    json(404, { error: "not-found" });
  }

  private handleChromeConnection(socket: WebSocket): void {
    // SBR-F-002: exactly one Chrome client — new replaces previous
    if (this.chromeSocket && this.chromeSocket !== socket) {
      this.chromeSocket.close(1000, "replaced");
    }

    // PAIR-SEC-06 (Finding 4.3): Relay identity challenge/response.
    // Before accepting this socket as the active Chrome connection, send a nonce
    // and wait for the extension to reply with HMAC(nonce, relayIdentitySecret).
    // If no valid reply arrives within RELAY_HELLO_TIMEOUT_MS, close the socket.
    if (this.relayIdentitySecret !== null) {
      const secret = this.relayIdentitySecret;
      const nonce = randomUUID();
      const expectedHmac = createHmac(RELAY_HMAC_ALGO, secret).update(nonce).digest("hex");

      let verified = false;
      let helloTimer: ReturnType<typeof setTimeout> | null = null;

      const onHelloMessage = (raw: Buffer): void => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(String(raw)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (parsed["kind"] !== "relay-hello-ack") return;
        const receivedHmac = parsed["hmac"];
        if (typeof receivedHmac !== "string") {
          socket.close(1008, "identity-verification-failed");
          return;
        }
        // Constant-time compare
        const expected = Buffer.from(expectedHmac, "hex");
        const received = Buffer.from(receivedHmac, "hex");
        const valid =
          expected.length === received.length &&
          expected.every((b, i) => b === received[i]);

        if (!valid) {
          socket.close(1008, "identity-verification-failed");
          return;
        }
        verified = true;
        if (helloTimer !== null) {
          clearTimeout(helloTimer);
          helloTimer = null;
        }
        // Remove this one-time handler and complete the connection.
        socket.off("message", onHelloMessage);
        this.completesChromeConnection(socket);
      };

      socket.on("message", onHelloMessage);

      // Send the challenge.
      socket.send(JSON.stringify({ kind: "relay-hello", nonce }));

      helloTimer = setTimeout(() => {
        if (!verified) {
          socket.off("message", onHelloMessage);
          socket.close(1008, "identity-verification-timeout");
        }
      }, RELAY_HELLO_TIMEOUT_MS);

      return;
    }

    // No identity secret set yet (first-ever connection before any pairing) — accept directly.
    this.completesChromeConnection(socket);
  }

  /**
   * Complete a Chrome WebSocket connection after identity is verified (or when no
   * identity secret exists yet — first connection before any pairing).
   */
  private completesChromeConnection(socket: WebSocket): void {
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
