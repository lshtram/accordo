/**
 * buildVoidResult + buildJsonResult — success result builders.
 * Extracted from vscode-command-execute.ts to keep orchestrator ≤150 lines.
 *
 * Requirements: M75-VCG-11 (requirements-editor.md §4.28)
 */

import type { VscodeCommandResultEnvelope } from "./vscode-command-contracts.js";

export function buildVoidResult(): VscodeCommandResultEnvelope {
  return { kind: "void" };
}

export function buildJsonResult(value: unknown): VscodeCommandResultEnvelope {
  return { kind: "json", value };
}