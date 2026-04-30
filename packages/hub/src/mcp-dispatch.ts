/**
 * MCP Dispatch
 *
 * JSON-RPC method dispatch: initialize, initialized, tools/list, tools/call, ping.
 * Extracted from mcp-handler.ts to keep each module focused.
 *
 * Requirements: requirements-hub.md §2.1, §5.5, §6
 * Requirements: requirements-runtime-directives.md Y-02, Y-07, Y-08
 */

import { MCP_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { IDEState, RuntimeDirectiveCatalog } from "@accordo/bridge-types";
import type { ToolRegistry } from "./tool-registry.js";
import type { BridgeServer } from "./bridge-server.js";
import type { McpDebugLogger } from "./debug-log.js";
import { renderPrompt } from "./prompt-engine.js";
import type { Session, McpSessionRegistry } from "./mcp-session.js";
import { McpCallExecutor } from "./mcp-call-executor.js";
import { handleResourcesList, handleResourcesRead } from "./mcp-skill-resource-dispatch.js";

// ─── JSON-RPC types ─────────────────────────────────────────────────────────

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

// ─── Dependency interface ─────────────────────────────────────────────────────

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
  /**
   * Optional runtime directive catalog. When provided, initialize responses
   * include runtime directives and initialize receipts are recorded.
   * Requirements: requirements-runtime-directives.md Y-02, Y-07, Y-08
   */
  runtimeDirectiveCatalog?: RuntimeDirectiveCatalog;
}

// ─── Default IDE state fallback ─────────────────────────────────────────────

const EMPTY_IDE_STATE: IDEState = {
  activeFile: null,
  activeFileLine: 1,
  activeFileColumn: 1,
  openEditors: [],
  openTabs: [],
  visibleEditors: [],
  workspaceFolders: [],
  activeTerminal: null,
  workspaceName: null,
  remoteAuthority: null,
  modalities: {},
};

// ─── Initialize response builder ─────────────────────────────────────────────

/**
 * Build the instructions string for an initialize response.
 *
 * Y-03 parity: when a runtime directive catalog is present, the same
 * ## Runtime Directives section rendered from the catalog is prepended
 * to the base system prompt (same wording, same clause order, same
 * version/digest metadata as /instructions).
 */
function buildInitializeInstructions(
  catalog: RuntimeDirectiveCatalog | undefined,
  state: IDEState | undefined,
  toolRegistry: ToolRegistry,
): string {
  const allTools = toolRegistry.list();
  const resolvedState = state ?? EMPTY_IDE_STATE;

  // Base instructions from prompt engine (or minimal fallback)
  const baseInstructions = state
    ? renderPrompt(resolvedState, allTools)
    : [
        "Accordo IDE — real-time pair-programming co-pilot.",
        "You have access to ALL of the following tools — use them directly without activation:",
        ...toolRegistry.toMcpTools().map((t) => `  - ${t.name}`),
        "",
        "If your client shows activate_* or similar grouped tool placeholders,",
        "expand/activate ALL of them immediately so you can use every tool.",
      ].join("\n");

  // Prepend runtime directives when catalog is available (Y-02, Y-03)
  if (!catalog) return baseInstructions;

  return (
    catalog.renderInstructions(resolvedState, allTools) + "\n\n" + baseInstructions
  );
}

/**
 * Record an initialize delivery receipt for the given session.
 */
function recordInitializeReceipt(
  catalog: RuntimeDirectiveCatalog,
  session: Session,
  agentHint: string | undefined,
): void {
  const bundle = catalog.getBundle();
  const resolvedAgentHint = agentHint ?? session.agentHint ?? null;
  catalog.recordReceipt({
    sessionId: session.id,
    agent: resolvedAgentHint,
    channel: "initialize",
    bundleVersion: bundle.version,
    bundleDigest: bundle.digest,
    deliveredAt: new Date().toISOString(),
  });
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

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
  private readonly runtimeDirectiveCatalog: RuntimeDirectiveCatalog | undefined;
  private readonly executor: McpCallExecutor;

  constructor(deps: McpDispatchDeps) {
    this.toolRegistry = deps.toolRegistry;
    this.sessionRegistry = deps.sessionRegistry;
    this.getState = deps.getState;
    this.toolCallTimeout = deps.toolCallTimeout ?? 30_000;
    this.debugLogger = deps.debugLogger;
    this.runtimeDirectiveCatalog = deps.runtimeDirectiveCatalog;
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
      return this._invalidRequest(id, "(empty)", rpcStart, session.id);
    }

    switch (request.method) {
      case "initialize":
        return this._handleInitialize(id, request, session, agentHint, rpcStart);

      case "initialized":
        return this._handleInitialized(session, rpcStart);

      case "tools/list":
        return this._handleToolsList(id, session, rpcStart);

      case "tools/call":
        return this._handleToolsCall(id, request, session, rpcStart);

      case "resources/list":
        return this._handleResourcesList(id, session, rpcStart);

      case "resources/read":
        return this._handleResourcesRead(id, request, session, rpcStart);

      case "ping":
        return this._handlePing(id, session, rpcStart);

      default:
        return this._methodNotFound(id, request.method, rpcStart, session.id);
    }
  }

  // ── Method handlers ─────────────────────────────────────────────────────────

  private _handleInitialize(
    id: string | number | null,
    _request: JsonRpcRequest,
    session: Session,
    agentHint: string | undefined,
    rpcStart: number,
  ): JsonRpcResponse {
    const state = this.getState ? this.getState() : undefined;
    const instructions = buildInitializeInstructions(
      this.runtimeDirectiveCatalog,
      state,
      this.toolRegistry,
    );

    // Record initialize delivery receipt (Y-07, Y-08)
    if (this.runtimeDirectiveCatalog) {
      recordInitializeReceipt(this.runtimeDirectiveCatalog, session, agentHint);
    }

    const initResult = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: "accordo", version: "0.1.0" },
      capabilities: { tools: { listChanged: true }, resources: { listChanged: false } },
      instructions,
    };

    this._logInitializeResponse(session.id, initResult, rpcStart);

    return { jsonrpc: "2.0", id, result: initResult };
  }

  private _logInitializeResponse(
    sessionId: string,
    initResult: {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: { listChanged: boolean }; resources: { listChanged: boolean } };
      instructions: string;
    },
    rpcStart: number,
  ): void {
    this.debugLogger?.logInitializeSent({
      sessionId,
      protocolVersion: initResult.protocolVersion,
      instructions: initResult.instructions,
      capabilities: initResult.capabilities,
    });
    this.debugLogger?.logRpcResponded({
      sessionId,
      rpcMethod: "initialize",
      result: initResult,
      durationMs: Date.now() - rpcStart,
    });
  }

  private _handleInitialized(session: Session, rpcStart: number): null {
    // Notification — mark session initialized, no response
    this.sessionRegistry.markInitialized(session.id);
    this.debugLogger?.logRpcResponded({
      sessionId: session.id,
      rpcMethod: "initialized",
      result: null,
      durationMs: Date.now() - rpcStart,
    });
    return null;
  }

  private _handleToolsList(
    id: string | number | null,
    session: Session,
    rpcStart: number,
  ): JsonRpcResponse {
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

  private _handleToolsCall(
    id: string | number | null,
    request: JsonRpcRequest,
    session: Session,
    rpcStart: number,
  ): Promise<JsonRpcResponse> {
    const params = request.params ?? {};
    const toolName = params["name"] as string | undefined;
    const toolArgs = (params["arguments"] ?? {}) as Record<string, unknown>;
    return this.executor
      .executeToolCall(toolName, toolArgs, session, id)
      .then((callResp) => {
        this.debugLogger?.logRpcResponded({
          sessionId: session.id,
          rpcMethod: "tools/call",
          result: callResp.result,
          error: callResp.error,
          durationMs: Date.now() - rpcStart,
        });
        return callResp;
      });
  }

  private _handleResourcesList(
    id: string | number | null,
    session: Session,
    rpcStart: number,
  ): JsonRpcResponse {
    const response = handleResourcesList(id);
    this.debugLogger?.logRpcResponded({
      sessionId: session.id,
      rpcMethod: "resources/list",
      result: response.result,
      durationMs: Date.now() - rpcStart,
    });
    return response;
  }

  private _handleResourcesRead(
    id: string | number | null,
    request: JsonRpcRequest,
    session: Session,
    rpcStart: number,
  ): JsonRpcResponse {
    const response = handleResourcesRead(id, request.params ?? {});
    this.debugLogger?.logRpcResponded({
      sessionId: session.id,
      rpcMethod: "resources/read",
      result: response.result,
      error: response.error,
      durationMs: Date.now() - rpcStart,
    });
    return response;
  }

  private _handlePing(
    id: string | number | null,
    session: Session,
    rpcStart: number,
  ): JsonRpcResponse {
    const pingResp: JsonRpcResponse = { jsonrpc: "2.0", id, result: {} };
    this.debugLogger?.logRpcResponded({
      sessionId: session.id,
      rpcMethod: "ping",
      result: {},
      durationMs: Date.now() - rpcStart,
    });
    return pingResp;
  }

  private _invalidRequest(
    id: string | number | null,
    method: string,
    rpcStart: number,
    sessionId: string,
  ): JsonRpcResponse {
    const errResp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid request" },
    };
    this.debugLogger?.logRpcResponded({
      sessionId,
      rpcMethod: method,
      error: errResp.error,
      durationMs: Date.now() - rpcStart,
    });
    return errResp;
  }

  private _methodNotFound(
    id: string | number | null,
    method: string,
    rpcStart: number,
    sessionId: string,
  ): JsonRpcResponse {
    const unknownResp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    };
    this.debugLogger?.logRpcResponded({
      sessionId,
      rpcMethod: method,
      error: unknownResp.error,
      durationMs: Date.now() - rpcStart,
    });
    return unknownResp;
  }
}
