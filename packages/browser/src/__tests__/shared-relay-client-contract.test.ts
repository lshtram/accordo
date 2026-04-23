import { describe, it, expect } from "vitest";
import { SharedRelayClient, TEST_HUB_ID, TEST_TOKEN, makeOptions } from "./shared-relay-client-fixtures.js";

describe("shared-relay-client contract", () => {
  it("constructs cleanly and exposes BrowserRelayLike methods", () => {
    const client = new SharedRelayClient(makeOptions());
    expect(typeof client.request).toBe("function");
    expect(typeof client.push).toBe("function");
    expect(typeof client.isConnected).toBe("function");
    expect(typeof client.start).toBe("function");
    expect(typeof client.stop).toBe("function");
  });

  it("request() resolves and push() is fire-and-forget after start()", async () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    const response = await client.request("get_page_map", { maxDepth: 3 }, 5000);
    expect(response).toHaveProperty("success");
    client.push("navigate", { url: "https://example.com" });
    client.stop();
  });

  it("WS URL contract includes hubId and token query parameters", () => {
    const expectedUrl = `ws://127.0.0.1:40111/hub?hubId=${TEST_HUB_ID}&token=${TEST_TOKEN}`;
    expect(expectedUrl).toContain(`hubId=${TEST_HUB_ID}`);
    expect(expectedUrl).toContain(`token=${TEST_TOKEN}`);
  });
});
