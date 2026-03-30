/**
 * MCP Error Mapper
 *
 * Pure functions for classifying errors and building JSON-RPC error responses
 * that arise during tools/call execution.  No side-effects (no file I/O, no
 * bridge calls).
 *
 * Extracted from mcp-dispatch.ts handleToolsCall to keep that method focused.
 */

import type { JsonRpcResponse } from "./mcp-dispatch.js";
import { JsonRpcError } from "./errors.js";

/** Timeout vs. regular error — drives audit result and user-facing message. */
export type ErrorKind = "timeout" | "error";

/**
 * Returns true when `e` represents a bridge-invocation timeout.
 *
 * Matches:
 *   - JsonRpcError with code -32000
 *   - Any Error whose message contains "timed out" or "timeout" (case-insensitive)
 */
export function isInvokeTimeout(e: unknown): boolean {
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
}

/**
 * Classify an uncaught error from the bridge or tool handler into a bucket.
 *
 * Timeout errors receive different user-facing messages and audit results.
 * Uses the same code (-32000) as isInvokeTimeout for consistency.
 */
export function classifyError(err: unknown): ErrorKind {
  if (err instanceof JsonRpcError) {
    return err.code === -32000 || err.message.toLowerCase().includes("timed out")
      ? "timeout"
      : "error";
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timed out") || msg.includes("timeout")) return "timeout";
  }
  return "error";
}

/**
 * Build a tool-level error response (isError: true) for a known error message.
 * Used when we have a meaningful message to surface to the agent.
 */
export function buildToolErrorResponse(
  id: string | number | null,
  message: string,
  _isTimeout: boolean,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    },
  };
}

/**
 * Build a tool-level error response for a soft error detected in the result data.
 * Soft errors are editor-tool exceptions returned as successful data
 * `{ error: "..." }` rather than thrown — requirements-hub.md §7.
 */
export function buildSoftErrorResponse(
  id: string | number | null,
  softErrorMsg: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text" as const, text: softErrorMsg }],
      isError: true,
    },
  };
}

/**
 * Build a tool-level success response wrapping arbitrary JSON-serialised data.
 */
export function buildToolSuccessResponse(
  id: string | number | null,
  data: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text" as const, text: JSON.stringify(data) }],
    },
  };
}

/**
 * Build a tool-level error response for a bridge invocation failure.
 */
export function buildBridgeFailureResponse(
  id: string | number | null,
  errorMessage: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text" as const, text: errorMessage }],
      isError: true,
    },
  };
}

/**
 * Build a protocol-level JSON-RPC error (not a tool-level result) for a
 * tools/call that has malformed parameters.
 */
export function buildInvalidParamsResponse(
  id: string | number | null,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32602, message },
  };
}

/**
 * Build a protocol-level JSON-RPC error for an unknown tool.
 */
export function buildUnknownToolResponse(
  id: string | number | null,
  toolName: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown tool: ${toolName}` },
  };
}
