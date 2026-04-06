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
import { hashArgs, writeAuditEntry } from "./audit-log.js";
import type { McpSessionRegistry } from "./mcp-session.js";
import type { JsonRpcResponse } from "./mcp-dispatch.js";
import type { Session } from "./mcp-session.js";
import {
  buildBridgeFailureResponse,
  buildInvalidParamsResponse,
  buildSoftErrorResponse,
  buildToolSuccessResponse,
  buildUnknownToolResponse,
  classifyError,
  isInvokeTimeout,
} from "./mcp-error-mapper.js";
import { isHubTool } from "./hub-tool-types.js";

/**
 * Extract a soft-error message from a tool result data object.
 * Soft errors are editor-tool exceptions returned as successful data
 * `{ error: "..." }` rather than thrown — requirements-hub.md §7.
 * Returns undefined if no soft error is present.
 */
function extractSoftError(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  // Structured tool error payloads use `{ success: false, error: "...", ... }`
  // and must flow back to the caller intact as normal tool data. Soft errors
  // are only legacy `{ error: "..." }` result objects with no success flag.
  if (typeof d.success === "boolean") return undefined;
  if (!("error" in d)) return undefined;
  // Domain result objects (e.g. WaitForResult) may carry an `error` field as
  // part of their normal schema alongside a `met` discriminator. These are not
  // soft errors — they are structured results that must flow through intact.
  if ("met" in d) return undefined;
  return typeof d.error === "string" ? d.error : undefined;
}

export interface McpCallExecutorDeps {
  toolRegistry: ToolRegistry;
  bridgeServer: BridgeServer;
  toolCallTimeout: number;
  auditFile?: string;
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
    // Validate params
    if (!toolName) {
      return buildInvalidParamsResponse(id, "Invalid params: missing name");
    }

    // Check tool exists in registry
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return buildUnknownToolResponse(id, toolName);
    }

    const startMs = Date.now();

    // Write one audit entry when auditFile is configured.
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
    // First check if this is a Hub-native tool with a localHandler.
    // If so, execute locally without routing through the bridge.
    if (isHubTool(tool)) {
      try {
        const data = await tool.localHandler(toolArgs);
        // Soft-error check on local handler result
        const softErrorMsg = extractSoftError(data);
        if (softErrorMsg !== undefined) {
          audit("error", softErrorMsg);
          return buildSoftErrorResponse(id, softErrorMsg);
        }
        audit("success");
        return buildToolSuccessResponse(id, data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        audit("error", msg);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text" as const, text: msg }],
            isError: true,
          },
        };
      }
    }

    // Bridge-routed tool: invoke via bridge server
    try {
      const result = await this.bridgeServer.invoke(
        toolName,
        toolArgs,
        this.toolCallTimeout,
        session.id,
        session.agentHint,
      );
      if (!result.success) {
        // Tool handler returned an error — surface as MCP tool error so agents
        // can read the message and adapt. isError:true signals the LLM that the
        // tool itself failed (not a protocol error).
        audit("error", result.error ?? "Tool execution failed");
        return buildBridgeFailureResponse(id, result.error ?? "Tool execution failed");
      }

      // Detect soft errors: editor tools catch exceptions and return
      // { error: "..." } as successful data rather than throwing.
      // requirements-hub.md §7 — these must be classified as "error" in the
      // audit log and surfaced with isError:true so agents can adapt.
      const softErrorMsg = extractSoftError(result.data);
      if (softErrorMsg !== undefined) {
        audit("error", softErrorMsg);
        return buildSoftErrorResponse(id, softErrorMsg);
      }

      audit("success");
      return buildToolSuccessResponse(id, result.data);
    } catch (err: unknown) {
      // M32: idempotent timeout retry — attempt once for tools marked idempotent: true.
      if (isInvokeTimeout(err) && tool.idempotent === true) {
        const firstMsg = err instanceof Error ? err.message : String(err);
        audit("timeout", firstMsg);
        try {
          const retryResult = await this.bridgeServer.invoke(
            toolName,
            toolArgs,
            this.toolCallTimeout,
            session.id,
            session.agentHint,
          );
          if (!retryResult.success) {
            audit("error", retryResult.error ?? "Tool execution failed");
            return buildBridgeFailureResponse(id, retryResult.error ?? "Tool execution failed");
          }
          // Soft-error check on retry result
          const retrySoftErr = extractSoftError(retryResult.data);
          if (retrySoftErr !== undefined) {
            audit("error", retrySoftErr);
            return buildSoftErrorResponse(id, retrySoftErr);
          }
          audit("success");
          return buildToolSuccessResponse(id, retryResult.data ?? {});
        } catch (retryErr: unknown) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          audit(isInvokeTimeout(retryErr) ? "timeout" : "error", retryMsg);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text" as const, text: "Tool invocation timed out" }],
              isError: true,
            },
          };
        }
      }

      // JsonRpcError → tool-level error response with its message
      if (err instanceof Error) {
        const msg = err.message;
        const kind = classifyError(err);
        audit(kind, msg);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text" as const, text: msg }],
            isError: true,
          },
        };
      }
      // Non-Error throwables
      const msg = String(err);
      audit("error", msg);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        },
      };
    }
  }
}
