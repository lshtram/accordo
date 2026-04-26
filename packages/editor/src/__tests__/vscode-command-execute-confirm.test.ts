/**
 * Tests for accordo_vscode_command_execute — confirmation payload contract
 * Req: M75-VCG-12 (requirements-editor.md §4.28)
 *
 * Phase B: tests invoke executeHandler through injectable factory with mocked deps.
 * PASS-ELIGIBLE-IN-B: stub checks confirmation payload before calling executor.
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

// ── M75-VCG-12: confirm class requires matching confirmation payload ────────

describe("M75-VCG-12: confirm class requires matching confirmation payload", () => {
  it("M75-VCG-12: without confirmation payload → error code POLICY_CONFIRMATION_REQUIRED", async () => {
    const deps = buildDeps({
      policy: {
        classify: vi.fn().mockResolvedValue({
          action: "confirm" as const,
          riskClass: "moderate" as const,
          reason: "requires confirmation",
          requiresConfirmation: true,
        }),
      } as VscodeCommandGatewayDeps["policy"],
    });

    const result = await execute({ command: "risky.command" }, deps);

    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: VscodeCommandToolError }).error;
    expect(err.code).toBe("POLICY_CONFIRMATION_REQUIRED");
    expect(err.retriable).toBe(false);
  });

  it("M75-VCG-12: with matching confirmation payload → executor is called", async () => {
    const executeSpy = vi.fn().mockResolvedValue({
      auditId: "a1",
      command: "risky.command",
      policy: { action: "confirm" as const, riskClass: "moderate" as const, reason: "requires confirmation", requiresConfirmation: true },
      result: { kind: "void" as const },
    });
    const deps = buildDeps({
      policy: {
        classify: vi.fn().mockResolvedValue({
          action: "confirm" as const,
          riskClass: "moderate" as const,
          reason: "requires confirmation",
          requiresConfirmation: true,
        }),
      } as VscodeCommandGatewayDeps["policy"],
      executor: { execute: executeSpy } as VscodeCommandGatewayDeps["executor"],
    });

    const result = await execute(
      { command: "risky.command", confirmation: { confirmed: true, command: "risky.command" } },
      deps,
    );

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("M75-VCG-12: confirmation.command must echo the request command", async () => {
    const deps = buildDeps({
      policy: {
        classify: vi.fn().mockResolvedValue({
          action: "confirm" as const,
          riskClass: "moderate" as const,
          reason: "requires confirmation",
          requiresConfirmation: true,
        }),
      } as VscodeCommandGatewayDeps["policy"],
    });

    const result = await execute(
      { command: "cmd.a", confirmation: { confirmed: true, command: "cmd.b" } },
      deps,
    );

    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: VscodeCommandToolError }).error;
    expect(err.code).toBe("INVALID_ARGUMENT");
    expect(err.message).toContain("echo");
  });
});
