/**
 * E2E Tests — vscode-command-gateway policy enforcement (part 2 of 3)
 * Package: accordo-hub
 * Gated: ACCORDO_E2E_LIVE=1 required
 * Req: E2E-VCG-11
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ACCORDO_E2E_LIVE,
  StubBridge,
  McpSession,
  baseUrl,
  E2E_TOKEN,
  flush,
  vscodeCommandTools,
} from "./vscode-command-e2e-harness.js";
import { confirmReloadResponder, applyAutoResponder } from "./vscode-command-policy-e2e-helpers.js";

const E2E = ACCORDO_E2E_LIVE === "1" ? describe : describe.skip;

E2E("vscode-command E2E — policy (confirm)", () => {
  let bridge: StubBridge;
  let session: McpSession;

  beforeEach(async () => {
    bridge = new StubBridge();
    session = new McpSession(baseUrl, E2E_TOKEN);
    await bridge.connect(baseUrl);
    await session.initialize();
    bridge.registerTools(vscodeCommandTools);
    await flush(50);
  });

  afterEach(() => { bridge.disconnect(); });

  it("E2E-VCG-11: confirm-class command returns POLICY_CONFIRMATION_REQUIRED without payload", async () => {
    applyAutoResponder(bridge, confirmReloadResponder);
    bridge.clearInvokes();

    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_execute",
      arguments: { command: "workbench.action.reload" },
    });
    expect(res.status).toBe(200);
    const text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "{}";
    const p = JSON.parse(text);
    expect(p.ok).toBe(false);
    expect(p.error.code).toBe("POLICY_CONFIRMATION_REQUIRED");
  });
});
