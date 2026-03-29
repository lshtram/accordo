/**
 * Tests for server-sse.ts (createSseManager)
 * Requirements: requirements-hub.md §2.1 (SSE notifications)
 *
 * API checklist:
 * ✓ createSseManager() — 1 structural test
 * ✓ SseManager.handleMcpSse() — 9 tests
 * ✓ SseManager.pushSseNotification() — 5 tests
 * ✓ SseManager.getConnectionCount() — 2 tests
 * ✓ SseManager.closeAll() — 2 tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import type http from "node:http";
import { createSseManager } from "../server-sse.js";
import type { SseDeps } from "../server-sse.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSseDeps(): SseDeps {
  return {
    debugLogger: {
      logSseConnect: vi.fn(),
      logSseDisconnect: vi.fn(),
      logSseNotification: vi.fn(),
      logError: vi.fn(),
    } as unknown as SseDeps["debugLogger"],
    extractAgentHint: vi.fn((ua: string | string[] | undefined) => {
      if (!ua) return undefined;
      const uaStr = Array.isArray(ua) ? ua[0] : ua;
      if (uaStr.toLowerCase().includes("github-copilot")) return "copilot";
      if (uaStr.toLowerCase().includes("opencode")) return "opencode";
      if (uaStr.toLowerCase().includes("claude")) return "claude";
      if (uaStr.toLowerCase().includes("cursor")) return "cursor";
      return uaStr.slice(0, 60);
    }),
  };
}

// Minimal mock IncomingMessage
function makeReq(overrides: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
} = {}): http.IncomingMessage {
  const stream = new PassThrough();
  return Object.assign(stream, {
    method: overrides.method ?? "GET",
    url: overrides.url ?? "/mcp",
    headers: overrides.headers ?? {},
    socket: {
      setTimeout: vi.fn(),
      setKeepAlive: vi.fn(),
    } as unknown as http.IncomingMessage["socket"],
  }) as unknown as http.IncomingMessage;
}

// Mock ServerResponse
interface MockSseRes {
  res: http.ServerResponse;
  statusCode: () => number;
  headers: () => Record<string, string | string[]>;
  writtenData: () => string[];
  endCalled: () => boolean;
  destroyed: () => boolean;
  setTimeout: () => number;
  setKeepAlive: () => boolean;
}

function makeSseRes(): MockSseRes {
  let status = 200;
  const capturedHeaders: Record<string, string | string[]> = {};
  const writtenData: string[] = [];
  let endCalled = false;
  let destroyed = false;
  let socketTimeout = 0;
  let socketKeepAlive = false;

  const mockSocket = {
    setTimeout(val: number) { socketTimeout = val; },
    setKeepAlive(enable: boolean) { socketKeepAlive = enable; },
  };

  const res = {
    writeHead(code: number, headers?: Record<string, string | string[]>) {
      status = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          capturedHeaders[k.toLowerCase()] = v;
        }
      }
    },
    end(..._args: unknown[]) { endCalled = true; },
    write: vi.fn((chunk: string) => { writtenData.push(chunk); }),
    destroy() { destroyed = true; },
    getHeader(name: string) {
      return capturedHeaders[name.toLowerCase()] as string | undefined;
    },
    socket: mockSocket,
  } as unknown as http.ServerResponse;

  return {
    res,
    statusCode: () => status,
    headers: () => capturedHeaders,
    writtenData: () => writtenData,
    endCalled: () => endCalled,
    destroyed: () => destroyed,
    setTimeout: () => socketTimeout,
    setKeepAlive: () => socketKeepAlive,
  };
}

// ── createSseManager ─────────────────────────────────────────────────────────

describe("createSseManager", () => {
  it("returns a SseManager with handleMcpSse, pushSseNotification, getConnectionCount, closeAll", () => {
    const deps = makeSseDeps();
    const manager = createSseManager(deps);
    expect(typeof manager.handleMcpSse).toBe("function");
    expect(typeof manager.pushSseNotification).toBe("function");
    expect(typeof manager.getConnectionCount).toBe("function");
    expect(typeof manager.closeAll).toBe("function");
  });
});

// ── SseManager.handleMcpSse ──────────────────────────────────────────────────

describe("SseManager.handleMcpSse — header and socket setup", () => {
  let manager: ReturnType<typeof createSseManager>;
  let deps: SseDeps;

  beforeEach(() => {
    deps = makeSseDeps();
    manager = createSseManager(deps);
  });

  it("sets Content-Type: text/event-stream", () => {
    const { res, headers } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    expect(headers()["content-type"]).toBe("text/event-stream");
  });

  it("sets Cache-Control: no-cache", () => {
    const { res, headers } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    expect(headers()["cache-control"]).toBe("no-cache");
  });

  it("sets Connection: keep-alive", () => {
    const { res, headers } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    expect(headers()["connection"]).toBe("keep-alive");
  });

  it("sets Access-Control-Allow-Origin: *", () => {
    const { res, headers } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    expect(headers()["access-control-allow-origin"]).toBe("*");
  });

  it("disables socket timeout on req.socket (setTimeout called with 0)", () => {
    const req = makeReq();
    const { res } = makeSseRes();
    manager.handleMcpSse(req, res);
    expect(req.socket.setTimeout).toHaveBeenCalledWith(0);
  });

  it("enables socket keep-alive on req.socket", () => {
    const req = makeReq();
    const { res } = makeSseRes();
    manager.handleMcpSse(req, res);
    expect(req.socket.setKeepAlive).toHaveBeenCalled();
  });

  it("sends SSE confirmation ping on connect", () => {
    const { res, writtenData } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    const sseData = writtenData().find(d => d.includes("accordo-hub SSE"));
    expect(sseData).toBeDefined();
  });

  it("adds connection to the internal map", () => {
    const { res } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    expect(manager.getConnectionCount()).toBeGreaterThan(0);
  });

  it("writes ping comment every 30s to keep connection alive", async () => {
    vi.useFakeTimers();
    try {
      const req = makeReq();
      const { res, writtenData } = makeSseRes();
      manager.handleMcpSse(req, res);

      // Advance 30 seconds
      await vi.advanceTimersByTimeAsync(30_000);

      const pingCall = writtenData().find(d => d === ": ping\n\n");
      expect(pingCall).toBe(": ping\n\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes connection and clears timer when res is destroyed (explicit disconnect)", async () => {
    vi.useFakeTimers();
    try {
      const req = makeReq();
      const { res, writtenData } = makeSseRes();
      manager.handleMcpSse(req, res);
      expect(manager.getConnectionCount()).toBe(1);

      // Simulate client disconnect by destroying the response
      res.destroy();

      expect(manager.getConnectionCount()).toBe(0);

      // Advance time and verify no ping writes occur after disconnect
      await vi.advanceTimersByTimeAsync(60_000);
      const pingWritesAfterDisconnect = writtenData().filter(d => d === ": ping\n\n");
      expect(pingWritesAfterDisconnect).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── SseManager.pushSseNotification ───────────────────────────────────────────

describe("SseManager.pushSseNotification", () => {
  let manager: ReturnType<typeof createSseManager>;
  let deps: SseDeps;

  beforeEach(() => {
    deps = makeSseDeps();
    manager = createSseManager(deps);
  });

  it("writes to all active connections", () => {
    const { res: res1 } = makeSseRes();
    const { res: res2 } = makeSseRes();
    manager.handleMcpSse(makeReq({ headers: { "user-agent": "opencode" } }), res1);
    manager.handleMcpSse(makeReq({ headers: { "user-agent": "copilot" } }), res2);

    manager.pushSseNotification({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} });

    expect(res1.write).toHaveBeenCalled();
    expect(res2.write).toHaveBeenCalled();
  });

  it("writes valid SSE format (data: <json>\n\n)", () => {
    const { res } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);

    manager.pushSseNotification({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} });

    const written = res.write as ReturnType<typeof vi.fn>;
    const dataCall = written.mock.calls.find((call) => (call[0] as string).startsWith("data:"));
    expect(dataCall).toBeDefined();
    const dataStr = dataCall![0] as string;
    expect(dataStr).toMatch(/^data: .+\n\n$/);
    // should be parseable JSON after "data: "
    const jsonPart = dataStr.replace(/^data: /, "").replace(/\n\n$/, "");
    expect(() => JSON.parse(jsonPart)).not.toThrow();
  });

  it("with 0 connections is a no-op (does not throw)", () => {
    expect(() => manager.pushSseNotification({ jsonrpc: "2.0", method: "foo", params: {} })).not.toThrow();
  });

  it("skips dead connections that throw on write", () => {
    const { res: res1 } = makeSseRes();
    const { res: res2 } = makeSseRes();

    // Make res1's write throw (simulate dead connection)
    (res1.write as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("ECONNRESET"); });

    manager.handleMcpSse(makeReq(), res1);
    manager.handleMcpSse(makeReq(), res2);

    // Should not throw despite res1 being dead
    expect(() => manager.pushSseNotification({ jsonrpc: "2.0", method: "foo", params: {} })).not.toThrow();
    // res2 should still have been written to
    expect(res2.write).toHaveBeenCalled();
  });

  it("skips dead connections and decrements connection count", () => {
    const { res: res1 } = makeSseRes();
    const { res: res2 } = makeSseRes();

    manager.handleMcpSse(makeReq(), res1);
    manager.handleMcpSse(makeReq(), res2);

    const countBefore = manager.getConnectionCount();

    // Kill res1
    (res1.write as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("ECONNRESET"); });

    manager.pushSseNotification({ jsonrpc: "2.0", method: "foo", params: {} });

    expect(manager.getConnectionCount()).toBeLessThan(countBefore);
  });
});

// ── SseManager.getConnectionCount ─────────────────────────────────────────────

describe("SseManager.getConnectionCount", () => {
  let manager: ReturnType<typeof createSseManager>;
  let deps: SseDeps;

  beforeEach(() => {
    deps = makeSseDeps();
    manager = createSseManager(deps);
  });

  it("returns 0 initially", () => {
    expect(manager.getConnectionCount()).toBe(0);
  });

  it("returns correct count after connections are added", () => {
    const { res: res1 } = makeSseRes();
    const { res: res2 } = makeSseRes();
    manager.handleMcpSse(makeReq(), res1);
    manager.handleMcpSse(makeReq(), res2);
    expect(manager.getConnectionCount()).toBe(2);
  });
});

// ── SseManager.closeAll ───────────────────────────────────────────────────────

describe("SseManager.closeAll", () => {
  let manager: ReturnType<typeof createSseManager>;
  let deps: SseDeps;

  beforeEach(() => {
    deps = makeSseDeps();
    manager = createSseManager(deps);
  });

  it("sets connection count to 0", () => {
    const { res } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    manager.handleMcpSse(makeReq(), res);
    manager.closeAll();
    expect(manager.getConnectionCount()).toBe(0);
  });

  it("subsequent pushSseNotification is a no-op after closeAll", () => {
    const { res } = makeSseRes();
    manager.handleMcpSse(makeReq(), res);
    manager.closeAll();
    expect(() => manager.pushSseNotification({ jsonrpc: "2.0", method: "foo", params: {} })).not.toThrow();
    expect(manager.getConnectionCount()).toBe(0);
  });
});
