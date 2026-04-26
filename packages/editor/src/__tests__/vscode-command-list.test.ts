/**
 * Tests for accordo_vscode_command_list handler — pagination, filtering, metadata
 * Req: M75-VCG-01..07, 07a, 16, 17, 18 (requirements-editor.md §4.26)
 *
 * Phase B: tests invoke listHandler through injectable factory with mocked deps.
 * PASS-ELIGIBLE-IN-B: stub returns deterministic catalog shapes.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  VscodeCommandCatalog,
  VscodeCommandDescriptor,
  VscodeCommandGatewayDeps,
  VscodeCommandListResponse,
  VscodeCommandToolError,
} from "../tools/vscode-command-contracts.js";
import { createVscodeCommandGateway } from "../tools/vscode-command-stubs.ts";
import { buildDeps } from "./vscode-command-helpers.ts";

// ── Per-test fresh mocks ────────────────────────────────────────────────────

beforeEach(() => { vi.clearAllMocks(); });

// ── Helper: call listHandler ───────────────────────────────────────────────

async function list(
  args: Record<string, unknown>,
  deps: VscodeCommandGatewayDeps,
): Promise<VscodeCommandListResponse | { ok: false; error: VscodeCommandToolError }> {
  const { listHandler } = createVscodeCommandGateway(deps);
  return listHandler(args) as Promise<VscodeCommandListResponse | { ok: false; error: VscodeCommandToolError }>;
}

// ── M75-VCG-02: bounded, paginated list ───────────────────────────────────

describe("M75-VCG-02: bounded paginated list", () => {
  it("M75-VCG-02: returns { ok: true, commands, totalCount, truncated } with auditId", async () => {
    const commands: VscodeCommandDescriptor[] = [
      { command: "cmd.1", source: "core", internal: false, policy: { action: "allow", riskClass: "low", reason: "safe", requiresConfirmation: false } },
    ];
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "a1", commands, totalCount: 1, truncated: false }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    const result = await list({}, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandListResponse;
    expect(ok.auditId).toBe("a1");
    expect(ok.commands).toHaveLength(1);
    expect(ok.totalCount).toBe(1);
    expect(ok.truncated).toBe(false);
    expect(catalog.listCommands).toHaveBeenCalledTimes(1);
  });

  it("M75-VCG-02: offset and limit are forwarded to catalog.listCommands", async () => {
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "a1", commands: [], totalCount: 0, truncated: false }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    await list({ offset: 10, limit: 5 }, deps);

    expect(catalog.listCommands).toHaveBeenCalledWith(expect.objectContaining({ offset: 10, limit: 5 }));
  });

  it("M75-VCG-02: nextOffset is returned when truncated:true", async () => {
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "a1", commands: [], totalCount: 50, nextOffset: 10, truncated: true }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    const result = await list({ limit: 10 }, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandListResponse;
    expect(ok.truncated).toBe(true);
    expect(ok.nextOffset).toBe(10);
  });
});

// ── M75-VCG-03: includeInternal filtering ──────────────────────────────────

describe("M75-VCG-03: includeInternal flag controls internal command visibility", () => {
  it("M75-VCG-03: includeInternal:false excludes underscore-prefixed commands", async () => {
    const commands: VscodeCommandDescriptor[] = [
      { command: "public.command", source: "core", internal: false, policy: { action: "allow", riskClass: "low", reason: "safe", requiresConfirmation: false } },
      { command: "_internal.command", source: "core", internal: true, policy: { action: "deny", riskClass: "high", reason: "internal", requiresConfirmation: false } },
    ];
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "a1", commands, totalCount: 2, truncated: false }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    await list({ includeInternal: false }, deps);

    expect(catalog.listCommands).toHaveBeenCalledWith(expect.objectContaining({ includeInternal: false }));
  });

  it("M75-VCG-03: includeInternal:true passes includeInternal:true to catalog", async () => {
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "a1", commands: [], totalCount: 0, truncated: false }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    await list({ includeInternal: true }, deps);

    expect(catalog.listCommands).toHaveBeenCalledWith(expect.objectContaining({ includeInternal: true }));
  });
});

// ── M75-VCG-06: auditable, returns auditId ───────────────────────────────

describe("M75-VCG-06: listing is auditable and returns an auditId", () => {
  it("M75-VCG-06: catalog result auditId is returned in response", async () => {
    const catalog = { listCommands: vi.fn().mockResolvedValue({ auditId: "audit-list-42", commands: [], totalCount: 0, truncated: false }) };
    const deps = buildDeps({ catalog: catalog as VscodeCommandCatalog });

    const result = await list({}, deps);

    expect(result.ok).toBe(true);
    const ok = result as VscodeCommandListResponse;
    expect(ok.auditId).toBe("audit-list-42");
  });
});

