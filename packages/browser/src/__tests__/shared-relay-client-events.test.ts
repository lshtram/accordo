import { describe, it, expect } from "vitest";
import { SharedRelayClient, makeOptions, onRelayRequestImplement, sharedWsState, type BrowserRelayAction } from "./shared-relay-client-fixtures.js";

describe("shared-relay-client events", () => {
  it("chrome-status events toggle connection state", () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    sharedWsState.messageHandler?.(Buffer.from(JSON.stringify({ kind: "chrome-status", connected: true })));
    expect(client.isConnected()).toBe(true);
    sharedWsState.messageHandler?.(Buffer.from(JSON.stringify({ kind: "chrome-status", connected: false })));
    expect(client.isConnected()).toBe(false);
    client.stop();
  });

  it("onRelayRequest can service all supported browser comment actions", async () => {
    const validActions: BrowserRelayAction[] = [
      "create_comment", "reply_comment", "resolve_thread", "reopen_thread",
      "delete_comment", "delete_thread", "get_comments", "get_all_comments", "get_comments_version",
    ];
    expect(validActions.length).toBe(9);
    for (const action of validActions) {
      const result = await onRelayRequestImplement(action, {});
      expect(result).toHaveProperty("success");
    }
  });

  it("constructed client accepts onRelayRequest interceptor", () => {
    const client = new SharedRelayClient(makeOptions({ onRelayRequest: onRelayRequestImplement }));
    client.start();
    expect(client.onRelayRequest).toBeDefined();
    client.stop();
  });
});
