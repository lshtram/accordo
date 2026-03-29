/**
 * Hub Server — MCP Request Handler
 *
 * Handles POST /mcp — the MCP Streamable HTTP endpoint. Reads the
 * JSON-RPC request body, validates content-type and session, then
 * delegates to McpHandler for JSON-RPC dispatch.
 *
 * Also contains the `extractAgentHint()` utility shared by other
 * server-* modules for identifying which AI agent sent a request.
 *
 * Pattern: factory function `createMcpRequestHandler(deps)` returns
 * the `handleMcp` function wired into the router.
 *
 * Requirements: requirements-hub.md §2.1
 */

import type http from "node:http";
import type { McpHandler, Session, JsonRpcRequest } from "./mcp-handler.js";
import type { McpDebugLogger } from "./debug-log.js";

// ─── Dependency Interface ──────────────────────────────────────────────────

/**
 * Dependencies injected into the MCP request handler factory.
 */
export interface McpRequestHandlerDeps {
  /** The McpHandler instance for JSON-RPC dispatch. */
  mcpHandler: McpHandler;
  /** Optional debug logger for HTTP request/error logging. */
  debugLogger?: McpDebugLogger;
}

// ─── Return Type ────────────────────────────────────────────────────────────

/**
 * The MCP request handler object returned by `createMcpRequestHandler()`.
 */
export interface McpRequestHandler {
  /**
   * Handle POST /mcp — MCP Streamable HTTP endpoint.
   *
   * Steps:
   * 1. Validate Content-Type is application/json
   * 2. Validate session ID if present (fail-fast before body read)
   * 3. Read and parse JSON-RPC request body
   * 4. Create or reuse MCP session
   * 5. Dispatch to McpHandler.handleRequest()
   * 6. Write JSON-RPC response
   *
   * @param req - Incoming HTTP request (body not yet consumed)
   * @param res - HTTP response object
   */
  handleMcp: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

// ─── Shared Utility ─────────────────────────────────────────────────────────

/**
 * Extract a short agent identifier string from a User-Agent header value.
 *
 * Recognises: "github-copilot" → "copilot", "opencode" → "opencode",
 * "claude" → "claude", "cursor" → "cursor". Falls back to first 60 chars.
 *
 * Returns undefined when the header is missing.
 *
 * @param ua - User-Agent header value (string, string[], or undefined)
 * @returns Short agent hint or undefined
 */
export function extractAgentHint(ua: string | string[] | undefined): string | undefined {
  if (!ua) return undefined;
  const uaStr = Array.isArray(ua) ? ua[0] : ua;
  if (!uaStr) return undefined;
  const lower = uaStr.toLowerCase();
  if (lower.includes("github-copilot") || lower.includes("copilot")) return "copilot";
  if (lower.includes("opencode")) return "opencode";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("cursor")) return "cursor";
  return uaStr.slice(0, 60);
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the MCP POST request handler.
 *
 * @param deps - Injected dependencies
 * @returns McpRequestHandler with handleMcp function
 */
export function createMcpRequestHandler(deps: McpRequestHandlerDeps): McpRequestHandler {
  function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): void {
    // §2.1: Content-Type must be application/json
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unsupported Media Type: expected application/json" }));
      return;
    }

    // §2.1: Session handling — validate existing session synchronously before body read
    const incomingSessionId = req.headers["mcp-session-id"] as string | undefined;
    let existingSession: Session | undefined;
    if (incomingSessionId) {
      existingSession = deps.mcpHandler.getSession(incomingSessionId);
      if (!existingSession) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired session" }));
        return;
      }
    }

    // Read body first — headers/session are finalised only after successful parse
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      // Log the raw HTTP request
      deps.debugLogger?.logHttpRequest({
        httpMethod: req.method ?? "POST",
        url: req.url ?? "/mcp",
        remoteIp: req.socket?.remoteAddress,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        sessionId: incomingSessionId,
      });

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      // Create or reuse session and write headers now that the body is validated
      let session: Session;
      if (existingSession) {
        session = existingSession;
        res.writeHead(200, { "Content-Type": "application/json" });
      } else {
        session = deps.mcpHandler.createSession(extractAgentHint(req.headers["user-agent"]));
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": session.id,
        });
      }

      const agentHintForRequest = extractAgentHint(req.headers["user-agent"]);
      deps.mcpHandler
        .handleRequest(request, session, agentHintForRequest)
        .then((response) => {
          if (response !== null) {
            res.end(JSON.stringify(response));
          } else {
            res.end();
          }
        })
        .catch((err) => {
          deps.debugLogger?.logError?.(`handleRequest error: ${err instanceof Error ? err.message : String(err)}`);
          res.end();
        });
    });
  }

  return { handleMcp };
}
