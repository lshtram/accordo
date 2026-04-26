/**
 * Argument validation and result normalization for execute handler.
 * Extracted to keep handler body focused on orchestration.
 *
 * Requirements: M75-VCG-09, 10, 11 (requirements-editor.md §4.28)
 */

import type {
  VscodeCommandExecuteRequest,
  VscodeCommandErrorResponse,
  VscodeCommandResultEnvelope,
} from "./vscode-command-contracts.js";

export function validateExecuteArgs(
  args: Record<string, unknown>,
): VscodeCommandErrorResponse | null {
  if (!("command" in args)) {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "command is required", retriable: false } };
  }
  if (typeof args.command !== "string") {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "command must be a string", retriable: false } };
  }
  if (args.command === "") {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "command must be non-empty", retriable: false } };
  }
  if (args.args !== undefined && !Array.isArray(args.args)) {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "args must be an array", retriable: false } };
  }
  if (args.confirmation !== undefined) {
    const conf = args.confirmation as Record<string, unknown>;
    if (typeof conf.confirmed !== "boolean") {
      return { ok: false, error: { code: "INVALID_ARGUMENT", message: "confirmation.confirmed must be a boolean", retriable: false } };
    }
    if (conf.command !== args.command) {
      return { ok: false, error: { code: "INVALID_ARGUMENT", message: "confirmation.command must echo the request command", retriable: false } };
    }
  }
  return null;
}

export function buildExecuteRequest(args: Record<string, unknown>): VscodeCommandExecuteRequest {
  return {
    command: args.command as string,
    args: args.args as readonly unknown[] | undefined,
    confirmation: args.confirmation as { confirmed: boolean; command: string; reason?: string } | undefined,
  };
}

export function normalizeResult(result: unknown): VscodeCommandResultEnvelope {
  if (result === undefined || result === null) {
    return { kind: "void" };
  }
  if (typeof result === "object" && "kind" in result) {
    return result as VscodeCommandResultEnvelope;
  }
  return { kind: "json", value: result };
}