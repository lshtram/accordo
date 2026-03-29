/**
 * Hub MCP Handler — composition root / facade
 *
 * Imports McpSessionRegistry (session lifecycle) and McpDispatch
 * (JSON-RPC method routing) and exposes the same McpHandler class
 * as before. All callers continue to import from this file.
 *
 * Requirements: requirements-hub.md §2.1, §5.5, §6
 */

import type { IDEState } from "@accordo/bridge-types";
import type { ToolRegistry } from "./tool-registry.js";
import type { BridgeServer } from "./bridge-server.js";
import type { McpDebugLogger } from "./debug-log.js";
import { McpSessionRegistry } from "./mcp-session.js";
import { McpDispatch } from "./mcp-dispatch.js";

// Re-export all public types so callers can continue to import from this file.
export type { Session } from "./mcp-session.js";
export type { JsonRpcRequest, JsonRpcResponse } from "./mcp-dispatch.js";

/** Dependencies injected into McpHandler */
export interface McpHandlerDeps {
  /** Tool registry for tools/list and tools/call lookup */
  toolRegistry: ToolRegistry;
  /** Bridge server for routing tools/call invocations */
  bridgeServer: BridgeServer;
  /**
   * Returns the current IDE state snapshot used to render the full system
   * prompt in the MCP initialize response. When provided, the initialize
   * instructions field contains the output of renderPrompt() — including
   * ## Voice, ## Open Comment Threads, and live IDE state — so agents that
   * only read initialize (e.g. VS Code Copilot) see the same directives
   * as agents that load /instructions separately (e.g. OpenCode).
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

export class McpHandler {
  private readonly sessionRegistry: McpSessionRegistry;
  private readonly dispatch: McpDispatch;

  constructor(deps: McpHandlerDeps) {
    this.sessionRegistry = new McpSessionRegistry({
      debugLogger: deps.debugLogger,
    });
    this.dispatch = new McpDispatch({
      toolRegistry: deps.toolRegistry,
      bridgeServer: deps.bridgeServer,
      sessionRegistry: this.sessionRegistry,
      getState: deps.getState,
      toolCallTimeout: deps.toolCallTimeout,
      auditFile: deps.auditFile,
      debugLogger: deps.debugLogger,
    });
  }

  /**
   * Dispatch a JSON-RPC request to the appropriate MCP method handler.
   *
   * Supports: initialize, initialized, tools/list, tools/call, ping.
   * Returns null for notifications (no id).
   */
  async handleRequest(
    request: import("./mcp-dispatch.js").JsonRpcRequest,
    session: import("./mcp-session.js").Session,
    agentHint?: string,
  ): Promise<import("./mcp-dispatch.js").JsonRpcResponse | null> {
    return this.dispatch.handleRequest(request, session, agentHint);
  }

  /**
   * Create a new MCP session. Called on each `initialize` request.
   *
   * @returns A new Session with a unique UUID
   */
  createSession(agentHint?: string): import("./mcp-session.js").Session {
    return this.sessionRegistry.createSession(agentHint);
  }

  /**
   * Look up an existing session by its Mcp-Session-Id.
   *
   * @param id - Session ID string
   * @returns The session, or undefined if not found
   */
  getSession(id: string): import("./mcp-session.js").Session | undefined {
    return this.sessionRegistry.getSession(id);
  }
}
