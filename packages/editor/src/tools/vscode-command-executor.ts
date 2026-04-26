/**
 * VSCode executor for vscode-command-gateway.
 *
 * Requirements: M75-VCG-09, 10, 11, 12, 13 (requirements-editor.md §4.28)
 */

import * as vscode from "vscode";
import type {
  VscodeCommandExecutor,
  VscodeCommandExecuteRequest,
  VscodeCommandResultEnvelope,
} from "./vscode-command-contracts.js";
import { classifyCommand } from "./vscode-command-policy.js";

export class VsCodeExecutor implements VscodeCommandExecutor {
  async execute(request: VscodeCommandExecuteRequest): Promise<{
    auditId: string;
    command: string;
    policy: ReturnType<typeof classifyCommand>;
    result: VscodeCommandResultEnvelope;
  }> {
    const result = await vscode.commands.executeCommand(request.command, ...(request.args ?? []));
    const envelope: VscodeCommandResultEnvelope = result === undefined || result === null
      ? { kind: "void" }
      : { kind: "json", value: result as unknown };
    return {
      auditId: `audit-exec-${Date.now()}`,
      command: request.command,
      policy: classifyCommand(request.command, request.args ?? []),
      result: envelope,
    };
  }
}