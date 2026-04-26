/**
 * handleError — builds error responses and audit entries.
 * Extracted from vscode-command-execute.ts to keep orchestrator ≤150 lines.
 *
 * Requirements: M75-VCG-12 (requirements-editor.md §4.28)
 */

import type {
  VscodeCommandExecuteRequest,
  VscodeCommandExecuteHandlerDeps,
  VscodeCommandErrorResponse,
  VscodeCommandAuditEntry,
} from "./vscode-command-contracts.js";
import { classifyExecutionError } from "./vscode-command-shared.js";
import { buildExecuteAuditEntry } from "./vscode-command-execute-audit.js";

export async function handleError(
  deps: VscodeCommandExecuteHandlerDeps,
  req: VscodeCommandExecuteRequest,
  auditId: string,
  start: number,
  err: unknown,
): Promise<VscodeCommandErrorResponse> {
  const msg = err instanceof Error ? err.message : String(err);
  const errorCode = classifyExecutionError(msg);
  const entry: VscodeCommandAuditEntry = {
    auditId,
    ts: new Date().toISOString(),
    toolName: "accordo_vscode_command_execute",
    command: req.command,
    argsShape: [],
    policyAction: "allow",
    riskClass: "low",
    outcome: "error",
    durationMs: performance.now() - start,
    errorCode,
    errorMessage: msg,
  };
  await deps.audit.write(entry);
  return {
    ok: false,
    auditId,
    command: req.command,
    error: { code: errorCode, message: msg, retriable: false },
  };
}