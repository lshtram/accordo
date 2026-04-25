/**
 * VSCode command policy for vscode-command-gateway.
 *
 * Provides classify() using static rule sets.
 *
 * Requirements: M75-VCG-02, 04, 05, 06, 07 (requirements-editor.md §4.26)
 */

import type {
  VscodeCommandPolicy,
  VscodeCommandPolicyDecision,
} from "./vscode-command-contracts.js";

const ACCORDO_INTERNAL_COMMANDS = new Set([
  "accordo_editor_open",
  "accordo_editor_close",
  "accordo_editor_scroll",
  "accordo_editor_focus",
  "accordo_editor_highlight",
  "accordo_editor_clearHighlights",
  "accordo_terminal_open",
  "accordo_terminal_run",
  "accordo_terminal_focus",
  "accordo_terminal_list",
  "accordo_terminal_close",
  "accordo_panel_toggle",
  "accordo_layout_state",
  "accordo_layout_panel",
  "accordo_vscode_command_list",
  "accordo_vscode_command_execute",
]);

const HIGH_RISK_COMMANDS = new Set([
  "workbench.action.quit",
  "workbench.action.restart",
  "workbench.action.reloadWindow",
  "extension.hostManifest.bundle",
]);

const MODERATE_RISK_PATTERNS = [
  /^workbench\.action\.files\./,
  /^editor\.action\./,
  /^workbench\.action\.close/,
];

export function classifyCommand(command: string, _args: readonly unknown[]): VscodeCommandPolicyDecision {
  if (ACCORDO_INTERNAL_COMMANDS.has(command) || command.startsWith("accordo_")) {
    return {
      action: "deny",
      riskClass: "high",
      reason: "accordo internal",
      requiresConfirmation: false,
      preferredTool: command.startsWith("accordo_") ? command : undefined,
    };
  }
  if (HIGH_RISK_COMMANDS.has(command)) {
    return { action: "deny", riskClass: "high", reason: "high risk", requiresConfirmation: false };
  }
  const isModerate = MODERATE_RISK_PATTERNS.some((p) => p.test(command));
  if (isModerate) {
    return { action: "confirm", riskClass: "moderate", reason: "moderate risk", requiresConfirmation: true };
  }
  return { action: "allow", riskClass: "low", reason: "safe", requiresConfirmation: false };
}

export const vscodeCommandPolicy: VscodeCommandPolicy = {
  async classify(command: string, args: readonly unknown[]): Promise<VscodeCommandPolicyDecision> {
    return classifyCommand(command, args);
  },
};