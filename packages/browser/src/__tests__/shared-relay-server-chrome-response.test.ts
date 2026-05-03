import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SharedBrowserRelayServer, clearWsHandlers, getWsHarness, makeMockRequest, makeMockSocket } from "./shared-relay-server-fixtures.js";

/**
 * Regression test: Chrome-originated requests that trigger Hub actions must have
 * their Hub responses routed back to Chrome, not silently dropped.
 *
 * Flow under test:
 *  1. Chrome sends { requestId, action, payload } to the relay server.
 *  2. Relay server forwards it to Hub (adding the requestId to chromeOriginatedRequestIds).
 *  3. Hub sends back { requestId, success, data } (no action field).
 *  4. Relay server detects the response, sees the requestId is Chrome-originated,
 *     sends the raw response JSON back to Chrome, and deletes the tracking entry.
 */
describe("shared-relay-server chrome-originated response routing", () => {
  beforeEach(() => clearWsHandlers());
  afterEach(() => clearWsHandlers());

  it("routes Hub response for Chrome-originated action back to Chrome socket", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: "test-token" });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;

    // Simulate Chrome connecting
    const chromeSocket = makeMockSocket();
    handler(chromeSocket, makeMockRequest("/chrome?token=test-token"));
    expect(server.isChromeConnected()).toBe(true);

    // Simulate Hub connecting
    const hubSocket = makeMockSocket();
    handler(hubSocket, makeMockRequest("/hub?hubId=hub-1&token=test-token"));
    // Hub registers and gets ack
    const hubAck = JSON.parse(hubSocket.sent[0] as string);
    expect(hubAck.kind).toBe("hub-register-ack");

    // Clear previous sent messages
    chromeSocket.sent.length = 0;
    hubSocket.sent.length = 0;

    // Chrome sends an action with a requestId (simulating browser-extension relay flow)
    const chromeRequestId = "chrome-req-123";
    chromeSocket.handlers["message"]?.forEach((cb: (...args: unknown[]) => void) => {
      cb(Buffer.from(JSON.stringify({ requestId: chromeRequestId, action: "sync_comment_state", payload: {} })));
    });

    // Hub receives the forwarded action
    const hubReceived = JSON.parse(hubSocket.sent[0] as string);
    expect(hubReceived.requestId).toBe(chromeRequestId);
    expect(hubReceived.action).toBe("sync_comment_state");

    // Hub sends back a success response (no action field)
    hubSocket.handlers["message"]?.forEach((cb: (...args: unknown[]) => void) => {
      cb(Buffer.from(JSON.stringify({ requestId: chromeRequestId, success: true, data: { synchronized: true } })));
    });

    // Chrome must receive the Hub response
    const chromeReceived = JSON.parse(chromeSocket.sent[0] as string);
    expect(chromeReceived.requestId).toBe(chromeRequestId);
    expect(chromeReceived.success).toBe(true);
    expect(chromeReceived.data).toEqual({ synchronized: true });

    await server.stop();
  });

  it("drops Chrome-originated response if Chrome socket is closed before Hub responds", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: "test-token" });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;

    // Chrome and Hub connect
    const chromeSocket = makeMockSocket();
    handler(chromeSocket, makeMockRequest("/chrome?token=test-token"));
    const hubSocket = makeMockSocket();
    handler(hubSocket, makeMockRequest("/hub?hubId=hub-1&token=test-token"));
    hubSocket.sent.length = 0;

    // Chrome sends a request
    const reqId = "chrome-req-456";
    chromeSocket.handlers["message"]?.forEach((cb: (...args: unknown[]) => void) => {
      cb(Buffer.from(JSON.stringify({ requestId: reqId, action: "get_comments", payload: {} })));
    });

    // Consume the forwarded message to Hub
    hubSocket.sent.length = 0;

    // Chrome disconnects
    chromeSocket.handlers["close"]?.forEach((cb: (...args: unknown[]) => void) => {
      cb();
    });

    // Hub sends back a response — Chrome socket is already closed, nothing should crash
    // and no exception should propagate from the relay server
    expect(() => {
      hubSocket.handlers["message"]?.forEach((cb: (...args: unknown[]) => void) => {
        cb(Buffer.from(JSON.stringify({ requestId: reqId, success: true, data: {} })));
      });
    }).not.toThrow();

    await server.stop();
  });

  it("does NOT route Hub responses that did not originate from Chrome", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: "test-token" });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;

    // Chrome connects
    const chromeSocket = makeMockSocket();
    handler(chromeSocket, makeMockRequest("/chrome?token=test-token"));

    // Hub connects and sends an action-routed request (not Chrome-originated)
    const hubSocket = makeMockSocket();
    handler(hubSocket, makeMockRequest("/hub?hubId=hub-1&token=test-token"));
    hubSocket.sent.length = 0;

    // Hub sends back a response with success but the requestId is NOT in chromeOriginatedRequestIds
    // (simulating a Hub-initiated request that has no business going back to Chrome)
    const nonChromeReqId = "hub-originated-req-789";
    hubSocket.handlers["message"]?.forEach((cb: (...args: unknown[]) => void) => {
      cb(Buffer.from(JSON.stringify({ requestId: nonChromeReqId, success: true, data: {} })));
    });

    // Chrome socket must NOT receive this — it was never Chrome-originated
    expect(chromeSocket.sent).toHaveLength(0);

    await server.stop();
  });

  it("preserves existing hub-origin request/response routing (pendingByHub path)", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: "test-token" });
    await server.start();
    const handler = getWsHarness().captured.at(-1)!;

    // Chrome connects
    const chromeSocket = makeMockSocket();
    handler(chromeSocket, makeMockRequest("/chrome?token=test-token"));

    // Hub connects
    const hubSocket = makeMockSocket();
    handler(hubSocket, makeMockRequest("/hub?hubId=hub-1&token=test-token"));
    hubSocket.sent.length = 0;

    // Hub sends an action TO Chrome (not a response)
    // This tests that the action-routing path is not broken
    const hubActionRequestId = "hub-to-chrome-action";
    hubSocket.handlers["message"]?.forEach((cb: (...args: unknown[]) => void) => {
      cb(Buffer.from(JSON.stringify({ hubId: "hub-1", requestId: hubActionRequestId, action: "notify_comments_updated", payload: {} })));
    });

    // Chrome must receive the forwarded action (not a response)
    const chromeReceived = JSON.parse(chromeSocket.sent[0] as string);
    expect(chromeReceived.action).toBe("notify_comments_updated");
    expect(chromeReceived.requestId).toBe(hubActionRequestId);
    expect(typeof chromeReceived.success).toBe("undefined");

    // Chrome sends back a success response to that requestId
    chromeSocket.sent.length = 0;
    chromeSocket.handlers["message"]?.forEach((cb: (...args: unknown[]) => void) => {
      cb(Buffer.from(JSON.stringify({ requestId: hubActionRequestId, success: true, data: {} })));
    });

    // Hub must receive it back (pendingByHub resolution)
    const hubReceived = JSON.parse(hubSocket.sent[0] as string);
    expect(hubReceived.requestId).toBe(hubActionRequestId);
    expect(hubReceived.success).toBe(true);

    await server.stop();
  });
});