/**
 * Hub Server — HTTP Request Routing
 *
 * Extracts the URL-based routing switch and individual endpoint handlers
 * from server.ts. Security middleware (Origin validation, Bearer auth,
 * Bridge secret) executes FIRST on every authenticated endpoint — the
 * exact order from the original server.ts is preserved.
 *
 * Pattern: factory function `createRouter(deps)` returns a `handleHttpRequest`
 * function that HubServer wires into http.createServer().
 *
 * Requirements: requirements-hub.md §2.1–§2.4, §2.6, §5.6
 */

import type http from "node:http";
import type { HealthResponse } from "@accordo/bridge-types";
import type { ToolRegistration } from "@accordo/bridge-types";
import type { IDEState } from "@accordo/bridge-types";
import { validateOrigin, validateBearer, validateBridgeSecret } from "./security.js";

// ─── Dependency Interface ──────────────────────────────────────────────────

/**
 * Dependencies injected into the router factory.
 *
 * Every field maps to a capability that HubServer owns or can provide
 * via its internal components. No direct class references — only the
 * function signatures the router needs.
 */
export interface RouterDeps {
  /** Returns the current bearer token (may change after reauth). */
  getToken: () => string;
  /** Returns the current bridge secret (may change after reauth). */
  getBridgeSecret: () => string;

  // ── Delegate handlers (owned by other server-* modules) ──
  /** Handle POST /mcp — MCP Streamable HTTP endpoint. */
  handleMcp: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  /** Handle GET /mcp — SSE notification stream for MCP clients. */
  handleMcpSse: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  /** Handle POST /bridge/reauth — credential rotation. */
  handleReauth: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  /**
   * Handle POST /bridge/disconnect — graceful Bridge disconnection.
   * Starts the grace timer for reload survival.
   * Requirements: adr-reload-reconnect.md §D1
   */
  handleDisconnect: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  // ── Data providers for endpoints handled directly by the router ──
  /** Build a HealthResponse from current server state. */
  getHealth: () => HealthResponse;
  /** Return the current IDEState snapshot. */
  getState: () => IDEState;
  /** Return all registered tools for the instructions prompt. */
  getTools: () => ToolRegistration[];
  /** Render the system prompt from state and tools. */
  renderPrompt: (state: IDEState, tools: ToolRegistration[]) => string;
  /** Return browser extension relay status (connection + control consent). */
  getBrowserStatus: () => { connected: boolean; controlGranted: boolean };
}

// ─── Return Type ────────────────────────────────────────────────────────────

/**
 * The router object returned by `createRouter()`.
 */
export interface Router {
  /**
   * Route an incoming HTTP request to the correct endpoint handler.
   * Security middleware runs first on every authenticated endpoint.
   *
   * @param req - Incoming HTTP request
   * @param res - HTTP response object
   */
  handleHttpRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the HTTP request router.
 *
 * Auth middleware execution order (preserved from server.ts):
 * 1. /health — no auth
 * 2. validateOrigin() on all other endpoints
 * 3. validateBearer() on /mcp POST, /mcp GET, /instructions, /state
 * 4. validateBridgeSecret() on /bridge/reauth
 *
 * @param deps - Injected dependencies
 * @returns Router object with handleHttpRequest
 */
export function createRouter(deps: RouterDeps): Router {
  function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "/";

    // §2.4: /health — no auth required
    if (url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(deps.getHealth()));
      return;
    }

    // §2.1: Origin validation on all authenticated endpoints
    if (!validateOrigin(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: invalid origin" }));
      return;
    }

    // §2.1: /mcp POST — Bearer auth + Origin already validated
    if (url === "/mcp" && req.method === "POST") {
      if (!validateBearer(req, deps.getToken())) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      deps.handleMcp(req, res);
      return;
    }

    // §2.1: /mcp GET — SSE notification stream for MCP clients
    if (url === "/mcp" && req.method === "GET") {
      if (!validateBearer(req, deps.getToken())) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      deps.handleMcpSse(req, res);
      return;
    }

    // §2.1: /mcp — wrong HTTP method
    if (url === "/mcp") {
      res.writeHead(405, { "Content-Type": "application/json", "Allow": "POST, GET" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // §2.3: /instructions — Bearer auth
    if (url === "/instructions" && req.method === "GET") {
      if (!validateBearer(req, deps.getToken())) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const state = deps.getState();
      const tools = deps.getTools();
      const prompt = deps.renderPrompt(state, tools);
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(prompt);
      return;
    }

    // /state — raw IDE state JSON (Bearer auth)
    if (url === "/state" && req.method === "GET") {
      if (!validateBearer(req, deps.getToken())) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const state = deps.getState();

      // M43: hoist full thread list to top-level commentThreads when published
      const commentModality = state.modalities["accordo-comments"];
      const commentThreads = Array.isArray(commentModality?.["threads"])
        ? (commentModality["threads"] as unknown[])
        : undefined;

      const response: Record<string, unknown> = { ...state };
      if (commentThreads !== undefined) {
        response["commentThreads"] = commentThreads;
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(response, null, 2));
      return;
    }

    // §2.6: /bridge/reauth — bridge secret auth
    if (url === "/bridge/reauth" && req.method === "POST") {
      if (!validateBridgeSecret(req, deps.getBridgeSecret())) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      deps.handleReauth(req, res);
      return;
    }

    // ADR-reload-reconnect §D1: /bridge/disconnect — bridge secret auth
    if (url === "/bridge/disconnect" && req.method === "POST") {
      if (!validateBridgeSecret(req, deps.getBridgeSecret())) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      deps.handleDisconnect(req, res);
      return;
    }

    // Browser extension relay status — Bearer auth
    if (url === "/browser/status" && req.method === "GET") {
      if (!validateBearer(req, deps.getToken())) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const browserStatus = deps.getBrowserStatus();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(browserStatus));
      return;
    }

    // Unknown endpoint
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  return { handleHttpRequest };
}
