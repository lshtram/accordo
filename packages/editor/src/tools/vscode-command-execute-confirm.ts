/**
 * handleConfirm — builds confirmation-required responses and audit entries.
 * Extracted from vscode-command-execute.ts to keep orchestrator ≤150 lines.
 *
 * Requirements: M75-VCG-13 (requirements-editor.md §4.28)
 */

import type {
  VscodeCommandExecuteRequest,
  VscodeCommandExecuteHandlerDeps,
  VscodeCommandExecuteResponse,
  VscodeCommandErrorResponse,
  VscodeCommandPolicyDecision,
  VscodeCommandAuditEntry,
} from "./vscode-command-contracts.js";

export async function handleConfirm(
  deps: VscodeCommandExecuteHandlerDeps,
  req: VscodeCommandExecuteRequest,
  policy: VscodeCommandPolicyDecision,
  auditId: string,
  start: number,
): Promise<VscodeCommandErrorResponse> {
  const entry: VscodeCommandAuditEntry = {
    auditId,
    ts: new Date().toISOString(),
    toolName: "accordo_vscode_command_execute",
    command: req.command,
    argsShape: [],
    policyAction: policy.action,
    riskClass: policy.riskClass,
    outcome: "denied",
    durationMs: performance.now() - start,
  };
  await deps.audit.write(entry);

  return {
    ok: false,
    auditId,
    command: req.command,
    error: {
      code: "POLICY_CONFIRMATION_REQUIRED",
      message: `Command '${req.command}' requires explicit confirmation`,
      retriable: false,
    },
  };
}
