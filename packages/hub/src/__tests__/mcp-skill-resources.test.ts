import { describe, expect, it } from "vitest";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import { McpHandler } from "../mcp-handler.js";
import { ToolRegistry } from "../tool-registry.js";
import { BridgeServer } from "../bridge-server.js";
import { createRuntimeDirectiveCatalog } from "../runtime-directives/index.js";

function createHandler(): McpHandler {
  return new McpHandler({
    toolRegistry: new ToolRegistry(),
    bridgeServer: new BridgeServer({ secret: "test-secret", maxConcurrent: 16, maxQueueDepth: 64 }),
    runtimeDirectiveCatalog: createRuntimeDirectiveCatalog(),
  });
}

function request(method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0" as const, id: "req-1", method, params };
}

describe("MCP skill resources", () => {
  it("declares resources capability and thin skill routing instructions", async () => {
    const handler = createHandler();
    const session = handler.createSession();
    const response = await handler.handleRequest(request("initialize", {
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-agent", version: "1.0" },
    }), session);

    const result = response?.result as { capabilities: Record<string, unknown>; instructions: string };
    expect(result.capabilities).toHaveProperty("resources");
    expect(result.instructions).toContain("accordo://skills/accordo");
    expect(result.instructions).toContain("accordo://skills/diagram");
    expect(result.instructions).not.toContain("skill-tester");
  });

  it("lists all Accordo skill resources", async () => {
    const handler = createHandler();
    const session = handler.createSession();
    const response = await handler.handleRequest(request("resources/list"), session);
    const result = response?.result as { resources: Array<{ uri: string; mimeType: string }> };

    expect(result.resources.map((resource) => resource.uri)).toEqual([
      "accordo://skills/accordo",
      "accordo://skills/diagram",
      "accordo://skills/browser",
      "accordo://skills/presentation",
      "accordo://skills/walkthrough",
    ]);
    expect(result.resources.every((resource) => resource.mimeType === "text/markdown")).toBe(true);
  });

  it("reads a skill resource as Markdown", async () => {
    const handler = createHandler();
    const session = handler.createSession();
    const response = await handler.handleRequest(request("resources/read", { uri: "accordo://skills/walkthrough" }), session);
    const result = response?.result as { contents: Array<{ uri: string; mimeType: string; text: string }> };

    expect(result.contents[0]?.uri).toBe("accordo://skills/walkthrough");
    expect(result.contents[0]?.mimeType).toBe("text/markdown");
    expect(result.contents[0]?.text).toContain("Present Topics");
    expect(result.contents[0]?.text).toContain("Code Reviews");
  });

  it("returns resource-not-found for unknown skill URI", async () => {
    const handler = createHandler();
    const session = handler.createSession();
    const response = await handler.handleRequest(request("resources/read", { uri: "accordo://skills/missing" }), session);

    expect(response?.error?.code).toBe(-32002);
    expect(response?.error?.message).toBe("Resource not found");
  });
});
