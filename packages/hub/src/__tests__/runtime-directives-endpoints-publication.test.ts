/**
 * Runtime Directives — Endpoint: authenticated publication payload
 * Requirements: requirements-runtime-directives.md Y-07
 *
 * API checklist:
 *   GET /runtime-directives — valid auth → 200 + full canonical publication [1 test]
 *
 * Blocker 7 remediation: injects MockRuntimeDirectiveCatalog into RouterDeps,
 * asserts exact 200 status, and validates full payload parity against the live
 * router path (no [200, 404] fallback).
 */

import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import type http from "node:http";
import { createRouter } from "../server-routing.js";
import type { RouterDeps } from "../server-routing.js";
import {
  CANONICAL_PUBLICATION,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
  MockRuntimeDirectiveCatalog,
} from "./runtime-directives-fixtures.js";

// ── Router deps (injects real catalog for exact 200 assertions) ───────────────

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
    // Blocker 7: inject real catalog so endpoint returns 200 (not 404)
    runtimeDirectiveCatalog: new MockRuntimeDirectiveCatalog(),
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
  body: () => string;
}

function makeRes(): MockRes {
  let status = 200;
  let responseBody = "";
  const res = {
    writeHead(code: number, _headers?: Record<string, string>) { status = code; },
    end(body?: string) { if (body) responseBody += body; },
  } as unknown as http.ServerResponse;
  return { res, statusCode: () => status, body: () => responseBody };
}

// ── Y-07: Authenticated publication payload ─────────────────────────────────

describe("GET /runtime-directives — Y-07 authenticated publication payload", () => {
  it("Y-07: GET /runtime-directives with valid auth → 200 + full canonical publication", () => {
    const deps = makeRouterDeps();
    const router = createRouter(deps);
    const req = makeReq({
      url: "/runtime-directives",
      headers: { authorization: "Bearer valid-bearer-token" },
    });
    const mockRes = makeRes();
    router.handleHttpRequest(req, mockRes.res);

    // Blocker 7: exact 200 status with real catalog injected
    expect(mockRes.statusCode()).toBe(200);

    const body = JSON.parse(mockRes.body());

    // Blocker 7: full canonical payload assertions
    // Bundle level
    expect(body).toHaveProperty("bundle");
    expect(body.bundle.version).toBe(CANONICAL_BUNDLE_VERSION);
    expect(body.bundle.digest).toBe(CANONICAL_BUNDLE_DIGEST);

    // Ownership metadata (Y-07)
    expect(body).toHaveProperty("ownership");
    expect(body.ownership.ownerPackage).toBe(
      CANONICAL_PUBLICATION.ownership.ownerPackage,
    );
    expect(body.ownership.ownerModule).toBe(
      CANONICAL_PUBLICATION.ownership.ownerModule,
    );

    // Publication parity: bundle/version/digest same as /runtime-directives/diagnostics
    expect(body.bundle.version).toBe(CANONICAL_PUBLICATION.bundle.version);
    expect(body.bundle.digest).toBe(CANONICAL_PUBLICATION.bundle.digest);

    // Clauses present
    expect(body.bundle).toHaveProperty("clauses");
    expect(Array.isArray(body.bundle.clauses)).toBe(true);
    expect(body.bundle.clauses.length).toBeGreaterThan(0);
  });
});