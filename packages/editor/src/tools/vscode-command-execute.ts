/**
 * Execute handler for accordo_vscode_command_execute.
 * Orchestration delegates to specialized handlers.
 *
 * Requirements: M75-VCG-09, 10, 11, 12, 13, 14, 15, 16
 * (requirements-editor.md §4.28)
 */

import type {
  VscodeCommandErrorResponse,
  VscodeCommandExecuteRequest,
  VscodeCommandExecuteResponse,
  VscodeCommandExecutor,
  VscodeCommandGatewayDeps,
  VscodeCommandPolicy,
  VscodeCommandPolicyDecision,
} from "./vscode-command-contracts.js";
import {
  validateExecuteArgs,
  buildExecuteRequest,
  normalizeResult,
} from "./vscode-command-execute-validate.js";
import { handleConfirm } from "./vscode-command-execute-confirm.js";
import { handleError } from "./vscode-command-execute-error.js";
import { handleDenied } from "./vscode-command-execute-deny.js";
import { writeExecuteAudit, buildExecuteAuditEntry } from "./vscode-command-execute-audit.js";

export type VscodeCommandExecuteHandlerDeps = Pick<
  VscodeCommandGatewayDeps,
  "executor" | "policy" | "audit"
>;

function newAuditId(): string {
  return `audit-exec-${Math.random().toString(36).slice(2)}`;
}

async function applyPolicyGate(
  deps: VscodeCommandExecuteHandlerDeps,
  req: VscodeCommandExecuteRequest,
  policy: VscodeCommandPolicyDecision,
  auditId: string,
  start: number,
): Promise<VscodeCommandErrorResponse | null> {
  if (policy.action === "deny") {
    return handleDenied(
      deps.audit,
      "accordo_vscode_command_execute",
      req.command,
      req.args ?? [],
      policy.action,
      policy.riskClass,
      policy.reason,
      policy.preferredTool,
      auditId,
      start,
    );
  }
  if (policy.action !== "confirm" || req.confirmation?.confirmed) return null;
  return handleConfirm(deps, req, policy, auditId, start);
}

async function writeSuccessAudit(
  deps: VscodeCommandExecuteHandlerDeps,
  req: VscodeCommandExecuteRequest,
  policy: VscodeCommandPolicyDecision,
  auditId: string,
  start: number,
): Promise<void> {
  await writeExecuteAudit(
    deps.audit,
    buildExecuteAuditEntry({
      auditId,
      toolName: "accordo_vscode_command_execute",
      command: req.command,
      args: req.args ?? [],
      policyAction: policy.action,
      riskClass: policy.riskClass,
      outcome: "success",
      durationMs: performance.now() - start,
    }),
  );
}

function buildSuccessResponse(
  policy: VscodeCommandPolicyDecision,
  auditId: string,
  command: string,
  result: unknown,
): VscodeCommandExecuteResponse {
  return {
    ok: true,
    auditId,
    command,
    policy,
    result: normalizeResult(result),
  };
}

export async function createExecuteHandler(
  deps: VscodeCommandExecuteHandlerDeps,
  args: Record<string, unknown>,
): Promise<VscodeCommandExecuteResponse | VscodeCommandErrorResponse> {
  const validationError = validateExecuteArgs(args);
  if (validationError) return validationError;

  const start = performance.now();
  const req = buildExecuteRequest(args);
  const auditId = newAuditId();
  const policy = await deps.policy.classify(req.command, req.args ?? []);

  try {
    const gateResponse = await applyPolicyGate(deps, req, policy, auditId, start);
    if (gateResponse !== null) return gateResponse;
  } catch (err) {
    return await handleError(deps, req, auditId, start, err);
  }

  let execResult: { command: string; result: unknown };
  try {
    execResult = await deps.executor.execute(req);
  } catch (err) {
    return await handleError(deps, req, auditId, start, err);
  }

  await writeSuccessAudit(deps, req, policy, auditId, start);
  return buildSuccessResponse(policy, auditId, execResult.command, execResult.result);
}
