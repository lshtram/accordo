/**
 * Runtime Directives — Endpoint: diagnostics authenticated payload
 * Requirements: requirements-runtime-directives.md Y-07, Y-08
 *
 * API checklist:
 *   GET /runtime-directives/diagnostics — valid auth → 200 + publication + receipts [1 test]
 *
 * Blocker 7 remediation: injects MockRuntimeDirectiveCatalog into RouterDeps,
 * asserts exact 200 status, and validates deterministic receipt parity from the
 * live router path (no [200, 404] fallback).
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

// ── Y-07/Y-08: Authenticated diagnostics payload ───────────────────────────

describe("GET /runtime-directives/diagnostics — Y-07/Y-08 diagnostics payload", () => {
  it("Y-07 Y-08: GET /runtime-directives/diagnostics valid auth → 200 + publication + receipts", () => {
    const deps = makeRouterDeps();
    const router = createRouter(deps);
    const req = makeReq({
      url: "/runtime-directives/diagnostics",
      headers: { authorization: "Bearer valid-bearer-token" },
    });
    const mockRes = makeRes();
    router.handleHttpRequest(req, mockRes.res);

    // Blocker 7: exact 200 status with real catalog injected
    expect(mockRes.statusCode()).toBe(200);

    const body = JSON.parse(mockRes.body());

    // Blocker 7: publication parity with /runtime-directives
    expect(body).toHaveProperty("publication");
    expect(body.publication.bundle.version).toBe(CANONICAL_BUNDLE_VERSION);
    expect(body.publication.bundle.digest).toBe(CANONICAL_BUNDLE_DIGEST);
    expect(body.publication.ownership.ownerPackage).toBe(
      CANONICAL_PUBLICATION.ownership.ownerPackage,
    );

    // Receipts array (Y-08 delivery receipt capture)
    expect(body).toHaveProperty("receipts");
    expect(Array.isArray(body.receipts)).toBe(true);

    // Blocker 7: deterministic receipt content parity
    // Each receipt must have required fields; bundle version/digest must match publication
    for (const receipt of body.receipts) {
      expect(receipt).toHaveProperty("sessionId");
      expect(receipt).toHaveProperty("agent");
      expect(receipt).toHaveProperty("channel");
      expect(receipt).toHaveProperty("bundleVersion");
      expect(receipt).toHaveProperty("bundleDigest");
      expect(receipt).toHaveProperty("deliveredAt");

      // Receipt bundle version/digest must match publication bundle
      expect(receipt.bundleVersion).toBe(CANONICAL_BUNDLE_VERSION);
      expect(receipt.bundleDigest).toBe(CANONICAL_BUNDLE_DIGEST);

      // Channel must be a known delivery surface
      expect(["initialize", "instructions", "diagnostics"]).toContain(receipt.channel);
    }
  });
});