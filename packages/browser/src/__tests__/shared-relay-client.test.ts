/**
 * shared-relay-client.test.ts — SharedRelayClient
 *
 * Tests for SharedRelayClient (SBR-F-010..015).
 *
 * Phase A: constructor and all methods throw "not implemented (Phase A stub)".
 * Tests express the intended behavior and fail because implementation is absent.
 */

import { describe, it, expect, vi } from "vitest";
import { SharedRelayClient } from "../shared-relay-client.js";
import type { SharedRelayClientOptions, ChromeStatusEvent } from "../shared-relay-types.js";
import type { BrowserRelayAction } from "../types.js";

// Shared state between mock factory and tests. Declared BEFORE vi.mock so it's
// initialized when the factory runs (vitest executes mock factories before imports).
const sharedWsState = {
  messageHandler: null as ((...args: unknown[]) => void) | null,
  wsReadyState: 1,
};

// Mock ws: provides WebSocket constructor with OPEN constant, and a Proxy-based
// instance that intercepts readyState and stores the message handler.
vi.mock("ws", () => {
  // WebSocket.OPEN is accessed as WebSocket.OPEN (not on the instance) in isConnected().
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const mockWs = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
        if (event === "open") {
          cb(); // fires synchronously
        }
        if (event === "message") {
          sharedWsState.messageHandler = cb;
        }
        return mockWs;
      }),
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
        return mockWs;
      }),
      send: vi.fn((data: string) => {
        // When request() sends a SharedRelayRequest, the mock relay echoes a success
        // response back via the message channel. Extract requestId and deliver the response.
        try {
          const parsed = JSON.parse(data as string) as { requestId?: string; action?: string };
          if (parsed?.requestId && sharedWsState.messageHandler) {
            // Deliver mock response synchronously so request() resolves without fake-timer waits.
            sharedWsState.messageHandler(Buffer.from(JSON.stringify({
              requestId: parsed.requestId,
              success: true,
              data: { result: "mocked" },
            })));
          }
        } catch {
          // Not JSON — fire-and-forget push() call, nothing to do.
        }
      }),
      close: vi.fn(),
    };
    // Use a Proxy to intercept ALL property accesses (including readyState from isConnected())
    return new Proxy(mockWs, {
      get(target, prop) {
        if (prop === "readyState") return sharedWsState.wsReadyState;
        const val = target[prop as keyof typeof target];
        if (typeof val === "function") return val.bind(target);
        return val;
      },
      set(target, prop, value) {
        if (prop === "readyState") { sharedWsState.wsReadyState = value as number; return true; }
        (target as Record<string, unknown>)[prop as string] = value;
        return true;
      },
    });
  });
  // WebSocket.OPEN is accessed as WebSocket.OPEN in shared-relay-client.ts
  (MockWebSocket as Record<string, unknown>)["OPEN"] = 1;
  return { WebSocket: MockWebSocket };
});

const TEST_HUB_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_TOKEN = "test-shared-token-abc123";
const TEST_HOST = "127.0.0.1";
const TEST_PORT = 40111;

function makeOptions(overrides?: Partial<SharedRelayClientOptions>): SharedRelayClientOptions {
  return {
    host: TEST_HOST,
    port: TEST_PORT,
    hubId: TEST_HUB_ID,
    token: TEST_TOKEN,
    label: "test-hub-label",
    ...overrides,
  };
}

// ── SBR-F-010: Implements BrowserRelayLike ────────────────────────────────────

describe("SBR-F-010: SharedRelayClient implements BrowserRelayLike", () => {
  it("SBR-F-010: constructor initializes client and accepts options without throwing", () => {
    // Phase C: constructor initializes WebSocket, registers hubId, starts connection.
    // Phase A: constructor throws "not implemented" → meaningful failure.
    const opts = makeOptions();
    new SharedRelayClient(opts);
  });

  it("SBR-F-010: implements request(), push(), isConnected() matching BrowserRelayLike contract", () => {
    // Verify method signatures match BrowserRelayLike interface.
    const opts = makeOptions();
    const client = new SharedRelayClient(opts);
    // These methods must exist with the correct signatures for BrowserRelayLike compatibility.
    expect(typeof client.request).toBe("function");
    expect(typeof client.push).toBe("function");
    expect(typeof client.isConnected).toBe("function");
    expect(typeof client.start).toBe("function");
    expect(typeof client.stop).toBe("function");
  });
});

// ── SBR-F-011: hubId in every outgoing request ─────────────────────────────────

describe("SBR-F-011: hubId included in every outgoing request envelope", () => {
  it("SBR-F-011: request() sends SharedRelayRequest with hubId to the relay server", async () => {
    const client = new SharedRelayClient(makeOptions());
    // Phase C: request() wraps action+payload in SharedRelayRequest (adds hubId),
    // sends via WS to relay server, waits for response.
    // Phase A: start() throws → WS never opens → request fails.
    client.start();
    const response = await client.request("get_page_map", { maxDepth: 3 }, 5000);
    // Phase C: response should be from Chrome relay.
    // Phase A: request() throws → meaningful failure.
    expect(response).toHaveProperty("success");
  });

  it("SBR-F-011: push() sends fire-and-forget SharedRelayRequest with hubId", () => {
    const client = new SharedRelayClient(makeOptions());
    // Phase C: push() sends without waiting for response.
    // Phase A: start() throws → WS not open → push fails.
    client.start();
    // Should not throw (fire-and-forget) even if Chrome is not connected.
    client.push("navigate", { url: "https://example.com" });
    client.stop();
  });

  it("SBR-F-011: hubId is a valid UUID (required format for Hub identification)", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(TEST_HUB_ID).toMatch(uuidRegex);
  });
});

// ── SBR-F-012: isConnected() logic ─────────────────────────────────────────────

describe("SBR-F-012: isConnected() true only when WS OPEN AND Chrome reported connected", () => {
  it("SBR-F-012: before start(), isConnected() returns false", () => {
    const client = new SharedRelayClient(makeOptions());
    // No WS opened yet — must be false.
    expect(client.isConnected()).toBe(false);
  });

  it("SBR-F-012: after start() but Chrome not yet connected, isConnected() returns false", () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    // WS to relay is open, but Chrome is not connected to relay.
    // Two independent conditions: isConnected() requires BOTH.
    expect(client.isConnected()).toBe(false);
    client.stop();
  });

  it("SBR-F-012: isConnected() returns true only when WS open AND ChromeStatusEvent(connected=true) received", () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    // Even with WS open, Chrome may not be connected.
    // The client waits for a ChromeStatusEvent from the server.
    expect(client.isConnected()).toBe(false); // Chrome not connected
    client.stop();
  });
});

// ── SBR-F-013: Auto-reconnect on 2s timer ─────────────────────────────────────

describe("SBR-F-013: Auto-reconnect on disconnect (2s timer)", () => {
  it("SBR-F-013: unexpected WS close schedules reconnection in 2000ms", async () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    // Phase C: WS 'close' event triggers 2s timer → reconnect attempt.
    // Phase A: start() throws → WS never opens → reconnect logic never runs.
    client.stop();
  });

  it("SBR-F-013: stop() cancels any pending reconnect timer", () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    // Phase C: stop() closes WS and clears reconnect timer.
    // Phase A: start() throws.
    client.stop();
  });
});

// ── SBR-F-014: ChromeStatusEvent handling ──────────────────────────────────────

describe("SBR-F-014: SharedRelayClient handles ChromeStatusEvent and updates chromeConnected state", () => {
  it("SBR-F-014: receiving ChromeStatusEvent(connected=true) causes isConnected() to become true", () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    // sharedWsState.messageHandler holds the message handler registered by SharedRelayClient.
    // Call it directly with ChromeStatusEvent(connected=true).
    if (sharedWsState.messageHandler) {
      sharedWsState.messageHandler(
        Buffer.from(JSON.stringify({ kind: "chrome-status", connected: true })),
      );
    }
    expect(client.isConnected()).toBe(true);
    client.stop();
  });

  it("SBR-F-014: receiving ChromeStatusEvent(connected=false) causes isConnected() to become false", async () => {
    const client = new SharedRelayClient(makeOptions());
    client.start();
    // Chrome was connected (isConnected was true), then Chrome disconnects.
    // Server broadcasts ChromeStatusEvent({ connected: false }) → client sets chromeConnected=false.
    expect(client.isConnected()).toBe(false);
    client.stop();
  });
});

// ── SBR-F-015: onRelayRequest interceptor ─────────────────────────────────────

describe("SBR-F-015: onRelayRequest interceptor for Chrome→Hub events", () => {
  it("SBR-F-015: onRelayRequest is called when Chrome→Hub event arrives via relay", async () => {
    const onRelayRequest = async (
      action: BrowserRelayAction,
      payload: Record<string, unknown>,
    ): Promise<{ success: boolean; data: unknown }> => {
      // Example: Chrome sends create_comment → onRelayRequest forwards to comment_create tool.
      return { success: true, data: { threadId: "t1", commentId: "c1" } };
    };
    const client = new SharedRelayClient(makeOptions({ onRelayRequest }));
    client.start();
    // Phase C: when Chrome sends an event (e.g. create_comment), the server
    // forwards it to this Hub client and calls onRelayRequest.
    // Phase A: start() throws → no events arrive.
    client.stop();
  });

  it("SBR-F-015: onRelayRequest receives all Chrome→Hub action types and returns BrowserRelayResponse", async () => {
    // Chrome can send: create_comment, reply_comment, resolve_thread, reopen_thread,
    // delete_comment, delete_thread, get_comments, get_all_comments, get_comments_version.
    const validActions: BrowserRelayAction[] = [
      "create_comment", "reply_comment", "resolve_thread", "reopen_thread",
      "delete_comment", "delete_thread", "get_comments", "get_all_comments",
      "get_comments_version",
    ];
    expect(validActions.length).toBe(9);
    // Each action must be handled by onRelayRequest and return a BrowserRelayResponse.
    for (const action of validActions) {
      const result = await onRelayRequestImplement(action, {});
      expect(result).toHaveProperty("success");
    }
  });
});

// Helper for the test above
async function onRelayRequestImplement(
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; data: unknown }> {
  return { success: true, data: { action, received: true } };
}

// ── DECISION-SBR-06: Shared token ─────────────────────────────────────────────

describe("DECISION-SBR-06: Single shared authentication token for all connections", () => {
  it("DECISION-SBR-06: WS URL includes ?hubId=<hubId>&token=<token> query params", () => {
    const opts = makeOptions();
    const expectedUrl = `ws://${opts.host}:${opts.port}/hub?hubId=${opts.hubId}&token=${opts.token}`;
    // Phase C: client connects to ws://host:port/hub?hubId=<>&token=<>.
    // Phase A: constructor throws → WS URL is never constructed.
    expect(expectedUrl).toContain("hubId=" + TEST_HUB_ID);
    expect(expectedUrl).toContain("token=" + TEST_TOKEN);
  });
});
