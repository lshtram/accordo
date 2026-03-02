/**
 * Hub Server — Main HTTP server wiring
 *
 * Creates the HTTP server, routes requests to the appropriate handler,
 * and starts the Bridge WebSocket server.
 *
 * Requirements: requirements-hub.md §2.1–§2.6, §3.3
 */

import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { HealthResponse } from "@accordo/bridge-types";
import { BridgeServer } from "./bridge-server.js";
import { ToolRegistry } from "./tool-registry.js";

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
  private bridgeServer: BridgeServer;
  private toolRegistry: ToolRegistry;
  private startedAt: number | null = null;

  constructor(private options: HubServerOptions) {
    this.bridgeServer = new BridgeServer({
      secret: options.bridgeSecret,
      maxConcurrent: options.maxConcurrent,
      maxQueueDepth: options.maxQueueDepth,
    });
    this.toolRegistry = new ToolRegistry();
  }

  /**
   * Start the HTTP server and WebSocket bridge server.
   * Binds to options.host:options.port.
   * Writes PID file to ~/.accordo/hub.pid.
   *
   * @returns Promise that resolves when the server is listening
   */
  async start(): Promise<void> {
    this.startedAt = Date.now();
    // Full HTTP server binding is wired in Week 2 integration
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
   * Graceful shutdown.
   * Closes HTTP server, WS connections, removes PID file.
   */
  async stop(): Promise<void> {
    await this.bridgeServer.close();
    this.startedAt = null;
  }
}

