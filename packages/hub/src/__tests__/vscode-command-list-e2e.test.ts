/**
 * E2E Tests — vscode-command-gateway list operations
 * Package: accordo-hub
 * Gated: ACCORDO_E2E_LIVE=1 required
 * Req: E2E-VCG-01, 02, 03, 04, 05, 06, 16
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ACCORDO_E2E_LIVE,
  StubBridge,
  McpSession,
  buildCatalogResp,
  baseUrl,
  E2E_TOKEN,
  flush,
  vscodeCommandTools,
} from "./vscode-command-e2e-harness.js";

const E2E = ACCORDO_E2E_LIVE === "1" ? describe : describe.skip;

E2E("vscode-command E2E — list", () => {
  let bridge: StubBridge;
  let session: McpSession;

  beforeEach(async () => {
    bridge = new StubBridge();
    session = new McpSession(baseUrl, E2E_TOKEN);
    await bridge.connect(baseUrl);
    await session.initialize();
    bridge.clearInvokes();
    bridge.setAutoResponder((tool, args) => {
      if (tool === "accordo_vscode_command_list") {
        const { query, includeInternal, offset, limit } = args as { query?: string; includeInternal?: boolean; offset?: number; limit?: number };
        // Simulate handler validation for negative offset
        if (offset !== undefined && offset < 0) {
          return { success: true, data: { ok: false, error: { code: "INVALID_ARGUMENT", message: "offset must be non-negative", retriable: false } } };
        }
        return { success: true, data: buildCatalogResp(query, includeInternal, offset, limit) };
      }
      return { success: true, data: {} };
    });
    bridge.registerTools(vscodeCommandTools);
    await flush(50);
  });

  afterEach(() => { bridge.disconnect(); });

  it("E2E-VCG-01: accordo_vscode_command_list is registered after bridge connects", async () => {
    const res = await session.call("tools/list");
    expect(res.status).toBe(200);
    const result = res.body as { result?: { tools?: Array<{ name: string }> } };
    const toolNames = (result?.result?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("accordo_vscode_command_list");
  });

  it("E2E-VCG-02: list returns totalCount and truncated flag", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_list",
      arguments: { limit: 3 },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    expect(typeof p.totalCount).toBe("number");
    expect(p.totalCount).toBeGreaterThan(0);
    expect(typeof p.truncated).toBe("boolean");
    // When limit < totalCount, the result is truncated
    expect(p.truncated).toBe(p.totalCount > 3);
  });

  it("E2E-VCG-03: includeInternal:false excludes internal commands", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_list",
      arguments: { includeInternal: false, limit: 50 },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    const hasInternal = p.commands.some((c: { internal?: boolean }) => c.internal === true);
    expect(hasInternal).toBe(false);
  });

  it("E2E-VCG-04: each command has policy.action/riskClass/reason", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_list",
      arguments: { limit: 50 },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    for (const cmd of p.commands) {
      expect(cmd.policy).toMatchObject({
        action: expect.stringMatching(/^(allow|confirm|deny)$/),
        riskClass: expect.stringMatching(/^(low|moderate|high)$/),
        reason: expect.any(String),
      });
    }
  });

  it("E2E-VCG-05: accordo_* commands carry preferredTool", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_list",
      arguments: { includeInternal: false, limit: 50 },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    const accordoCmds = p.commands.filter((c: { command?: string }) => c.command?.startsWith("accordo_"));
    expect(accordoCmds.length).toBeGreaterThan(0);
    for (const cmd of accordoCmds) {
      expect(cmd.policy.preferredTool).toBeDefined();
      expect(typeof cmd.policy.preferredTool).toBe("string");
    }
  });

  it("E2E-VCG-06: list response carries auditId", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_list",
      arguments: { limit: 5 },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    expect(p.auditId).toBeDefined();
    expect(typeof p.auditId).toBe("string");
  });

  it("E2E-VCG-16: negative offset returns INVALID_ARGUMENT", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_list",
      arguments: { offset: -1 },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(false);
    expect(p.error.code).toBe("INVALID_ARGUMENT");
  });
});
