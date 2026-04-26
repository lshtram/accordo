/**
 * Tests for accordo_vscode_command_execute — policy classification and deny
 * Req: M75-VCG-10, 11 (requirements-editor.md §4.28)
 *
 * Phase B: PASS-ELIGIBLE-IN-B — stub enforces policy before calling executor.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  VscodeCommandExecuteResponse,
  VscodeCommandGatewayDeps,
  VscodeCommandToolError,
} from "../tools/vscode-command-contracts.js";
import { createVscodeCommandGateway } from "../tools/vscode-command-stubs.ts";
import { buildDeps } from "./vscode-command-helpers.ts";

// ── Per-test reset ─────────────────────────────────────────────────────────

beforeEach(() => { vi.clearAllMocks(); });

// ── Helper ─────────────────────────────────────────────────────────────────

async function execute(
  args: Record<string, unknown>,
  deps: VscodeCommandGatewayDeps,
): Promise<VscodeCommandExecuteResponse | { ok: false; error: VscodeCommandToolError }> {
  const { executeHandler } = createVscodeCommandGateway(deps);
  return executeHandler(args) as Promise<VscodeCommandExecuteResponse | { ok: false; error: VscodeCommandToolError }>;
}

// ── M75-VCG-10: policy classifies before execution ─────────────────────────

describe("M75-VCG-10: policy classifies each command before execution", () => {
  it("M75-VCG-10: policy.classify(command, args) is invoked before executor", async () => {
    const classifySpy = vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false });
    const executeSpy = vi.fn().mockResolvedValue({ auditId: "a1", command: "test.cmd", policy: { action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }, result: { kind: "void" as const } });
    const deps = buildDeps({
      policy: { classify: classifySpy } as VscodeCommandGatewayDeps["policy"],
      executor: { execute: executeSpy } as VscodeCommandGatewayDeps["executor"],
    });

    await execute({ command: "test.cmd" }, deps);

    expect(classifySpy).toHaveBeenCalledTimes(1);
    expect(classifySpy).toHaveBeenCalledWith("test.cmd", []);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("M75-VCG-10: policy.classify receives args array correctly", async () => {
    const classifySpy = vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false });
    const executeSpy = vi.fn().mockResolvedValue({ auditId: "a1", command: "test.cmd", policy: { action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }, result: { kind: "void" as const } });
    const deps = buildDeps({
      policy: { classify: classifySpy } as VscodeCommandGatewayDeps["policy"],
      executor: { execute: executeSpy } as VscodeCommandGatewayDeps["executor"],
    });

    await execute({ command: "test.cmd", args: ["arg1", 42] }, deps);

    expect(classifySpy).toHaveBeenCalledWith("test.cmd", ["arg1", 42]);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});

// ── M75-VCG-11: deny blocks execution ────────────────────────────────────────

describe("M75-VCG-11: deny class blocks execution and returns POLICY_DENIED", () => {
  it("M75-VCG-11: executor is NOT called when policy is deny", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ auditId: "a1", command: "dangerous.command", policy: { action: "deny" as const, riskClass: "high" as const, reason: "high risk", requiresConfirmation: false }, result: { kind: "void" as const } });
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "deny" as const, riskClass: "high" as const, reason: "high risk", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: { execute: executeSpy } as VscodeCommandGatewayDeps["executor"],
    });

    const result = await execute({ command: "dangerous.command" }, deps);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: VscodeCommandToolError }).error;
    expect(err.code).toBe("POLICY_DENIED");
    expect(err.retriable).toBe(false);
  });

  it("M75-VCG-11: result is { ok: false, error: { code: 'POLICY_DENIED' } }", async () => {
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "deny" as const, riskClass: "high" as const, reason: "high risk", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
    });

    const result = await execute({ command: "dangerous.command" }, deps);

    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: VscodeCommandToolError }).error;
    expect(err.code).toBe("POLICY_DENIED");
    expect(err.retriable).toBe(false);
    expect(err.message).toContain("dangerous.command");
  });

  it("M75-VCG-11: response includes policy decision with riskClass:high", async () => {
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "deny" as const, riskClass: "high" as const, reason: "high risk", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
    });

    const result = await execute({ command: "dangerous.command" }, deps);

    expect(result.ok).toBe(false);
    const err = result as { ok: false; error: VscodeCommandToolError };
    expect(err.error.details).toBeDefined();
  });
});
