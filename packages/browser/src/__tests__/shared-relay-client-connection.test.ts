import { describe, it, expect } from "vitest";
import { SharedRelayClient, makeOptions, sharedWsState } from "./shared-relay-client-fixtures.js";

describe("shared-relay-client connection", () => {
  it("isConnected() is false before start and false until chrome is known connected", () => {
    const client = new SharedRelayClient(makeOptions());
    expect(client.isConnected()).toBe(false);
    client.start();
    expect(client.isConnected()).toBe(false);
    expect(client.isRelayConnected()).toBe(true);
    client.stop();
  });

  it("hub-register-ack seeds initial chrome connection state", () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    sharedWsState.messageHandler?.(Buffer.from(JSON.stringify({ kind: "hub-register-ack", hubId: makeOptions().hubId, chromeConnected: true })));
    expect(client.isConnected()).toBe(true);
    client.stop();
  });

  it("stop() is safe after start() and cancels reconnect path", () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    client.stop();
    expect(client.isConnected()).toBe(false);
  });
});
