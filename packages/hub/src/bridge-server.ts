/**
 * Hub Bridge Server (WebSocket)
 *
 * Manages the single WebSocket connection from Bridge to Hub.
 * Routes tool invocations, state updates, and heartbeats.
 *
 * Requirements: requirements-hub.md §2.5, §5.4, §9 (concurrency)
 */

import type http from "node:http";
import type {
  IDEState,
  ToolRegistration,
  ResultMessage,
  ConcurrencyStats,
} from "@accordo/bridge-types";
import {
  ACCORDO_PROTOCOL_VERSION,
  DEFAULT_MAX_CONCURRENT_INVOCATIONS,
  DEFAULT_MAX_QUEUE_DEPTH,
} from "@accordo/bridge-types";
import { JsonRpcError } from "./errors.js";

export interface BridgeServerOptions {
  /** Expected ACCORDO_BRIDGE_SECRET. Can be updated via reauth. */
  secret: string;
  /** Maximum concurrent in-flight invocations. Default: 16 */
  maxConcurrent?: number;
  /** Maximum queue depth. Default: 64 */
  maxQueueDepth?: number;
}

export class BridgeServer {
  private secret: string;
  private maxConcurrent: number;
  private maxQueueDepth: number;
  private inflight = 0;
  private queued = 0;
  private connected = false;
  private registryUpdateCb: ((tools: ToolRegistration[]) => void) | null = null;
  private stateUpdateCb: ((patch: Partial<IDEState>) => void) | null = null;

  constructor(options: BridgeServerOptions) {
    this.secret = options.secret;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_INVOCATIONS;
    this.maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
  }

  start(server: http.Server): void {
    // Attach WS upgrade handler — full implementation in Week 2
    void server;
  }

  async invoke(
    tool: string,
    args: Record<string, unknown>,
    timeout: number,
  ): Promise<ResultMessage> {
    void tool; void args; void timeout;
    // Queue-full check runs BEFORE connection check so it is testable without a
    // live Bridge connection (degenerate configs: maxConcurrent=0, maxQueueDepth=0).
    if (this.inflight >= this.maxConcurrent && this.queued >= this.maxQueueDepth) {
      throw new JsonRpcError("Queue full", -32004);
    }
    if (!this.connected) {
      throw new JsonRpcError("Bridge not connected", -32603);
    }
    throw new Error("not implemented");
  }

  cancel(id: string): void {
    // No-op if no connection or unrecognised ID — silent by design
    void id;
  }

  async requestState(): Promise<IDEState> {
    if (!this.connected) {
      throw new JsonRpcError("Bridge not connected", -32603);
    }
    throw new Error("not implemented");
  }

  isConnected(): boolean {
    return this.connected;
  }

  onRegistryUpdate(cb: (tools: ToolRegistration[]) => void): void {
    this.registryUpdateCb = cb;
  }

  onStateUpdate(
    cb: (patch: Partial<IDEState>) => void,
  ): void {
    this.stateUpdateCb = cb;
  }

  validateProtocolVersion(received: string): boolean {
    return received === ACCORDO_PROTOCOL_VERSION;
  }

  getConcurrencyStats(): ConcurrencyStats {
    return {
      inflight: this.inflight,
      queued: this.queued,
      limit: this.maxConcurrent,
    };
  }

  updateSecret(newSecret: string): void {
    this.secret = newSecret;
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}
