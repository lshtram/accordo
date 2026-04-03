/**
 * Bridge Dispatch
 *
 * Message routing: tool invocations, state updates, result routing.
 * Operates on the BridgeConnectionState shared with BridgeConnection.
 *
 * Requirements: requirements-hub.md §5.4, §9, CONC-03, CONC-05
 */

import { randomUUID } from "node:crypto";
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
import type { BridgeConnectionState } from "./bridge-connection.js";

/** In-flight invoke awaiting a ResultMessage from Bridge */
interface PendingInvoke {
  resolve: (r: ResultMessage) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** MS-02: Session ID for per-session tracking */
  sessionId: string;
}

/**
 * An invocation queued because the in-flight limit was reached.
 * CONC-03: Simple FIFO — queue in order of arrival.
 */
interface QueuedInvoke {
  tool: string;
  args: Record<string, unknown>;
  timeout: number;
  /** MS-02: Session ID for logging/tracking */
  sessionId: string;
  /** MS-02: Agent hint of the caller (e.g. "copilot", "opencode") */
  agentHint?: string | null;
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

const REQUEST_STATE_TIMEOUT_MS = 10_000;

/** Options for BridgeDispatch */
export interface BridgeDispatchOptions {
  maxConcurrent?: number;
  maxQueueDepth?: number;
  /** Diagnostic log function */
  log: (msg: string) => void;
  /** Send a raw message over the connection */
  send: (msg: Record<string, unknown>) => void;
}

/**
 * Handles in-flight invocations, message dispatch, and concurrency management.
 * Operates on shared BridgeConnectionState for connection presence checks.
 *
 * CONC-03: Simple FIFO queue — global 16 concurrent slots, 64 queue depth.
 * All invocations are queued in arrival order. No per-session scheduling.
 */
export class BridgeDispatch {
  private readonly maxConcurrent: number;
  private readonly maxQueueDepth: number;
  private inflight = 0;
  /** Total queued (global cap: 64) */
  private queued = 0;
  /** Simple FIFO queue — all invocations queued in arrival order */
  private queue: QueuedInvoke[] = [];
  private pendingInvokes = new Map<string, PendingInvoke>();
  private pendingStateRequest: PendingStateRequest | null = null;

  private connectionState: BridgeConnectionState;
  private readonly log: (msg: string) => void;
  private readonly send: (msg: Record<string, unknown>) => void;

  constructor(connectionState: BridgeConnectionState, opts: BridgeDispatchOptions) {
    this.connectionState = connectionState;
    this.log = opts.log;
    this.send = opts.send;
    this.maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_INVOCATIONS;
    this.maxQueueDepth = opts.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
  }

  /**
   * Invoke a tool on the Bridge.
   * Requirements: requirements-hub.md §5.4, §9, MS-02
   *
   * @param tool - Tool name
   * @param args - Tool arguments
   * @param timeout - Timeout in milliseconds
   * @param sessionId - MCP session ID of the caller (MS-02)
   * @param agentHint - Agent hint of the caller (MS-02)
   */
  async invoke(
    tool: string,
    args: Record<string, unknown>,
    timeout: number,
    sessionId?: string,
    agentHint?: string | null,
  ): Promise<ResultMessage> {
    // MS-02: Accept sessionId as either a positional param or extracted from args.
    const resolvedSessionId = sessionId ?? (typeof args.sessionId === "string" ? args.sessionId : randomUUID());

    // Queue-full check runs BEFORE connection check so it is testable without a
    // live Bridge connection (degenerate configs: maxConcurrent=0, maxQueueDepth=0).
    // Check BEFORE incrementing queued, so we throw at exactly maxQueueDepth.
    if (this.inflight >= this.maxConcurrent && this.queued >= this.maxQueueDepth) {
      this.log(`[hub:bridge] invoke(${tool}) REJECTED — queue full (inflight=${this.inflight}, queued=${this.queued})`);
      throw new JsonRpcError("Server busy — invocation queue full", -32004);
    }
    if (!this.connectionState.connected || !this.connectionState.ws) {
      if (this.connectionState.graceTimer !== null) {
        this.log(`[hub:bridge] invoke(${tool}) REJECTED — Bridge reconnecting (grace window active)`);
        throw new JsonRpcError("Bridge reconnecting", -32603);
      }
      this.log(`[hub:bridge] invoke(${tool}) REJECTED — Bridge not connected`);
      throw new JsonRpcError("Bridge not connected", -32603);
    }

    // Dispatch immediately if there's a free slot; otherwise queue FIFO.
    if (this.inflight < this.maxConcurrent) {
      return this.dispatchInvoke(tool, args, timeout, resolvedSessionId, agentHint);
    }

    this.queued++;
    this.log(`[hub:bridge] invoke(${tool}) QUEUED session=${resolvedSessionId} (inflight=${this.inflight}, queued=${this.queued})`);

    return new Promise<ResultMessage>((resolve, reject) => {
      this.queue.push({ tool, args, timeout, sessionId: resolvedSessionId, agentHint, resolve, reject });

      // Try to dispatch — may free a slot synchronously if a result was processed
      this.dequeueAndDispatch();
    });
  }

  /**
   * Send a cancel message for an in-flight invocation.
   * Silent no-op if the id is unknown or the connection is closed.
   * Requirements: requirements-hub.md §3.1
   */
  cancel(id: string): void {
    if (!this.connectionState.connected || !this.connectionState.ws || !this.pendingInvokes.has(id)) return;
    this.send({ type: "cancel", id });
  }

  /**
   * Request a fresh full state snapshot from Bridge.
   * Requirements: requirements-hub.md §3.1
   */
  async requestState(): Promise<IDEState> {
    if (!this.connectionState.connected || !this.connectionState.ws) {
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

  /**
   * Wire in the real BridgeConnectionState after BridgeConnection is constructed.
   * Used by BridgeServer to break the circular initialisation dependency between
   * BridgeDispatch and BridgeConnection.
   */
  setConnectionState(state: BridgeConnectionState): void {
    this.connectionState = state;
  }

  getConcurrencyStats(): ConcurrencyStats {
    return {
      inflight: this.inflight,
      queued: this.queued,
      limit: this.maxConcurrent,
    };
  }

  validateProtocolVersion(received: string): boolean {
    return received === ACCORDO_PROTOCOL_VERSION;
  }

  /**
   * Route an inbound raw message string to the appropriate handler.
   * Called by BridgeConnection after rate-limit pass.
   */
  routeMessage(raw: string): void {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw) as BridgeMessage;
    } catch {
      this.log(`[hub:bridge] dropped malformed frame (${raw.length} bytes)`);
      return;
    }

    // Log every inbound message type (except pong, which is noisy)
    if (msg.type !== "pong") {
      const extra = msg.type === "result"
        ? ` id=${(msg as ResultMessage).id?.slice(0, 8)} success=${(msg as ResultMessage).success}`
        : msg.type === "toolRegistry"
          ? ` tools=${((msg as { tools?: unknown[] }).tools ?? []).length}`
          : msg.type === "stateUpdate"
            ? ` keys=${Object.keys((msg as { patch?: Record<string, unknown> }).patch ?? {}).join(",")}`
            : msg.type === "stateSnapshot"
              ? ` proto=${(msg as { protocolVersion?: string }).protocolVersion}`
              : "";
      this.log(`[hub:bridge] ← ${msg.type}${extra}`);
    }

    switch (msg.type) {
      case "stateSnapshot": {
        // §3.2: Validate protocol version — close 4002 if mismatch
        if (!this.validateProtocolVersion(msg.protocolVersion)) {
          this.connectionState.ws?.close(
            4002,
            `Protocol version mismatch: expected ${ACCORDO_PROTOCOL_VERSION}, got ${msg.protocolVersion}`,
          );
          return;
        }
        try { this.connectionState.stateUpdateCb?.(msg.state); } catch (e) {
          this.log(`[hub:bridge] stateUpdateCb threw: ${(e as Error).message ?? e}`);
        }
        if (this.pendingStateRequest) {
          const pending = this.pendingStateRequest;
          this.pendingStateRequest = null;
          pending.resolve(msg.state);
        }
        break;
      }

      case "stateUpdate": {
        try { this.connectionState.stateUpdateCb?.(msg.patch); } catch (e) {
          this.log(`[hub:bridge] stateUpdateCb threw: ${(e as Error).message ?? e}`);
        }
        break;
      }

      case "toolRegistry": {
        try { this.connectionState.registryUpdateCb?.(msg.tools); } catch (e) {
          this.log(`[hub:bridge] registryUpdateCb threw: ${(e as Error).message ?? e}`);
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
          this.log(`[hub:bridge] ← result [id=${msg.id.slice(0, 8)}, success=${(msg as ResultMessage).success}, inflight=${this.inflight}]`);
          pending.resolve(msg as ResultMessage);
        } else {
          this.log(`[hub:bridge] ← result [id=${msg.id.slice(0, 8)}] — no pending invoke (orphan)`);
        }
        break;
      }

      case "cancelled": {
        // late:false → Bridge cancelled before producing a result; free slot now.
        // late:true  → result frame is already in-flight; treat as informational.
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

  /**
   * Reject all pending invocations and drain the queue.
   * Called on disconnect or server close.
   */
  rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingInvokes) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingInvokes.clear();
    this.inflight = 0;

    // Drain the FIFO queue — reject queued invocations immediately.
    for (const queued of this.queue) {
      queued.reject(err);
    }
    this.queue = [];
    this.queued = 0;

    if (this.pendingStateRequest) {
      const pending = this.pendingStateRequest;
      this.pendingStateRequest = null;
      pending.reject(err);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Dispatch an invocation directly (slot was available).
   */
  private dispatchInvoke(
    tool: string,
    args: Record<string, unknown>,
    timeout: number,
    sessionId: string,
    agentHint?: string | null,
  ): Promise<ResultMessage> {
    const id = randomUUID();
    this.inflight++;

    this.log(`[hub:bridge] invoke(${tool}) DISPATCHED session=${sessionId} (inflight=${this.inflight})`);

    return new Promise<ResultMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInvokes.delete(id);
        this.inflight--;
        this.dequeueAndDispatch();
        this.send({ type: "cancel", id });
        reject(new JsonRpcError(`Tool invocation timed out after ${timeout}ms`, -32000));
      }, timeout);

      this.pendingInvokes.set(id, { resolve, reject, timer, sessionId });
      this.send({ type: "invoke", id, tool, args, timeout, sessionId, agentHint: agentHint ?? null });
    });
  }

  /**
   * CONC-03: Dequeue the next waiting invocation in FIFO order.
   * Called after each in-flight slot becomes free (result/timeout/cancel).
   * No-op when queue is empty or inflight is at limit.
   */
  private dequeueAndDispatch(): void {
    if (this.queue.length === 0) return;
    if (this.inflight >= this.maxConcurrent) return;

    const next = this.queue.shift()!;
    this.queued--;

    const { tool, args, timeout, sessionId, agentHint, resolve, reject } = next;

    const id = randomUUID();
    this.inflight++;

    const timer = setTimeout(() => {
      this.pendingInvokes.delete(id);
      this.inflight--;
      this.dequeueAndDispatch();
      this.send({ type: "cancel", id });
      reject(new JsonRpcError(`Tool invocation timed out after ${timeout}ms`, -32000));
    }, timeout);

    this.pendingInvokes.set(id, { resolve, reject, timer, sessionId });
    this.send({ type: "invoke", id, tool, args, timeout, sessionId, agentHint: agentHint ?? null });
  }
}
