/**
 * VSCode-backed deps for vscode-command-gateway runtime.
 *
 * Provides real implementations of Catalog, Executor, Policy, and AuditSink
 * using VSCode APIs. Consumed by initVscodeCommandGateway() during extension
 * activation.
 *
 * Requirements: M75-VCG-01..18 (requirements-editor.md §4.26, §4.28)
 */

import type { VscodeCommandGatewayDeps } from "./vscode-command-contracts.js";
import { VsCodeCatalog } from "./vscode-command-catalog.js";
import { VsCodeExecutor } from "./vscode-command-executor.js";
import { vscodeCommandPolicy } from "./vscode-command-policy.js";
import { VsCodeAuditSink } from "./vscode-command-audit.js";

export function createVsCodeCommandGatewayDeps(): VscodeCommandGatewayDeps {
  return {
    catalog: new VsCodeCatalog(),
    executor: new VsCodeExecutor(),
    policy: vscodeCommandPolicy,
    audit: new VsCodeAuditSink(),
  };
}