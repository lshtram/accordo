/**
 * Hub MCP Handler
 *
 * Dispatches JSON-RPC requests from MCP clients (agents).
 * Manages MCP sessions. Routes tools/call to Bridge via BridgeServer.
 *
 * Requirements: requirements-hub.md §2.1, §5.5, §6
 */

import { MCP_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { ToolRegistry } from "./tool-registry.js";
import type { BridgeServer } from "./bridge-server.js";
import { JsonRpcError } from "./errors.js";
import { hashArgs, writeAuditEntry } from "./audit-log.js";
import type { AuditEntry } from "./audit-log.js";
import type { McpDebugLogger } from "./debug-log.js";

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
  /**
   * Optional debug logger. When provided, every JSON-RPC exchange is logged
   * in full — including the tool list returned by tools/list and the
   * instructions text injected into the agent's context by initialize.
   */
  debugLogger?: McpDebugLogger;
}

export class McpHandler {
  private sessions = new Map<string, Session>();
  private toolRegistry: ToolRegistry;
  private bridgeServer: BridgeServer;
  private toolCallTimeout: number;
  private auditFile: string | undefined;
  private debugLogger: McpDebugLogger | undefined;

  constructor(deps: McpHandlerDeps) {
    this.toolRegistry = deps.toolRegistry;
    this.bridgeServer = deps.bridgeServer;
    this.toolCallTimeout = deps.toolCallTimeout ?? 30_000;
    this.auditFile = deps.auditFile;
    this.debugLogger = deps.debugLogger;
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
    agentHint?: string,
  ): Promise<JsonRpcResponse | null> {
    // Type-narrow here: `?? null` eliminates `undefined`, so id is never undefined
    const id: string | number | null = request.id ?? null;

    // Update session activity timestamp
    session.lastActivity = Date.now();
    const rpcStart = Date.now();

    // Log every incoming RPC method
    this.debugLogger?.logRpcReceived({
      sessionId: session.id,
      rpcMethod: request.method || "(empty)",
      rpcParams: request.params,
      agent: agentHint,
    });

    // Empty method string → Invalid request
    if (!request.method) {
      const errResp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid request" },
      };
      this.debugLogger?.logRpcResponded({
        sessionId: session.id,
        rpcMethod: "(empty)",
        error: errResp.error,
        durationMs: Date.now() - rpcStart,
      });
      return errResp;
    }

    switch (request.method) {
      case "initialize": {
        // MCP spec: the `instructions` field is included in the agent's system
        // context. We use it to tell agents about the FULL tool set so they
        // don't rely on progressive discovery (activate_* virtual tools).
        const toolNames = this.toolRegistry.toMcpTools().map((t) => t.name);
        const instructions = [
          "Accordo IDE — real-time pair-programming co-pilot.",
          "You have access to ALL of the following tools — use them directly without activation:",
          ...toolNames.map((n) => `  - ${n}`),
          "",
          "If your client shows activate_* or similar grouped tool placeholders,",
          "expand/activate ALL of them immediately so you can use every tool.",
        ].join("\n");

        const initResult = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: "accordo-hub", version: "0.1.0" },
          capabilities: { tools: { listChanged: true } },
          instructions,
        };
        this.debugLogger?.logInitializeSent({
          sessionId: session.id,
          protocolVersion: MCP_PROTOCOL_VERSION,
          instructions,
          capabilities: initResult.capabilities,
        });
        const initResp: JsonRpcResponse = { jsonrpc: "2.0", id, result: initResult };
        this.debugLogger?.logRpcResponded({
          sessionId: session.id,
          rpcMethod: "initialize",
          result: initResult,
          durationMs: Date.now() - rpcStart,
        });
        return initResp;
      }

      case "initialized": {
        // Notification — mark session initialized, no response
        const s = this.sessions.get(session.id);
        if (s) s.initialized = true;
        // Notifications have no id and return null — just note it was received
        this.debugLogger?.logRpcResponded({
          sessionId: session.id,
          rpcMethod: "initialized",
          result: null,
          durationMs: Date.now() - rpcStart,
        });
        return null;
      }

      case "tools/list": {
        const mcpTools = this.toolRegistry.toMcpTools();
        this.debugLogger?.logToolsListSent({ sessionId: session.id, tools: mcpTools });
        const listResp: JsonRpcResponse = {
          jsonrpc: "2.0",
          id,
          result: { tools: mcpTools },
        };
        this.debugLogger?.logRpcResponded({
          sessionId: session.id,
          rpcMethod: "tools/list",
          result: { toolCount: mcpTools.length },
          durationMs: Date.now() - rpcStart,
        });
        return listResp;
      }

      case "tools/call": {
        const callResp = await this.handleToolsCall(request, session, id);
        this.debugLogger?.logRpcResponded({
          sessionId: session.id,
          rpcMethod: "tools/call",
          result: callResp.result,
          error: callResp.error,
          durationMs: Date.now() - rpcStart,
        });
        return callResp;
      }

      case "ping": {
        const pingResp: JsonRpcResponse = { jsonrpc: "2.0", id, result: {} };
        this.debugLogger?.logRpcResponded({
          sessionId: session.id,
          rpcMethod: "ping",
          result: {},
          durationMs: Date.now() - rpcStart,
        });
        return pingResp;
      }

      default: {
        const unknownResp: JsonRpcResponse = {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        };
        this.debugLogger?.logRpcResponded({
          sessionId: session.id,
          rpcMethod: request.method,
          error: unknownResp.error,
          durationMs: Date.now() - rpcStart,
        });
        return unknownResp;
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
      // M32: idempotent timeout retry — attempt once for tools marked idempotent: true.
      const isInvokeTimeout = (e: unknown): boolean => {
        if (e instanceof JsonRpcError) {
          return e.code === -32000 || e.message.toLowerCase().includes("timed out");
        }
        if (e instanceof Error) {
          return (
            e.message.toLowerCase().includes("timed out") ||
            e.message.toLowerCase().includes("timeout")
          );
        }
        return false;
      };

      if (isInvokeTimeout(err) && tool.idempotent === true) {
        const firstMsg = err instanceof Error ? err.message : String(err);
        audit("timeout", firstMsg);
        try {
          const retryResult = await this.bridgeServer.invoke(toolName, toolArgs, this.toolCallTimeout);
          if (!retryResult.success) {
            audit("error", retryResult.error ?? "Tool execution failed");
            return {
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: retryResult.error ?? "Tool execution failed" }],
                isError: true,
              },
            };
          }
          audit("success");
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(retryResult.data ?? {}) }],
            },
          };
        } catch (retryErr: unknown) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          audit(isInvokeTimeout(retryErr) ? "timeout" : "error", retryMsg);
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32001, message: "Tool invocation timed out" },
          };
        }
      }

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
  createSession(agentHint?: string): Session {
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastActivity: now,
      initialized: false,
    };
    this.sessions.set(session.id, session);
    this.debugLogger?.logSessionCreated(session.id, agentHint);
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

