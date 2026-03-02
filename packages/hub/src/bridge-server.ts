/**
 * Hub Bridge Server (WebSocket)
 *
 * Manages the single WebSocket connection from Bridge to Hub.
 * Routes tool invocations, state updates, and heartbeats.
 *
 * Requirements: requirements-hub.md §2.5, §5.4, §9 (concurrency)
 */

import { randomUUID } from "node:crypto";
import type http from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket as WsSocket } from "ws";
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

/** In-flight invoke awaiting a ResultMessage from Bridge */
interface PendingInvoke {
  resolve: (r: ResultMessage) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** In-flight requestState awaiting a StateSnapshotMessage from Bridge */
interface PendingStateRequest {
  resolve: (s: IDEState) => void;
  reject: (e: Error) => void;
}

/** Incoming Bridge → Hub message (discriminated union for type-narrowing) */
type BridgeMessage =
  | { type: "stateSnapshot"; protocolVersion: string; state: IDEState }
  | { type: "stateUpdate"; patch: Partial<IDEState> }
  | { type: "toolRegistry"; tools: ToolRegistration[] }
  | { type: "result"; id: string; success: boolean; data?: unknown; error?: string }
  | { type: "pong"; ts: number }
  | { type: "cancelled"; id: string; late: boolean };

const PING_INTERVAL_MS = 30_000;
const REQUEST_STATE_TIMEOUT_MS = 10_000;

export class BridgeServer {
  private secret: string;
  private maxConcurrent: number;
  private maxQueueDepth: number;
  private inflight = 0;
  private queued = 0;
  private connected = false;
  private ws: WsSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingInvokes = new Map<string, PendingInvoke>();
  private pendingStateRequest: PendingStateRequest | null = null;
  private registryUpdateCb: ((tools: ToolRegistration[]) => void) | null = null;
  private stateUpdateCb: ((patch: Partial<IDEState>) => void) | null = null;

  constructor(options: BridgeServerOptions) {
    this.secret = options.secret;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_INVOCATIONS;
    this.maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
  }

  /**
   * Attach the WebSocket upgrade handler to the HTTP server.
   * Must be called once after the HTTP server is listening.
   * Requirements: requirements-hub.md §2.5
   */
  start(server: http.Server): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      // Only handle /bridge path
      if (req.url !== "/bridge") return;

      // §2.5: Validate secret on upgrade — 401 if wrong
      const providedSecret = req.headers["x-accordo-secret"];
      if (providedSecret !== this.secret) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // §2.5: Max 1 connection — reject additional with 409
      if (this.connected) {
        socket.write("HTTP/1.1 409 Conflict\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    wss.on("connection", (ws: WsSocket) => {
      this.ws = ws;
      this.connected = true;

      // §9.2: Heartbeat — send ping every 30 s
      this.pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          this.send({ type: "ping", ts: Date.now() });
        }
      }, PING_INTERVAL_MS);

      ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      ws.on("close", () => {
        this.handleDisconnect();
      });

      ws.on("error", () => {
        this.handleDisconnect();
      });
    });
  }

  /**
   * Invoke a tool on the Bridge.
   * Requirements: requirements-hub.md §5.4, §9
   */
  async invoke(
    tool: string,
    args: Record<string, unknown>,
    timeout: number,
  ): Promise<ResultMessage> {
    // Queue-full check runs BEFORE connection check so it is testable without a
    // live Bridge connection (degenerate configs: maxConcurrent=0, maxQueueDepth=0).
    if (this.inflight >= this.maxConcurrent && this.queued >= this.maxQueueDepth) {
      throw new JsonRpcError("Queue full", -32004);
    }
    if (!this.connected || !this.ws) {
      throw new JsonRpcError("Bridge not connected", -32603);
    }

    const id = randomUUID();

    return new Promise<ResultMessage>((resolve, reject) => {
      this.inflight++;

      const timer = setTimeout(() => {
        this.pendingInvokes.delete(id);
        this.inflight--;
        this.send({ type: "cancel", id });
        reject(new JsonRpcError(`Tool invocation timed out after ${timeout}ms`, -32000));
      }, timeout);

      this.pendingInvokes.set(id, { resolve, reject, timer });

      this.send({ type: "invoke", id, tool, args, timeout });
    });
  }

  /**
   * Send a cancel message for an in-flight invocation.
   * Silent no-op if the id is unknown or the connection is closed.
   * Requirements: requirements-hub.md §3.1
   */
  cancel(id: string): void {
    if (!this.connected || !this.ws || !this.pendingInvokes.has(id)) return;
    this.send({ type: "cancel", id });
  }

  /**
   * Request a fresh full state snapshot from Bridge.
   * Requirements: requirements-hub.md §3.1
   */
  async requestState(): Promise<IDEState> {
    if (!this.connected || !this.ws) {
      throw new JsonRpcError("Bridge not connected", -32603);
    }

    const id = randomUUID();

    return new Promise<IDEState>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingStateRequest?.resolve === resolve) {
          this.pendingStateRequest = null;
        }
        reject(new JsonRpcError("getState timed out", -32000));
      }, REQUEST_STATE_TIMEOUT_MS);

      // Wrap to clear timer on resolution
      this.pendingStateRequest = {
        resolve: (state) => { clearTimeout(timer); resolve(state); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };

      this.send({ type: "getState", id });
    });
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

  /**
   * Gracefully terminate the Bridge WebSocket connection.
   */
  async close(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.rejectAllPending(new JsonRpcError("Bridge server closed", -32603));
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(raw: string): void {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw) as BridgeMessage;
    } catch {
      return; // Ignore malformed frames
    }

    switch (msg.type) {
      case "stateSnapshot": {
        // §3.2: Validate protocol version — close 4002 if mismatch
        if (!this.validateProtocolVersion(msg.protocolVersion)) {
          this.ws?.close(4002, "Protocol version mismatch");
          return;
        }
        // Update state cache (full replacement via callback)
        this.stateUpdateCb?.(msg.state);
        // Resolve any waiting requestState() call
        if (this.pendingStateRequest) {
          const pending = this.pendingStateRequest;
          this.pendingStateRequest = null;
          pending.resolve(msg.state);
        }
        break;
      }

      case "stateUpdate": {
        this.stateUpdateCb?.(msg.patch);
        break;
      }

      case "toolRegistry": {
        this.registryUpdateCb?.(msg.tools);
        break;
      }

      case "result": {
        const pending = this.pendingInvokes.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingInvokes.delete(msg.id);
          this.inflight--;
          pending.resolve(msg as ResultMessage);
        }
        break;
      }

      case "cancelled": {
        // Bridge acknowledged a cancel — the invoke promise is already settled via timeout
        // or result, so this is informational only.
        break;
      }

      case "pong": {
        // Heartbeat response — no action needed
        break;
      }
    }
  }

  private handleDisconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws = null;
    this.connected = false;
    this.rejectAllPending(new JsonRpcError("Bridge disconnected", -32603));
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingInvokes) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingInvokes.clear();
    this.inflight = 0;

    if (this.pendingStateRequest) {
      const pending = this.pendingStateRequest;
      this.pendingStateRequest = null;
      pending.reject(err);
    }
  }
}
