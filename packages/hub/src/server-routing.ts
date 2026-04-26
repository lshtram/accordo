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
 * Requirements: requirements-runtime-directives.md Y-03, Y-07
 */

import type http from "node:http";
import type {
  HealthResponse,
  RuntimeDirectiveCatalog,
  RuntimeDirectiveDiagnostics,
  RuntimeDirectivePublication,
  ToolRegistration,
} from "@accordo/bridge-types";
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
  /**
   * Render the base system prompt (no runtime directives).
   * Used as fallback when runtimeDirectiveCatalog is not available.
   */
  renderPrompt: (state: IDEState, tools: ToolRegistration[]) => string;
  /** Return browser extension relay status (connection + control consent). */
  getBrowserStatus: () => { connected: boolean; controlGranted: boolean };
  /**
   * Optional runtime directive catalog. When provided:
   * - /instructions includes runtime directives (Y-03 parity with initialize)
   * - /runtime-directives and /runtime-directives/diagnostics are wired
   * Requirements: requirements-runtime-directives.md Y-02, Y-03, Y-07
   */
  runtimeDirectiveCatalog?: RuntimeDirectiveCatalog;
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

// ─── Helper types ───────────────────────────────────────────────────────────

type HeaderRecord = Record<string, string>;

function jsonHead(status: number): { status: number; headers: HeaderRecord } {
  return { status, headers: { "Content-Type": "application/json" } };
}

// ─── Route handler helpers ─────────────────────────────────────────────────

/**
 * Respond to /health — no auth required.
 */
function handleHealth(deps: RouterDeps, res: http.ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(deps.getHealth()));
}

/**
 * Respond to /mcp POST — Bearer + Origin already validated by caller.
 */
function handleMcpPost(
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  deps.handleMcp(req, res);
}

/**
 * Respond to /mcp GET (SSE) — Bearer + Origin already validated by caller.
 */
function handleMcpGet(
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  deps.handleMcpSse(req, res);
}

/**
 * Respond to wrong HTTP method on /mcp.
 */
function handleMcpMethodNotAllowed(res: http.ServerResponse): void {
  res.writeHead(405, { "Content-Type": "application/json", "Allow": "POST, GET" });
  res.end(JSON.stringify({ error: "Method not allowed" }));
}

/**
 * Respond to /instructions — includes runtime directives when catalog is present.
 * Y-03: same directive bundle (version/digest/clause order) as initialize.
 */
function handleInstructions(deps: RouterDeps, res: http.ServerResponse): void {
  const state = deps.getState();
  const tools = deps.getTools();

  let prompt: string;
  if (deps.runtimeDirectiveCatalog) {
    // Y-03 parity: prepend runtime directives from catalog (same as initialize)
    prompt =
      deps.runtimeDirectiveCatalog.renderInstructions(state, tools) +
      "\n\n" +
      deps.renderPrompt(state, tools);
  } else {
    prompt = deps.renderPrompt(state, tools);
  }

  res.writeHead(200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(prompt);
}

/**
 * Respond to /state — raw IDE state JSON.
 */
function handleState(deps: RouterDeps, res: http.ServerResponse): void {
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
}

/**
 * Respond to /bridge/reauth — Bridge secret validated by caller.
 */
function handleReauth(
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  deps.handleReauth(req, res);
}

/**
 * Respond to /bridge/disconnect — Bridge secret validated by caller.
 */
function handleDisconnect(
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  deps.handleDisconnect(req, res);
}

/**
 * Respond to /browser/status — Bearer already validated by caller.
 */
function handleBrowserStatus(deps: RouterDeps, res: http.ServerResponse): void {
  const browserStatus = deps.getBrowserStatus();
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(browserStatus));
}

/**
 * Respond to /runtime-directives — catalog must be present.
 * Y-07: authenticated, returns canonical publication payload.
 */
function handleRuntimeDirectives(deps: RouterDeps, res: http.ServerResponse): void {
  if (!deps.runtimeDirectiveCatalog) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const publication: RuntimeDirectivePublication =
    deps.runtimeDirectiveCatalog.getPublication();
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(publication));
}

/**
 * Respond to /runtime-directives/diagnostics — catalog must be present.
 * Y-07/Y-08: authenticated, returns publication + delivery receipts.
 */
function handleRuntimeDirectivesDiagnostics(
  deps: RouterDeps,
  res: http.ServerResponse,
): void {
  if (!deps.runtimeDirectiveCatalog) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const diagnostics: RuntimeDirectiveDiagnostics =
    deps.runtimeDirectiveCatalog.getDiagnostics();
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(diagnostics));
}

// ─── Auth middleware helpers ─────────────────────────────────────────────────

/** Respond with 401 Unauthorized */
function unauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

/** Validate Bearer auth; call handler on success, respond 401 on failure */
function withBearerAuth(
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: () => void,
): void {
  if (!validateBearer(req, deps.getToken())) { unauthorized(res); return; }
  handler();
}

/** Validate Bridge secret; call handler on success, respond 401 on failure */
function withBridgeSecretAuth(
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: () => void,
): void {
  if (!validateBridgeSecret(req, deps.getBridgeSecret())) { unauthorized(res); return; }
  handler();
}

// ─── Route descriptor ────────────────────────────────────────────────────────

type AuthMode = "none" | "bearer" | "bridge";

interface Route {
  url: string;
  method: string;
  auth: AuthMode;
  handler: (deps: RouterDeps, req: http.IncomingMessage, res: http.ServerResponse) => void;
}

/**
 * Route table — ordered by precedence (first match wins).
 * Auth middleware order: none → bearer → bridge (matches security order).
 */
const ROUTES: readonly Route[] = [
  { url: "/health",        method: "GET",  auth: "none",   handler: (d, _, r) => handleHealth(d, r) },
  { url: "/mcp",           method: "POST", auth: "bearer", handler: (d, req, r) => withBearerAuth(d, req, r, () => handleMcpPost(d, req, r)) },
  { url: "/mcp",           method: "GET",  auth: "bearer", handler: (d, req, r) => withBearerAuth(d, req, r, () => handleMcpGet(d, req, r)) },
  { url: "/mcp",           method: "*",    auth: "none",   handler: (_d, _req, r) => handleMcpMethodNotAllowed(r) },
  { url: "/instructions",   method: "GET",  auth: "bearer", handler: (d, req, r) => withBearerAuth(d, req, r, () => handleInstructions(d, r)) },
  { url: "/state",          method: "GET",  auth: "bearer", handler: (d, req, r) => withBearerAuth(d, req, r, () => handleState(d, r)) },
  { url: "/bridge/reauth",  method: "POST", auth: "bridge", handler: (d, req, r) => withBridgeSecretAuth(d, req, r, () => handleReauth(d, req, r)) },
  { url: "/bridge/disconnect", method: "POST", auth: "bridge", handler: (d, req, r) => withBridgeSecretAuth(d, req, r, () => handleDisconnect(d, req, r)) },
  { url: "/browser/status", method: "GET",  auth: "bearer", handler: (d, req, r) => withBearerAuth(d, req, r, () => handleBrowserStatus(d, r)) },
  { url: "/runtime-directives",         method: "GET", auth: "bearer", handler: (d, req, r) => withBearerAuth(d, req, r, () => handleRuntimeDirectives(d, r)) },
  { url: "/runtime-directives/diagnostics", method: "GET", auth: "bearer", handler: (d, req, r) => withBearerAuth(d, req, r, () => handleRuntimeDirectivesDiagnostics(d, r)) },
];

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
  /**
   * Route an incoming HTTP request to the correct endpoint handler.
   * Security middleware runs first on every authenticated endpoint.
   */
  function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "/";
    const method = req.method ?? "";

    // §2.4: /health — no auth required
    if (url === "/health" && method === "GET") {
      handleHealth(deps, res);
      return;
    }

    // §2.1: Origin validation on all other authenticated endpoints
    if (!validateOrigin(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: invalid origin" }));
      return;
    }

    // Route table — first match wins
    for (const route of ROUTES) {
      if (route.url !== url) continue;
      if (route.method !== "*" && route.method !== method) continue;

      if (route.auth === "bearer") {
        withBearerAuth(deps, req, res, () => route.handler(deps, req, res));
      } else if (route.auth === "bridge") {
        withBridgeSecretAuth(deps, req, res, () => route.handler(deps, req, res));
      } else {
        route.handler(deps, req, res);
      }
      return;
    }

    // Unknown endpoint
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  return { handleHttpRequest };
}
