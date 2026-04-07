/**
 * Bridge Connection Manager
 *
 * WebSocket connection management: accept, authenticate, heartbeat, disconnect.
 * Shared connection state is held in a BridgeConnectionState object that is
 * passed into bridge-dispatch so both modules operate on the same data.
 *
 * Requirements: requirements-hub.md §2.5, §9.2, M31, M33, M34
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type http from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket as WsSocket } from "ws";
import type { ToolRegistration } from "@accordo/bridge-types";
import type { IDEState } from "@accordo/bridge-types";

const PING_INTERVAL_MS = 30_000;

/**
 * Mutable connection state shared between BridgeConnection and BridgeDispatch.
 * Both modules hold a reference to the same object.
 */
export interface BridgeConnectionState {
  connected: boolean;
  ws: WsSocket | null;
  pingInterval: ReturnType<typeof setInterval> | null;
  // M33: rate limiting counters
  messageCount: number;
  messageWindowStart: number;
  // M31: grace timer
  graceTimer: ReturnType<typeof setTimeout> | null;
  // callbacks
  registryUpdateCb: ((tools: ToolRegistration[]) => void) | null;
  stateUpdateCb: ((patch: Partial<IDEState>) => void) | null;
}

/** Options used by BridgeConnection */
export interface BridgeConnectionOptions {
  /** Getter so the connection can read the current secret even after rotation */
  getSecret: () => string;
  /** Max WS payload size (bytes). Default: 1_048_576. M34 */
  maxPayload: number;
  /** Max inbound messages per second. Default: 100. M33 */
  maxMessagesPerSecond: number;
  /** Grace window (ms) after disconnect. Default: 15_000. M31 */
  graceWindowMs: number;
  /** Called when the grace window expires without reconnect. M31 */
  onGraceExpired?: () => void;
  /** Called when a new Bridge WS connection is established (including reconnect). */
  onBridgeConnect?: () => void;
  /** Called when a new message arrives (post-rate-limit). */
  onMessage: (raw: string) => void;
  /**
   * Called synchronously when the connection drops, before the grace timer
   * starts. Use this to reject all in-flight invocations.
   */
  onDisconnect: () => void;
  /** Diagnostic log function */
  log: (msg: string) => void;
}

/** Manages the WebSocket connection lifecycle for the Bridge → Hub link. */
export class BridgeConnection {
  /** Shared state object — also held by BridgeDispatch. */
  readonly state: BridgeConnectionState;

  private readonly opts: BridgeConnectionOptions;

  constructor(opts: BridgeConnectionOptions) {
    this.opts = opts;
    this.state = {
      connected: false,
      ws: null,
      pingInterval: null,
      messageCount: 0,
      messageWindowStart: 0,
      graceTimer: null,
      registryUpdateCb: null,
      stateUpdateCb: null,
    };
  }

  /**
   * Attach the WebSocket upgrade handler to the HTTP server.
   * Must be called once after the HTTP server is listening.
   * Requirements: requirements-hub.md §2.5
   */
  attach(server: http.Server): void {
    const wss = new WebSocketServer({ noServer: true, maxPayload: this.opts.maxPayload });

    server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/bridge") return;

      const remoteAddr = (socket as unknown as { remoteAddress?: string }).remoteAddress ?? "unknown";
      this.opts.log(`[hub:bridge] WS upgrade request from ${remoteAddr}`);

      // §2.5: Validate secret on upgrade — 401 if wrong
      const providedSecret = req.headers["x-accordo-secret"];
      if (providedSecret !== this.opts.getSecret()) {
        this.opts.log(`[hub:bridge] WS upgrade REJECTED — bad secret from ${remoteAddr}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // §2.5: Max 1 connection — evict stale connection before accepting new one
      if (this.state.connected && this.state.ws) {
        this.opts.log("[hub:bridge] evicting stale Bridge socket");
        const stale = this.state.ws;
        stale.removeAllListeners();
        stale.on("error", () => {});
        try { stale.terminate(); } catch { /* already gone */ }
        this.handleDisconnect();
      }

      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      } catch (err) {
        this.opts.log(`[hub:bridge] handleUpgrade error: ${(err as Error).message ?? err}`);
        socket.destroy();
      }
    });

    wss.on("connection", (ws: WsSocket) => {
      this.handleConnect(ws);
    });

    wss.on("error", (err) => {
      this.opts.log(`[hub:bridge] WebSocketServer error: ${(err as Error).message ?? err}`);
    });
  }

  /**
   * Send a JSON message on the current WebSocket, if open.
   */
  send(msg: Record<string, unknown>): void {
    if (this.state.ws && this.state.ws.readyState === this.state.ws.OPEN) {
      this.state.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Gracefully close the Bridge WebSocket.
   * Clears ping interval, grace timer, and the socket.
   */
  close(): void {
    if (this.state.pingInterval) {
      clearInterval(this.state.pingInterval);
      this.state.pingInterval = null;
    }
    if (this.state.graceTimer !== null) {
      clearTimeout(this.state.graceTimer);
      this.state.graceTimer = null;
    }
    if (this.state.ws) {
      this.state.ws.close();
      this.state.ws = null;
    }
    this.state.connected = false;
  }

  /**
   * Handle Bridge disconnect: stop heartbeat, clear socket, call onDisconnect,
   * then start M31 grace timer.
   *
   * Idempotent — safe to call multiple times (no-op when already disconnected).
   */
  handleDisconnect(): void {
    // Idempotency guard
    if (!this.state.connected) return;

    this.opts.log(`[hub:bridge] Bridge disconnected (graceMs=${this.opts.graceWindowMs})`);

    if (this.state.pingInterval) {
      clearInterval(this.state.pingInterval);
      this.state.pingInterval = null;
    }
    this.state.ws = null;
    this.state.connected = false;

    // Let the dispatch layer reject in-flight calls
    this.opts.onDisconnect();

    // M31: start grace window — hold state until reconnect or expiry.
    if (this.opts.graceWindowMs === 0) {
      // Zero-ms grace: fire synchronously — no deferred timer.
      this.opts.onGraceExpired?.();
    } else {
      this.state.graceTimer = setTimeout(() => {
        this.state.graceTimer = null;
        this.opts.onGraceExpired?.();
      }, this.opts.graceWindowMs);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * M31: Wire up a new WebSocket connection.
   * Handles both initial connect and reconnect-within-grace-window.
   * Public so that BridgeServer can expose it as a test-facing shim.
   */
  handleConnect(ws: WsSocket): void {
    try {
      this.opts.log("[hub:bridge] Bridge connected");

      // Cancel any running grace timer — Bridge reconnected within the window.
      if (this.state.graceTimer !== null) {
        clearTimeout(this.state.graceTimer);
        this.state.graceTimer = null;
      }

      this.state.ws = ws;
      this.state.connected = true;

      // Notify listeners that a Bridge connection is now live (including reconnect).
      this.opts.onBridgeConnect?.();

      // §9.2: Heartbeat — send ping every 30 s
      this.state.pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          this.send({ type: "ping", ts: Date.now() });
        }
      }, PING_INTERVAL_MS);

      ws.on("message", (data) => {
        this.dispatchInbound(data.toString());
      });

      ws.on("close", () => {
        this.handleDisconnect();
      });

      // Capture the error for logging. The ws library always emits 'close'
      // after 'error', so handleDisconnect() will run from the close handler;
      // calling it here as well would double-fire. Just log the error.
      ws.on("error", (err) => {
        this.opts.log(`[hub:bridge] socket error: ${(err as Error).message ?? err}`);
      });
    } catch (err) {
      this.opts.log(`[hub:bridge] handleConnect error: ${(err as Error).message ?? err}`);
      try { ws.terminate(); } catch { /* already gone */ }
    }
  }

  /** M33: Rate-limit inbound messages then forward to onMessage callback.
   * Public so that BridgeServer can expose it as a test-facing handleMessage shim.
   */
  dispatchInbound(raw: string): void {
    const now = Date.now();
    if (now - this.state.messageWindowStart >= 1000) {
      this.state.messageWindowStart = now;
      this.state.messageCount = 0;
    }
    this.state.messageCount++;
    if (this.state.messageCount > this.opts.maxMessagesPerSecond) {
      this.opts.log(`[hub:bridge] rate-limited — dropped message (>${this.opts.maxMessagesPerSecond} msg/s)`);
      return;
    }
    this.opts.onMessage(raw);
  }
}

// ─── Log helper factory (used by BridgeServer facade) ────────────────────────

/** Create the diagnostic log function that appends to ~/.accordo/bridge-server.log */
export function createBridgeLogger(): (msg: string) => void {
  const dir = path.join(os.homedir(), ".accordo");
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
  const logFile = path.join(dir, "bridge-server.log");

  return (msg: string): void => {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    } catch { /* swallow */ }
  };
}
