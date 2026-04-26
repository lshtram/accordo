/**
 * Shared helpers for vscode-command-gateway.
 * Extracted to avoid duplication across handler files.
 */

import type {
  VscodeCommandArgumentShape,
  VscodeCommandErrorCode,
} from "./vscode-command-contracts.js";

export function getArgumentShapeKind(value: unknown): VscodeCommandArgumentShape["kind"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "object": return "object";
    default: return "unknown";
  }
}

export function summarizeArguments(
  args: readonly unknown[],
): readonly VscodeCommandArgumentShape[] {
  return args.map((value, index) => ({
    index,
    kind: getArgumentShapeKind(value),
    summary: String(value),
  }));
}

export function classifyExecutionError(message: string): VscodeCommandErrorCode {
  if (message.includes("not found") || message.includes("NOT_FOUND")) {
    return "COMMAND_NOT_FOUND";
  }
  return "COMMAND_EXECUTION_FAILED";
}
