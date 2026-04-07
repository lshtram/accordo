/**
 * Hub Bridge Server (WebSocket) — composition root / facade
 *
 * Imports BridgeConnection (connection lifecycle) and BridgeDispatch
 * (message routing + concurrency) and exposes the same BridgeServer
 * class as before. All callers continue to import from this file.
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
import { JsonRpcError } from "./errors.js";
import { BridgeConnection, createBridgeLogger } from "./bridge-connection.js";
import { BridgeDispatch } from "./bridge-dispatch.js";

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
  /** Called when a new Bridge WS connection is established (including reconnect). */
  onBridgeConnect?: () => void;
}

export class BridgeServer {
  private secret: string;
  private readonly conn: BridgeConnection;
  private readonly dispatch: BridgeDispatch;

  /**
   * Stored so tests can read `server.maxMessagesPerSecond` via internal cast.
   * Also used to pass the value to BridgeConnection.
   */
  private readonly maxMessagesPerSecond: number;
  /**
   * Stored so tests can read `server.graceWindowMs` via internal cast.
   * Also used to pass the value to BridgeConnection.
   */
  private readonly graceWindowMs: number;

  // ── Test-facing proxy setters (tests inject mock ws/connected via cast) ──
  /** Proxy setter — writes through to the shared connection state. */
  private set ws(value: unknown) {
    (this.conn.state as unknown as Record<string, unknown>)["ws"] = value;
  }
  /** Proxy setter — writes through to the shared connection state. */
  private set connected(value: boolean) {
    this.conn.state.connected = value;
  }

  constructor(options: BridgeServerOptions) {
    this.secret = options.secret;
    this.maxMessagesPerSecond = options.maxMessagesPerSecond ?? 100;
    this.graceWindowMs = options.graceWindowMs ?? 15_000;
    const log = createBridgeLogger();

    this.dispatch = new BridgeDispatch(
      // state reference is created inside BridgeConnection — we pass a getter
      // but dispatch needs the state; we break the circular init by wiring after.
      // We use a lazy initialisation pattern: dispatch is created with a
      // temporary placeholder state, then the real state is set once conn exists.
      // Instead, we create conn first, then pass its state to dispatch.
      // To do that we need to build conn first — but conn needs onMessage and
      // onDisconnect callbacks that reference dispatch. We use arrow functions
      // that capture `this` to break the cycle at runtime.
      null as never, // placeholder — reassigned below
      {
        maxConcurrent: options.maxConcurrent,
        maxQueueDepth: options.maxQueueDepth,
        log,
        send: (msg): void => { this.conn.send(msg); },
      },
    );

    this.conn = new BridgeConnection({
      getSecret: (): string => this.secret,
      maxPayload: options.maxPayload ?? 1_048_576,
      maxMessagesPerSecond: this.maxMessagesPerSecond,
      graceWindowMs: this.graceWindowMs,
      onGraceExpired: options.onGraceExpired,
      onBridgeConnect: options.onBridgeConnect,
      log,
      onMessage: (raw): void => { this.dispatch.routeMessage(raw); },
      onDisconnect: (): void => {
        this.dispatch.rejectAllPending(new JsonRpcError("Bridge disconnected", -32603));
      },
    });

    // Wire the real connection state into dispatch now that conn exists
    this.dispatch.setConnectionState(this.conn.state);
  }

  /**
   * Attach the WebSocket upgrade handler to the HTTP server.
   * Must be called once after the HTTP server is listening.
   * Requirements: requirements-hub.md §2.5
   */
  start(server: http.Server): void {
    this.conn.attach(server);
  }

  /**
   * Invoke a tool on the Bridge.
   * Requirements: requirements-hub.md §5.4, §9
   */
  async invoke(
    tool: string,
    args: Record<string, unknown>,
    timeout: number,
    sessionId?: string,
    agentHint?: string | null,
  ): Promise<ResultMessage> {
    return this.dispatch.invoke(tool, args, timeout, sessionId, agentHint);
  }

  /**
   * Send a cancel message for an in-flight invocation.
   * Requirements: requirements-hub.md §3.1
   */
  cancel(id: string): void {
    this.dispatch.cancel(id);
  }

  /**
   * Request a fresh full state snapshot from Bridge.
   * Requirements: requirements-hub.md §3.1
   */
  async requestState(): Promise<IDEState> {
    return this.dispatch.requestState();
  }

  isConnected(): boolean {
    return this.conn.state.connected;
  }

  onRegistryUpdate(cb: (tools: ToolRegistration[]) => void): void {
    this.conn.state.registryUpdateCb = cb;
  }

  onStateUpdate(cb: (patch: Partial<IDEState>) => void): void {
    this.conn.state.stateUpdateCb = cb;
  }

  validateProtocolVersion(received: string): boolean {
    return this.dispatch.validateProtocolVersion(received);
  }

  getConcurrencyStats(): ConcurrencyStats {
    return this.dispatch.getConcurrencyStats();
  }

  updateSecret(newSecret: string): void {
    this.secret = newSecret;
  }

  /**
   * Gracefully terminate the Bridge WebSocket connection.
   */
  async close(): Promise<void> {
    this.conn.close();
    this.dispatch.rejectAllPending(new JsonRpcError("Bridge server closed", -32603));
  }

  // ── Test-facing forwarding methods ──────────────────────────────────────────
  // These proxy internal lifecycle/routing calls so tests written against the
  // original monolithic BridgeServer still work after the class was split into
  // BridgeConnection + BridgeDispatch.

  /**
   * Forward an inbound raw message through the rate-limiter and then to the
   * dispatch layer. Mirrors the private handleMessage() that existed before the
   * split. Tests use this to simulate Bridge → Hub frames.
   */
  handleMessage(raw: string): void {
    this.conn.dispatchInbound(raw);
  }

  /**
   * Trigger a Bridge disconnect (stop heartbeat, clear socket, start grace
   * timer). Tests use this to simulate Bridge dropping the connection.
   */
  handleDisconnect(): void {
    this.conn.handleDisconnect();
  }

  /**
   * Simulate a Bridge reconnect (wire a new WebSocket). Tests use this to
   * verify that reconnecting within the grace window cancels the expiry timer.
   */
  handleConnect(ws: unknown): void {
    // BridgeConnection.handleConnect is public; the ws type is widened to
    // unknown here so test code can pass a plain mock object without importing
    // the WsSocket type.
    type WsLike = Parameters<BridgeConnection["handleConnect"]>[0];
    this.conn.handleConnect(ws as WsLike);
  }
}
