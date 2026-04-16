import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelayBridgeClient } from "../src/relay-bridge.js";
import type { RelayActionRequest, RelayActionResponse } from "../src/relay-actions.js";

type HandlerFn = (request: RelayActionRequest) => Promise<RelayActionResponse>;

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public readonly url: string) {}
  send(payload: string): void {
    this.sent.push(payload);
  }
  close(code = 1000): void {
    this.onclose?.({ code });
  }
}

/** Mock chrome.storage.local with a given token value. */
function mockStorage(token: string | null = "test-token-abc"): void {
  const store: Record<string, unknown> = token ? { relayToken: token } : {};
  (globalThis as unknown as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: vi.fn((keys: string[]) =>
          Promise.resolve(
            Object.fromEntries(
              keys.map((k) => [k, store[k]])
            )
          )
        ),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
      },
    },
  };
}

/** Flush pending microtasks (Promise.then chains). */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("M82-RELAY — browser-extension relay client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage("test-token-abc");
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("BR-F-120: starts websocket connection to local relay endpoint", async () => {
    const ctor = vi.fn((url: string) => new FakeSocket(url));
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = FakeSocket.OPEN;
    (ctor as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = FakeSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;

    const bridge = new RelayBridgeClient(async () => ({
      requestId: "r1",
      success: true,
    }));
    bridge.start();
    await flushMicrotasks();

    expect(ctor).toHaveBeenCalledOnce();
    expect(String(ctor.mock.calls[0][0])).toContain("ws://127.0.0.1:40111/");
  });

  it("BR-F-120 + AUTH-chrome: WS URL uses /chrome path with ?token= query parameter (non-empty)", async () => {
    mockStorage("discovered-token-xyz");
    const ctor = vi.fn((url: string) => new FakeSocket(url));
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = FakeSocket.OPEN;
    (ctor as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = FakeSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;

    const bridge = new RelayBridgeClient(async () => ({
      requestId: "r1",
      success: true,
    }));
    bridge.start();
    await flushMicrotasks();

    const constructedUrl = String(ctor.mock.calls[0][0]);
    expect(constructedUrl).toMatch(/^\ws:\/\/127\.0\.0\.1:40111\/chrome\?token=.+$/);
    const tokenMatch = constructedUrl.match(/token=([^&]+)/);
    expect(tokenMatch).not.toBeNull();
    expect(tokenMatch![1].length).toBeGreaterThan(0);
  });

  it("BR-F-121: no token stored → no WebSocket created, schedules retry", async () => {
    mockStorage(null);
    const ctor = vi.fn((url: string) => new FakeSocket(url));
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = FakeSocket.OPEN;
    (ctor as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = FakeSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;

    const bridge = new RelayBridgeClient(async () => ({ requestId: "r", success: true }));
    bridge.start();
    await flushMicrotasks();

    expect(ctor).not.toHaveBeenCalled();
    bridge.stop();
  });

  it("BR-F-122: close code 1008 clears stored token", async () => {
    const socket = new FakeSocket("ws://127.0.0.1:40111");
    const ctor = vi.fn(() => socket);
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = FakeSocket.OPEN;
    (ctor as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = FakeSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;

    const bridge = new RelayBridgeClient(async () => ({ requestId: "r", success: true }));
    bridge.start();
    await flushMicrotasks();

    const chromeMock = (globalThis as unknown as Record<string, unknown>).chrome as {
      storage: { local: { remove: ReturnType<typeof vi.fn> } };
    };

    socket.onclose?.({ code: 1008 });
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith("relayToken");
    bridge.stop();
  });

  it("BR-F-123: incoming relay request is handled and responded with same requestId", async () => {
    const socket = new FakeSocket("ws://127.0.0.1:40111");
    const ctor = vi.fn(() => socket);
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = FakeSocket.OPEN;
    (ctor as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = FakeSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;

    const bridge = new RelayBridgeClient(async () => ({
      requestId: "req-42",
      success: true,
      data: { ok: true },
    }));
    bridge.start();
    await flushMicrotasks();

    socket.onmessage?.({
      data: JSON.stringify({ requestId: "req-42", action: "get_comments", payload: { url: "https://example.com" } }),
    });
    await Promise.resolve();

    expect(socket.sent).toHaveLength(1);
    const payload = JSON.parse(socket.sent[0]) as { requestId: string; success: boolean };
    expect(payload.requestId).toBe("req-42");
    expect(payload.success).toBe(true);
  });

  it("BR-F-124: transport mode handles incoming action requests and sends handler response", async () => {
    const handler = vi.fn(async (request: { requestId: string }) => ({
      requestId: request.requestId,
      success: true,
      data: { pages: [] },
    }));

    const transportSend = vi.fn((_data: string) => true);
    const transport = {
      start: vi.fn(),
      startPolling: vi.fn(),
      stop: vi.fn(),
      send: transportSend,
      isConnected: vi.fn(() => true),
    };

    const bridge = new RelayBridgeClient(
      handler as unknown as HandlerFn,
      transport as unknown as { start(): void; startPolling(): void; stop(): void; send(data: string): boolean; isConnected(): boolean } as any,
    );

    bridge.handleTransportMessage(JSON.stringify({
      requestId: "req-transport-1",
      action: "list_pages",
      payload: {},
    }));

    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(transportSend).toHaveBeenCalledTimes(1);
    const wirePayload = JSON.parse(String(transportSend.mock.calls[0][0])) as { requestId: string; success: boolean };
    expect(wirePayload.requestId).toBe("req-transport-1");
    expect(wirePayload.success).toBe(true);
  });
});
