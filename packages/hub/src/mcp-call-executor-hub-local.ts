import type { JsonRpcResponse } from "./mcp-dispatch.js";
import { buildSoftErrorResponse, buildToolSuccessResponse } from "./mcp-error-mapper.js";
import type { HubToolRegistration } from "./hub-tool-types.js";
import type { AuditWriter } from "./mcp-call-executor-common.js";
import { extractSoftError } from "./mcp-call-executor-common.js";

export async function executeHubLocalToolCall(
  id: string | number | null,
  toolArgs: Record<string, unknown>,
  tool: HubToolRegistration,
  audit: AuditWriter,
): Promise<JsonRpcResponse> {
  try {
    const data = await tool.localHandler(toolArgs);
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
