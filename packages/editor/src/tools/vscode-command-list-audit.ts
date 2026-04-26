/**
 * Audit helper for list handler.
 *
 * Requirements: M75-VCG-03, 17, 18 (requirements-editor.md §4.26)
 */

import type {
  VscodeCommandAuditEntry,
  VscodeCommandAuditSink,
  VscodeCommandToolName,
} from "./vscode-command-contracts.js";
import { summarizeArguments } from "./vscode-command-shared.js";

export function buildListAuditEntry(params: {
  auditId: string;
  outcome: "success" | "error";
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}): VscodeCommandAuditEntry {
  return {
    auditId: params.auditId,
    ts: new Date().toISOString(),
    toolName: "accordo_vscode_command_list" as VscodeCommandToolName,
    argsShape: summarizeArguments([]),
    policyAction: "allow",
    riskClass: "low",
    outcome: params.outcome,
    durationMs: params.durationMs,
    errorCode: params.errorCode as VscodeCommandAuditEntry["errorCode"],
    errorMessage: params.errorMessage,
  };
}

export async function writeListAudit(
  audit: VscodeCommandAuditSink,
  entry: VscodeCommandAuditEntry,
): Promise<void> {
  await audit.write(entry);
}