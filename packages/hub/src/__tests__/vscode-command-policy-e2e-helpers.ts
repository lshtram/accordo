/**
 * E2E Test helpers for vscode-command-policy-e2e.test.ts
 * Req: E2E-VCG-09, 11, 12
 */

import type { StubBridge } from "./vscode-command-e2e-transport.js";
import { buildExecuteResp } from "./vscode-command-e2e-sim.js";

// ── Auto-responder factories ────────────────────────────────────────────────

/**
 * Standard auto-responder for accordo_* commands (deny-style):
 * accordo_* commands must never reach the bridge — gateway policy denies them.
 */
export function denyOnlyResponder(args: unknown) {
  const { command, args: cmdArgs, confirmation } = args as { command: string; args?: unknown[]; confirmation?: { confirmed: boolean; command: string } };
  if (confirmation && !confirmation.confirmed) {
    return { success: true, data: { ok: false, error: { code: "POLICY_CONFIRMATION_REQUIRED", message: "not confirmed", retriable: false } } };
  }
  if (command?.startsWith("accordo_")) {
    return { success: true, data: { ok: false, error: `Command '${command}' is denied by policy` } };
  }
  return { success: true, data: buildExecuteResp(command, cmdArgs) };
}

/**
 * Confirm-class responder: workbench.action.reload requires confirmation.
 */
export function confirmReloadResponder(args: unknown) {
  const { command } = args as { command: string };
  if (command === "workbench.action.reload") {
    return {
      success: true,
      data: {
        ok: false,
        error: {
          code: "POLICY_CONFIRMATION_REQUIRED",
          message: "Command requires confirmation",
          retriable: false,
          details: { confirmationRequired: true },
        },
      },
    };
  }
  return { success: true, data: buildExecuteResp(command) };
}

/**
 * Confirmed-execution responder: confirms payload with confirmed:true allows execution.
 */
export function confirmExecutionResponder(args: unknown) {
  const { command } = args as { command: string; confirmation?: { confirmed: boolean; command: string } };
  return {
    success: true,
    data: {
      ok: true,
      auditId: "audit-confirmed-1",
      command,
      policy: { action: "confirm", riskClass: "moderate", reason: "requires confirmation", requiresConfirmation: true },
      result: { kind: "void" },
    },
  };
}

// ── Bridge auto-responder wiring ────────────────────────────────────────────

/**
 * Wires a typed responder into the bridge's auto-responder callback.
 */
export function applyAutoResponder(
  bridge: StubBridge,
  responder: (args: unknown) => { success: boolean; data: unknown },
) {
  bridge.setAutoResponder((tool, args) => {
    if (tool === "accordo_vscode_command_execute") {
      return responder(args);
    }
    return { success: true, data: {} };
  });
}
