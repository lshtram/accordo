/**
 * MCP Call Executor
 *
 * Handles the full lifecycle of a tools/call invocation:
 * tool lookup, bridge routing, soft-error detection, audit logging,
 * and idempotent timeout retry.
 *
 * Requirements: requirements-hub.md §2.1, §6, §7
 */

import type { BridgeServer } from "./bridge-server.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { AuditEntry } from "./audit-log.js";
import type { ToolRegistration } from "@accordo/bridge-types";
import { hashArgs, writeAuditEntry } from "./audit-log.js";
import type { JsonRpcResponse } from "./mcp-dispatch.js";
import type { Session } from "./mcp-session.js";
import {
  buildInvalidParamsResponse,
  buildToolErrorResponse,
  buildUnknownToolResponse,
} from "./mcp-error-mapper.js";
import { isHubTool } from "./hub-tool-types.js";
import { executeBridgeToolCall } from "./mcp-call-executor-bridge.js";
import { executeHubLocalToolCall } from "./mcp-call-executor-hub-local.js";
import { shouldDenyGatewayCommand } from "./mcp-call-executor-common.js";

export interface McpCallExecutorDeps {
  toolRegistry: ToolRegistry;
  bridgeServer: BridgeServer;
  toolCallTimeout: number;
  auditFile?: string;
}

function makeAuditWriter(params: {
  auditFile?: string;
  startMs: number;
  toolName: string;
  toolArgs: Record<string, unknown>;
  sessionId: string;
}): (result: AuditEntry["result"], errorMessage?: string) => void {
  return (result: AuditEntry["result"], errorMessage?: string): void => {
    if (!params.auditFile) return;
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      tool: params.toolName,
      argsHash: hashArgs(params.toolArgs),
      sessionId: params.sessionId,
      result,
      durationMs: Date.now() - params.startMs,
    };
    if (errorMessage !== undefined) entry.errorMessage = errorMessage;
    writeAuditEntry(params.auditFile, entry);
  };
}

function routeBridgeToolCall(params: {
  bridgeServer: BridgeServer;
  toolName: string;
  toolArgs: Record<string, unknown>;
  tool: ToolRegistration;
  toolCallTimeout: number;
  session: Session;
  id: string | number | null;
  audit: (result: AuditEntry["result"], errorMessage?: string) => void;
}): Promise<JsonRpcResponse> {
  const deniedMsg = shouldDenyGatewayCommand(params.toolName, params.toolArgs);
  if (deniedMsg !== undefined) {
    params.audit("error", deniedMsg);
    return Promise.resolve(buildToolErrorResponse(params.id, deniedMsg, false));
  }
  return executeBridgeToolCall(params);
}

/**
 * Executes a tools/call request end-to-end.
 *
 * Public interface: `executeToolCall(toolName, toolArgs, session, id)`
 */
export class McpCallExecutor {
  private readonly toolRegistry: ToolRegistry;
  private readonly bridgeServer: BridgeServer;
  private readonly toolCallTimeout: number;
  private readonly auditFile: string | undefined;

  constructor(deps: McpCallExecutorDeps) {
    this.toolRegistry = deps.toolRegistry;
    this.bridgeServer = deps.bridgeServer;
    this.toolCallTimeout = deps.toolCallTimeout;
    this.auditFile = deps.auditFile;
  }

  /**
   * Execute a tools/call invocation.
   *
   * @param toolName  - Name of the tool to invoke
   * @param toolArgs  - Arguments to pass to the tool
   * @param session   - MCP session making the call
   * @param id        - JSON-RPC request id for the response
   * @returns JSON-RPC response with tool result or error
   */
  async executeToolCall(
    toolName: string | undefined,
    toolArgs: Record<string, unknown>,
    session: Session,
    id: string | number | null,
  ): Promise<JsonRpcResponse> {
    if (!toolName) return buildInvalidParamsResponse(id, "Invalid params: missing name");
    const tool = this.toolRegistry.get(toolName);
    if (!tool) return buildUnknownToolResponse(id, toolName);
    const audit = makeAuditWriter({
      auditFile: this.auditFile,
      startMs: Date.now(),
      toolName,
      toolArgs,
      sessionId: session.id,
    });
    if (isHubTool(tool)) {
      return executeHubLocalToolCall(id, toolArgs, tool, audit);
    }
    return routeBridgeToolCall({
      bridgeServer: this.bridgeServer,
      toolName,
      toolArgs,
      tool,
      toolCallTimeout: this.toolCallTimeout,
      session,
      id,
      audit,
    });
  }
}
