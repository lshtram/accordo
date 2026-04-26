/**
 * E2E Tests — vscode-command-gateway policy enforcement (part 1 of 3)
 * Package: accordo-hub
 * Gated: ACCORDO_E2E_LIVE=1 required
 * Req: E2E-VCG-09
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
import { denyOnlyResponder, applyAutoResponder } from "./vscode-command-policy-e2e-helpers.js";

const E2E = ACCORDO_E2E_LIVE === "1" ? describe : describe.skip;

E2E("vscode-command E2E — policy (deny)", () => {
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

  it("E2E-VCG-09: deny-class command returns POLICY_DENIED — no bridge invocation", async () => {
    applyAutoResponder(bridge, denyOnlyResponder);
    bridge.clearInvokes();

    const listRes = await session.call("tools/list");
    const listResult = listRes.body as { result?: { tools?: Array<{ name: string }> } };
    const toolNames = (listResult?.result?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("accordo_vscode_command_execute");

    const res = await session.call("tools/call", {
      name: "accordo_vscode_command_execute",
      arguments: { command: "accordo_editor_open" },
    });
    expect(res.status).toBe(200);

    let text = "";
    try {
      text = (res.body as { result?: { content?: Array<{ text: string }> } })?.result?.content?.[0]?.text ?? "";
    } catch { /* no text */ }
    expect(text).toContain("denied");

    const invokes = await bridge.waitForInvokes(1, 200).catch(() => []);
    expect(invokes.length).toBe(0);
  });
});
