import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SharedBrowserRelayServer, clearWsHandlers, getWsHarness, makeMockRequest, makeMockSocket } from "./shared-relay-server-fixtures.js";

describe("shared-relay-server metadata", () => {
  const SERVER_TOKEN = "shared-secret-xyz";
  beforeEach(() => clearWsHandlers());
  afterEach(() => clearWsHandlers());

  it("preserves handshake label and stable connectedAt for a live connection", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;
    const socket = makeMockSocket();
    handler(socket, makeMockRequest(`/hub?hubId=h-meta&label=my-hub&token=${SERVER_TOKEN}`));
    const first = server.getConnectedHubs().get("h-meta");
    const second = server.getConnectedHubs().get("h-meta");
    expect(first?.label).toBe("my-hub");
    expect(second?.connectedAt).toBe(first?.connectedAt);
    await server.stop();
  });

  it("post-open hub-register message cannot overwrite handshake metadata", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;
    const socket = makeMockSocket();
    handler(socket, makeMockRequest(`/hub?hubId=h-overwrite&label=handshake-label&token=${SERVER_TOKEN}`));
    const initial = server.getConnectedHubs().get("h-overwrite");
    socket.handlers["message"]?.forEach((cb) => cb(Buffer.from(JSON.stringify({ kind: "hub-register", hubId: "h-overwrite", label: "message-label" }))));
    const after = server.getConnectedHubs().get("h-overwrite");
    expect(after?.label).toBe("handshake-label");
    expect(after?.connectedAt).toBe(initial?.connectedAt);
    await server.stop();
  });

  it("real reconnect gets a new connectedAt", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;
    const firstSocket = makeMockSocket();
    handler(firstSocket, makeMockRequest(`/hub?hubId=h-reconnect&label=hub&token=${SERVER_TOKEN}`));
    const firstTime = server.getConnectedHubs().get("h-reconnect")?.connectedAt;
    firstSocket.handlers["close"]?.forEach((cb) => cb());
    await new Promise((resolve) => setTimeout(resolve, 1));
    const secondSocket = makeMockSocket();
    handler(secondSocket, makeMockRequest(`/hub?hubId=h-reconnect&label=hub&token=${SERVER_TOKEN}`));
    const secondTime = server.getConnectedHubs().get("h-reconnect")?.connectedAt;
    expect(secondTime).toBeDefined();
    expect(secondTime).not.toBe(firstTime);
    await server.stop();
  });
});
