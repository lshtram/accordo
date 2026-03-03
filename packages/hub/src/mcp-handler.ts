/**
 * Hub MCP Handler
 *
 * Dispatches JSON-RPC requests from MCP clients (agents).
 * Manages MCP sessions. Routes tools/call to Bridge via BridgeServer.
 *
 * Requirements: requirements-hub.md §2.1, §5.5, §6
 */

import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { ToolRegistry } from "./tool-registry.js";
import type { BridgeServer } from "./bridge-server.js";
import { JsonRpcError } from "./errors.js";

/** Represents an active MCP session */
export interface Session {
  id: string;
  createdAt: number;
  lastActivity: number;
  initialized: boolean;
}

/** JSON-RPC 2.0 request */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Dependencies injected into McpHandler */
export interface McpHandlerDeps {
  /** Tool registry for tools/list and tools/call lookup */
  toolRegistry: ToolRegistry;
  /** Bridge server for routing tools/call invocations */
  bridgeServer: BridgeServer;
}

export class McpHandler {
  private sessions = new Map<string, Session>();
  private toolRegistry: ToolRegistry;
  private bridgeServer: BridgeServer;

  constructor(deps: McpHandlerDeps) {
    this.toolRegistry = deps.toolRegistry;
    this.bridgeServer = deps.bridgeServer;
  }

  /**
   * Dispatch a JSON-RPC request to the appropriate MCP method handler.
   *
   * Supports: initialize, initialized, tools/list, tools/call, ping.
   * Returns null for notifications (no id).
   *
   * @param request - Parsed JSON-RPC 2.0 request
   * @param session - The session associated with this request
   * @returns JSON-RPC response, or null for notifications
   */
  async handleRequest(
    request: JsonRpcRequest,
    session: Session,
  ): Promise<JsonRpcResponse | null> {
    // Type-narrow here: `?? null` eliminates `undefined`, so id is never undefined
    const id: string | number | null = request.id ?? null;

    // Update session activity timestamp
    session.lastActivity = Date.now();

    // Empty method string → Invalid request
    if (!request.method) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid request" },
      };
    }

    switch (request.method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: ACCORDO_PROTOCOL_VERSION,
            serverInfo: { name: "accordo-hub", version: "0.1.0" },
            capabilities: { tools: {} },
          },
        };
      }

      case "initialized": {
        // Notification — mark session initialized, no response
        const s = this.sessions.get(session.id);
        if (s) s.initialized = true;
        return null;
      }

      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: this.toolRegistry.toMcpTools() },
        };
      }

      case "tools/call": {
        return this.handleToolsCall(request, session, id);
      }

      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }

      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        };
      }
    }
  }

  /**
   * Handle tools/call — route invocation to Bridge via BridgeServer.
   *
   * Error codes (requirements-hub.md §6):
   *   -32601 "Unknown tool: <name>" — tool not in registry
   *   -32603 "Bridge not connected" — no Bridge WS connection
   *   -32004 "Server busy — invocation queue full" — queue full
   *   -32001 "Tool invocation timed out" — handler timed out
   *   -32603 internal error — handler failure
   *
   * @param request - The tools/call JSON-RPC request
   * @param session - Associated MCP session
   * @param id - Request ID for the response
   * @returns JSON-RPC response with tool result or error
   */
  private async handleToolsCall(
    request: JsonRpcRequest,
    _session: Session,
    id: string | number | null,
  ): Promise<JsonRpcResponse> {
    const params = request.params ?? {};
    const toolName = params["name"] as string | undefined;
    const toolArgs = (params["arguments"] ?? {}) as Record<string, unknown>;

    // Validate params
    if (!toolName) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Invalid params: missing name" },
      };
    }

    // Check tool exists in registry
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      };
    }

    // Invoke via bridge server (handles connection + concurrency checks)
    try {
      const result = await this.bridgeServer.invoke(toolName, toolArgs, 30_000);
      if (!result.success) {
        // Tool handler returned an error — surface as MCP tool error so agents
        // can read the message and adapt. isError:true signals the LLM that the
        // tool itself failed (not a protocol error).
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: result.error ?? "Tool execution failed",
              },
            ],
            isError: true,
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data ?? {}),
            },
          ],
        },
      };
    } catch (err: unknown) {
      if (err instanceof JsonRpcError) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: err.code, message: err.message },
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("timeout")) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: "Tool invocation timed out" },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: msg },
      };
    }
  }

  /**
   * Create a new MCP session. Called on each `initialize` request.
   *
   * @returns A new Session with a unique UUID
   */
  createSession(): Session {
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastActivity: now,
      initialized: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Look up an existing session by its Mcp-Session-Id.
   *
   * @param id - Session ID string
   * @returns The session, or undefined if not found
   */
  getSession(id: string): Session | undefined {
    if (!id) return undefined;
    return this.sessions.get(id);
  }
}

