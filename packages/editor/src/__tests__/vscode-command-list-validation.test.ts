/**
 * Tests for accordo_vscode_command_list handler — invalid argument handling
 * Req: M75-VCG-16 (requirements-editor.md §4.26)
 *
 * Phase B: tests invoke listHandler through injectable factory with mocked deps.
 * PASS-ELIGIBLE-IN-B: stub validates args and returns structured INVALID_ARGUMENT errors.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  VscodeCommandGatewayDeps,
  VscodeCommandToolError,
  VscodeCommandListResponse,
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

// ── M75-VCG-16: invalid args return structured INVALID_ARGUMENT errors ──────

describe("M75-VCG-16: invalid args return structured INVALID_ARGUMENT errors", () => {
  it("M75-VCG-16: offset:-1 → INVALID_ARGUMENT (non-negative required)", async () => {
    const deps = buildDeps();
    const result = await list({ offset: -1 }, deps);
    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: VscodeCommandToolError }).error;
    expect(err.code).toBe("INVALID_ARGUMENT");
    expect(err.retriable).toBe(false);
    expect(err.message).toContain("offset");
  });

  it("M75-VCG-16: limit:-5 → INVALID_ARGUMENT", async () => {
    const deps = buildDeps();
    const result = await list({ limit: -5 }, deps);
    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: VscodeCommandToolError }).error;
    expect(err.code).toBe("INVALID_ARGUMENT");
  });

  it("M75-VCG-16: includeInternal:'yes' → INVALID_ARGUMENT (must be boolean)", async () => {
    const deps = buildDeps();
    const result = await list({ includeInternal: "yes" }, deps);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: VscodeCommandToolError }).error.code).toBe("INVALID_ARGUMENT");
  });

  it("M75-VCG-16: query:123 → INVALID_ARGUMENT (must be string)", async () => {
    const deps = buildDeps();
    const result = await list({ query: 123 }, deps);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: VscodeCommandToolError }).error.code).toBe("INVALID_ARGUMENT");
  });
});
