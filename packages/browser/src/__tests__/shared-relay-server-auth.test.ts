import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SharedBrowserRelayServer, clearWsHandlers, getWsHarness, makeMockRequest, makeMockSocket } from "./shared-relay-server-fixtures.js";

describe("shared-relay-server auth", () => {
  const SERVER_TOKEN = "shared-secret-xyz";
  beforeEach(() => clearWsHandlers());
  afterEach(() => clearWsHandlers());

  it("rejects wrong token on /chrome and accepts correct token", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;
    const badSocket = makeMockSocket();
    handler(badSocket, makeMockRequest("/chrome?token=wrong-token"));
    expect(badSocket.closeCode).toBe(1008);
    const goodSocket = makeMockSocket();
    handler(goodSocket, makeMockRequest(`/chrome?token=${SERVER_TOKEN}`));
    expect(goodSocket.closeCode).toBeNull();
    expect(server.isChromeConnected()).toBe(true);
    await server.stop();
  });

  it("rejects wrong token on /hub, rejects missing hubId, and accepts valid /hub handshake", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;
    const badSocket = makeMockSocket();
    handler(badSocket, makeMockRequest(`/hub?hubId=h1&token=wrong-token`));
    expect(badSocket.closeCode).toBe(1008);
    const missingHubSocket = makeMockSocket();
    handler(missingHubSocket, makeMockRequest(`/hub?token=${SERVER_TOKEN}`));
    expect(missingHubSocket.closeMessage).toBe("missing hubId");
    const goodSocket = makeMockSocket();
    handler(goodSocket, makeMockRequest(`/hub?hubId=h1&token=${SERVER_TOKEN}`));
    expect(goodSocket.closeCode).toBeNull();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });
});
