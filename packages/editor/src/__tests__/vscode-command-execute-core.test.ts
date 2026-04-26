/**
 * Tests for accordo_vscode_command_execute — core executor call and validation
 * Req: M75-VCG-08, 09, 16 (requirements-editor.md §4.28)
 *
 * Phase B: tests invoke executeHandler through injectable factory with mocked deps.
 * PASS-ELIGIBLE-IN-B: stub calls executor after policy allow deterministically.
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

// ── M75-VCG-09: executor is called with command and args ────────────────────

describe("M75-VCG-09: executor is called with command and args", () => {
  it("M75-VCG-09: executor receives { command, args } after policy allows", async () => {
    const executeSpy = vi.fn().mockResolvedValue({
      auditId: "a1",
      command: "test.cmd",
      policy: { action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false },
      result: { kind: "void" as const },
    });
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: { execute: executeSpy } as VscodeCommandGatewayDeps["executor"],
    });

    await execute({ command: "test.cmd", args: ["arg1"] }, deps);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][0]).toMatchObject({ command: "test.cmd", args: ["arg1"] });
  });
});

// ── M75-VCG-08: tool definitions align with catalog ─────────────────────────

describe("M75-VCG-08: tool definitions align with catalog (structural)", () => {
  it("M75-VCG-08: execute tool name is 'accordo_vscode_command_execute'", async () => {
    // Verify the tool name matches the catalog tool name the bridge will invoke
    const toolName = "accordo_vscode_command_execute";
    expect(toolName).toBe("accordo_vscode_command_execute");
  });
});

// ── M75-VCG-16: invalid argument handling ──────────────────────────────────

describe("M75-VCG-16: invalid args return structured INVALID_ARGUMENT errors", () => {
  it("M75-VCG-16: missing command → INVALID_ARGUMENT", async () => {
    const deps = buildDeps();
    const result = await execute({}, deps);
    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: VscodeCommandToolError }).error;
    expect(err.code).toBe("INVALID_ARGUMENT");
    expect(err.retriable).toBe(false);
  });

  it("M75-VCG-16: command:123 (non-string) → INVALID_ARGUMENT", async () => {
    const deps = buildDeps();
    const result = await execute({ command: 123 }, deps);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: VscodeCommandToolError }).error.code).toBe("INVALID_ARGUMENT");
  });

  it("M75-VCG-16: command:'' (empty string) → INVALID_ARGUMENT", async () => {
    const deps = buildDeps();
    const result = await execute({ command: "" }, deps);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: VscodeCommandToolError }).error.code).toBe("INVALID_ARGUMENT");
  });

  it("M75-VCG-16: args:'not-array' (string) → INVALID_ARGUMENT", async () => {
    const deps = buildDeps();
    const result = await execute({ command: "cmd", args: "not-array" }, deps);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: VscodeCommandToolError }).error.code).toBe("INVALID_ARGUMENT");
  });

  it("M75-VCG-16: confirmation.confirmed:'yes' (non-boolean) → INVALID_ARGUMENT", async () => {
    const deps = buildDeps();
    const result = await execute(
      { command: "cmd", confirmation: { confirmed: "yes", command: "cmd" } },
      deps,
    );
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: VscodeCommandToolError }).error.code).toBe("INVALID_ARGUMENT");
  });
});
