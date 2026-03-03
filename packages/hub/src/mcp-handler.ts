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
import { hashArgs, writeAuditEntry } from "./audit-log.js";
import type { AuditEntry } from "./audit-log.js";

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
  /**
   * Timeout in ms for a single tool-call invocation.
   * Default: 30 000. Override in tests to avoid 30-second waits.
   */
  toolCallTimeout?: number;
  /**
   * Absolute path to the JSONL audit log file.
   * When set, every tools/call completion is logged via writeAuditEntry().
   * requirements-hub.md §7
   */
  auditFile?: string;
}

export class McpHandler {
  private sessions = new Map<string, Session>();
  private toolRegistry: ToolRegistry;
  private bridgeServer: BridgeServer;
  private toolCallTimeout: number;
  private auditFile: string | undefined;

  constructor(deps: McpHandlerDeps) {
    this.toolRegistry = deps.toolRegistry;
    this.bridgeServer = deps.bridgeServer;
    this.toolCallTimeout = deps.toolCallTimeout ?? 30_000;
    this.auditFile = deps.auditFile;
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
    session: Session,
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

    const startMs = Date.now();

    /** Write one audit entry when auditFile is configured. */
    const audit = (result: AuditEntry["result"], errorMessage?: string): void => {
      if (!this.auditFile) return;
      const entry: AuditEntry = {
        ts: new Date().toISOString(),
        tool: toolName,
        argsHash: hashArgs(toolArgs),
        sessionId: session.id,
        result,
        durationMs: Date.now() - startMs,
      };
      if (errorMessage !== undefined) entry.errorMessage = errorMessage;
      writeAuditEntry(this.auditFile, entry);
    };

    // Invoke via bridge server (handles connection + concurrency checks)
    try {
      const result = await this.bridgeServer.invoke(toolName, toolArgs, this.toolCallTimeout);
      if (!result.success) {
        // Tool handler returned an error — surface as MCP tool error so agents
        // can read the message and adapt. isError:true signals the LLM that the
        // tool itself failed (not a protocol error).
        audit("error", result.error ?? "Tool execution failed");
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

      // Detect soft errors: editor tools catch exceptions and return
      // { error: "..." } as successful data rather than throwing.
      // requirements-hub.md §7 — these must be classified as "error" in the
      // audit log and surfaced with isError:true so agents can adapt.
      const data = result.data ?? {};
      const softErrorMsg: string | undefined =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof (data as Record<string, unknown>)["error"] === "string"
          ? ((data as Record<string, unknown>)["error"] as string)
          : undefined;

      if (softErrorMsg !== undefined) {
        audit("error", softErrorMsg);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: softErrorMsg }],
            isError: true,
          },
        };
      }

      audit("success");
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(data),
            },
          ],
        },
      };
    } catch (err: unknown) {
      if (err instanceof JsonRpcError) {
        const isTimeout = err.code === -32001 || err.message.toLowerCase().includes("timed out");
        audit(isTimeout ? "timeout" : "error", err.message);
        return {
          jsonrpc: "2.0",
          id,
          error: { code: err.code, message: err.message },
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("timeout")) {
        audit("timeout");
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: "Tool invocation timed out" },
        };
      }
      audit("error", msg);
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

