/**
 * Tests for server.ts (HubServer)
 * Requirements: requirements-hub.md §2.1, §2.3, §2.4, §2.6, §5.6, §8
 *
 * API checklist:
 * ✓ getHealth() — 11 tests
 * ✓ handleHttpRequest() — 14 tests (routing + security + endpoint behaviour)
 * ✓ updateToken() — 2 tests
 * ✓ start() — 1 test
 * ✓ stop() — 1 test
 * ✓ constructor — 4 tests
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type http from "node:http";
import { HubServer } from "../server.js";
import type { HubServerOptions } from "../server.js";
import { StateCache } from "../state-cache.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<HubServerOptions> = {}): HubServerOptions {
  return {
    port: 3000,
    host: "127.0.0.1",
    token: "test-bearer-token",
    bridgeSecret: "test-bridge-secret",
    ...overrides,
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
  // Schedule stream data/end on next tick so that req.on() listeners can
  // be attached first by handleHttpRequest. This mirrors real TCP delivery.
  process.nextTick(() => {
    if (opts.body !== undefined) stream.push(opts.body);
    stream.push(null); // EOF
  });
  return Object.assign(stream, {
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers: opts.headers ?? {},
  }) as unknown as http.IncomingMessage;
}

// Minimal mock ServerResponse that captures status + body
interface MockRes {
  res: http.ServerResponse;
  statusCode: () => number;
  body: () => string;
  getHeader: (name: string) => string | undefined;
}

function makeRes(): MockRes {
  let status = 200;
  let responseBody = "";
  const capturedHeaders: Record<string, string | string[]> = {};

  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
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
    getHeader(name: string) {
      return capturedHeaders[name.toLowerCase()] as string | undefined;
    },
  } as unknown as http.ServerResponse;

  return {
    res,
    statusCode: () => status,
    body: () => responseBody,
    getHeader: (name: string) => capturedHeaders[name.toLowerCase()] as string | undefined,
  };
}

// ── HubServer ─────────────────────────────────────────────────────────────────

describe("HubServer", () => {
  let server: HubServer;

  beforeEach(() => {
    server = new HubServer(makeOptions());
  });

  // ── getHealth ─────────────────────────────────────────────────────────────

  describe("getHealth (§2.4: GET /health response shape)", () => {
    it("§2.4: returns ok: true", () => {
      expect(server.getHealth().ok).toBe(true);
    });

    it("§2.4: returns uptime as a non-negative number", () => {
      const health = server.getHealth();
      expect(typeof health.uptime).toBe("number");
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it("§2.4: returns bridge: 'disconnected' before any Bridge connects", () => {
      expect(server.getHealth().bridge).toBe("disconnected");
    });

    it("§2.4: returns toolCount as a non-negative integer", () => {
      const health = server.getHealth();
      expect(typeof health.toolCount).toBe("number");
      expect(health.toolCount).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(health.toolCount)).toBe(true);
    });

    it("§2.4: returns protocolVersion as a non-empty string", () => {
      const health = server.getHealth();
      expect(typeof health.protocolVersion).toBe("string");
      expect(health.protocolVersion.length).toBeGreaterThan(0);
    });

    it("§2.4: returns inflight as a non-negative integer", () => {
      const health = server.getHealth();
      expect(typeof health.inflight).toBe("number");
      expect(health.inflight).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(health.inflight)).toBe(true);
    });

    it("§2.4: returns queued as a non-negative integer", () => {
      const health = server.getHealth();
      expect(typeof health.queued).toBe("number");
      expect(health.queued).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(health.queued)).toBe(true);
    });

    it("§2.4: returns all seven required fields", () => {
      const health = server.getHealth();
      for (const field of ["ok", "uptime", "bridge", "toolCount", "protocolVersion", "inflight", "queued"]) {
        expect(health).toHaveProperty(field);
      }
    });

    it("§2.4: toolCount is 0 before any tool registry update", () => {
      expect(server.getHealth().toolCount).toBe(0);
    });

    it("§2.4: inflight is 0 before any invocations", () => {
      expect(server.getHealth().inflight).toBe(0);
    });

    it("§2.4: queued is 0 before any invocations", () => {
      expect(server.getHealth().queued).toBe(0);
    });
  });

  // ── handleHttpRequest — routing ───────────────────────────────────────────

  describe("handleHttpRequest — routing (§2.1, §2.3, §2.4, §2.6)", () => {
    it("§2.4: GET /health returns 200 without any auth", () => {
      // req-hub §2.4: no authentication on /health
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(makeReq({ method: "GET", url: "/health" }), res);
      expect(statusCode()).toBe(200);
    });

    it("§2.4: GET /health response body is valid JSON with ok:true", () => {
      const { res, body } = makeRes();
      server.handleHttpRequest(makeReq({ method: "GET", url: "/health" }), res);
      const parsed = JSON.parse(body()) as Record<string, unknown>;
      expect(parsed["ok"]).toBe(true);
    });

    it("§2.1: POST /mcp without Bearer returns 401", () => {
      // req-hub §2.1: Authorization: Bearer required
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({ method: "POST", url: "/mcp" }),
        res,
      );
      expect(statusCode()).toBe(401);
    });

    it("§2.1: POST /mcp with wrong Bearer returns 401", () => {
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({ method: "POST", url: "/mcp", headers: { authorization: "Bearer wrong-token" } }),
        res,
      );
      expect(statusCode()).toBe(401);
    });

    it("§2.1: POST /mcp with valid Bearer but bad Origin returns 403", () => {
      // req-hub §2.1: Origin must be localhost if present
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({
          method: "POST",
          url: "/mcp",
          headers: {
            authorization: "Bearer test-bearer-token",
            origin: "http://evil.example.com",
          },
        }),
        res,
      );
      expect(statusCode()).toBe(403);
    });

    it("§2.1: POST /mcp with valid Bearer and localhost Origin is processed", () => {
      // Passes security check → proceeds to handleMcp (stub → throws, but status is not 401/403)
      const { res, statusCode } = makeRes();
      try {
        server.handleHttpRequest(
          makeReq({
            method: "POST",
            url: "/mcp",
            headers: {
              authorization: "Bearer test-bearer-token",
              origin: "http://localhost:3000",
            },
          }),
          res,
        );
      } catch {
        // handleMcp is a stub; not 401/403 means security passed
      }
      expect(statusCode()).not.toBe(401);
      expect(statusCode()).not.toBe(403);
    });

    it("§2.3: GET /instructions without Bearer returns 401", () => {
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({ method: "GET", url: "/instructions" }),
        res,
      );
      expect(statusCode()).toBe(401);
    });

    it("§2.3: GET /instructions with valid Bearer returns 200 and text/markdown", () => {
      // req-hub §2.3: returns rendered system prompt
      const { res, statusCode, getHeader } = makeRes();
      server.handleHttpRequest(
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
      server.handleHttpRequest(
        makeReq({
          method: "GET",
          url: "/instructions",
          headers: { authorization: "Bearer test-bearer-token" },
        }),
        res,
      );
      expect(body().length).toBeGreaterThan(0);
    });

    it("§2.6: POST /bridge/reauth without bridge secret returns 401", () => {
      // req-hub §2.6: x-accordo-secret header required
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({ method: "POST", url: "/bridge/reauth" }),
        res,
      );
      expect(statusCode()).toBe(401);
    });

    it("§2.6: POST /bridge/reauth with wrong secret returns 401", () => {
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({
          method: "POST",
          url: "/bridge/reauth",
          headers: { "x-accordo-secret": "wrong-secret" },
        }),
        res,
      );
      expect(statusCode()).toBe(401);
    });

    it("§2.6: POST /bridge/reauth with correct secret is processed (stub throws, not 401)", () => {
      const { res, statusCode } = makeRes();
      try {
        server.handleHttpRequest(
          makeReq({
            method: "POST",
            url: "/bridge/reauth",
            headers: { "x-accordo-secret": "test-bridge-secret" },
          }),
          res,
        );
      } catch {
        // handleReauth stub throws — auth passed
      }
      expect(statusCode()).not.toBe(401);
    });

    it("§2.1: unknown endpoint returns 404", () => {
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({ method: "GET", url: "/nonexistent" }),
        res,
      );
      expect(statusCode()).toBe(404);
    });
  });

  // ── updateToken ───────────────────────────────────────────────────────────

  describe("updateToken (§2.6: credential rotation)", () => {
    it("§2.6: updateToken changes the token used for Bearer auth — old token is rejected", () => {
      // After rotation, old token should fail auth
      server.updateToken("new-token");
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({
          method: "GET",
          url: "/instructions",
          headers: { authorization: "Bearer test-bearer-token" },
        }),
        res,
      );
      expect(statusCode()).toBe(401);
    });

    it("§2.6: updateToken — new token is accepted for Bearer auth", () => {
      server.updateToken("new-token");
      const { res, statusCode } = makeRes();
      server.handleHttpRequest(
        makeReq({
          method: "GET",
          url: "/instructions",
          headers: { authorization: "Bearer new-token" },
        }),
        res,
      );
      expect(statusCode()).toBe(200);
    });
  });

  // ── §2.1: Content-Type enforcement ───────────────────────────────────────

  describe("handleHttpRequest — §2.1 Content-Type enforcement", () => {
    it("§2.1: POST /mcp without Content-Type: application/json returns 415", () => {
      // req-hub §2.1: Content-Type must be application/json; missing → 415
      // RED on stub: handleMcp throws before content-type check → statusCode stays 200
      const { res, statusCode } = makeRes();
      try {
        server.handleHttpRequest(
          makeReq({
            method: "POST",
            url: "/mcp",
            headers: { authorization: "Bearer test-bearer-token" },
          }),
          res,
        );
      } catch { /* stub throws; after implementation content-type check runs first */ }
      expect(statusCode()).toBe(415);
    });

    it("§2.1: POST /mcp with Content-Type: text/plain returns 415", () => {
      const { res, statusCode } = makeRes();
      try {
        server.handleHttpRequest(
          makeReq({
            method: "POST",
            url: "/mcp",
            headers: {
              authorization: "Bearer test-bearer-token",
              "content-type": "text/plain",
            },
          }),
          res,
        );
      } catch { /* stub throws */ }
      expect(statusCode()).toBe(415);
    });
  });

  // ── §2.1: Mcp-Session-Id header ───────────────────────────────────────────

  describe("handleHttpRequest — §2.1 Mcp-Session-Id header", () => {
    it("§2.1: POST /mcp with valid auth and content-type is processed (not 401/403/415)", () => {
      // Passes all pre-flight checks; if handleMcp is implemented it returns Mcp-Session-Id
      // RED on stub: handleMcp throws → doesn't send Mcp-Session-Id
      const { res, statusCode } = makeRes();
      try {
        server.handleHttpRequest(
          makeReq({
            method: "POST",
            url: "/mcp",
            headers: {
              authorization: "Bearer test-bearer-token",
              "content-type": "application/json",
            },
          }),
          res,
        );
      } catch { /* stub throws */ }
      expect(statusCode()).not.toBe(401);
      expect(statusCode()).not.toBe(403);
      expect(statusCode()).not.toBe(415);
    });

    it("§2.1: Mcp-Session-Id header is set on initialize response", async () => {
      // Session is only created after the request body is successfully parsed,
      // so the test must provide a valid JSON body and await async processing.
      const { res, getHeader } = makeRes();
      server.handleHttpRequest(
        makeReq({
          method: "POST",
          url: "/mcp",
          headers: {
            authorization: "Bearer test-bearer-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "init-1",
            method: "initialize",
            params: {
              protocolVersion: "1",
              capabilities: {},
              clientInfo: { name: "test", version: "1" },
            },
          }),
        }),
        res,
      );
      // Wait for process.nextTick (stream delivery) + async mcpHandler.handleRequest
      await new Promise<void>((r) => setTimeout(r, 10));
      const sessionId = getHeader("mcp-session-id");
      expect(typeof sessionId).toBe("string");
      expect((sessionId ?? "").length).toBeGreaterThan(0);
    });

    it("§2.1: POST /mcp with unknown Mcp-Session-Id header returns 400", () => {
      // req-hub §2.1: if Mcp-Session-Id is provided but unknown → 400
      // RED on stub: handleMcp throws before session lookup
      const { res, statusCode } = makeRes();
      try {
        server.handleHttpRequest(
          makeReq({
            method: "POST",
            url: "/mcp",
            headers: {
              authorization: "Bearer test-bearer-token",
              "content-type": "application/json",
              "mcp-session-id": "unknown-session-11111",
            },
          }),
          res,
        );
      } catch { /* stub throws */ }
      expect(statusCode()).toBe(400);
    });
  });

  // ── §2.6: reauth body validation ─────────────────────────────────────────

  describe("handleHttpRequest — §2.6 reauth body validation", () => {
    it("§2.6: POST /bridge/reauth with valid secret but empty body returns 400", () => {
      // req-hub §2.6: body must have newToken + newSecret fields; missing → 400
      // RED on stub: handleReauth throws before body is parsed
      const { res, statusCode } = makeRes();
      try {
        server.handleHttpRequest(
          makeReq({
            method: "POST",
            url: "/bridge/reauth",
            headers: { "x-accordo-secret": "test-bridge-secret" },
          }),
          res,
        );
      } catch { /* stub throws */ }
      expect(statusCode()).toBe(400);
    });
  });

  // ── §2.3: Cache-Control on /instructions ─────────────────────────────────

  describe("handleHttpRequest — §2.3 Cache-Control", () => {
    it("§2.3: GET /instructions returns Cache-Control: no-cache", () => {
      // This is already implemented — should be GREEN
      const { res, getHeader } = makeRes();
      server.handleHttpRequest(
        makeReq({
          method: "GET",
          url: "/instructions",
          headers: { authorization: "Bearer test-bearer-token" },
        }),
        res,
      );
      expect(getHeader("cache-control")).toBe("no-cache");
    });
  });

  // ── start ─────────────────────────────────────────────────────────────────

  describe("start (§8: PID file, §2.4 server binding)", () => {
    it("§8: start() returns a promise", () => {
      const result = server.start();
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────────

  describe("stop (§8: graceful shutdown)", () => {
    it("§8: stop() returns a promise", () => {
      const result = server.stop();
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  // ── constructor options ───────────────────────────────────────────────────

  describe("constructor (§4.1 defaults)", () => {
    it("§4.1: accepts maxConcurrent override", () => {
      expect(new HubServer(makeOptions({ maxConcurrent: 4 }))).toBeDefined();
    });

    it("§4.1: accepts maxQueueDepth override", () => {
      expect(new HubServer(makeOptions({ maxQueueDepth: 8 }))).toBeDefined();
    });

    it("§4.1: accepts auditFile override", () => {
      expect(new HubServer(makeOptions({ auditFile: "/tmp/audit.jsonl" }))).toBeDefined();
    });

    it("§4.1: accepts logLevel override", () => {
      expect(new HubServer(makeOptions({ logLevel: "debug" }))).toBeDefined();
    });
  });
});

// ── M21: session error message contract (§6) ──────────────────────────────────

describe("HubServer — §6 session error message (M21)", () => {
  it("§6: POST /mcp with unknown mcp-session-id returns 'Invalid or expired session'", () => {
    // RED: current impl returns { error: "Unknown session" }
    const server = new HubServer(makeOptions());
    const { res, body, statusCode } = makeRes();

    server.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/mcp",
        headers: {
          authorization: "Bearer test-bearer-token",
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "mcp-session-id": "00000000-dead-beef-0000-000000000001",
        },
      }),
      res,
    );

    // Session check is synchronous — no await needed
    expect(statusCode()).toBe(400);
    const parsed = JSON.parse(body()) as { error: string };
    expect(parsed.error).toBe("Invalid or expired session");
  });
});

// ── M30-hub: /bridge/reauth persists token to tokenFilePath (§2.6) ───────────


const tmpTokenFile = path.join(os.tmpdir(), `accordo-test-token-${process.pid}.txt`);
afterAll(() => { try { fs.unlinkSync(tmpTokenFile); } catch { /* ignore */ } });

describe("HubServer — §2.6 handleReauth persists tokenFilePath (M30-hub)", () => {
  it("§2.6: POST /bridge/reauth writes new token to tokenFilePath", async () => {
    // RED: current handleReauth only updates in-memory token; doesn't write file
    const server = new HubServer(
      makeOptions({ tokenFilePath: tmpTokenFile }),
    );

    let resEndResolve: () => void;
    const resEnded = new Promise<void>((r) => { resEndResolve = r; });

    // Build a MockRes that resolves the promise when end() is called
    let status = 200;
    let responseBody = "";
    const capturedHeaders: Record<string, string | string[]> = {};
    const mockRes = {
      writeHead(code: number, headers?: Record<string, string>) {
        status = code;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            capturedHeaders[k.toLowerCase()] = v;
          }
        }
      },
      end(body?: string) {
        if (body) responseBody += body;
        resEndResolve();
      },
      getHeader(name: string) {
        return capturedHeaders[name.toLowerCase()] as string | undefined;
      },
      getHeaderNames: () => Object.keys(capturedHeaders),
      setHeader: (_name: string, _value: string) => {},
    } as unknown as import("node:http").ServerResponse;

    const body = JSON.stringify({ newToken: "rotated-token-abc", newSecret: "rotated-secret-xyz" });

    server.handleHttpRequest(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: {
          "x-accordo-secret": "test-bridge-secret",
          "content-type": "application/json",
        },
        body,
      }),
      mockRes,
    );

    await resEnded;
    expect(status).toBe(200);

    // File should now contain the new token
    const written = fs.existsSync(tmpTokenFile)
      ? fs.readFileSync(tmpTokenFile, "utf8").trim()
      : null;
    expect(written).toBe("rotated-token-abc");
    // Suppress unused vars warning from captured locals
    void responseBody;
  });
});

// ── M43: /state commentThreads enrichment ────────────────────────────────────

describe("HubServer — §2.7-M43: /state commentThreads enrichment", () => {
  it("§2.7-M43: GET /state hoists threads to top-level commentThreads when present in accordo-comments modality", () => {
    // req-hub §2.7-M43: commentThreads field added when modality has threads array
    const server43 = new HubServer(makeOptions());
    const cache = (server43 as unknown as { stateCache: StateCache }).stateCache;
    cache.applyPatch({
      modalities: {
        "accordo-comments": {
          isOpen: true,
          openThreadCount: 1,
          resolvedThreadCount: 0,
          summary: [],
          threads: [
            {
              id: "t1",
              status: "open",
              anchor: { kind: "text", uri: "src/foo.ts", range: { startLine: 1, startChar: 0, endLine: 1, endChar: 0 }, docVersion: 1 },
              comments: [],
              createdAt: "2026-01-01T00:00:00Z",
              lastActivity: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    });
    const { res, body, statusCode } = makeRes();
    server43.handleHttpRequest(
      makeReq({ method: "GET", url: "/state", headers: { authorization: "Bearer test-bearer-token" } }),
      res,
    );
    expect(statusCode()).toBe(200);
    const parsed = JSON.parse(body()) as Record<string, unknown>;
    expect(Array.isArray(parsed["commentThreads"])).toBe(true);
    expect((parsed["commentThreads"] as unknown[]).length).toBe(1);
  });

  it("§2.7-M43: GET /state omits commentThreads when accordo-comments modality absent", () => {
    // req-hub §2.7-M43: no commentThreads field when modality not present
    const server43 = new HubServer(makeOptions());
    const { res, body, statusCode } = makeRes();
    server43.handleHttpRequest(
      makeReq({ method: "GET", url: "/state", headers: { authorization: "Bearer test-bearer-token" } }),
      res,
    );
    expect(statusCode()).toBe(200);
    const parsed = JSON.parse(body()) as Record<string, unknown>;
    expect(parsed["commentThreads"]).toBeUndefined();
  });

  it("§2.7-M43: GET /state omits commentThreads when accordo-comments modality has no threads field", () => {
    // req-hub §2.7-M43: no threads field in modality → no hoisting
    const server43 = new HubServer(makeOptions());
    const cache = (server43 as unknown as { stateCache: StateCache }).stateCache;
    cache.applyPatch({
      modalities: {
        "accordo-comments": {
          isOpen: true,
          openThreadCount: 0,
          resolvedThreadCount: 0,
          summary: [],
        },
      },
    });
    const { res, body, statusCode } = makeRes();
    server43.handleHttpRequest(
      makeReq({ method: "GET", url: "/state", headers: { authorization: "Bearer test-bearer-token" } }),
      res,
    );
    expect(statusCode()).toBe(200);
    const parsed = JSON.parse(body()) as Record<string, unknown>;
    expect(parsed["commentThreads"]).toBeUndefined();
  });
});
