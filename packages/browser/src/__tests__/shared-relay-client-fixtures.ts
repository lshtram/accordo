import { vi } from "vitest";
import type { SharedRelayClientOptions } from "../shared-relay-types.js";
import type { BrowserRelayAction } from "../types.js";

export type { BrowserRelayAction };

export const sharedWsState = {
  messageHandler: null as ((...args: unknown[]) => void) | null,
  wsReadyState: 1,
};

vi.mock("ws", () => {
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const mockWs = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
        if (event === "open") cb();
        if (event === "message") sharedWsState.messageHandler = cb;
        return mockWs;
      }),
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
        return mockWs;
      }),
      send: vi.fn((data: string) => {
        try {
          const parsed = JSON.parse(data as string) as { requestId?: string };
          if (parsed?.requestId && sharedWsState.messageHandler) {
            sharedWsState.messageHandler(Buffer.from(JSON.stringify({ requestId: parsed.requestId, success: true, data: { result: "mocked" } })));
          }
        } catch {}
      }),
      close: vi.fn(),
    };
    return new Proxy(mockWs, {
      get(target, prop) {
        if (prop === "readyState") return sharedWsState.wsReadyState;
        const val = target[prop as keyof typeof target];
        return typeof val === "function" ? val.bind(target) : val;
      },
      set(target, prop, value) {
        if (prop === "readyState") {
          sharedWsState.wsReadyState = value as number;
          return true;
        }
        (target as Record<string, unknown>)[prop as string] = value;
        return true;
      },
    });
  });
  (MockWebSocket as Record<string, unknown>)["OPEN"] = 1;
  return { WebSocket: MockWebSocket };
});

export const TEST_HUB_ID = "550e8400-e29b-41d4-a716-446655440000";
export const TEST_TOKEN = "test-shared-token-abc123";
export const { SharedRelayClient } = await import("../shared-relay-client.js");

export function makeOptions(overrides?: Partial<SharedRelayClientOptions>): SharedRelayClientOptions {
  return {
    host: "127.0.0.1",
    port: 40111,
    hubId: TEST_HUB_ID,
    token: TEST_TOKEN,
    label: "test-hub-label",
    ...overrides,
  };
}

export async function onRelayRequestImplement(action: BrowserRelayAction, payload: Record<string, unknown>): Promise<{ success: boolean; data: unknown }> {
  return { success: true, data: { action, received: true, payload } };
}
