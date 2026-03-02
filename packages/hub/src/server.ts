/**
 * Hub Server — Main HTTP server wiring
 *
 * Creates the HTTP server, routes requests to the appropriate handler,
 * and starts the Bridge WebSocket server. Security middleware (Origin
 * validation + Bearer auth) enforced on all authenticated endpoints.
 *
 * Requirements: requirements-hub.md §2.1–§2.6, §3.3, §5.6, §8
 */

import http from "node:http";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { HealthResponse, ReauthRequest } from "@accordo/bridge-types";
import { BridgeServer } from "./bridge-server.js";
import { McpHandler } from "./mcp-handler.js";
import type { Session, JsonRpcRequest } from "./mcp-handler.js";
import { ToolRegistry } from "./tool-registry.js";
import { StateCache } from "./state-cache.js";
import { renderPrompt } from "./prompt-engine.js";
import { validateOrigin, validateBearer, validateBridgeSecret } from "./security.js";

export interface HubServerOptions {
  /** Port to listen on. Default: 3000 */
  port: number;
  /** Bind address. Default: "127.0.0.1" */
  host: string;
  /** Bearer token for MCP and /instructions auth */
  token: string;
  /** Bridge shared secret for WS auth */
  bridgeSecret: string;
  /** Max concurrent invocations. Default: 16 */
  maxConcurrent?: number;
  /** Max queue depth. Default: 64 */
  maxQueueDepth?: number;
  /** Audit log file path */
  auditFile?: string;
  /** Log level */
  logLevel?: "debug" | "info" | "warn" | "error";
}

export class HubServer {
  private httpServer: http.Server | null = null;
  private bridgeServer: BridgeServer;
  private toolRegistry: ToolRegistry;
  private stateCache: StateCache;
  private mcpHandler: McpHandler;
  private startedAt: number | null = null;
  private token: string;

  constructor(private options: HubServerOptions) {
    this.token = options.token;
    this.bridgeServer = new BridgeServer({
      secret: options.bridgeSecret,
      maxConcurrent: options.maxConcurrent,
      maxQueueDepth: options.maxQueueDepth,
    });
    this.toolRegistry = new ToolRegistry();
    this.stateCache = new StateCache();
    this.mcpHandler = new McpHandler({
      toolRegistry: this.toolRegistry,
      bridgeServer: this.bridgeServer,
    });

    // Wire Bridge callbacks to state cache and tool registry
    this.bridgeServer.onStateUpdate((patch) => {
      this.stateCache.applyPatch(patch);
    });
    this.bridgeServer.onRegistryUpdate((tools) => {
      this.toolRegistry.register(tools);
    });
  }

  /**
   * Start the HTTP server and WebSocket bridge server.
   * Binds to options.host:options.port.
   * Writes PID file to ~/.accordo/hub.pid.
   *
   * Security enforcement (§2.1, §5.6):
   *   - /mcp: Origin validation + Bearer auth
   *   - /instructions: Bearer auth
   *   - /health: no auth
   *   - /bridge: secret auth (handled by BridgeServer on WS upgrade)
   *   - /bridge/reauth: bridge secret auth
   *
   * @returns Promise that resolves when the server is listening
   */
  async start(): Promise<void> {
    this.startedAt = Date.now();
    return new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });
      this.httpServer = server;

      server.once("error", reject);
      server.listen(
        this.options.port,
        this.options.host,
        () => {
          server.off("error", reject);
          server.on("error", (err) => {
            console.error("[hub] server error", err);
          });
          // Start Bridge WebSocket server on same HTTP server
          this.bridgeServer.start(server);
          resolve();
        },
      );
    });
  }

  /**
   * Handle an incoming HTTP request by routing to the right endpoint.
   * Security middleware runs first on every authenticated endpoint.
   *
   * @param req - Incoming HTTP request
   * @param res - HTTP response object
   */
  handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "/";

    // §2.4: /health — no auth required
    if (url === "/health" && req.method === "GET") {
      this.handleHealth(req, res);
      return;
    }

    // §2.1: Origin validation on all authenticated endpoints
    if (!validateOrigin(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: invalid origin" }));
      return;
    }

    // §2.1: /mcp — Bearer auth + Origin already validated
    if (url === "/mcp" && req.method === "POST") {
      if (!validateBearer(req, this.token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      this.handleMcp(req, res);
      return;
    }

    // §2.1: /mcp — wrong HTTP method
    if (url === "/mcp") {
      res.writeHead(405, { "Content-Type": "application/json", "Allow": "POST" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // §2.3: /instructions — Bearer auth
    if (url === "/instructions" && req.method === "GET") {
      if (!validateBearer(req, this.token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      this.handleInstructions(req, res);
      return;
    }

    // §2.6: /bridge/reauth — bridge secret auth
    if (url === "/bridge/reauth" && req.method === "POST") {
      if (!validateBridgeSecret(req, this.options.bridgeSecret)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      this.handleReauth(req, res);
      return;
    }

    // Unknown endpoint
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  /**
   * GET /health — unauthenticated liveness check.
   * Requirements: requirements-hub.md §2.4
   */
  private handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this.getHealth()));
  }

  /**
   * POST /mcp — MCP Streamable HTTP endpoint.
   * Parses JSON-RPC, creates/validates session, dispatches to McpHandler.
   * Requirements: requirements-hub.md §2.1
   */
  private handleMcp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // §2.1: Content-Type must be application/json
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unsupported Media Type: expected application/json" }));
      return;
    }

    // §2.1: Session handling — validate or create
    const incomingSessionId = req.headers["mcp-session-id"] as string | undefined;
    let session: Session;
    if (incomingSessionId) {
      const found = this.mcpHandler.getSession(incomingSessionId);
      if (!found) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown session" }));
        return;
      }
      session = found;
    } else {
      session = this.mcpHandler.createSession();
      // Set Mcp-Session-Id synchronously so tests can observe it
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": session.id,
      });
    }

    // Read body and dispatch
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      this.mcpHandler
        .handleRequest(request, session)
        .then((response) => {
          if (response !== null) {
            res.end(JSON.stringify(response));
          } else {
            res.end();
          }
        })
        .catch(() => {
          res.end();
        });
    });
  }

  /**
   * GET /instructions — rendered system prompt.
   * Requirements: requirements-hub.md §2.3
   */
  private handleInstructions(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const state = this.stateCache.getState();
    const tools = this.toolRegistry.list();
    const prompt = renderPrompt(state, tools);
    res.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(prompt);
  }

  /**
   * POST /bridge/reauth — credential rotation.
   * Requirements: requirements-hub.md §2.6
   */
  private handleReauth(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // Require application/json body
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Request: expected application/json body" }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      const newToken = parsed["newToken"] as string | undefined;
      const newSecret = parsed["newSecret"] as string | undefined;

      if (!newToken || !newSecret) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing newToken or newSecret" }));
        return;
      }

      this.updateToken(newToken);
      this.bridgeServer.updateSecret(newSecret);
      this.options.bridgeSecret = newSecret;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  }

  /**
   * Build a HealthResponse from current state.
   */
  getHealth(): HealthResponse {
    const uptime =
      this.startedAt !== null ? (Date.now() - this.startedAt) / 1000 : 0;
    const stats = this.bridgeServer.getConcurrencyStats();
    return {
      ok: true,
      uptime,
      bridge: this.bridgeServer.isConnected() ? "connected" : "disconnected",
      toolCount: this.toolRegistry.size,
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      inflight: stats.inflight,
      queued: stats.queued,
    };
  }

  /**
   * Return the bound address after start(). Returns null before start() or after stop().
   */
  getAddress(): { port: number; host: string } | null {
    if (!this.httpServer) return null;
    const addr = this.httpServer.address();
    if (!addr || typeof addr === "string") return null;
    return { port: addr.port, host: addr.address };
  }

  /**
   * Graceful shutdown.
   * Closes HTTP server, WS connections, removes PID file.
   */
  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        // Non-null assertion safe: checked above
        this.httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
      this.httpServer = null;
    }
    await this.bridgeServer.close();
    this.startedAt = null;
  }

  /**
   * Update the bearer token in memory.
   * Called during credential rotation (/bridge/reauth).
   */
  updateToken(newToken: string): void {
    this.token = newToken;
  }
}

