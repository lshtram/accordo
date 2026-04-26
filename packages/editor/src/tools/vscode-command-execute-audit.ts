/**
 * Audit helper for execute handler.
 * Extracted to keep handler body focused on orchestration.
 *
 * Requirements: M75-VCG-14, 15, 16 (requirements-editor.md §4.28)
 */

import type {
  VscodeCommandAuditEntry,
  VscodeCommandAuditSink,
  VscodeCommandToolName,
  VscodeCommandPolicyDecision,
  VscodeCommandRiskClass,
} from "./vscode-command-contracts.js";
import { summarizeArguments } from "./vscode-command-shared.js";

export function buildExecuteAuditEntry(params: {
  auditId: string;
  toolName: VscodeCommandToolName;
  command: string;
  args: readonly unknown[];
  policyAction: VscodeCommandPolicyDecision["action"];
  riskClass: VscodeCommandRiskClass;
  outcome: "success" | "denied" | "error";
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}): VscodeCommandAuditEntry {
  return {
    auditId: params.auditId,
    ts: new Date().toISOString(),
    toolName: params.toolName,
    command: params.command,
    argsShape: summarizeArguments(params.args),
    policyAction: params.policyAction,
    riskClass: params.riskClass,
    outcome: params.outcome,
    durationMs: params.durationMs,
    errorCode: params.errorCode as VscodeCommandAuditEntry["errorCode"],
    errorMessage: params.errorMessage,
  };
}

export async function writeExecuteAudit(
  audit: VscodeCommandAuditSink,
  entry: VscodeCommandAuditEntry,
): Promise<void> {
  await audit.write(entry);
}