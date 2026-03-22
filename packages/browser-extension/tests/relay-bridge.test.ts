import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelayBridgeClient } from "../src/relay-bridge.js";

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public readonly url: string) {}
  send(payload: string): void {
    this.sent.push(payload);
  }
  close(): void {
    this.onclose?.();
  }
}

describe("M82-RELAY — browser-extension relay client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("BR-F-120: starts websocket connection to local relay endpoint", () => {
    const ctor = vi.fn((url: string) => new FakeSocket(url));
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = FakeSocket.OPEN;
    (ctor as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = FakeSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;

    const bridge = new RelayBridgeClient(async () => ({
      requestId: "r1",
      success: true,
    }));
    bridge.start();

    expect(ctor).toHaveBeenCalledOnce();
    expect(String(ctor.mock.calls[0][0])).toContain("ws://127.0.0.1:40111/");
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

    socket.onmessage?.({
      data: JSON.stringify({ requestId: "req-42", action: "get_comments", payload: { url: "https://example.com" } }),
    });
    await Promise.resolve();

    expect(socket.sent).toHaveLength(1);
    const payload = JSON.parse(socket.sent[0]) as { requestId: string; success: boolean };
    expect(payload.requestId).toBe("req-42");
    expect(payload.success).toBe(true);
  });
});
