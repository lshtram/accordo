/**
 * handleDenied — builds denial responses and audit entries.
 * Extracted from vscode-command-execute.ts to keep orchestrator ≤150 lines.
 *
 * Requirements: M75-VCG-14, 15, 16 (requirements-editor.md §4.28)
 */

import type {
  VscodeCommandToolName,
  VscodeCommandPolicyAction,
  VscodeCommandRiskClass,
  VscodeCommandAuditEntry,
  VscodeCommandAuditSink,
  VscodeCommandToolError,
  VscodeCommandErrorResponse,
} from "./vscode-command-contracts.js";
import { buildExecuteAuditEntry } from "./vscode-command-execute-audit.js";

function buildDeniedAuditEntry(params: {
  auditId: string;
  toolName: VscodeCommandToolName;
  command: string;
  args: readonly unknown[];
  policyAction: VscodeCommandPolicyAction;
  riskClass: VscodeCommandRiskClass;
  start: number;
}): VscodeCommandAuditEntry {
  return {
    auditId: params.auditId,
    ts: new Date().toISOString(),
    toolName: params.toolName,
    command: params.command,
    argsShape: [],
    policyAction: params.policyAction,
    riskClass: params.riskClass,
    outcome: "denied",
    durationMs: performance.now() - params.start,
  };
}

export async function handleDenied(
  audit: VscodeCommandAuditSink,
  toolName: VscodeCommandToolName,
  command: string,
  args: readonly unknown[],
  policyAction: VscodeCommandPolicyAction,
  riskClass: VscodeCommandRiskClass,
  reason: string,
  preferredTool: string | undefined,
  auditId: string,
  start: number,
): Promise<VscodeCommandErrorResponse> {
  const entry = buildDeniedAuditEntry({ auditId, toolName, command, args, policyAction, riskClass, start });
  await audit.write(entry);
  const error: VscodeCommandToolError = {
    code: "POLICY_DENIED",
    message: `Command '${command}' is denied by policy (${reason})`,
    retriable: false,
    details: {
      reason,
      riskClass,
      ...(preferredTool ? { preferredTool } : {}),
    },
  };
  return { ok: false, auditId, command, error };
}
