/**
 * Hub Server — Thin Orchestration Shell
 *
 * Creates the HTTP server, wires the 4 sub-modules together, and manages
 * the start/stop lifecycle. All endpoint logic lives in the dedicated modules:
 *   - server-routing.ts  — URL dispatch + auth middleware chain
 *   - server-sse.ts      — SSE connection management + notifications
 *   - server-mcp.ts      — MCP JSON-RPC POST handling
 *   - server-reauth.ts   — credential rotation flow
 *
 * Requirements: requirements-hub.md §2.1–§2.6, §3.3, §5.6, §8
 */

import http from "node:http";
import * as fs from "node:fs";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { HealthResponse } from "@accordo/bridge-types";
import { BridgeServer } from "./bridge-server.js";
import { McpHandler } from "./mcp-handler.js";
import { ToolRegistry } from "./tool-registry.js";
import { StateCache } from "./state-cache.js";
import { renderPrompt } from "./prompt-engine.js";
import { McpDebugLogger } from "./debug-log.js";
import { createRouter } from "./server-routing.js";
import type { Router } from "./server-routing.js";
import { createSseManager } from "./server-sse.js";
import type { SseManager } from "./server-sse.js";import { createMcpRequestHandler, extractAgentHint } from "./server-mcp.js";
import { createReauthHandler } from "./server-reauth.js";

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
   * Fingerprint of the last tool registry snapshot that triggered a
   * notifications/tools/list_changed push. Deduplicates redundant pushes.
   */
  private lastNotifiedToolHash = "";

  /** SSE connection manager — owns the connection map and keep-alive timers. */
  private sseManager: SseManager;
  /** HTTP request router — owns the auth middleware chain and URL dispatch. */
  private router: Router;

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

    // Wire Bridge callbacks to state cache, tool registry, and SSE notifications
    this.bridgeServer.onStateUpdate((patch) => { this.stateCache.applyPatch(patch); });
    this.bridgeServer.onRegistryUpdate((tools) => {
      this.toolRegistry.register(tools);
      // Only notify SSE clients if the effective tool set actually changed (dedup).
      const newHash = this.toolRegistry.list().map(t => t.name).sort().join(",");
      if (newHash === this.lastNotifiedToolHash) return;
      this.lastNotifiedToolHash = newHash;
      this.sseManager.pushSseNotification({
        jsonrpc: "2.0" as const,
        method: "notifications/tools/list_changed",
        params: {},
      });
    });

    // Wire sub-modules
    this.sseManager = createSseManager({
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

    this.router = createRouter({
      getToken: () => this.token,
      getBridgeSecret: () => this.options.bridgeSecret,
      handleMcp: (req, res) => { mcpRequestHandler.handleMcp(req, res); },
      handleMcpSse: (req, res) => { this.sseManager.handleMcpSse(req, res); },
      handleReauth: (req, res) => { reauthHandler.handleReauth(req, res); },
      getHealth: () => this.getHealth(),
      getState: () => this.stateCache.getState(),
      getTools: () => this.toolRegistry.list(),
      renderPrompt,
    });
  }

  /**
   * Start the HTTP server and WebSocket bridge server.
   * Binds to options.host:options.port.
   * requirements-hub.md §2.1, §5.6, §8
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
   * Route an incoming HTTP request to the correct endpoint handler.
   * Delegates to the router which enforces the auth middleware chain.
   */
  handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.router.handleHttpRequest(req, res);
  }

  /**
   * Build a HealthResponse from current state.
   * requirements-hub.md §2.4
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
   * Graceful shutdown. Closes SSE connections before the HTTP server.
   */
  async stop(): Promise<void> {
    this.sseManager.closeAll();
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        // Non-null assertion is safe: checked above; stop() is not re-entrant.
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
