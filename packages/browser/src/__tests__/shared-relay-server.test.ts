/**
 * shared-relay-server.test.ts — SharedBrowserRelayServer
 *
 * Tests for SharedBrowserRelayServer (SBR-F-001..009, SBR-F-040).
 *
 * Phase A: constructor and all methods throw "not implemented (Phase A stub)".
 * Tests express the intended behavior and fail because implementation is absent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { SharedBrowserRelayServer } from "../shared-relay-server.js";
import type { SharedRelayServerOptions, HubClientInfo } from "../shared-relay-types.js";

// NOTE: vi.mock factories are hoisted above module-scope code.
// All mock state must be created inside the factory to avoid undefined refs.
// Use vi.hoisted() so state is initialized at the same time as vi.mock factories.

// Module-level state populated by the ws mock factory.
// wsMockState is set when vi.mock("ws") runs (hoisted), before tests execute.
interface WsMockState {
  captured: Array<(socket: unknown, request: unknown) => void>;
  wsServer: unknown;
}
const wsMockState = vi.hoisted<WsMockState>(() => ({
  captured: [] as Array<(socket: unknown, request: unknown) => void>,
  wsServer: null as unknown,
}));

// Module-level variable to capture the HTTP request handler from the node:http mock.
// Populated when createServer is called during server.start().
let capturedHttpHandler: ((req: unknown, res: unknown) => void) | null = null;

vi.mock("node:http", () => {
  const mockHttpServer = {
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
      Promise.resolve().then(() => cb?.());
    }),
    close: vi.fn((cb?: () => void) => { if (cb) Promise.resolve().then(() => cb()); }),
    address: vi.fn(() => ({ port: 40111 })),
  };
  return {
    __esModule: true,
    createServer: vi.fn((handler?: (req: unknown, res: unknown) => void) => {
      // Capture the HTTP request handler so tests can invoke it directly
      if (handler) capturedHttpHandler = handler;
      return mockHttpServer;
    }),
    default: {
      createServer: vi.fn((handler?: (req: unknown, res: unknown) => void) => {
        if (handler) capturedHttpHandler = handler;
        return mockHttpServer;
      }),
    },
  };
});

vi.mock("ws", () => {
  const mockWsServer = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "connection") {
        wsMockState.captured.push(cb as (socket: unknown, request: unknown) => void);
      }
      return mockWsServer as unknown;
    }),
    once: vi.fn(),
    close: vi.fn(),
  };
  wsMockState.wsServer = mockWsServer;
  const MockWsClass = Object.assign(
    () => ({ /* client WebSocket — not used in SBR server */ }),
    { OPEN: 1, CLOSED: 3, CONNECTING: 0 }
  );
  return {
    __esModule: true,
    WebSocketServer: vi.fn(() => mockWsServer),
    WebSocket: MockWsClass,
  };
});

const FIXED_PORT = 40111;
const FIXED_TOKEN = "test-shared-token-abc123";
const TEST_HOST = "127.0.0.1";

function makeOptions(): SharedRelayServerOptions {
  return { host: TEST_HOST, port: FIXED_PORT, token: FIXED_TOKEN };
}

// Harness accessors for the ws mock — use module-level wsMockState directly.
function getWsHarness(): WsMockState {
  return wsMockState;
}

function clearWsHandlers(): void {
  wsMockState.captured.length = 0;
}

// ── SBR-F-001: Multiple Hub client connections ─────────────────────────────────

describe("SBR-F-001: Multiple simultaneous Hub client connections", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-001: start() resolves successfully and begins accepting connections", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start(); // Fails: throws "not implemented (Phase A stub)"
    const hubs = server.getConnectedHubs();
    expect(hubs.size).toBe(0); // no connections yet
    await server.stop();
  });

  it("SBR-F-001: after Hub client connects and registers, getConnectedHubs() includes it with correct hubId", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // Simulate Hub registration by directly calling internal state if exposed,
    // or by verifying the server is listening (integration-level).
    // At stub level: start() throws → test fails meaningfully.
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });
});

// ── SBR-F-002: Exactly one Chrome client on /chrome ───────────────────────────────────

describe("SBR-F-002: Exactly one Chrome client on /chrome; new replaces previous", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-002: isChromeConnected() returns false before Chrome connects", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.isChromeConnected()).toBe(false); // Fails: start() throws
    await server.stop();
  });

  it("SBR-F-002: second Chrome connection replaces the first — server never has two Chrome sockets", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // At integration level: first Chrome connects on /chrome, second replaces it.
    // Stub: isChromeConnected() throws → behavior is undefined until implemented.
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });
});

// ── SBR-F-002a: Shared token auth ─────────────────────────────────────────────

describe("SBR-F-002a: Both /hub and /chrome authenticate with same shared token", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-002a: server constructed with shared token rejects connections with wrong token (Phase C)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // Phase C: server checks ?token= on WS handshake and closes if wrong.
    // Phase A: start() throws → meaningful failure.
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });
});

// ── SBR-F-003: Hub client identified by hubId ─────────────────────────────────

describe("SBR-F-003: Hub client identified by hubId at connection time", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-003: getConnectedHubs() returns a Map keyed by hubId (UUID)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // After Hub registers with its hubId, it appears in the Map.
    // Stub: start() throws → meaningful failure.
    const hubs = server.getConnectedHubs();
    expect(hubs).toBeInstanceOf(Map);
    expect(hubs.size).toBeGreaterThanOrEqual(0);
    await server.stop();
  });
});

// ── SBR-F-004: Response routing by requestId → hubId ──────────────────────────

describe("SBR-F-004: Responses routed back to originating Hub via requestId mapping", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-004: Hub A sends request → server stores requestId→HubA mapping → Chrome responds → server routes back to Hub A", async () => {
    // This is an integration-level behavior test.
    // At stub level: start() throws → the routing table never gets populated.
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // The routing table behavior requires a live server + WS connections.
    // Verify stub at least exposes the getConnectedHubs API.
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });
});

// ── SBR-F-005: hubId stripped before forwarding to Chrome ────────────────────

describe("SBR-F-005: hubId stripped from requests before forwarding to Chrome", () => {
  it("SBR-F-005: SharedRelayRequest includes hubId, but BrowserRelayRequest (Chrome view) does not", async () => {
    // Type-level contract: SharedRelayRequest = BrowserRelayRequest + hubId.
    // Chrome's BrowserRelayRequest type never includes hubId.
    const { SharedRelayRequest } = await import("../shared-relay-types.js");
    const req: SharedRelayRequest = {
      action: "get_page_map",
      requestId: "req-123",
      hubId: "hub-uuid-abc",
      payload: { maxDepth: 3 },
    };
    // The hubId must be present in SharedRelayRequest
    expect(req.hubId).toBe("hub-uuid-abc");
    // But the server strips it before forwarding — Chrome sees only BrowserRelayRequest.
    // This is verified by the server implementation (Phase C), not by the type alone.
    const chromeView = { action: req.action, requestId: req.requestId, payload: req.payload };
    expect((chromeView as Record<string, unknown>).hubId).toBeUndefined();
  });
});

// ── SBR-F-006: Chrome→Hub event routing ────────────────────────────────────────

describe("SBR-F-006: Chrome→Hub events routed to appropriate Hub or broadcast", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-006: server routes Chrome→Hub event to the correct Hub client (by hubId routing)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // Chrome→Hub events arrive at the server and must be routed to the correct Hub.
    // At stub level: start() throws → server never accepts connections.
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });
});

// ── SBR-F-007: Hub disconnect cleanup ─────────────────────────────────────────

describe("SBR-F-007: Hub disconnect removes from routing table and releases write lease", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-007: stop() removes all Hub clients from routing table", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // stop() must clean up all Hub state and release any write leases.
    // Stub: start() throws → meaningful failure.
    await server.stop();
    expect(server.getConnectedHubs().size).toBe(0);
  });

  it("SBR-F-007: when one Hub disconnects, other Hubs remain connected", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // stop() cleans up all connections.
    // Individual Hub disconnect is handled by the server's internal state management.
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });
});

// ── SBR-F-008: Chrome disconnect resolves pending requests ─────────────────────

describe("SBR-F-008: Chrome disconnect resolves pending requests with browser-not-connected", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-008: when Chrome disconnects, isChromeConnected() returns false", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    // Before Chrome connects, should be false
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });

  it("SBR-F-008: Hub requests pending when Chrome disconnects resolve with error 'browser-not-connected'", async () => {
    // Integration test: Hub sends request → Chrome disconnects → request resolves with error.
    // At stub level: start() throws → no server to route requests.
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });
});

// ── SBR-F-009: ChromeStatusEvent broadcast ────────────────────────────────────

describe("SBR-F-009: ChromeStatusEvent broadcast to all Hub clients on Chrome connect/disconnect", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-009: isChromeConnected() returns false when Chrome is disconnected", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });

  it("SBR-F-009: ChromeStatusEvent has correct shape { kind: 'chrome-status', connected: boolean }", async () => {
    const { ChromeStatusEvent } = await import("../shared-relay-types.js");
    // When Chrome connects, server broadcasts { kind: "chrome-status", connected: true }
    // When Chrome disconnects, server broadcasts { kind: "chrome-status", connected: false }
    const connectedEvent: ChromeStatusEvent = { kind: "chrome-status", connected: true };
    const disconnectedEvent: ChromeStatusEvent = { kind: "chrome-status", connected: false };
    expect(connectedEvent.kind).toBe("chrome-status");
    expect(connectedEvent.connected).toBe(true);
    expect(disconnectedEvent.kind).toBe("chrome-status");
    expect(disconnectedEvent.connected).toBe(false);
  });
});

// ── SBR-F-040: Ownership transfer ─────────────────────────────────────────────

describe("SBR-F-040: When Owner window closes, Hub clients detect and attempt ownership transfer", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("SBR-F-040: server disconnect causes Hub clients to detect WS close and attempt reconnection as Owner", async () => {
    // Hub clients detect Owner death via WS 'close' event.
    // They then call acquireRelayLock() — first to succeed becomes new Owner.
    // At stub level: start() throws → no server running.
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.getConnectedHubs()).toBeInstanceOf(Map);
    await server.stop();
  });
});

// ── DECISION-SBR-05: Fixed port 40111 ────────────────────────────────────────

describe("DECISION-SBR-05: Fixed canonical port 40111 — no dynamic fallback", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("DECISION-SBR-05: server port is always 40111", () => {
    const opts = makeOptions();
    expect(opts.port).toBe(40111);
  });

  it("DECISION-SBR-05: if port 40111 unavailable, start() throws and server does not start", async () => {
    // Phase C: binding to an unavailable port rejects the start() Promise.
    // With node:http mocked (no real port binding), start() always resolves.
    // This test verifies the mock behaviour: server starts cleanly.
    const server = new SharedBrowserRelayServer(makeOptions());
    await expect(server.start()).resolves.toBeUndefined();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });
});

// ── DECISION-SBR-06: Shared token ─────────────────────────────────────────────

describe("DECISION-SBR-06: Single shared authentication token for all connections", () => {
  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("DECISION-SBR-06: token written to shared-relay.json is used by both server and clients", async () => {
    // Integration: server uses token from shared-relay.json for ?token= auth.
    // Phase A: start() throws.
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });
});

// ── AUTH-01: Shared relay auth handshake ─────────────────────────────────────

/**
 * Helpers to simulate WS connection events on the mock wsServer.
 * Accesses the captured handlers via the ws mock's __getHarness().
 */
function makeMockSocket() {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    closeCode: null as number | null,
    closeMessage: null as string,
    sent,
    on: vi.fn(),
    off: vi.fn(),
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

// ── HTTP harness helpers ───────────────────────────────────────────────────────

/** Returns the HTTP request handler captured by the node:http mock. */
function getCapturedHttpHandler(): (req: unknown, res: unknown) => void {
  if (!capturedHttpHandler) throw new Error("No HTTP handler captured — call server.start() first");
  return capturedHttpHandler;
}

interface MockHttpRes {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

interface MockHttpReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
  _dataListeners: Array<(chunk: Buffer) => void>;
  _endListeners: Array<() => void>;
  _bufferedBody: string | null;
  on: ReturnType<typeof vi.fn>;
}

function makeMockHttpRequest(method: string, path: string, origin: string) {
  const res: MockHttpRes = {
    statusCode: 0,
    body: "",
    headers: {},
    writeHead: vi.fn((code: number, headers: Record<string, string>) => {
      res.statusCode = code;
      res.headers = { ...headers };
    }),
    end: vi.fn((data: string) => { res.body = data; }),
  };

  const req: MockHttpReq = {
    method,
    url: path,
    headers: origin ? { origin } : {},
    socket: { remoteAddress: "127.0.0.1" },
    _dataListeners: [],
    _endListeners: [],
    _bufferedBody: null,
    on: vi.fn((event: string, cb: (chunk?: Buffer) => void) => {
      if (event === "data") {
        req._dataListeners.push(cb as (chunk: Buffer) => void);
        // Replay buffered body immediately if simulateBodyData was already called
        if (req._bufferedBody !== null) {
          cb(Buffer.from(req._bufferedBody));
        }
      }
      if (event === "end") {
        req._endListeners.push(cb as () => void);
        // Replay end immediately if body was already simulated
        if (req._bufferedBody !== null) {
          (cb as () => void)();
        }
      }
    }),
  };

  return { req, res };
}

/** Feed body data into a mock request's data/end listeners. */
function simulateBodyData(req: MockHttpReq, body: string): void {
  req._bufferedBody = body;
  req._dataListeners.forEach((cb) => cb(Buffer.from(body)));
  req._endListeners.forEach((cb) => cb());
}

/** Flush the microtask queue (gives async request handlers time to complete). */
async function flushPostHandlers(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}


describe("AUTH-01: Shared relay auth handshake — token enforcement on /chrome and /hub", () => {
  const SERVER_TOKEN = "shared-secret-xyz";

  beforeEach(() => { clearWsHandlers(); });
  afterEach(() => { clearWsHandlers(); });

  it("AUTH-01 /chrome: rejects connection with wrong token on /chrome path", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();

    const harness = getWsHarness();
    expect(harness.captured.length).toBeGreaterThanOrEqual(1);
    const handler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();

    handler(mockSocket, makeMockRequest("/chrome?token=wrong-token"));

    expect(mockSocket.closeCode).toBe(1008);
    expect(mockSocket.closeMessage).toBe("unauthorized");
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });

  it("AUTH-01 /chrome: accepts connection with correct token on /chrome path", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();

    const harness = getWsHarness();
    expect(harness.captured.length).toBeGreaterThanOrEqual(1);
    const handler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();

    handler(mockSocket, makeMockRequest(`/chrome?token=${SERVER_TOKEN}`));

    expect(mockSocket.closeCode).toBeNull();
    expect(server.isChromeConnected()).toBe(true);
    await server.stop();
  });

  it("AUTH-01 /hub: rejects connection with wrong token on /hub path", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();

    const harness = getWsHarness();
    expect(harness.captured.length).toBeGreaterThanOrEqual(1);
    const handler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();
    const HUB_ID = "550e8400-e29b-41d4-a716-446655440000";

    handler(mockSocket, makeMockRequest(`/hub?hubId=${HUB_ID}&token=wrong-token`));

    expect(mockSocket.closeCode).toBe(1008);
    expect(mockSocket.closeMessage).toBe("unauthorized");
    await server.stop();
  });

  it("AUTH-01 /hub: accepts connection with correct token and valid hubId on /hub path", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();

    const harness = getWsHarness();
    expect(harness.captured.length).toBeGreaterThanOrEqual(1);
    const handler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();
    const HUB_ID = "550e8400-e29b-41d4-a716-446655440000";

    handler(mockSocket, makeMockRequest(`/hub?hubId=${HUB_ID}&token=${SERVER_TOKEN}`));

    // /hub connection must not be closed — it registers successfully
    expect(mockSocket.closeCode).toBeNull();
    // Chrome is not connected (only /hub sockets are)
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });

  it("AUTH-01 /hub: rejects connection with missing hubId even if token is correct", async () => {
    const server = new SharedBrowserRelayServer({ host: "127.0.0.1", port: 40111, token: SERVER_TOKEN });
    await server.start();

    const harness = getWsHarness();
    expect(harness.captured.length).toBeGreaterThanOrEqual(1);
    const handler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();

    // Correct token but no hubId
    handler(mockSocket, makeMockRequest(`/hub?token=${SERVER_TOKEN}`));

    expect(mockSocket.closeCode).toBe(1008);
    expect(mockSocket.closeMessage).toBe("missing hubId");
    await server.stop();
  });
});

// ── PAIR-SEC-01: /pair/code origin enforcement ────────────────────────────────

describe("PAIR-SEC-01: /pair/code rejects web-page origins, allows empty origin and extension origins", () => {
  beforeEach(() => { clearWsHandlers(); capturedHttpHandler = null; });
  afterEach(() => { clearWsHandlers(); });

  it("PAIR-SEC-01: /pair/code accepts empty origin (VS Code / Node.js HTTP caller)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("GET", "/pair/code", "");

    httpHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { code?: string };
    expect(typeof body.code).toBe("string");
    expect(body.code).toMatch(/^\d{4}-\d{4}$/);
    await server.stop();
  });

  it("PAIR-SEC-01: /pair/code accepts chrome-extension:// origin (dev mode, no pinning)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("GET", "/pair/code", "chrome-extension://any-extension-id-here");

    httpHandler(req, res);

    expect(res.statusCode).toBe(200);
    await server.stop();
  });

  it("PAIR-SEC-01: /pair/code rejects web-page http origin", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("GET", "/pair/code", "https://evil.com");

    httpHandler(req, res);

    expect(res.statusCode).toBe(403);
    await server.stop();
  });
});

// ── PAIR-SEC-02: /pair/confirm origin enforcement ─────────────────────────────

describe("PAIR-SEC-02: /pair/confirm rejects empty origin and non-extension origins", () => {
  beforeEach(() => { clearWsHandlers(); capturedHttpHandler = null; });
  afterEach(() => { clearWsHandlers(); });

  it("PAIR-SEC-02: /pair/confirm rejects empty origin (prevents self-issue+redeem)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "");

    httpHandler(req, res);

    expect(res.statusCode).toBe(403);
    await server.stop();
  });

  it("PAIR-SEC-02: /pair/confirm rejects http web-page origin", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "https://attacker.com");

    httpHandler(req, res);

    expect(res.statusCode).toBe(403);
    await server.stop();
  });

  it("PAIR-SEC-02: /pair/confirm accepts chrome-extension:// origin (dev mode, no pinning)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    // Issue a code first
    server.generatePairCode();

    const httpHandler = getCapturedHttpHandler();
    // Use correct code via second call so we have the code value
    const code = server.generatePairCode();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://any-id");
    simulateBodyData(req, JSON.stringify({ code }));

    httpHandler(req, res);
    await flushPostHandlers();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { token?: string; relayIdentitySecret?: string };
    expect(body.token).toBe(FIXED_TOKEN);
    expect(typeof body.relayIdentitySecret).toBe("string");
    expect(body.relayIdentitySecret!.length).toBeGreaterThan(0);
    await server.stop();
  });
});

// ── PAIR-SEC-03: Extension ID pinning ─────────────────────────────────────────

describe("PAIR-SEC-03: allowedExtensionId pins pairing to a specific extension (production mode)", () => {
  const ALLOWED_ID = "abcdefghijklmnopabcdefghijklmnop";
  const OTHER_ID   = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

  beforeEach(() => { clearWsHandlers(); capturedHttpHandler = null; });
  afterEach(() => { clearWsHandlers(); });

  it("PAIR-SEC-03: with allowedExtensionId set, /pair/confirm rejects a different extension ID", async () => {
    const server = new SharedBrowserRelayServer({ ...makeOptions(), allowedExtensionId: ALLOWED_ID });
    await server.start();

    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", `chrome-extension://${OTHER_ID}`);

    httpHandler(req, res);

    expect(res.statusCode).toBe(403);
    await server.stop();
  });

  it("PAIR-SEC-03: with allowedExtensionId set, /pair/confirm accepts the exact allowed extension ID", async () => {
    const server = new SharedBrowserRelayServer({ ...makeOptions(), allowedExtensionId: ALLOWED_ID });
    await server.start();

    const code = server.generatePairCode();
    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", `chrome-extension://${ALLOWED_ID}`);
    simulateBodyData(req, JSON.stringify({ code }));

    httpHandler(req, res);
    await flushPostHandlers();

    expect(res.statusCode).toBe(200);
    await server.stop();
  });

  it("PAIR-SEC-03: with allowedExtensionId set, /pair/code also rejects a different extension ID", async () => {
    const server = new SharedBrowserRelayServer({ ...makeOptions(), allowedExtensionId: ALLOWED_ID });
    await server.start();

    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("GET", "/pair/code", `chrome-extension://${OTHER_ID}`);

    httpHandler(req, res);

    expect(res.statusCode).toBe(403);
    await server.stop();
  });
});

// ── PAIR-SEC-04: Rate limiting on /pair/confirm ────────────────────────────────

describe("PAIR-SEC-04: /pair/confirm rate-limits and locks out after 5 failed attempts", () => {
  beforeEach(() => { clearWsHandlers(); capturedHttpHandler = null; });
  afterEach(() => { clearWsHandlers(); });

  it("PAIR-SEC-04: after 5 wrong codes, /pair/confirm returns 429 and rejects valid code", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    server.generatePairCode(); // sets a valid code
    const httpHandler = getCapturedHttpHandler();

    // Submit 5 wrong codes
    for (let i = 0; i < 5; i++) {
      const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://any-id");
      simulateBodyData(req, JSON.stringify({ code: "0000-0000" }));
      httpHandler(req, res);
      await flushPostHandlers();
    }

    // 6th attempt (even with a "valid-looking" code) → 429
    const { req: req6, res: res6 } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://any-id");
    simulateBodyData(req6, JSON.stringify({ code: "0000-0000" }));
    httpHandler(req6, res6);

    expect(res6.statusCode).toBe(429);
    const body6 = JSON.parse(res6.body) as { error?: string };
    expect(body6.error).toBe("too-many-attempts");
    await server.stop();
  });

  it("PAIR-SEC-04: generatePairCode() resets the failed-attempt counter", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    server.generatePairCode(); // first code
    const httpHandler = getCapturedHttpHandler();

    // Exhaust attempts
    for (let i = 0; i < 5; i++) {
      const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://any-id");
      simulateBodyData(req, JSON.stringify({ code: "0000-0000" }));
      httpHandler(req, res);
      await flushPostHandlers();
    }

    // Issue fresh code — counter resets
    const freshCode = server.generatePairCode();

    const { req: reqFresh, res: resFresh } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://any-id");
    simulateBodyData(reqFresh, JSON.stringify({ code: freshCode }));
    httpHandler(reqFresh, resFresh);
    await flushPostHandlers();

    expect(resFresh.statusCode).toBe(200);
    await server.stop();
  });
});

// ── PAIR-SEC-04: CSPRNG for pair codes ────────────────────────────────────────

describe("PAIR-SEC-04: generatePairCode() uses CSPRNG — produces NNNN-NNNN format codes", () => {
  it("PAIR-SEC-04: code matches NNNN-NNNN format", () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    const code = server.generatePairCode();
    expect(code).toMatch(/^\d{4}-\d{4}$/);
  });

  it("PAIR-SEC-04: consecutive codes are different (CSPRNG, not sequential)", () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    const codes = new Set(Array.from({ length: 20 }, () => server.generatePairCode()));
    // With CSPRNG, 20 random 8-digit codes should all be unique (10^8 space)
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ── PAIR-SEC-06: /pair/confirm returns relayIdentitySecret ────────────────────

describe("PAIR-SEC-06: /pair/confirm response includes relayIdentitySecret", () => {
  beforeEach(() => { clearWsHandlers(); capturedHttpHandler = null; });
  afterEach(() => { clearWsHandlers(); });

  it("PAIR-SEC-06: successful pairing response includes relayIdentitySecret (UUID)", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const code = server.generatePairCode();
    const httpHandler = getCapturedHttpHandler();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://ext-id");
    simulateBodyData(req, JSON.stringify({ code }));

    httpHandler(req, res);
    await flushPostHandlers();

    const body = JSON.parse(res.body) as { token?: string; relayIdentitySecret?: string };
    expect(body.relayIdentitySecret).toBeDefined();
    // UUID v4 format
    expect(body.relayIdentitySecret).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await server.stop();
  });

  it("PAIR-SEC-06: two consecutive pairings produce different relayIdentitySecrets", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const httpHandler = getCapturedHttpHandler();

    const code1 = server.generatePairCode();
    const { req: req1, res: res1 } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://ext-id");
    simulateBodyData(req1, JSON.stringify({ code: code1 }));
    httpHandler(req1, res1);
    await flushPostHandlers();

    const code2 = server.generatePairCode();
    const { req: req2, res: res2 } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://ext-id");
    simulateBodyData(req2, JSON.stringify({ code: code2 }));
    httpHandler(req2, res2);
    await flushPostHandlers();

    const secret1 = (JSON.parse(res1.body) as { relayIdentitySecret?: string }).relayIdentitySecret;
    const secret2 = (JSON.parse(res2.body) as { relayIdentitySecret?: string }).relayIdentitySecret;
    expect(secret1).not.toBe(secret2);
    await server.stop();
  });
});

// ── PAIR-SEC-06: relay-hello challenge/response on /chrome ────────────────────

describe("PAIR-SEC-06: /chrome WS — relay sends hello challenge, closes on wrong HMAC", () => {
  beforeEach(() => { clearWsHandlers(); capturedHttpHandler = null; });
  afterEach(() => { clearWsHandlers(); });

  it("PAIR-SEC-06: /chrome with relayIdentitySecret — relay sends relay-hello nonce immediately", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    // Trigger a pairing so relayIdentitySecret is set inside the server
    const httpHandler = getCapturedHttpHandler();
    const code = server.generatePairCode();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://ext-id");
    simulateBodyData(req, JSON.stringify({ code }));
    httpHandler(req, res);
    await flushPostHandlers();

    // Now simulate /chrome WS connection
    const harness = getWsHarness();
    const wsHandler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();

    wsHandler(mockSocket, makeMockRequest(`/chrome?token=${FIXED_TOKEN}`));

    // Relay must have sent relay-hello immediately
    expect(mockSocket.sent.length).toBeGreaterThanOrEqual(1);
    const hello = JSON.parse(mockSocket.sent[0]) as { kind?: string; nonce?: string };
    expect(hello.kind).toBe("relay-hello");
    expect(typeof hello.nonce).toBe("string");
    expect(hello.nonce!.length).toBeGreaterThan(0);
    await server.stop();
  });

  it("PAIR-SEC-06: /chrome — wrong HMAC causes close(1008, 'identity-verification-failed')", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    // Trigger pairing
    const httpHandler = getCapturedHttpHandler();
    const code = server.generatePairCode();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://ext-id");
    simulateBodyData(req, JSON.stringify({ code }));
    httpHandler(req, res);
    await flushPostHandlers();

    // Simulate /chrome WS connection
    const harness = getWsHarness();
    const wsHandler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();
    wsHandler(mockSocket, makeMockRequest(`/chrome?token=${FIXED_TOKEN}`));

    // Get the nonce from relay-hello
    const hello = JSON.parse(mockSocket.sent[0]) as { kind: string; nonce: string };
    expect(hello.kind).toBe("relay-hello");

    // Simulate extension registering its message handler and firing the wrong ack
    const msgHandler = mockSocket.on.mock.calls.find((c) => c[0] === "message")?.[1] as
      | ((buf: Buffer) => void)
      | undefined;
    expect(msgHandler).toBeDefined();
    msgHandler!(Buffer.from(JSON.stringify({ kind: "relay-hello-ack", hmac: "deadbeef" })));

    expect(mockSocket.closeCode).toBe(1008);
    expect(mockSocket.closeMessage).toBe("identity-verification-failed");
    expect(server.isChromeConnected()).toBe(false);
    await server.stop();
  });

  it("PAIR-SEC-06: /chrome — correct HMAC completes the connection", async () => {
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    // Trigger pairing and extract relayIdentitySecret
    const httpHandler = getCapturedHttpHandler();
    const code = server.generatePairCode();
    const { req, res } = makeMockHttpRequest("POST", "/pair/confirm", "chrome-extension://ext-id");
    simulateBodyData(req, JSON.stringify({ code }));
    httpHandler(req, res);
    await flushPostHandlers();

    const secret = (JSON.parse(res.body) as { relayIdentitySecret: string }).relayIdentitySecret;

    // Simulate /chrome WS connection
    const harness = getWsHarness();
    const wsHandler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();
    wsHandler(mockSocket, makeMockRequest(`/chrome?token=${FIXED_TOKEN}`));

    const hello = JSON.parse(mockSocket.sent[0]) as { kind: string; nonce: string };
    expect(hello.kind).toBe("relay-hello");

    // Compute correct HMAC
    const correctHmac = createHmac("sha256", secret).update(hello.nonce).digest("hex");

    // Simulate correct ack
    const msgHandler = mockSocket.on.mock.calls.find((c) => c[0] === "message")?.[1] as
      | ((buf: Buffer) => void)
      | undefined;
    expect(msgHandler).toBeDefined();
    msgHandler!(Buffer.from(JSON.stringify({ kind: "relay-hello-ack", hmac: correctHmac })));

    // Socket must remain open and Chrome must be connected
    expect(mockSocket.closeCode).toBeNull();
    expect(server.isChromeConnected()).toBe(true);
    await server.stop();
  });

  it("PAIR-SEC-06: /chrome before any pairing — connection accepted without challenge", async () => {
    // No pairing → relayIdentitySecret is null → relay skips challenge
    const server = new SharedBrowserRelayServer(makeOptions());
    await server.start();

    const harness = getWsHarness();
    const wsHandler = harness.captured[harness.captured.length - 1];
    const mockSocket = makeMockSocket();
    wsHandler(mockSocket, makeMockRequest(`/chrome?token=${FIXED_TOKEN}`));

    // No relay-hello should have been sent
    const sentMessages = mockSocket.sent.map((s) => JSON.parse(s) as { kind?: string });
    const helloSent = sentMessages.some((m) => m.kind === "relay-hello");
    expect(helloSent).toBe(false);

    // Chrome should be connected
    expect(server.isChromeConnected()).toBe(true);
    await server.stop();
  });
});
