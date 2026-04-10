import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRelayServer } from "../relay-server.js";

// NOTE: vi.mock factories are hoisted above module-scope code.
// All mock state must be created inside the factory to avoid undefined refs.
// Use vi.hoisted so the state is initialized before the mock factory runs.
// capturedHandlerRef is a stable object reference that the mock factory captures.
const capturedHandlerRef = vi.hoisted(() => ({ current: null as ((socket: unknown, request: unknown) => void) | null }));
// Store mock references so they can be reset in beforeEach.
const wsMocks = vi.hoisted(() => {
  const mockWsServer = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "connection") capturedHandlerRef.current = handler as (socket: unknown, request: unknown) => void;
      return mockWsServer as unknown;
    }),
    once: vi.fn(),
    close: vi.fn(),
  };
  return { mockWsServer, WebSocket: vi.fn(() => mockWsServer) };
});

vi.mock("node:http", () => {
  const mockHttpServer = {
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
      cb?.();
    }),
    close: vi.fn((cb?: () => void) => { cb?.(); }),
    address: vi.fn(() => ({ port: 40120 })),
  };
  return {
    __esModule: true,
    createServer: vi.fn(() => mockHttpServer),
    default: { createServer: vi.fn(() => mockHttpServer) },
  };
});

vi.mock("ws", () => {
  // wsMocks.WebSocket is the WebSocketServer constructor (returns mockWsServer).
  // We also need WebSocket.OPEN === 1 for isConnected() comparisons.
  const MockWsClass = Object.assign(
    () => wsMocks.mockWsServer,
    { OPEN: 1, CLOSED: 3, CONNECTING: 0 }
  );
  return {
    __esModule: true,
    WebSocketServer: wsMocks.WebSocket,
    WebSocket: MockWsClass,
  };
});

// Restore wsMocks.WebSocket implementation before each test so
// new WebSocketServer(...) returns mockWsServer (not undefined).
const WebSocketServer = wsMocks.WebSocket;

describe("M82-RELAY server", () => {
  beforeEach(() => {
    capturedHandlerRef.current = null;
    // Restore wsMocks.WebSocket implementation before each test so
    // new WebSocketServer(...) returns mockWsServer (not undefined).
    wsMocks.WebSocket.mockImplementation(() => wsMocks.mockWsServer);
  });

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

  describe("AUTH-01: auth handshake — token validation at connection time", () => {
    // Retrieves the captured connection handler from the ws mock.
    function getCapturedHandler(): (socket: unknown, request: unknown) => void | null {
      return capturedHandlerRef.current;
    }

    function makeMockSocket() {
      const sent: string[] = [];
      const socket = {
        readyState: 1,
        closeCode: null as number | null,
        closeMessage: null as string,
        sent,
        on: vi.fn(),
        send: (data: string) => sent.push(data),
        close: (code?: number, msg?: string) => {
          socket.readyState = 3;
          socket.closeCode = code ?? null;
          socket.closeMessage = msg ?? null;
        },
      };
      return socket;
    }

    function makeMockRequest(url: string) {
      return {
        url,
        socket: { remoteAddress: "127.0.0.1" },
      };
    }

    it("AUTH-01: rejects connection with wrong token and closes socket with 1008", async () => {
      const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40120, token: "correct-token" });
      await server.start();

      const mockSocket = makeMockSocket();
      const handler = getCapturedHandler();
      expect(handler).not.toBeNull();

      // Fire connection with wrong token
      handler!(mockSocket, makeMockRequest("/?token=wrong-token"));

      // Socket must be closed with 1008 (Policy Violation — unauthorized)
      expect(mockSocket.closeCode).toBe(1008);
      expect(mockSocket.closeMessage).toBe("unauthorized");
      // Server must not have accepted this as its client
      expect(server.isConnected()).toBe(false);

      await server.stop();
    });

    it("AUTH-01: accepts connection with correct token and stores as client", async () => {
      const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40120, token: "my-secret-token" });
      await server.start();

      const mockSocket = makeMockSocket();
      const handler = getCapturedHandler();
      expect(handler).not.toBeNull();

      // Fire connection with correct token
      handler!(mockSocket, makeMockRequest("/?token=my-secret-token"));

      // Socket must NOT be closed — connection accepted
      expect(mockSocket.closeCode).toBeNull();
      // Server must now report connected
      expect(server.isConnected()).toBe(true);

      await server.stop();
    });

    it("AUTH-01: rejects connection with missing token", async () => {
      const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40120, token: "secret" });
      await server.start();

      const mockSocket = makeMockSocket();
      const handler = getCapturedHandler();
      handler!(mockSocket, makeMockRequest("/"));

      expect(mockSocket.closeCode).toBe(1008);
      expect(mockSocket.closeMessage).toBe("unauthorized");
      expect(server.isConnected()).toBe(false);

      await server.stop();
    });
  });
});
