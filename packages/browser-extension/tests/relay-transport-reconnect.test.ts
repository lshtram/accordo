import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayTransport } from "../src/relay-transport.js";
import type { RelayConfig } from "../src/relay-config.js";

class ControllableSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = ControllableSocket.CONNECTING;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = ControllableSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  open(): void {
    this.readyState = ControllableSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
}

const originalWebSocket = globalThis.WebSocket;

function config(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    host: "127.0.0.1",
    port: 40111,
    reconnectDelayMs: 2000,
    heartbeatIntervalMs: 15000,
    tokenPollIntervalMs: 60000,
    ...overrides,
  };
}

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.useRealTimers();
});

describe("RelayTransport reconnect scheduling", () => {
  it("deduplicates repeated socket close events while reconnect is pending", async () => {
    vi.useFakeTimers();
    const sockets: ControllableSocket[] = [];
    const ctor = vi.fn((url: string) => {
      const socket = new ControllableSocket(url);
      sockets.push(socket);
      return socket;
    });
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = ControllableSocket.OPEN;
    (ctor as unknown as { CONNECTING: number }).CONNECTING = ControllableSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const transport = new RelayTransport(config({ tokenProvider: async () => "token-1" }), {});
    transport.start();
    await Promise.resolve();
    await Promise.resolve();

    sockets[0].close();
    sockets[0].close();

    expect(transport.getState()).toBe("reconnecting");
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    transport.stop();
    timeoutSpy.mockRestore();
  });

  it("refreshes the token before reconnecting", async () => {
    vi.useFakeTimers();
    const sockets: ControllableSocket[] = [];
    const ctor = vi.fn((url: string) => {
      const socket = new ControllableSocket(url);
      sockets.push(socket);
      return socket;
    });
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = ControllableSocket.OPEN;
    (ctor as unknown as { CONNECTING: number }).CONNECTING = ControllableSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;
    const tokenProvider = vi.fn()
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");

    const transport = new RelayTransport(config({ tokenProvider }), {});
    transport.start();
    await Promise.resolve();
    await Promise.resolve();
    sockets[0].close();

    await vi.advanceTimersByTimeAsync(2000);

    expect(String(ctor.mock.calls[1][0])).toContain("token=token-2");
    transport.stop();
  });

  it("deduplicates token-poll reconnect when socket close also schedules reconnect", async () => {
    vi.useFakeTimers();
    const sockets: ControllableSocket[] = [];
    const ctor = vi.fn((url: string) => {
      const socket = new ControllableSocket(url);
      sockets.push(socket);
      return socket;
    });
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = ControllableSocket.OPEN;
    (ctor as unknown as { CONNECTING: number }).CONNECTING = ControllableSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const tokenProvider = vi.fn()
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");

    const transport = new RelayTransport(config({ tokenProvider, tokenPollIntervalMs: 60000 }), {});
    transport.start();
    transport.startPolling();
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(60000);

    expect(sockets).toHaveLength(1);
    expect(transport.getState()).toBe("reconnecting");
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    transport.stop();
    timeoutSpy.mockRestore();
  });

  it("retries when state is connecting but the socket is no longer active", async () => {
    const sockets: ControllableSocket[] = [];
    const ctor = vi.fn((url: string) => {
      const socket = new ControllableSocket(url);
      sockets.push(socket);
      return socket;
    });
    (ctor as unknown as { OPEN: number; CONNECTING: number }).OPEN = ControllableSocket.OPEN;
    (ctor as unknown as { CONNECTING: number }).CONNECTING = ControllableSocket.CONNECTING;
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;
    const tokenProvider = vi.fn()
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");

    const transport = new RelayTransport(config({ tokenProvider }), {});
    transport.start();
    await Promise.resolve();
    await Promise.resolve();
    sockets[0].readyState = ControllableSocket.CLOSED;

    transport.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(sockets).toHaveLength(2);
    expect(String(ctor.mock.calls[1][0])).toContain("token=token-2");
    transport.stop();
  });
});
