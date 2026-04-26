/**
 * Runtime Directives — Endpoint Auth: missing/invalid auth returns 401
 * Requirements: requirements-runtime-directives.md Y-07
 *
 * API checklist:
 *   GET /runtime-directives — missing auth [1 test]
 *   GET /runtime-directives — invalid auth [1 test]
 *   GET /runtime-directives/diagnostics — missing auth [1 test]
 *   GET /runtime-directives/diagnostics — invalid auth [1 test]
 *
 * Blocker 2 remediation: removed permissive [401, 404] allowances.
 * Security middleware runs BEFORE route lookup — missing/invalid auth
 * must always return 401 even when route is not yet implemented.
 * Phase C will add routing; these tests verify auth wiring is correct.
 */

import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import type http from "node:http";
import { createRouter } from "../server-routing.js";
import type { RouterDeps } from "../server-routing.js";

// ── Router deps (standard, no runtime-directives catalog yet) ─────────────────

function makeRouterDeps(): RouterDeps {
  return {
    getToken: () => "valid-bearer-token",
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
    getBrowserStatus: () => ({ connected: true, controlGranted: true }),
  };
}

// ── Mock request/response ─────────────────────────────────────────────────────

function makeReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}): http.IncomingMessage {
  const stream = new PassThrough();
  process.nextTick(() => stream.push(null));
  return Object.assign(stream, {
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers: opts.headers ?? {},
  }) as unknown as http.IncomingMessage;
}

interface MockRes {
  res: http.ServerResponse;
  statusCode: () => number;
}

function makeRes(): MockRes {
  let status = 200;
  const res = {
    writeHead(code: number, _headers?: Record<string, string>) { status = code; },
    end() {},
  } as unknown as http.ServerResponse;
  return { res, statusCode: () => status };
}

// ── Y-07: Missing/invalid auth must return 401 (not 404) ─────────────────────

describe("GET /runtime-directives — Y-07 auth: missing/invalid returns 401", () => {
  it("Y-07: GET /runtime-directives without Authorization header returns 401", () => {
    const deps = makeRouterDeps();
    const router = createRouter(deps);
    const req = makeReq({ url: "/runtime-directives", headers: {} });
    const mockRes = makeRes();
    router.handleHttpRequest(req, mockRes.res);
    // Auth layer must return 401 — Phase C routing target
    expect(mockRes.statusCode()).toBe(401);
  });

  it("Y-07: GET /runtime-directives with invalid bearer token returns 401", () => {
    const deps = makeRouterDeps();
    const router = createRouter(deps);
    const req = makeReq({
      url: "/runtime-directives",
      headers: { authorization: "Bearer invalid-token" },
    });
    const mockRes = makeRes();
    router.handleHttpRequest(req, mockRes.res);
    // validateBearer returns false → 401 — Phase C routing target
    expect(mockRes.statusCode()).toBe(401);
  });
});

describe("GET /runtime-directives/diagnostics — Y-07 auth: missing/invalid returns 401", () => {
  it("Y-07: GET /runtime-directives/diagnostics without Authorization header returns 401", () => {
    const deps = makeRouterDeps();
    const router = createRouter(deps);
    const req = makeReq({ url: "/runtime-directives/diagnostics", headers: {} });
    const mockRes = makeRes();
    router.handleHttpRequest(req, mockRes.res);
    // Auth layer must return 401 — Phase C routing target
    expect(mockRes.statusCode()).toBe(401);
  });

  it("Y-07: GET /runtime-directives/diagnostics with invalid bearer token returns 401", () => {
    const deps = makeRouterDeps();
    const router = createRouter(deps);
    const req = makeReq({
      url: "/runtime-directives/diagnostics",
      headers: { authorization: "Bearer wrong-token" },
    });
    const mockRes = makeRes();
    router.handleHttpRequest(req, mockRes.res);
    // validateBearer returns false → 401 — Phase C routing target
    expect(mockRes.statusCode()).toBe(401);
  });
});