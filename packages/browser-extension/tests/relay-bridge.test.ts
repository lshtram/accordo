import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelayBridgeClient } from "../src/relay-bridge.js";

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  constructor(public readonly url: string) {}
  send(payload: string): void {
    this.sent.push(payload);
  }
  close(code = 1000): void {
    this.onclose?.({ code });
  }
}

/** Mock chrome.storage.local with a given token and optional identity secret. */
function mockStorage(token: string | null = "test-token-abc", identitySecret?: string): void {
  const store: Record<string, unknown> = {};
  if (token) store["relayToken"] = token;
  if (identitySecret) store["relayIdentitySecret"] = identitySecret;
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

/**
 * Flush microtasks without relying on setTimeout (safe under vi.useFakeTimers).
 * Runs several rounds of Promise.resolve() to drain chained .then() callbacks.
 */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("M82-RELAY — browser-extension relay client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage("test-token-abc");
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
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

  it("BR-F-122: close code 1008 clears both stored token and identity secret", async () => {
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
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith(["relayToken", "relayIdentitySecret"]);
    bridge.stop();
  });

  it("BR-F-123: incoming relay request is handled and responded with same requestId", async () => {
    vi.useFakeTimers();
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
    await flushPromises();

    // No identity secret stored → timeout path activates socket after RELAY_HELLO_TIMEOUT_MS.
    socket.onopen?.(new Event("open"));
    // Advance past the 3000ms RELAY_HELLO_TIMEOUT_MS so activateSocket() is called.
    await vi.advanceTimersByTimeAsync(3100);
    await flushPromises();

    socket.onmessage?.({
      data: JSON.stringify({ requestId: "req-42", action: "get_comments", payload: { url: "https://example.com" } }),
    });
    await flushPromises();

    expect(socket.sent).toHaveLength(1);
    const payload = JSON.parse(socket.sent[0]) as { requestId: string; success: boolean };
    expect(payload.requestId).toBe("req-42");
    expect(payload.success).toBe(true);
    bridge.stop();
  });

  describe("PAIR-SEC-06: relay-hello challenge/response", () => {
    function makeCtorFromSocket(socket: FakeSocket): () => FakeSocket {
      const ctor = vi.fn(() => socket);
      (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = FakeSocket.OPEN;
      (ctor as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = FakeSocket.CONNECTING;
      globalThis.WebSocket = ctor as unknown as typeof WebSocket;
      return ctor;
    }

    it("PAIR-SEC-06a: no identity secret + timeout → socket activated (legacy relay path)", async () => {
      vi.useFakeTimers();
      mockStorage("tok", undefined); // no identity secret
      const socket = new FakeSocket("ws://...");
      makeCtorFromSocket(socket);

      const bridge = new RelayBridgeClient(async () => ({ requestId: "r", success: true }));
      bridge.start();
      // Advance past the storage get's internal setTimeout(r,0) and the reconnect timer
      await vi.advanceTimersByTimeAsync(100);
      await flushPromises();

      socket.onopen?.(new Event("open"));
      // Advance past the 3000ms RELAY_HELLO_TIMEOUT_MS
      await vi.advanceTimersByTimeAsync(3100);
      await flushPromises();

      // After timeout with no secret, activateSocket() wires real onmessage.
      // Send a message and verify the handler is active.
      socket.onmessage?.({
        data: JSON.stringify({ requestId: "r1", action: "ping", payload: {} }),
      });
      await flushPromises();
      expect(socket.sent).toHaveLength(1);

      bridge.stop();
    });

    it("PAIR-SEC-06b: relay sends relay-hello with no nonce → socket closed 1008", async () => {
      mockStorage("tok", "my-secret");
      const socket = new FakeSocket("ws://...");
      const closeSpy = vi.spyOn(socket, "close");
      makeCtorFromSocket(socket);

      const bridge = new RelayBridgeClient(async () => ({ requestId: "r", success: true }));
      bridge.start();
      await flushMicrotasks();

      socket.onopen?.(new Event("open"));
      // Send relay-hello without a nonce field
      socket.onmessage?.({ data: JSON.stringify({ kind: "relay-hello" }) });
      await flushMicrotasks();

      expect(closeSpy).toHaveBeenCalledWith(1008, "invalid-relay-hello");
      bridge.stop();
    });

    it("PAIR-SEC-06c: no identity secret but relay sends hello → socket closed 1008 (no-identity-secret)", async () => {
      mockStorage("tok", undefined); // no secret
      const socket = new FakeSocket("ws://...");
      const closeSpy = vi.spyOn(socket, "close");
      makeCtorFromSocket(socket);

      const bridge = new RelayBridgeClient(async () => ({ requestId: "r", success: true }));
      bridge.start();
      await flushMicrotasks();

      socket.onopen?.(new Event("open"));
      socket.onmessage?.({ data: JSON.stringify({ kind: "relay-hello", nonce: "abc123" }) });
      await flushMicrotasks();

      expect(closeSpy).toHaveBeenCalledWith(1008, "no-identity-secret");
      bridge.stop();
    });

    it("PAIR-SEC-06d: relay sends relay-hello with valid nonce → extension sends relay-hello-ack with HMAC", async () => {
      const secret = "test-identity-secret";
      mockStorage("tok", secret);
      const socket = new FakeSocket("ws://...");
      makeCtorFromSocket(socket);

      const bridge = new RelayBridgeClient(async () => ({ requestId: "r", success: true }));
      bridge.start();
      await flushMicrotasks();

      socket.onopen?.(new Event("open"));
      socket.onmessage?.({ data: JSON.stringify({ kind: "relay-hello", nonce: "test-nonce-xyz" }) });
      // Wait for async crypto.subtle operations
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(socket.sent).toHaveLength(1);
      const ack = JSON.parse(socket.sent[0]) as { kind: string; hmac: string };
      expect(ack.kind).toBe("relay-hello-ack");
      expect(typeof ack.hmac).toBe("string");
      expect(ack.hmac).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex = 64 chars

      // Verify the HMAC is correct: HMAC-SHA256("test-nonce-xyz", "test-identity-secret")
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("test-nonce-xyz"));
      const expectedHmac = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(ack.hmac).toBe(expectedHmac);

      bridge.stop();
    });

    it("PAIR-SEC-06e: identity secret stored but relay never sends hello (timeout) → socket closed 1008", async () => {
      vi.useFakeTimers();
      mockStorage("tok", "my-secret");
      const socket = new FakeSocket("ws://...");
      const closeSpy = vi.spyOn(socket, "close");
      makeCtorFromSocket(socket);

      const bridge = new RelayBridgeClient(async () => ({ requestId: "r", success: true }));
      bridge.start();
      await vi.advanceTimersByTimeAsync(100);
      await flushPromises();

      socket.onopen?.(new Event("open"));
      // Advance past the 3000ms RELAY_HELLO_TIMEOUT_MS
      await vi.advanceTimersByTimeAsync(3100);
      await flushPromises();

      expect(closeSpy).toHaveBeenCalledWith(1008, "relay-hello-timeout");
      bridge.stop();
    });
  });
});
