/**
 * Tests for accordo_vscode_command_execute — result normalization
 * Req: M75-VCG-14 (requirements-editor.md §4.28)
 *
 * Phase B: tests invoke executeHandler through injectable factory with mocked deps.
 * PASS-ELIGIBLE-IN-B: stub normalizes result kinds deterministically.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  VscodeCommandExecuteResponse,
  VscodeCommandGatewayDeps,
} from "../tools/vscode-command-contracts.js";
import { createVscodeCommandGateway } from "../tools/vscode-command-stubs.ts";
import { buildDeps } from "./vscode-command-helpers.ts";

// ── Per-test reset ─────────────────────────────────────────────────────────

beforeEach(() => { vi.clearAllMocks(); });

// ── Helper ─────────────────────────────────────────────────────────────────

async function execute(
  args: Record<string, unknown>,
  deps: VscodeCommandGatewayDeps,
) {
  const { executeHandler } = createVscodeCommandGateway(deps);
  return executeHandler(args) as Promise<VscodeCommandExecuteResponse | { ok: false }>;
}

// ── M75-VCG-14: result normalization ─────────────────────────────────────────

describe("M75-VCG-14: raw results are normalized to JSON-safe envelopes", () => {
  it("M75-VCG-14: void result (undefined) → { kind: 'void' }", async () => {
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: {
        execute: vi.fn().mockResolvedValue({
          auditId: "a1",
          command: "void.cmd",
          policy: { action: "allow", riskClass: "low", requiresConfirmation: false, reason: "safe" },
          result: { kind: "void" as const },
        }),
      } as VscodeCommandGatewayDeps["executor"],
    });

    const result = await execute({ command: "void.cmd" }, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandExecuteResponse;
    expect(ok.result).toMatchObject({ kind: "void" });
  });

  it("M75-VCG-14: plain object result → { kind: 'json', value: <object> }", async () => {
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: {
        execute: vi.fn().mockResolvedValue({
          auditId: "a1",
          command: "obj.cmd",
          policy: { action: "allow", riskClass: "low", requiresConfirmation: false, reason: "safe" },
          result: { kind: "json" as const, value: { count: 42, text: "hello" } },
        }),
      } as VscodeCommandGatewayDeps["executor"],
    });

    const result = await execute({ command: "obj.cmd" }, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandExecuteResponse;
    expect(ok.result).toMatchObject({ kind: "json", value: { count: 42 } });
  });

  it("M75-VCG-14: array result → { kind: 'json', value: <array> }", async () => {
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: {
        execute: vi.fn().mockResolvedValue({
          auditId: "a1",
          command: "arr.cmd",
          policy: { action: "allow", riskClass: "low", requiresConfirmation: false, reason: "safe" },
          result: { kind: "json" as const, value: ["a", "b"] },
        }),
      } as VscodeCommandGatewayDeps["executor"],
    });

    const result = await execute({ command: "arr.cmd" }, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandExecuteResponse;
    expect(ok.result).toMatchObject({ kind: "json", value: ["a", "b"] });
  });

  it("M75-VCG-14: unsupported result → { kind: 'unsupported', summary }", async () => {
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: {
        execute: vi.fn().mockResolvedValue({
          auditId: "a1",
          command: "bad.cmd",
          policy: { action: "allow", riskClass: "low", requiresConfirmation: false, reason: "safe" },
          result: { kind: "unsupported" as const, summary: "Command returned a function — not serializable" },
        }),
      } as VscodeCommandGatewayDeps["executor"],
    });

    const result = await execute({ command: "bad.cmd" }, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandExecuteResponse;
    expect(ok.result.kind).toBe("unsupported");
  });
});
