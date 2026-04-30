/**
 * Tests for accordo_vscode_command_list — policy metadata per command
 * Req: M75-VCG-04, 05, 07, 07a, 17, 18 (requirements-editor.md §4.26)
 *
 * Phase B: PASS-ELIGIBLE-IN-B — stub returns deterministic catalog metadata.
 * These tests verify tool descriptions and catalog policy metadata.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  VscodeCommandCatalog,
  VscodeCommandDescriptor,
  VscodeCommandGatewayDeps,
  VscodeCommandListResponse,
} from "../tools/vscode-command-contracts.js";
import { createVscodeCommandGateway } from "../tools/vscode-command-stubs.ts";
import { buildDeps } from "./vscode-command-helpers.ts";

beforeEach(() => { vi.clearAllMocks(); });

async function list(args: Record<string, unknown>, deps: VscodeCommandGatewayDeps) {
  const { listHandler } = createVscodeCommandGateway(deps);
  return listHandler(args) as Promise<VscodeCommandListResponse | { ok: false }>;
}

// ── M75-VCG-04: policy metadata per command ────────────────────────────────

describe("M75-VCG-04: each command descriptor includes policy metadata", () => {
  it("M75-VCG-04: every returned command has { action, riskClass, reason } in policy", async () => {
    const commands: VscodeCommandDescriptor[] = [
      { command: "safe.cmd", source: "core", internal: false, policy: { action: "allow", riskClass: "low", reason: "safe", requiresConfirmation: false } },
      { command: "risky.cmd", source: "extension", internal: false, policy: { action: "deny", riskClass: "high", reason: "high risk", requiresConfirmation: false } },
    ];
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "a1", commands, totalCount: 2, truncated: false }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    const result = await list({}, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandListResponse;
    for (const cmd of ok.commands) {
      expect(cmd.policy).toMatchObject({
        action: expect.stringMatching(/^(allow|confirm|deny)$/),
        riskClass: expect.stringMatching(/^(low|moderate|high)$/),
        reason: expect.any(String),
      });
    }
  });
});

// ── M75-VCG-05: preferredTool guidance ─────────────────────────────────────

describe("M75-VCG-05: preferredTool guidance for commands with first-class equivalents", () => {
  it("M75-VCG-05: commands with preferredTool set expose it in policy metadata", async () => {
    const commands: VscodeCommandDescriptor[] = [
      {
        command: "accordo_editor_open",
        source: "core",
        internal: false,
        policy: { action: "deny", riskClass: "high", reason: "accordo internal", requiresConfirmation: false, preferredTool: "accordo_editor_open" },
      },
    ];
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "a1", commands, totalCount: 1, truncated: false }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    const result = await list({}, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandListResponse;
    expect(ok.commands[0]!.policy.preferredTool).toBe("accordo_editor_open");
  });
});

// ── M75-VCG-07/07a: runtime description and MCP-visible docs ───────────────

describe("M75-VCG-07/07a: runtime description and MCP-visible docs guidance", () => {
  it("M75-VCG-07: tool description instructs agents to prefer first-class tools", async () => {
    const { vscodeCommandTools } = await import("../tools/vscode-command-tools.js");
    const listTool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list")!;
    expect(listTool.description).toContain("prefer first-class");
    expect(listTool.description).toContain("accordo_");
  });

  it("M75-VCG-07: tool description treats internal commands as unstable", async () => {
    const { vscodeCommandTools } = await import("../tools/vscode-command-tools.js");
    const listTool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list")!;
    expect(listTool.description).toMatch(/unstable|internal commands/i);
  });

  it("M75-VCG-07a: tool description includes MCP-visible skill resource URL", async () => {
    const { vscodeCommandTools } = await import("../tools/vscode-command-tools.js");
    const listTool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list")!;
    expect(listTool.description).toContain("accordo://skills/accordo");
  });
});

// ── M75-VCG-17: additive gateway — existing tools unchanged ────────────────

describe("M75-VCG-17: gateway is additive, not a contract replacement", () => {
  it("M75-VCG-17: tool description contains no 'replaces' or 'deprecated' language", async () => {
    const { vscodeCommandTools } = await import("../tools/vscode-command-tools.js");
    const listTool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list")!;
    const desc = listTool.description.toLowerCase();
    expect(desc).not.toMatch(/replaces?/);
    expect(desc).not.toMatch(/deprecated/i);
  });
});

// ── M75-VCG-18: server instructions point to MCP-visible runtime docs ───────

describe("M75-VCG-18: server instructions point to MCP-visible runtime docs", () => {
  it("M75-VCG-18: tool descriptions reference MCP-visible docs resources", async () => {
    const { vscodeCommandTools } = await import("../tools/vscode-command-tools.js");
    const listTool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list")!;
    expect(listTool.description).toContain("accordo://skills/accordo");
  });
});
