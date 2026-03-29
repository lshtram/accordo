/**
 * Tests for server-mcp.ts (createMcpRequestHandler, extractAgentHint)
 * Requirements: requirements-hub.md §2.1
 *
 * API checklist:
 * ✓ createMcpRequestHandler() — 1 structural test
 * ✓ McpRequestHandler.handleMcp() — 11 tests
 * ✓ extractAgentHint() — 5 tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import type http from "node:http";
import { createMcpRequestHandler, extractAgentHint } from "../server-mcp.js";
import type { McpRequestHandlerDeps, McpRequestHandler } from "../server-mcp.js";
import type { McpHandler, Session } from "../mcp-handler.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMockSession(): Session {
  return {
    id: "test-session-123",
    createdAt: Date.now(),
    lastActivity: Date.now(),
    initialized: false,
  };
}

function makeMockMcpHandler(): McpHandler {
  return {
    handleRequest: vi.fn(async () => ({
      jsonrpc: "2.0" as const,
      id: null,
      result: { ok: true },
    })),
    createSession: vi.fn(() => makeMockSession()),
    getSession: vi.fn((id: string) => {
      if (!id || id === "unknown-session") return undefined;
      return makeMockSession();
    }),
  } as unknown as McpHandler;
}

function makeMcpHandlerDeps(): McpRequestHandlerDeps {
  return {
    mcpHandler: makeMockMcpHandler(),
    debugLogger: {
      logHttpRequest: vi.fn(),
      logError: vi.fn(),
    } as unknown as McpRequestHandlerDeps["debugLogger"],
  };
}

// Minimal mock IncomingMessage
function makeReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): http.IncomingMessage {
  const stream = new PassThrough();
  process.nextTick(() => {
    if (opts.body !== undefined) stream.push(opts.body);
    stream.push(null);
  });
  return Object.assign(stream, {
    method: opts.method ?? "POST",
    url: opts.url ?? "/mcp",
    headers: opts.headers ?? {},
    socket: { remoteAddress: "127.0.0.1" } as unknown as http.IncomingMessage["socket"],
  }) as unknown as http.IncomingMessage;
}

// Mock ServerResponse
interface MockRes {
  res: http.ServerResponse;
  statusCode: () => number;
  getHeader: (name: string) => string | undefined;
  body: () => string;
  endSpy: ReturnType<typeof vi.fn>;
}

function makeRes(): MockRes {
  let status = 200;
  const capturedHeaders: Record<string, string | string[]> = {};
  let responseBody = "";
  const endSpy = vi.fn((body?: string) => {
    if (body) responseBody += body;
  });

  const res = {
    writeHead(code: number, headers?: Record<string, string | string[]>) {
      status = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          capturedHeaders[k.toLowerCase()] = v;
        }
      }
    },
    end: endSpy,
    getHeader(name: string) {
      return capturedHeaders[name.toLowerCase()] as string | undefined;
    },
  } as unknown as http.ServerResponse;

  return {
    res,
    statusCode: () => status,
    getHeader: (name: string) => capturedHeaders[name.toLowerCase()] as string | undefined,
    body: () => responseBody,
    endSpy,
  };
}

// Helper: resolves deterministically when res.end is called via the spy.
// Uses a microtask to avoid setTimeout timing fragility.
function flushHandleMcp(res: MockRes): Promise<void> {
  return new Promise<void>(resolve => {
    if (res.endSpy.mock.calls.length > 0) {
      resolve();
      return;
    }
    // Intercept endSpy so we resolve when it is called, without needing a timer.
    const orig = res.endSpy.getMockImplementation();
    res.endSpy.mockImplementation((body?: string) => {
      if (orig) orig(body);
      resolve();
    });
  });
}

// ── createMcpRequestHandler ───────────────────────────────────────────────────

describe("createMcpRequestHandler", () => {
  it("returns a McpRequestHandler with handleMcp method", () => {
    const deps = makeMcpHandlerDeps();
    const handler = createMcpRequestHandler(deps);
    expect(typeof handler.handleMcp).toBe("function");
  });
});

// ── McpRequestHandler.handleMcp ──────────────────────────────────────────────

describe("McpRequestHandler.handleMcp — request validation", () => {
  let handler: McpRequestHandler;
  let deps: McpRequestHandlerDeps;

  beforeEach(() => {
    deps = makeMcpHandlerDeps();
    handler = createMcpRequestHandler(deps);
  });

  it("returns 415 when Content-Type is not application/json", async () => {
    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { "content-type": "text/plain" },
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    expect(mockRes.statusCode()).toBe(415);
  });

  it("returns 415 when Content-Type header is missing", async () => {
    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: {},
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    expect(mockRes.statusCode()).toBe(415);
  });

  it("returns 400 when Mcp-Session-Id header references unknown session", async () => {
    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "unknown-session",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    expect(mockRes.statusCode()).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { "content-type": "application/json" },
        body: "this is not json{",
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    expect(mockRes.statusCode()).toBe(400);
  });

  it("with valid JSON body calls mcpHandler.handleRequest", async () => {
    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    expect(deps.mcpHandler.handleRequest).toHaveBeenCalled();
  });

  it("new session sets Mcp-Session-Id response header", async () => {
    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    const sessionId = mockRes.getHeader("mcp-session-id");
    expect(typeof sessionId).toBe("string");
    expect((sessionId as string).length).toBeGreaterThan(0);
  });

  it("existing session reuses session and does NOT set new Mcp-Session-Id header", async () => {
    const existingSession = makeMockSession();
    (deps.mcpHandler.getSession as ReturnType<typeof vi.fn>).mockReturnValue(existingSession);

    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": existingSession.id,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    // Should reuse the existing session, not create a new one
    expect(deps.mcpHandler.createSession).not.toHaveBeenCalled();
    // Must NOT set a new Mcp-Session-Id header (reuses existing)
    expect(mockRes.getHeader("mcp-session-id")).toBeUndefined();
  });

  it("null response from handler calls res.end() without body", async () => {
    // Notification (no id) returns null
    (deps.mcpHandler.handleRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }),
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    // Should have ended without throwing
    expect(mockRes.endSpy).toHaveBeenCalled();
  });

  it("handleRequest rejection calls res.end() (error response)", async () => {
    (deps.mcpHandler.handleRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("JSON-RPC internal error"),
    );

    const mockRes = makeRes();
    handler.handleMcp(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
      }),
      mockRes.res,
    );
    await flushHandleMcp(mockRes);
    expect(mockRes.endSpy).toHaveBeenCalled();
  });
});

// ── extractAgentHint ─────────────────────────────────────────────────────────

describe("extractAgentHint", () => {
  it("github-copilot → copilot", () => {
    expect(extractAgentHint("github-copilot/1.2.3")).toBe("copilot");
  });

  it("GitHub Copilot (case-insensitive) → copilot", () => {
    expect(extractAgentHint("GitHub Copilot/1.0")).toBe("copilot");
  });

  it("opencode → opencode", () => {
    expect(extractAgentHint("opencode/0.1.0")).toBe("opencode");
  });

  it("claude → claude", () => {
    expect(extractAgentHint("claude/1.0")).toBe("claude");
  });

  it("cursor → cursor", () => {
    expect(extractAgentHint("cursor/2024.1")).toBe("cursor");
  });

  it("unknown UA → first 60 chars", () => {
    const longUa = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 MyAgent/1.0";
    expect(extractAgentHint(longUa)).toBe(longUa.slice(0, 60));
  });

  it("missing UA → undefined", () => {
    expect(extractAgentHint(undefined)).toBe(undefined);
  });

  it("array UA → uses first element", () => {
    expect(extractAgentHint(["copilot/1.0", "foo/2.0"])).toBe("copilot");
  });
});
