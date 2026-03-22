import { describe, it, expect } from "vitest";
import { BrowserRelayServer } from "../relay-server.js";

describe("M82-RELAY server", () => {
  it("BR-F-120: starts relay on localhost without throwing", async () => {
    const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40112, token: "token" });
    await server.start();
    expect(server.isConnected()).toBe(false);
    await server.stop();
  });

  it("BR-F-125: request returns browser-not-connected when no extension socket", async () => {
    const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40113, token: "token" });
    await server.start();
    const response = await server.request("get_comments", { url: "https://example.com" }, 50);
    expect(response.success).toBe(false);
    expect(response.error).toBe("browser-not-connected");
    await server.stop();
  });

  it("BR-F-125: connected socket path uses timeout (not browser-not-connected)", async () => {
    const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40114, token: "token" });
    await server.start();

    const fakeClient = {
      readyState: 1,
      send: () => undefined,
      close: () => undefined,
    } as unknown;

    (server as unknown as { client: unknown }).client = fakeClient;
    expect(server.isConnected()).toBe(true);

    const response = await server.request("get_comments", { url: "https://example.com" }, 20);
    expect(response.success).toBe(false);
    expect(response.error).toBe("timeout");

    await server.stop();
  });
});
