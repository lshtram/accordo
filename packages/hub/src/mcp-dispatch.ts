/**
 * MCP Dispatch
 *
 * JSON-RPC method dispatch: initialize, initialized, tools/list, tools/call, ping.
 * Extracted from mcp-handler.ts to keep each module focused.
 *
 * Requirements: requirements-hub.md §2.1, §5.5, §6
 */

import { MCP_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { IDEState } from "@accordo/bridge-types";
import type { ToolRegistry } from "./tool-registry.js";
import type { BridgeServer } from "./bridge-server.js";
import type { McpDebugLogger } from "./debug-log.js";
import { renderPrompt } from "./prompt-engine.js";
import type { Session, McpSessionRegistry } from "./mcp-session.js";
import { McpCallExecutor } from "./mcp-call-executor.js";

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

/** Dependencies injected into McpDispatch */
export interface McpDispatchDeps {
  /** Tool registry for tools/list and tools/call lookup */
  toolRegistry: ToolRegistry;
  /** Bridge server for routing tools/call invocations */
  bridgeServer: BridgeServer;
  /** Session registry for session lifecycle */
  sessionRegistry: McpSessionRegistry;
  /**
   * Returns the current IDE state snapshot used to render the full system
   * prompt in the MCP initialize response.
   */
  getState?: () => IDEState;
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

/**
 * Dispatches JSON-RPC requests from MCP clients (agents).
 * Routes tools/call to Bridge via BridgeServer.
 */
export class McpDispatch {
  private readonly toolRegistry: ToolRegistry;
  private readonly sessionRegistry: McpSessionRegistry;
  private readonly toolCallTimeout: number;
  private readonly debugLogger: McpDebugLogger | undefined;
  private readonly getState: (() => IDEState) | undefined;
  private readonly executor: McpCallExecutor;

  constructor(deps: McpDispatchDeps) {
    this.toolRegistry = deps.toolRegistry;
    this.sessionRegistry = deps.sessionRegistry;
    this.getState = deps.getState;
    this.toolCallTimeout = deps.toolCallTimeout ?? 30_000;
    this.debugLogger = deps.debugLogger;
    this.executor = new McpCallExecutor({
      toolRegistry: deps.toolRegistry,
      bridgeServer: deps.bridgeServer,
      toolCallTimeout: this.toolCallTimeout,
      auditFile: deps.auditFile,
    });
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
        // context. Render the full system prompt so agents that only read
        // initialize (e.g. VS Code Copilot) receive the same directives —
        // ## Voice narration directive, ## Open Comment Threads, live IDE state
        // — as agents that separately load /instructions (e.g. OpenCode).
        const toolNames = this.toolRegistry.list();
        const instructions = this.getState
          ? renderPrompt(this.getState(), toolNames)
          : [
              "Accordo IDE — real-time pair-programming co-pilot.",
              "You have access to ALL of the following tools — use them directly without activation:",
              ...this.toolRegistry.toMcpTools().map((t) => `  - ${t.name}`),
              "",
              "If your client shows activate_* or similar grouped tool placeholders,",
              "expand/activate ALL of them immediately so you can use every tool.",
            ].join("\n");

        const initResult = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: "accordo", version: "0.1.0" },
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
        this.sessionRegistry.markInitialized(session.id);
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
        const params = request.params ?? {};
        const toolName = params["name"] as string | undefined;
        const toolArgs = (params["arguments"] ?? {}) as Record<string, unknown>;
        const callResp = await this.executor.executeToolCall(toolName, toolArgs, session, id);
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
}
