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
import * as fs from "node:fs";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { HealthResponse, ReauthRequest } from "@accordo/bridge-types";
import { BridgeServer } from "./bridge-server.js";
import { McpHandler } from "./mcp-handler.js";
import type { Session, JsonRpcRequest } from "./mcp-handler.js";
import { ToolRegistry } from "./tool-registry.js";
import { StateCache } from "./state-cache.js";
import { renderPrompt } from "./prompt-engine.js";
import { validateOrigin, validateBearer, validateBridgeSecret } from "./security.js";
import { McpDebugLogger } from "./debug-log.js";

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
  /** Tool-call invocation timeout in ms. Default: 30 000. */
  toolCallTimeout?: number;
  /** Audit log file path */
  auditFile?: string;
  /**
   * Path for the MCP debug log (JSONL). When set, every JSON-RPC message
   * exchanged with any agent is written in full to this file AND echoed to
   * stderr in real time.
   * Default: ~/.accordo/mcp-debug.jsonl
   * Set to empty string "" to disable debug logging.
   */
  debugLogFile?: string;
  /**
   * Absolute path where Hub writes the bearer token for out-of-band agents.
   * Default: ~/.accordo/token. Override in tests to avoid touching the filesystem.
   * requirements-hub.md §2.6, §4.2
   */
  tokenFilePath?: string;
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
  private debugLogger: McpDebugLogger | undefined;
  /**
   * Active SSE connections from MCP clients (VS Code / opencode / Claude Code)
   * listening for server notifications (e.g. notifications/tools/list_changed).
   * Key: stable UUID per connection. Value: response stream + keep-alive timer.
   */
  private sseConnections = new Map<string, { res: http.ServerResponse; keepAlive: ReturnType<typeof setInterval> }>();
  /**
   * Fingerprint of the last tool registry snapshot that triggered a
   * notifications/tools/list_changed push.  Sorted tool names joined with ",".
   * Prevents duplicate notifications when multiple extensions re-register after
   * a bridge reconnect but the effective tool set is unchanged.
   */
  private lastNotifiedToolHash = "";

  constructor(private options: HubServerOptions) {
    this.token = options.token;

    // Initialise debug logger unless explicitly disabled (empty string)
    if (options.debugLogFile !== "") {
      this.debugLogger = new McpDebugLogger(options.debugLogFile);
      console.error(`[hub] MCP debug log → ${this.debugLogger.getLogFile()}`);
    }
    this.bridgeServer = new BridgeServer({
      secret: options.bridgeSecret,
      maxConcurrent: options.maxConcurrent,
      maxQueueDepth: options.maxQueueDepth,
      onGraceExpired: () => { this.stateCache.clearModalities(); },
    });
    this.toolRegistry = new ToolRegistry();
    this.stateCache = new StateCache();
    this.mcpHandler = new McpHandler({
      toolRegistry: this.toolRegistry,
      bridgeServer: this.bridgeServer,
      getState: () => this.stateCache.getState(),
      toolCallTimeout: options.toolCallTimeout,
      auditFile: options.auditFile,
      debugLogger: this.debugLogger,
    });

    // Wire Bridge callbacks to state cache and tool registry
    this.bridgeServer.onStateUpdate((patch) => {
      this.stateCache.applyPatch(patch);
    });
    this.bridgeServer.onRegistryUpdate((tools) => {
      this.toolRegistry.register(tools);
      // Only notify SSE clients if the effective tool set actually changed.
      // Multiple extensions re-register on every bridge reconnect, each calling
      // onRegistryUpdate separately — without dedup this generates N tool-list
      // re-fetches per reconnect where N = number of registered extensions.
      const newHash = this.toolRegistry.list().map(t => t.name).sort().join(",");
      if (newHash === this.lastNotifiedToolHash) return;
      this.lastNotifiedToolHash = newHash;
      // MCP spec: notifications/tools/list_changed
      this.pushSseNotification({
        jsonrpc: "2.0" as const,
        method: "notifications/tools/list_changed",
        params: {},
      });
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

    // §2.1: /mcp GET — SSE notification stream for MCP clients
    // VS Code opens this to receive server-initiated notifications
    // (e.g. notifications/tools/list_changed after bridge reconnects).
    if (url === "/mcp" && req.method === "GET") {
      if (!validateBearer(req, this.token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      this.handleMcpSse(req, res);
      return;
    }

    // §2.1: /mcp — wrong HTTP method
    if (url === "/mcp") {
      res.writeHead(405, { "Content-Type": "application/json", "Allow": "POST, GET" });
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

    // /state — raw IDE state JSON (dev/debug, Bearer auth)
    if (url === "/state" && req.method === "GET") {
      if (!validateBearer(req, this.token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      this.handleState(req, res);
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
   *
   * Body is read before any session is created or headers are written,
   * so we can return 400 on malformed JSON without committing to 200.
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

    // §2.1: Session handling — validate existing session synchronously before body read
    // (fail-fast: if the session ID is unknown we can reject without reading the body)
    const incomingSessionId = req.headers["mcp-session-id"] as string | undefined;
    let existingSession: Session | undefined;
    if (incomingSessionId) {
      existingSession = this.mcpHandler.getSession(incomingSessionId);
      if (!existingSession) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired session" }));
        return;
      }
    }

    // Read body first — headers/session are finalised only after successful parse
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      // Log the raw HTTP request (including body) so we can see what the agent sent
      const agentHint = this.debugLogger
        ? this.extractAgentHint(req.headers["user-agent"])
        : undefined;
      this.debugLogger?.logHttpRequest({
        httpMethod: req.method ?? "POST",
        url: req.url ?? "/mcp",
        remoteIp: req.socket?.remoteAddress,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        sessionId: incomingSessionId,
      });

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      // Create or reuse session and write headers now that the body is validated
      let session: Session;
      if (existingSession) {
        session = existingSession;
        res.writeHead(200, { "Content-Type": "application/json" });
      } else {
        session = this.mcpHandler.createSession(this.extractAgentHint(req.headers["user-agent"]));
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": session.id,
        });
      }

      const agentHintForRequest = this.extractAgentHint(req.headers["user-agent"]);
      this.mcpHandler
        .handleRequest(request, session, agentHintForRequest)
        .then((response) => {
          if (response !== null) {
            res.end(JSON.stringify(response));
          } else {
            res.end();
          }
        })
        .catch((err) => {
          console.error(`[hub:mcp] handleRequest error: ${err instanceof Error ? err.message : String(err)}`);
          res.end();
        });
    });
  }

  /**
   * GET /mcp — SSE notification stream for MCP clients.
   *
   * VS Code opens this endpoint (with Accept: text/event-stream) after
   * initializing a session to receive server-initiated notifications such as
   * notifications/tools/list_changed. Keeping this stream open allows VS Code
   * to immediately re-fetch tools/list when the bridge reconnects and
   * registers new tools — preventing stale tool lists in agent sessions.
   *
   * Format: each notification is a Server-Sent Events `data:` line followed
   * by a blank line, per https://html.spec.whatwg.org/multipage/server-sent-events.html
   */
  private handleMcpSse(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const connId = Math.random().toString(36).slice(2);
    const agentHint = this.extractAgentHint(req.headers["user-agent"]);

    // Disable socket-level timeouts so Node doesn't kill this long-lived stream.
    // Without this, requestTimeout (default 5 min) terminates the SSE connection
    // and MCP SDK clients log "Error reading from async stream … TypeError: terminated".
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true, 30_000);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // SSE endpoint confirmation ping
    res.write(": accordo-hub SSE connected\n\n");

    console.error(`[hub:sse] new SSE connection id=${connId} agent=${agentHint ?? "unknown"}`);
    this.debugLogger?.logSseConnect(connId, agentHint);

    // Send SSE comment every 30 s to keep the stream alive.
    // Without periodic writes, intermediate proxies or TCP stacks may
    // consider the connection idle and tear it down.
    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // Socket already gone — cleanup happens in req.close handler below
      }
    }, 30_000);

    this.sseConnections.set(connId, { res, keepAlive });

    // Remove when client disconnects
    req.on("close", () => {
      const entry = this.sseConnections.get(connId);
      if (entry) {
        clearInterval(entry.keepAlive);
        this.sseConnections.delete(connId);
      }
      console.error(`[hub:sse] SSE disconnected id=${connId} (remaining=${this.sseConnections.size})`);
      this.debugLogger?.logSseDisconnect(connId);
    });
  }

  /**
   * Push a JSON-RPC notification to all active SSE connections.
   * Used to send notifications/tools/list_changed when tool registry updates.
   */
  private pushSseNotification(notification: { jsonrpc: "2.0"; method: string; params: unknown }): void {
    if (this.sseConnections.size === 0) return;
    console.error(`[hub:sse] pushing ${notification.method} to ${this.sseConnections.size} client(s)`);
    this.debugLogger?.logSseNotification(notification.method, this.sseConnections.size);
    const data = `data: ${JSON.stringify(notification)}\n\n`;
    for (const [id, entry] of this.sseConnections) {
      try {
        entry.res.write(data);
      } catch {
        // Connection closed — clean up timer and entry
        clearInterval(entry.keepAlive);
        this.sseConnections.delete(id);
      }
    }
  }

  /**
   * Extract a short agent identifier string from a User-Agent header value.
   * Returns undefined when the header is missing.
   */
  private extractAgentHint(ua: string | string[] | undefined): string | undefined {
    if (!ua) return undefined;
    const uaStr = Array.isArray(ua) ? ua[0] : ua;
    if (!uaStr) return undefined;
    const lower = uaStr.toLowerCase();
    if (lower.includes("github-copilot")) return "copilot";
    if (lower.includes("opencode")) return "opencode";
    if (lower.includes("claude")) return "claude";
    if (lower.includes("cursor")) return "cursor";
    return uaStr.slice(0, 60);
  }

  /**
   * GET /state — raw IDE state as JSON.
   * Dev/debug endpoint. Bearer auth required.
   */
  private handleState(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const state = this.stateCache.getState();

    // M43: hoist full thread list to top-level commentThreads when published
    // by accordo-comments (avoids summary truncation for debug consumers).
    const commentModality = state.modalities["accordo-comments"];
    const commentThreads = Array.isArray(commentModality?.["threads"])
      ? (commentModality["threads"] as unknown[])
      : undefined;

    const response: Record<string, unknown> = { ...state };
    if (commentThreads !== undefined) {
      response["commentThreads"] = commentThreads;
    }

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(response, null, 2));
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
      let newToken: string | undefined;
      let newSecret: string | undefined;
      try {
        const raw = JSON.parse(body) as Record<string, unknown>;
        const t = raw["newToken"];
        const s = raw["newSecret"];
        if (typeof t === "string") newToken = t;
        if (typeof s === "string") newSecret = s;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

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
    // Clean up SSE keep-alive timers before closing the server
    for (const [, entry] of this.sseConnections) {
      clearInterval(entry.keepAlive);
    }
    this.sseConnections.clear();

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        // Non-null assertion is safe: we checked `this.httpServer` immediately above
        // and `stop()` is not re-entrant (callers must await before calling again).
        this.httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
      this.httpServer = null;
    }
    await this.bridgeServer.close();
    this.startedAt = null;
  }

  /**
   * Update the bearer token in memory and persist to tokenFilePath when configured.
   * Called during credential rotation (/bridge/reauth).
   * requirements-hub.md §2.6, §4.2 (M30-hub)
   */
  updateToken(newToken: string): void {
    this.token = newToken;
    if (this.options.tokenFilePath) {
      fs.writeFileSync(this.options.tokenFilePath, newToken, "utf8");
    }
  }
}

