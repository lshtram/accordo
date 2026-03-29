/**
 * Hub Server — SSE Connection Management
 *
 * Manages Server-Sent Events connections from MCP clients (VS Code,
 * OpenCode, Claude Code). These connections receive server-initiated
 * notifications such as `notifications/tools/list_changed` when the
 * Bridge reconnects and registers new tools.
 *
 * Pattern: factory function `createSseManager(deps)` returns an object
 * with methods to handle new SSE connections, push notifications,
 * query active connections, and clean up on shutdown.
 *
 * Requirements: requirements-hub.md §2.1 (SSE notifications)
 */

import type http from "node:http";
import type { McpDebugLogger } from "./debug-log.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A single active SSE connection entry.
 */
export interface SseConnection {
  /** The HTTP response stream held open for SSE writes. */
  res: http.ServerResponse;
  /** Keep-alive interval timer reference. */
  keepAlive: ReturnType<typeof setInterval>;
}

/**
 * A JSON-RPC notification to push to SSE clients.
 */
export interface SseNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}

// ─── Dependency Interface ──────────────────────────────────────────────────

/**
 * Dependencies injected into the SSE manager factory.
 */
export interface SseDeps {
  /** Optional debug logger for SSE connect/disconnect/notification events. */
  debugLogger?: McpDebugLogger;
  /**
   * Extract a short agent identifier from a User-Agent header value.
   * Used for debug logging only.
   */
  extractAgentHint: (ua: string | string[] | undefined) => string | undefined;
}

// ─── Return Type ────────────────────────────────────────────────────────────

/**
 * The SSE manager object returned by `createSseManager()`.
 */
export interface SseManager {
  /**
   * Handle a GET /mcp request to establish an SSE notification stream.
   *
   * Sets up:
   * - SSE response headers (text/event-stream)
   * - Socket-level timeout disabling (prevents Node's requestTimeout killing the stream)
   * - Keep-alive pings every 30s
   * - Cleanup on client disconnect
   *
   * @param req - Incoming HTTP request
   * @param res - HTTP response object (held open for SSE)
   */
  handleMcpSse: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  /**
   * Push a JSON-RPC notification to all active SSE connections.
   *
   * Used to send `notifications/tools/list_changed` when the tool
   * registry updates. Silently cleans up dead connections.
   *
   * @param notification - JSON-RPC notification object
   */
  pushSseNotification: (notification: SseNotification) => void;

  /**
   * Return the number of currently active SSE connections.
   */
  getConnectionCount: () => number;

  /**
   * Close all SSE connections and clean up keep-alive timers.
   * Called during graceful shutdown.
   */
  closeAll: () => void;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the SSE connection manager.
 *
 * Internal state:
 * - `sseConnections: Map<string, SseConnection>` — keyed by a random connection ID
 *
 * @param deps - Injected dependencies
 * @returns SseManager object
 */
export function createSseManager(deps: SseDeps): SseManager {
  const sseConnections = new Map<string, SseConnection>();

  function cleanup(connId: string): void {
    const entry = sseConnections.get(connId);
    if (entry) {
      clearInterval(entry.keepAlive);
      sseConnections.delete(connId);
    }
  }

  function handleMcpSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    const connId = Math.random().toString(36).slice(2);
    const agentHint = deps.extractAgentHint(req.headers["user-agent"]);

    // Disable socket-level timeouts so Node doesn't kill this long-lived stream.
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true, 30_000);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // SSE endpoint confirmation ping
    try {
      res.write(": accordo-hub SSE connected\n\n");
    } catch {
      // Connection already gone before we could send confirmation — bail out
      return;
    }

    deps.debugLogger?.logSseConnect(connId, agentHint);

    // Send SSE comment every 30s to keep the stream alive.
    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // Socket already gone — cleanup happens in close handler
      }
    }, 30_000);

    sseConnections.set(connId, { res, keepAlive });

    // Remove when client disconnects (req stream closes)
    req.on("close", () => {
      cleanup(connId);
      deps.debugLogger?.logSseDisconnect(connId);
    });

    // Also intercept res.destroy so tests that destroy the response directly
    // can trigger cleanup synchronously.
    const originalDestroy = res.destroy.bind(res);
    res.destroy = (...args: Parameters<typeof res.destroy>): http.ServerResponse => {
      cleanup(connId);
      return originalDestroy(...args);
    };
  }

  function pushSseNotification(notification: SseNotification): void {
    if (sseConnections.size === 0) return;
    deps.debugLogger?.logSseNotification(notification.method, sseConnections.size);
    const data = `data: ${JSON.stringify(notification)}\n\n`;
    for (const [id, entry] of sseConnections) {
      try {
        entry.res.write(data);
      } catch {
        // Connection closed — clean up timer and entry
        clearInterval(entry.keepAlive);
        sseConnections.delete(id);
      }
    }
  }

  function getConnectionCount(): number {
    return sseConnections.size;
  }

  function closeAll(): void {
    for (const [, entry] of sseConnections) {
      clearInterval(entry.keepAlive);
    }
    sseConnections.clear();
  }

  return {
    handleMcpSse,
    pushSseNotification,
    getConnectionCount,
    closeAll,
  };
}
