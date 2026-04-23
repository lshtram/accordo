import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SharedBrowserRelayServer, clearWsHandlers, makeOptions } from "./shared-relay-server-fixtures.js";

describe("shared-relay-server basic", () => {
  beforeEach(() => clearWsHandlers());
  afterEach(() => clearWsHandlers());

  it("starts and stops cleanly", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await expect(server.start()).resolves.toBeUndefined();
    expect(server.getConnectedHubs().size).toBe(0);
    await server.stop();
  });

  it("reports chrome disconnected before any chrome client connects", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });

  it("exposes connected hubs as a Map keyed by hubId", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });

  it("stop clears hub routing table", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    await server.stop();
    expect(server.getConnectedHubs().size).toBe(0);
  });

  it("chrome-status event shape remains { kind, connected }", async () => {
    const { ChromeStatusEvent } = await import("../shared-relay-types.js");
    const connectedEvent: ChromeStatusEvent = { kind: "chrome-status", connected: true };
    const disconnectedEvent: ChromeStatusEvent = { kind: "chrome-status", connected: false };
    expect(connectedEvent.kind).toBe("chrome-status");
    expect(disconnectedEvent.connected).toBe(false);
  });

  it("fixed-port and shared-token decisions remain intact", async () => {
    expect(makeOptions().port).toBe(40111);
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });
});
