/**
 * Tests for accordo_vscode_command_execute — audit logging
 * Req: M75-VCG-15 (requirements-editor.md §4.28)
 *
 * Phase B: tests invoke executeHandler through injectable factory with mocked deps.
 * PASS-ELIGIBLE-IN-B: stub writes audit entry on every call.
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

async function execute(args: Record<string, unknown>, deps: VscodeCommandGatewayDeps) {
  const { executeHandler } = createVscodeCommandGateway(deps);
  return executeHandler(args) as Promise<VscodeCommandExecuteResponse | { ok: false }>;
}

// ── M75-VCG-15: audit logging ────────────────────────────────────────────────

describe("M75-VCG-15: every execution is audit-logged", () => {
  it("M75-VCG-15: audit.write is called once on success", async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: {
        execute: vi.fn().mockResolvedValue({
          auditId: "a1",
          command: "audit.test",
          policy: { action: "allow", riskClass: "low", requiresConfirmation: false, reason: "safe" },
          result: { kind: "void" as const },
        }),
      } as VscodeCommandGatewayDeps["executor"],
      audit: { write: writeSpy } as VscodeCommandGatewayDeps["audit"],
    });

    await execute({ command: "audit.test" }, deps);

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("M75-VCG-15: audit entry on success has outcome: 'success'", async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({
      policy: { classify: vi.fn().mockResolvedValue({ action: "allow" as const, riskClass: "low" as const, reason: "safe", requiresConfirmation: false }) } as VscodeCommandGatewayDeps["policy"],
      executor: {
        execute: vi.fn().mockResolvedValue({
          auditId: "a1",
          command: "audit.test",
          policy: { action: "allow", riskClass: "low", requiresConfirmation: false, reason: "safe" },
          result: { kind: "void" as const },
        }),
      } as VscodeCommandGatewayDeps["executor"],
      audit: { write: writeSpy } as VscodeCommandGatewayDeps["audit"],
    });

    await execute({ command: "audit.test" }, deps);

    const entry = writeSpy.mock.calls[0]![0];
    expect(entry.outcome).toBe("success");
    expect(entry.toolName).toBe("accordo_vscode_command_execute");
    expect(entry.command).toBe("audit.test");
  });

  it("M75-VCG-15: audit entry on deny has outcome: 'denied'", async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({
      policy: {
        classify: vi.fn().mockResolvedValue({
          action: "deny" as const,
          riskClass: "high" as const,
          reason: "policy deny",
          requiresConfirmation: false,
        }),
      } as VscodeCommandGatewayDeps["policy"],
      audit: { write: writeSpy } as VscodeCommandGatewayDeps["audit"],
    });

    await execute({ command: "denied.cmd" }, deps);

    const entry = writeSpy.mock.calls[0]![0];
    expect(entry.outcome).toBe("denied");
    expect(entry.policyAction).toBe("deny");
  });
});
