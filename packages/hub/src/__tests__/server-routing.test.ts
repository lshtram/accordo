/**
 * Tests for server-routing.ts (createRouter)
 * Requirements: requirements-hub.md §2.1, §2.3, §2.4, §2.6, §5.6
 *              adr-reload-reconnect.md §D1 (SR-01 to SR-05)
 *
 * API checklist:
 * ✓ createRouter() — 1 structural test
 * ✓ Router.handleHttpRequest() — 27 tests (routing + auth + origin + delegation + disconnect)
 *
 * SR-01: POST /bridge/disconnect with valid secret → delegates to handleDisconnect [1 test]
 * SR-02: POST /bridge/disconnect with invalid secret → 401, handleDisconnect NOT called [1 test]
 * SR-03: POST /bridge/disconnect missing x-accordo-secret → 401 [1 test]
 * SR-04: GET /bridge/disconnect (wrong method) → 404 [1 test]
 * SR-05: POST /bridge/disconnect with valid secret but invalid origin → 403 [1 test]
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import type http from "node:http";
import { createRouter } from "../server-routing.js";
import type { RouterDeps } from "../server-routing.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOptions(): RouterDeps {
  return {
    getToken: () => "test-bearer-token",
    getBridgeSecret: () => "test-bridge-secret",
    handleMcp: vi.fn<() => void>(),
    handleMcpSse: vi.fn<() => void>(),
    handleReauth: vi.fn<() => void>(),
    handleDisconnect: vi.fn<() => void>(),
    getHealth: () => ({
      ok: true,
      uptime: 1.5,
      bridge: "disconnected",
      toolCount: 0,
      protocolVersion: "1.0.0",
      inflight: 0,
      queued: 0,
    }),
    getState: () => ({
      activeFile: null,
      activeFileLine: 1,
      activeFileColumn: 1,
      openEditors: [],
      openTabs: [],
      visibleEditors: [],
      workspaceFolders: [],
      activeTerminal: null,
      workspaceName: null,
      remoteAuthority: null,
      modalities: {},
    }),
    getTools: () => [],
    renderPrompt: () => "# System Prompt\n\nYou have access to tools.",
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
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers: opts.headers ?? {},
  }) as unknown as http.IncomingMessage;
}

// Minimal mock ServerResponse
interface MockRes {
  res: http.ServerResponse;
  statusCode: () => number;
  body: () => string;
  getHeader: (name: string) => string | undefined;
  written: () => string[];
}

function makeRes(): MockRes {
  let status = 200;
  let responseBody = "";
  const capturedHeaders: Record<string, string | string[]> = {};
  const writeCalls: string[] = [];

  const res = {
    writeHead(code: number, headers?: Record<string, string | string[]>) {
      status = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          capturedHeaders[k.toLowerCase()] = v;
        }
      }
    },
    end(body?: string) {
      if (body) responseBody += body;
    },
    write(chunk: string) {
      writeCalls.push(chunk);
    },
    getHeader(name: string) {
      return capturedHeaders[name.toLowerCase()] as string | undefined;
    },
  } as unknown as http.ServerResponse;

  return {
    res,
    statusCode: () => status,
    body: () => responseBody,
    getHeader: (name: string) => capturedHeaders[name.toLowerCase()] as string | undefined,
    written: () => writeCalls,
  };
}

// ── createRouter ─────────────────────────────────────────────────────────────

describe("createRouter", () => {
  it("returns a Router with handleHttpRequest method", () => {
    const deps = makeOptions();
    const router = createRouter(deps);
    expect(typeof router.handleHttpRequest).toBe("function");
  });
});

// ── Router.handleHttpRequest — routing ───────────────────────────────────────

describe("Router.handleHttpRequest — routing (§2.1, §2.3, §2.4, §2.6)", () => {
  let deps: RouterDeps;
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    deps = makeOptions();
    router = createRouter(deps);
  });

  it("§2.4: GET /health returns 200 without any auth", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(makeReq({ method: "GET", url: "/health" }), res);
    expect(statusCode()).toBe(200);
  });

  it("§2.4: GET /health response body is valid JSON with ok:true", () => {
    const { res, body } = makeRes();
    router.handleHttpRequest(makeReq({ method: "GET", url: "/health" }), res);
    const parsed = JSON.parse(body()) as Record<string, unknown>;
    expect(parsed["ok"]).toBe(true);
  });

  it("§2.1: POST /mcp without Bearer returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(makeReq({ method: "POST", url: "/mcp" }), res);
    expect(statusCode()).toBe(401);
  });

  it("§2.1: GET /mcp without Bearer returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(makeReq({ method: "GET", url: "/mcp" }), res);
    expect(statusCode()).toBe(401);
  });

  it("§2.1: POST /mcp with wrong Bearer returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({ method: "POST", url: "/mcp", headers: { authorization: "Bearer wrong-token" } }),
      res,
    );
    expect(statusCode()).toBe(401);
  });

  it("§2.3: GET /instructions without Bearer returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(makeReq({ method: "GET", url: "/instructions" }), res);
    expect(statusCode()).toBe(401);
  });

  it("§2.3: GET /instructions with valid Bearer returns 200 and text/markdown", () => {
    const { res, statusCode, getHeader } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/instructions",
        headers: { authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(statusCode()).toBe(200);
    expect(getHeader("content-type")).toContain("text/markdown");
  });

  it("§2.3: GET /instructions with valid Bearer returns non-empty body", () => {
    const { res, body } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/instructions",
        headers: { authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(body().length).toBeGreaterThan(0);
  });

  it("§2.6: POST /bridge/reauth without secret returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(makeReq({ method: "POST", url: "/bridge/reauth" }), res);
    expect(statusCode()).toBe(401);
  });

  it("§2.6: POST /bridge/reauth with wrong secret returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "x-accordo-secret": "wrong-secret" },
      }),
      res,
    );
    expect(statusCode()).toBe(401);
  });

  it("§2.1: unknown endpoint returns 404", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(makeReq({ method: "GET", url: "/nonexistent" }), res);
    expect(statusCode()).toBe(404);
  });

  it("§2.1: POST /mcp with wrong HTTP method returns 405", () => {
    const { res, statusCode, getHeader } = makeRes();
    router.handleHttpRequest(makeReq({ method: "PUT", url: "/mcp" }), res);
    expect(statusCode()).toBe(405);
    expect(getHeader("allow")).toMatch(/POST|GET/);
  });
});

// ── Router.handleHttpRequest — Origin validation (§2.1, §2.3, §2.6) ───────────

describe("Router.handleHttpRequest — Origin validation (§2.1, §2.3, §2.6)", () => {
  let deps: RouterDeps;
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    deps = makeOptions();
    router = createRouter(deps);
  });

  it("POST /mcp with invalid Origin returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { origin: "https://evil.com", authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(statusCode()).toBe(403);
  });

  it("GET /mcp with invalid Origin returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/mcp",
        headers: { origin: "https://evil.com", authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(statusCode()).toBe(403);
  });

  it("GET /instructions with invalid Origin returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/instructions",
        headers: { origin: "https://evil.com", authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(statusCode()).toBe(403);
  });

  it("GET /state with invalid Origin returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/state",
        headers: { origin: "https://evil.com", authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(statusCode()).toBe(403);
  });

  it("POST /bridge/reauth with invalid Origin returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { origin: "https://evil.com", "x-accordo-secret": "test-bridge-secret" },
      }),
      res,
    );
    expect(statusCode()).toBe(403);
  });

  it("origin check runs before bearer check — invalid Origin + missing Bearer returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { origin: "https://evil.com" },
      }),
      res,
    );
    // Origin is checked before bearer auth, so we get 403 not 401
    expect(statusCode()).toBe(403);
  });

  it("origin check runs before bearer check — invalid Origin + wrong Bearer returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/mcp",
        headers: { origin: "https://evil.com", authorization: "Bearer wrong-token" },
      }),
      res,
    );
    expect(statusCode()).toBe(403);
  });

  it("origin check runs before bridge-secret check — invalid Origin + wrong secret returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { origin: "https://evil.com", "x-accordo-secret": "wrong-secret" },
      }),
      res,
    );
    // Origin is checked before the bridge-secret header, so we get 403 not 401
    expect(statusCode()).toBe(403);
  });
});

// ── Router.handleHttpRequest — delegation ─────────────────────────────────────

describe("Router.handleHttpRequest — delegation to handlers", () => {
  let deps: RouterDeps;
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    deps = makeOptions();
    router = createRouter(deps);
  });

  it("GET /state without Bearer returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(makeReq({ method: "GET", url: "/state" }), res);
    expect(statusCode()).toBe(401);
  });

  it("GET /state with valid Bearer delegates to getState and returns 200", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/state",
        headers: { authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(statusCode()).toBe(200);
  });

  it("POST /mcp with valid Bearer delegates to handleMcp", () => {
    const { res } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: { authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(deps.handleMcp).toHaveBeenCalled();
  });

  it("GET /mcp with valid Bearer delegates to handleMcpSse", () => {
    const { res } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/mcp",
        headers: { authorization: "Bearer test-bearer-token" },
      }),
      res,
    );
    expect(deps.handleMcpSse).toHaveBeenCalled();
  });

  it("POST /bridge/reauth with correct secret delegates to handleReauth", () => {
    const { res } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "x-accordo-secret": "test-bridge-secret" },
      }),
      res,
    );
    expect(deps.handleReauth).toHaveBeenCalled();
  });
});

// ── SR-01–SR-05: /bridge/disconnect endpoint (adr-reload-reconnect.md §D1) ────

describe("Router.handleHttpRequest — /bridge/disconnect (SR-01 to SR-05)", () => {
  let deps: RouterDeps;
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    deps = makeOptions();
    router = createRouter(deps);
  });

  it("SR-01: POST /bridge/disconnect with valid bridge secret delegates to handleDisconnect", () => {
    const { res } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: { "x-accordo-secret": "test-bridge-secret" },
      }),
      res,
    );
    // RED: handleDisconnect is a vi.fn() that does nothing — response will NOT be 200
    expect(deps.handleDisconnect).toHaveBeenCalled();
  });

  it("SR-01: POST /bridge/disconnect with valid bridge secret returns 200", () => {
    // Wire handleDisconnect to write a 200 response (as the real handler would)
    (deps.handleDisconnect as ReturnType<typeof vi.fn>).mockImplementation(
      (_req: unknown, res: { writeHead(c: number): void; end(): void }) => {
        res.writeHead(200);
        res.end();
      },
    );
    router = createRouter(deps);

    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: { "x-accordo-secret": "test-bridge-secret" },
      }),
      res,
    );
    expect(statusCode()).toBe(200);
  });

  it("SR-02: POST /bridge/disconnect with invalid bridge secret returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: { "x-accordo-secret": "wrong-secret" },
      }),
      res,
    );
    expect(statusCode()).toBe(401);
  });

  it("SR-02: POST /bridge/disconnect with invalid secret does NOT call handleDisconnect", () => {
    const { res } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: { "x-accordo-secret": "wrong-secret" },
      }),
      res,
    );
    expect(deps.handleDisconnect).not.toHaveBeenCalled();
  });

  it("SR-03: POST /bridge/disconnect missing x-accordo-secret header returns 401", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: {},
      }),
      res,
    );
    expect(statusCode()).toBe(401);
  });

  it("SR-03: POST /bridge/disconnect missing secret does NOT call handleDisconnect", () => {
    const { res } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: {},
      }),
      res,
    );
    expect(deps.handleDisconnect).not.toHaveBeenCalled();
  });

  it("SR-04: GET /bridge/disconnect (wrong HTTP method) returns 404", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "GET",
        url: "/bridge/disconnect",
        headers: { "x-accordo-secret": "test-bridge-secret" },
      }),
      res,
    );
    // GET is not a registered route for /bridge/disconnect — expect 404
    expect(statusCode()).toBe(404);
  });

  it("SR-05: POST /bridge/disconnect with valid secret but invalid origin returns 403", () => {
    const { res, statusCode } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: {
          "x-accordo-secret": "test-bridge-secret",
          origin: "https://evil.com",
        },
      }),
      res,
    );
    expect(statusCode()).toBe(403);
  });

  it("SR-05: POST /bridge/disconnect with invalid origin does NOT call handleDisconnect", () => {
    const { res } = makeRes();
    router.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/disconnect",
        headers: {
          "x-accordo-secret": "test-bridge-secret",
          origin: "https://evil.com",
        },
      }),
      res,
    );
    expect(deps.handleDisconnect).not.toHaveBeenCalled();
  });
});
