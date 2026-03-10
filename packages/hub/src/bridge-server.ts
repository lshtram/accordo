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
  /** Maximum WebSocket payload size (bytes). Default: 1_048_576 (1 MB). M34 */
  maxPayload?: number;
  /** Maximum inbound messages per second from Bridge. Default: 100. M33 */
  maxMessagesPerSecond?: number;
  /** Grace window (ms) after Bridge disconnect before state is cleared. Default: 15_000. M31 */
  graceWindowMs?: number;
  /** Called when the grace window expires without reconnect. M31 */
  onGraceExpired?: () => void;
}

/** In-flight invoke awaiting a ResultMessage from Bridge */
interface PendingInvoke {
  resolve: (r: ResultMessage) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * An invocation queued because the in-flight limit was reached.
 * CONC-03: Queued until an in-flight slot becomes available.
 */
interface QueuedInvoke {
  tool: string;
  args: Record<string, unknown>;
  timeout: number;
  resolve: (r: ResultMessage) => void;
  reject: (e: Error) => void;
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
  /** CONC-03: FIFO queue for invocations waiting for an in-flight slot */
  private invokeQueue: QueuedInvoke[] = [];
  private connected = false;
  private ws: WsSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingInvokes = new Map<string, PendingInvoke>();
  private pendingStateRequest: PendingStateRequest | null = null;
  private registryUpdateCb: ((tools: ToolRegistration[]) => void) | null = null;
  private stateUpdateCb: ((patch: Partial<IDEState>) => void) | null = null;
  // M34: max WS payload size
  private maxPayload: number = 1_048_576;
  // M33: inbound rate limiting
  private maxMessagesPerSecond: number = 100;
  private messageCount = 0;
  private messageWindowStart = 0;
  // M31: grace window
  private graceWindowMs: number = 15_000;
  private onGraceExpired: (() => void) | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: BridgeServerOptions) {
    this.secret = options.secret;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_INVOCATIONS;
    this.maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
    this.maxPayload = options.maxPayload ?? 1_048_576;
    this.maxMessagesPerSecond = options.maxMessagesPerSecond ?? 100;
    this.graceWindowMs = options.graceWindowMs ?? 15_000;
    this.onGraceExpired = options.onGraceExpired;
  }

  /**
   * Attach the WebSocket upgrade handler to the HTTP server.
   * Must be called once after the HTTP server is listening.
   * Requirements: requirements-hub.md §2.5
   */
  start(server: http.Server): void {
    const wss = new WebSocketServer({ noServer: true, maxPayload: this.maxPayload });

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

      // §2.5: Max 1 connection — evict any stale connection before accepting
      // the new one.  When VS Code kills the Extension Development Host with
      // SIGKILL, `deactivate()` is never called, so the bridge never sends a
      // clean close frame.  The hub would otherwise keep `this.connected = true`
      // and reject the new session's connection with HTTP 409, which the WS
      // library surfaces as close code 1006 on the client side.
      if (this.connected && this.ws) {
        console.error("[hub:bridge] evicting stale Bridge socket");
        const stale = this.ws;
        // Strip event listeners BEFORE terminate() so that the async `close`
        // event the ws library emits after socket destruction does not fire
        // handleDisconnect() a second time — which would arrive after
        // handleConnect() has already registered the new socket, nulling out
        // this.ws and this.connected and orphaning the new connection.
        stale.removeAllListeners();
        stale.on("error", () => {}); // prevent unhandled-error throw on RST
        try { stale.terminate(); } catch { /* already gone */ }
        this.handleDisconnect();
      }

      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      } catch (err) {
        console.error(`[hub:bridge] handleUpgrade error: ${(err as Error).message ?? err}`);
        socket.destroy();
      }
    });

    wss.on("connection", (ws: WsSocket) => {
      this.handleConnect(ws);
    });

    // Prevent unhandled 'error' on the WebSocketServer from crashing the
    // Node.js process.  Errors here are typically OS-level socket issues
    // (e.g. ECONNRESET from a stale Bridge) — log and continue.
    wss.on("error", (err) => {
      console.error(`[hub:bridge] WebSocketServer error: ${(err as Error).message ?? err}`);
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
      throw new JsonRpcError("Server busy — invocation queue full", -32004);
    }
    if (!this.connected || !this.ws) {
      if (this.graceTimer !== null) {
        throw new JsonRpcError("Bridge reconnecting", -32603);
      }
      throw new JsonRpcError("Bridge not connected", -32603);
    }

    // CONC-03: queue when at concurrency limit (but queue not full)
    if (this.inflight >= this.maxConcurrent) {
      this.queued++;
      return new Promise<ResultMessage>((resolve, reject) => {
        this.invokeQueue.push({ tool, args, timeout, resolve, reject });
      });
    }

    const id = randomUUID();

    return new Promise<ResultMessage>((resolve, reject) => {
      this.inflight++;

      const timer = setTimeout(() => {
        this.pendingInvokes.delete(id);
        this.inflight--;
        this.send({ type: "cancel", id });
        this.dequeueAndDispatch();
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

  /**
   * CONC-05: Dequeue the next waiting invocation and dispatch it.
   * Called after each in-flight slot becomes free (result/timeout/cancel).
   * No-op when queue is empty.
   */
  private dequeueAndDispatch(): void {
    if (this.invokeQueue.length === 0) return;
    const next = this.invokeQueue.shift()!;
    this.queued--;

    const id = randomUUID();
    const { tool, args, timeout, resolve, reject } = next;

    this.inflight++;

    const timer = setTimeout(() => {
      this.pendingInvokes.delete(id);
      this.inflight--;
      this.send({ type: "cancel", id });
      this.dequeueAndDispatch();
      reject(new JsonRpcError(`Tool invocation timed out after ${timeout}ms`, -32000));
    }, timeout);

    this.pendingInvokes.set(id, { resolve, reject, timer });
    this.send({ type: "invoke", id, tool, args, timeout });
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
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.rejectAllPending(new JsonRpcError("Bridge server closed", -32603));
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * M31: Wire up a new WebSocket connection.
   * Handles both initial connect and reconnect-within-grace-window
   * (cancels the grace timer in the latter case).
   */
  private handleConnect(ws: WsSocket): void {
    try {
      console.error("[hub:bridge] Bridge connected");
      // Cancel any running grace timer — Bridge reconnected within the window.
      if (this.graceTimer !== null) {
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
      }

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

      // Capture the error for logging.  The ws library always emits 'close'
      // after 'error', so handleDisconnect() will run from the close handler;
      // calling it here as well would double-fire.  Just log the error.
      ws.on("error", (err) => {
        console.error(`[hub:bridge] socket error: ${(err as Error).message ?? err}`);
      });
    } catch (err) {
      console.error(`[hub:bridge] handleConnect error: ${(err as Error).message ?? err}`);
      // Best effort: close the socket so Bridge gets a clean close event
      // and schedules reconnection.  Don't let the error propagate.
      try { ws.terminate(); } catch { /* already gone */ }
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(raw: string): void {
    // M33: inbound rate limiting — drop messages that exceed maxMessagesPerSecond.
    const now = Date.now();
    if (now - this.messageWindowStart >= 1000) {
      this.messageWindowStart = now;
      this.messageCount = 0;
    }
    this.messageCount++;
    if (this.messageCount > this.maxMessagesPerSecond) {
      return; // drop — do not close the connection
    }

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
          this.ws?.close(
            4002,
            `Protocol version mismatch: expected ${ACCORDO_PROTOCOL_VERSION}, got ${msg.protocolVersion}`,
          );
          return;
        }
        // Update state cache (full replacement via callback).
        // Guard with try-catch so a bad payload doesn't crash the Hub
        // and tear down the WebSocket (which surfaces as close 1006).
        try { this.stateUpdateCb?.(msg.state); } catch (e) {
          console.error(`[hub:bridge] stateUpdateCb threw: ${(e as Error).message ?? e}`);
        }
        // Resolve any waiting requestState() call
        if (this.pendingStateRequest) {
          const pending = this.pendingStateRequest;
          this.pendingStateRequest = null;
          pending.resolve(msg.state);
        }
        break;
      }

      case "stateUpdate": {
        try { this.stateUpdateCb?.(msg.patch); } catch (e) {
          console.error(`[hub:bridge] stateUpdateCb threw: ${(e as Error).message ?? e}`);
        }
        break;
      }

      case "toolRegistry": {
        try { this.registryUpdateCb?.(msg.tools); } catch (e) {
          console.error(`[hub:bridge] registryUpdateCb threw: ${(e as Error).message ?? e}`);
        }
        break;
      }

      case "result": {
        const pending = this.pendingInvokes.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingInvokes.delete(msg.id);
          this.inflight--;
          this.dequeueAndDispatch();
          pending.resolve(msg as ResultMessage);
        }
        break;
      }

      case "cancelled": {
        // Bridge confirmed cancel.
        // late:false → Bridge successfully cancelled before producing a result;
        //              free the slot and reject the caller now.
        // late:true  → Result frame is already in-flight; the slot will be freed
        //              when that "result" frame arrives. Treat as informational.
        if (msg.late) break;
        const pending = this.pendingInvokes.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingInvokes.delete(msg.id);
          this.inflight--;
          this.dequeueAndDispatch();
          pending.reject(new JsonRpcError("Invocation cancelled", -32000));
        }
        break;
      }

      case "pong": {
        // Heartbeat response — no action needed
        break;
      }
    }
  }

  private handleDisconnect(): void {
    // Idempotency guard: ws emits both 'error' and 'close' on failures,
    // and stale-eviction calls this explicitly.  Without the guard we
    // would create duplicate grace timers and double-reject pending calls.
    if (!this.connected) return;

    console.error("[hub:bridge] Bridge disconnected");
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws = null;
    this.connected = false;
    this.rejectAllPending(new JsonRpcError("Bridge disconnected", -32603));
    // M31: start grace window — hold state until reconnect or expiry.
    if (this.graceWindowMs === 0) {
      // Zero-ms grace: fire synchronously — no deferred timer.
      this.onGraceExpired?.();
    } else {
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        this.onGraceExpired?.();
      }, this.graceWindowMs);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingInvokes) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingInvokes.clear();
    this.inflight = 0;

    // Drain the FIFO queue — these were never dispatched, so reject them now
    // to avoid hung promises on the callers' side.
    for (const queued of this.invokeQueue) {
      queued.reject(err);
    }
    this.invokeQueue = [];
    this.queued = 0;

    if (this.pendingStateRequest) {
      const pending = this.pendingStateRequest;
      this.pendingStateRequest = null;
      pending.reject(err);
    }
  }
}
