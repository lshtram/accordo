/**
 * Hub Server — Main HTTP server wiring (thin delegation shell)
 *
 * Creates the HTTP server, wires the four sub-modules for routing, SSE
 * management, MCP request handling, and credential reauth, then starts
 * the Bridge WebSocket server.
 *
 * Security middleware (Origin validation + Bearer auth) is enforced inside
 * server-routing.ts — the exact middleware order from the original is preserved.
 *
 * Requirements: requirements-hub.md §2.1–§2.6, §3.3, §5.6, §8
 */

import http from "node:http";
import * as fs from "node:fs";
import { ACCORDO_PROTOCOL_VERSION, DISCONNECT_GRACE_WINDOW_MS } from "@accordo/bridge-types";
import type { HealthResponse, IDEState, DisconnectResponse } from "@accordo/bridge-types";
import { BridgeServer } from "./bridge-server.js";
import { DisconnectHandler } from "./disconnect-handler.js";
import { McpHandler } from "./mcp-handler.js";
import { ToolRegistry } from "./tool-registry.js";
import { StateCache } from "./state-cache.js";
import { renderPrompt } from "./prompt-engine.js";
import { McpDebugLogger } from "./debug-log.js";
import { createRouter } from "./server-routing.js";
import { createSseManager } from "./server-sse.js";
import { createMcpRequestHandler, extractAgentHint } from "./server-mcp.js";
import { createReauthHandler } from "./server-reauth.js";
import type { Router } from "./server-routing.js";


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
  private router: Router;
  private disconnectHandler: DisconnectHandler;
  /**
   * Fingerprint of the last tool registry snapshot that triggered a
   * notifications/tools/list_changed push. Prevents duplicate notifications.
   */
  private lastNotifiedToolHash = "";

  constructor(private options: HubServerOptions) {
    this.token = options.token;

    // Initialise debug logger unless explicitly disabled (empty string)
    if (options.debugLogFile !== "") {
      this.debugLogger = new McpDebugLogger(options.debugLogFile);
      console.error(`[hub] MCP debug log → ${this.debugLogger.getLogFile()}`);
    }

    // Create DisconnectHandler first so it can be referenced in BridgeServer callbacks.
    this.disconnectHandler = new DisconnectHandler({
      graceWindowMs: DISCONNECT_GRACE_WINDOW_MS,
      onGraceExpired: (): void => { process.exit(0); },
      log: (msg): void => { console.error(`[hub:disconnect] ${msg}`); },
    });

    this.bridgeServer = new BridgeServer({
      secret: options.bridgeSecret,
      maxConcurrent: options.maxConcurrent,
      maxQueueDepth: options.maxQueueDepth,
      onGraceExpired: (): void => { this.stateCache.clearModalities(); },
      onBridgeConnect: (): void => { this.disconnectHandler.cancelGraceTimer(); },
    });
    this.toolRegistry = new ToolRegistry();
    this.stateCache = new StateCache();

    this.mcpHandler = new McpHandler({
      toolRegistry: this.toolRegistry,
      bridgeServer: this.bridgeServer,
      getState: (): IDEState => this.stateCache.getState(),
      toolCallTimeout: options.toolCallTimeout,
      auditFile: options.auditFile,
      debugLogger: this.debugLogger,
    });

    // Wire Bridge callbacks to state cache and tool registry
    this.bridgeServer.onStateUpdate((patch) => {
      this.stateCache.applyPatch(patch);
    });

    // Create sub-module instances
    const sseManager = createSseManager({
      debugLogger: this.debugLogger,
      extractAgentHint,
    });

    const mcpRequestHandler = createMcpRequestHandler({
      mcpHandler: this.mcpHandler,
      debugLogger: this.debugLogger,
    });

    const reauthHandler = createReauthHandler({
      updateToken: (newToken) => { this.updateToken(newToken); },
      updateBridgeSecret: (newSecret) => { this.bridgeServer.updateSecret(newSecret); },
      updateOptionsBridgeSecret: (newSecret) => { this.options.bridgeSecret = newSecret; },
    });

    this.bridgeServer.onRegistryUpdate((tools) => {
      this.toolRegistry.register(tools);
      // Only notify SSE clients if the effective tool set actually changed.
      const newHash = this.toolRegistry.list().map(t => t.name).sort().join(",");
      if (newHash === this.lastNotifiedToolHash) return;
      this.lastNotifiedToolHash = newHash;
      // MCP spec: notifications/tools/list_changed
      sseManager.pushSseNotification({
        jsonrpc: "2.0" as const,
        method: "notifications/tools/list_changed",
        params: {},
      });
    });

    this.router = createRouter({
      getToken: () => this.token,
      getBridgeSecret: () => this.options.bridgeSecret,
      handleMcp: (req, res) => mcpRequestHandler.handleMcp(req, res),
      handleMcpSse: (req, res) => sseManager.handleMcpSse(req, res),
      handleReauth: (req, res) => reauthHandler.handleReauth(req, res),
      handleDisconnect: (_req, res) => {
        this.disconnectHandler.startGraceTimer();
        const body: DisconnectResponse = { ok: true, graceWindowMs: DISCONNECT_GRACE_WINDOW_MS };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      },
      getHealth: () => this.getHealth(),
      getState: () => this.stateCache.getState(),
      getTools: () => this.toolRegistry.list(),
      renderPrompt,
      getBrowserStatus: () => {
        const state = this.stateCache.getState();
        const browserState = state.modalities["accordo-browser"] as
          | { connected?: boolean; controlGranted?: boolean }
          | undefined;
        return {
          connected: browserState?.connected ?? false,
          controlGranted: browserState?.controlGranted ?? false,
        };
      },
    });

    // Store sseManager for shutdown cleanup
    this.sseManager = sseManager;
  }

  /** SSE manager — stored for closeAll() on stop() */
  private sseManager: ReturnType<typeof createSseManager>;

  /**
   * Start the HTTP server and WebSocket bridge server.
   * Binds to options.host:options.port.
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
   * Delegates to the router which enforces security middleware first.
   *
   * @param req - Incoming HTTP request
   * @param res - HTTP response object
   */
  handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.router.handleHttpRequest(req, res);
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
   * Closes HTTP server, WS connections, SSE connections.
   */
  async stop(): Promise<void> {
    // Clean up SSE connections and keep-alive timers
    this.sseManager.closeAll();

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        // Non-null assertion is safe: we checked `this.httpServer` immediately above
        // and `stop()` is not re-entrant (callers must await before calling again).
        this.httpServer.close((err) => (err ? reject(err) : resolve()));
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
