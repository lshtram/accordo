/**
 * Tests for accordo_vscode_command_execute — accordo_* command denial
 * Req: M75-VCG-13 (requirements-editor.md §4.28)
 *
 * Phase B: PASS-ELIGIBLE-IN-B — stub policy denies accordo_* with preferredTool.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  VscodeCommandGatewayDeps,
  VscodeCommandToolError,
} from "../tools/vscode-command-contracts.js";
import { createVscodeCommandGateway } from "../tools/vscode-command-stubs.ts";
import { buildDeps } from "./vscode-command-helpers.ts";

beforeEach(() => { vi.clearAllMocks(); });

async function execute(args: Record<string, unknown>, deps: VscodeCommandGatewayDeps) {
  const { executeHandler } = createVscodeCommandGateway(deps);
  return executeHandler(args) as Promise<{ ok: false; error: VscodeCommandToolError }>;
}

// ── M75-VCG-13: accordo_* commands denied with preferredTool ────────────────

describe("M75-VCG-13: accordo_* commands denied with preferredTool guidance", () => {
  it("M75-VCG-13: accordo_editor_open → POLICY_DENIED with preferredTool", async () => {
    const deps = buildDeps({
      policy: {
        classify: vi.fn().mockResolvedValue({
          action: "deny" as const,
          riskClass: "high" as const,
          reason: "accordo internal",
          requiresConfirmation: false,
          preferredTool: "accordo_editor_open",
        }),
      } as VscodeCommandGatewayDeps["policy"],
    });

    const result = await execute({ command: "accordo_editor_open" }, deps);

    expect(result.ok).toBe(false);
    const err = result.error;
    expect(err.code).toBe("POLICY_DENIED");
    expect((err.details as Record<string, string> | undefined)?.preferredTool).toBe("accordo_editor_open");
  });

  it("M75-VCG-13: accordo_vscode_command_execute itself → POLICY_DENIED with preferredTool", async () => {
    const deps = buildDeps({
      policy: {
        classify: vi.fn().mockResolvedValue({
          action: "deny" as const,
          riskClass: "high" as const,
          reason: "accordo internal",
          requiresConfirmation: false,
          preferredTool: "accordo_vscode_command_execute",
        }),
      } as VscodeCommandGatewayDeps["policy"],
    });

    const result = await execute({ command: "accordo_vscode_command_execute" }, deps);

    expect(result.ok).toBe(false);
    const err = result.error;
    expect(err.code).toBe("POLICY_DENIED");
    expect((err.details as Record<string, string> | undefined)?.preferredTool).toBe("accordo_vscode_command_execute");
  });
});
