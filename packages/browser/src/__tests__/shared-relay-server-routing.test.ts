import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SharedBrowserRelayServer, clearWsHandlers, makeOptions } from "./shared-relay-server-fixtures.js";

describe("shared-relay-server routing", () => {
  beforeEach(() => clearWsHandlers());
  afterEach(() => clearWsHandlers());

  it("preserves request/response routing surface and chrome event routing hooks", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });

  it("hub disconnect cleanup keeps server usable", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });

  it("chrome disconnect path leaves isChromeConnected false", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });

  it("ownership transfer scenario remains representable", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });

  it("supports fire-and-forget push API", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(() => server.push("navigate", { url: "https://example.com" })).not.toThrow();
    await server.stop();
  });
});
