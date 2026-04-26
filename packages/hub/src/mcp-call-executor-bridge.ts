import type { BridgeServer } from "./bridge-server.js";
import type { JsonRpcResponse } from "./mcp-dispatch.js";
import type { Session } from "./mcp-session.js";
import type { ToolRegistration } from "@accordo/bridge-types";
import {
  buildBridgeFailureResponse,
  buildSoftErrorResponse,
  buildToolSuccessResponse,
  classifyError,
  isInvokeTimeout,
} from "./mcp-error-mapper.js";
import type { AuditWriter } from "./mcp-call-executor-common.js";
import { extractSoftError } from "./mcp-call-executor-common.js";

interface ExecuteBridgeToolCallParams {
  bridgeServer: BridgeServer;
  toolName: string;
  toolArgs: Record<string, unknown>;
  tool: ToolRegistration;
  toolCallTimeout: number;
  session: Session;
  id: string | number | null;
  audit: AuditWriter;
}

function buildTimedOutResponse(id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text" as const, text: "Tool invocation timed out" }],
      isError: true,
    },
  };
}

function buildRuntimeErrorResponse(
  id: string | number | null,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text" as const, text: message }], isError: true },
  };
}

function mapBridgeResult(
  id: string | number | null,
  result: { success: boolean; data?: unknown; error?: string },
  audit: AuditWriter,
): JsonRpcResponse {
  if (!result.success) {
    audit("error", result.error ?? "Tool execution failed");
    return buildBridgeFailureResponse(id, result.error ?? "Tool execution failed");
  }
  const softErrorMsg = extractSoftError(result.data);
  if (softErrorMsg !== undefined) {
    audit("error", softErrorMsg);
    return buildSoftErrorResponse(id, softErrorMsg);
  }
  audit("success");
  return buildToolSuccessResponse(id, result.data);
}

export async function executeBridgeToolCall(
  p: ExecuteBridgeToolCallParams,
): Promise<JsonRpcResponse> {
  try {
    const result = await p.bridgeServer.invoke(
      p.toolName,
      p.toolArgs,
      p.toolCallTimeout,
      p.session.id,
      p.session.agentHint,
    );
    return mapBridgeResult(p.id, result, p.audit);
  } catch (err: unknown) {
    if (isInvokeTimeout(err) && p.tool.idempotent === true) {
      return executeBridgeRetry(p, err);
    }
    const msg = err instanceof Error ? err.message : String(err);
    p.audit(classifyError(err), msg);
    return buildRuntimeErrorResponse(p.id, msg);
  }
}

async function executeBridgeRetry(
  p: ExecuteBridgeToolCallParams,
  err: unknown,
): Promise<JsonRpcResponse> {
  const firstMsg = err instanceof Error ? err.message : String(err);
  p.audit("timeout", firstMsg);
  try {
    const retry = await p.bridgeServer.invoke(
      p.toolName,
      p.toolArgs,
      p.toolCallTimeout,
      p.session.id,
      p.session.agentHint,
    );
    return mapBridgeResult(
      p.id,
      { success: retry.success, error: retry.error, data: retry.data ?? {} },
      p.audit,
    );
  } catch (retryErr: unknown) {
    const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
    p.audit(isInvokeTimeout(retryErr) ? "timeout" : "error", retryMsg);
    return buildTimedOutResponse(p.id);
  }
}
