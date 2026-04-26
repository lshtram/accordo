/**
 * E2E Tests — vscode-command-gateway execute operations
 * Package: accordo-hub
 * Gated: ACCORDO_E2E_LIVE=1 required
 * Req: E2E-VCG-07, 08, 10, 13, 14, 15
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ACCORDO_E2E_LIVE,
  StubBridge,
  McpSession,
  buildExecuteResp,
  baseUrl,
  E2E_TOKEN,
  flush,
  vscodeCommandTools,
} from "./vscode-command-e2e-harness.js";

const E2E = ACCORDO_E2E_LIVE === "1" ? describe : describe.skip;

E2E("vscode-command E2E — execute", () => {
  let bridge: StubBridge;
  let session: McpSession;

  beforeEach(async () => {
    bridge = new StubBridge();
    session = new McpSession(baseUrl, E2E_TOKEN);
    await bridge.connect(baseUrl);
    await session.initialize();
    bridge.clearInvokes();
    bridge.setAutoResponder((tool, args) => {
      if (tool === "accordo_vscode_command_execute") {
        const { command, args: cmdArgs, confirmation } = args as { command: string; args?: unknown[]; confirmation?: { confirmed: boolean; command: string } };
        if (confirmation && !confirmation.confirmed) {
          return { success: true, data: { ok: false, error: { code: "POLICY_CONFIRMATION_REQUIRED", message: "not confirmed", retriable: false } } };
        }
        // accordo_* commands are denied by gateway policy BEFORE bridge invoke.
        // Simulate this in the auto-responder so tests can verify behavior.
        if (command?.startsWith("accordo_")) {
          return { success: true, data: { ok: false, error: { code: "POLICY_DENIED", message: `Command '${command}' is denied by policy`, retriable: false, details: { preferredTool: command } } } };
        }
        return { success: true, data: buildExecuteResp(command, cmdArgs) };
      }
      return { success: true, data: {} };
    });
    bridge.registerTools(vscodeCommandTools);
    await flush(50);
  });

  afterEach(() => { bridge.disconnect(); });

  it("E2E-VCG-07: accordo_vscode_command_execute is registered after bridge connects", async () => {
    const res = await session.call("tools/list");
    expect(res.status).toBe(200);
    const result = res.body as { result?: { tools?: Array<{ name: string }> } };
    const toolNames = (result?.result?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("accordo_vscode_command_execute");
  });

  it("E2E-VCG-08: execute routes through gateway to executor via WS bridge", async () => {
    bridge.clearInvokes();
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_execute",
      arguments: { command: "workbench.action.splitEditorRight" },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    expect(p.command).toBe("workbench.action.splitEditorRight");
    const invokes = await bridge.waitForInvokes(1);
    expect(invokes.length).toBe(1);
    expect(invokes[0].tool).toBe("accordo_vscode_command_execute");
    expect(invokes[0].args).toMatchObject({ command: "workbench.action.splitEditorRight" });
  });

  it("E2E-VCG-13: execute returns structured result (kind: void | json | unsupported)", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_execute",
      arguments: { command: "workbench.action.closeActiveEditor" },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    expect(p.result).toMatchObject({ kind: expect.stringMatching(/^(void|json|unsupported)$/) });
  });

  it("E2E-VCG-14: execute response carries auditId", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_execute",
      arguments: { command: "workbench.action.splitEditorRight" },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(true);
    expect(p.auditId).toBeDefined();
    expect(typeof p.auditId).toBe("string");
  });

  it("E2E-VCG-15: missing command argument returns INVALID_ARGUMENT", async () => {
    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_execute",
      arguments: {},
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(false);
    expect(p.error.code).toBe("INVALID_ARGUMENT");
    expect(p.error.retriable).toBe(false);
  });
});
