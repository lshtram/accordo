/**
 * Shared test helpers for vscode-command-gateway tests.
 * Exported from this file to avoid circular self-imports in test files.
 *
 * Requirements: M75-VCG-01..18 (requirements-editor.md §4.26, §4.28)
 */

import { vi } from "vitest";
import type {
  VscodeCommandCatalog,
  VscodeCommandDescriptor,
  VscodeCommandGatewayDeps,
  VscodeCommandExecutor,
  VscodeCommandPolicyDecision,
  VscodeCommandAuditSink,
} from "../tools/vscode-command-contracts.js";

// ── buildDeps ─────────────────────────────────────────────────────────────────

export function buildDeps(overrides?: Partial<VscodeCommandGatewayDeps>): VscodeCommandGatewayDeps {
  return {
    catalog: overrides?.catalog ?? makeSimCatalog(),
    executor: overrides?.executor ?? makeSimExecutor(),
    policy: overrides?.policy ?? makePolicyDecision(),
    audit: overrides?.audit ?? makeAuditSink(),
  };
}

// ── makeSimCatalog ─────────────────────────────────────────────────────────

export function makeSimCatalog(commands?: VscodeCommandDescriptor[]): VscodeCommandCatalog {
  const defaultCommands: VscodeCommandDescriptor[] = [
    makeCmd("workbench.action.splitEditorRight"),
    makeCmd("workbench.action.splitEditorDown"),
    makeCmd("workbench.action.joinAllGroups"),
    makeCmd("workbench.action.files.save"),
    makeCmd("workbench.action.files.saveAll"),
    makeCmd("editor.action.formatDocument"),
    makeCmd("workbench.action.closeActiveEditor"),
    makeCmd("accordo_editor_open", "deny", "high", "accordo internal", "accordo_editor_open"),
    makeCmd("_private.internal.command", "allow", "low", "safe", undefined, true),
  ];
  return {
    list: vi.fn(async (opts) => {
      let cmds = (commands ?? defaultCommands);
      if (!opts?.includeInternal) cmds = cmds.filter((c) => !c.internal);
      if (opts?.query) cmds = cmds.filter((c) => c.command.toLowerCase().includes(opts.query!.toLowerCase()));
      const totalCount = cmds.length;
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 100;
      const page = cmds.slice(offset, offset + limit);
      return {
        auditId: "audit-list-1",
        ok: true,
        commands: page.map((c) => ({
          command: c.command,
          policy: {
            action: c.policyAction,
            riskClass: c.riskClass,
            reason: c.riskReason,
            preferredTool: c.preferredTool,
          },
        })),
        totalCount,
        truncated: offset + page.length < totalCount,
        nextOffset: offset + page.length < totalCount ? offset + page.length : undefined,
      };
    }),
  };
}

// ── makeSimExecutor ────────────────────────────────────────────────────────

export function makeSimExecutor(): VscodeCommandExecutor {
  return {
    execute: vi.fn(async (cmd) => {
      // Default: return void success — policy enforcement is tested via policy.classify mock
      return { auditId: `audit-exec-${Date.now()}`, command: cmd.command, policy: { action: "allow", riskClass: "low", reason: "safe", requiresConfirmation: false }, result: { kind: "void" } };
    }),
  };
}

// ── makePolicyDecision ────────────────────────────────────────────────────

export function makePolicyDecision(
  decisions?: Record<string, VscodeCommandPolicyDecision>,
): VscodeCommandPolicyDecision {
  return vi.fn((cmd) => {
    if (decisions?.[cmd.command]) return decisions[cmd.command];
    if (cmd.command.startsWith("accordo_")) {
      return { action: "deny", riskClass: "high", reason: "accordo internal", requiresConfirmation: false, preferredTool: cmd.command };
    }
    if (cmd.command === "workbench.action.quit" || cmd.command === "workbench.action.restart") {
      return { action: "deny", riskClass: "high", reason: "high risk", requiresConfirmation: false };
    }
    return { action: "allow", riskClass: "low", reason: "safe", requiresConfirmation: false };
  });
}

// ── makeAuditSink ─────────────────────────────────────────────────────────

export function makeAuditSink() {
  const log: unknown[] = [];
  const sink: VscodeCommandAuditSink = {
    log: vi.fn((entry) => { log.push(entry); }),
    write: vi.fn(async (entry) => { log.push(entry); }),
    getLog: () => log,
  };
  return sink;
}

// ── makeCmd helper ─────────────────────────────────────────────────────────

function makeCmd(
  command: string,
  policyAction: "allow" | "confirm" | "deny" = "allow",
  riskClass: "low" | "moderate" | "high" = "low",
  riskReason = "safe",
  preferredTool?: string,
  internal = false,
): VscodeCommandDescriptor {
  return {
    command,
    source: "core",
    internal,
    policy: {
      action: policyAction,
      riskClass,
      reason: riskReason,
      requiresConfirmation: false,
      preferredTool,
    },
  };
}
