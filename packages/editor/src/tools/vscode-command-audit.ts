/**
 * VSCode audit sink for vscode-command-gateway.
 *
 * Requirements: M75-VCG-14, 15, 16 (requirements-editor.md §4.28)
 */

import type { VscodeCommandAuditEntry } from "./vscode-command-contracts.js";

export class VsCodeAuditSink {
  async write(entry: VscodeCommandAuditEntry): Promise<void> {
    const msg = `[VSCodeCommandAudit] ${entry.ts} | ${entry.toolName} | ${entry.outcome} | ${entry.command ?? ""} | ${entry.durationMs.toFixed(2)}ms | ${entry.errorCode ?? ""} ${entry.errorMessage ?? ""}`;
    console.warn(msg);
  }
}