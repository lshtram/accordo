/**
 * Tests for server-reauth.ts (createReauthHandler)
 * Requirements: requirements-hub.md §2.6
 *
 * API checklist:
 * ✓ createReauthHandler() — 1 structural test
 * ✓ ReauthHandler.handleReauth() — 11 tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import type http from "node:http";
import { createReauthHandler } from "../server-reauth.js";
import type { ReauthDeps } from "../server-reauth.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeReauthDeps(): ReauthDeps {
  return {
    updateToken: vi.fn(),
    updateBridgeSecret: vi.fn(),
    updateOptionsBridgeSecret: vi.fn(),
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
    url: opts.url ?? "/bridge/reauth",
    headers: opts.headers ?? {},
  }) as unknown as http.IncomingMessage;
}

// Mock ServerResponse
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

// ── createReauthHandler ─────────────────────────────────────────────────────

describe("createReauthHandler", () => {
  it("returns a ReauthHandler with handleReauth method", () => {
    const deps = makeReauthDeps();
    const handler = createReauthHandler(deps);
    expect(typeof handler.handleReauth).toBe("function");
  });
});

// ── ReauthHandler.handleReauth ───────────────────────────────────────────────

describe("ReauthHandler.handleReauth — body validation (§2.6)", () => {
  let handler: ReturnType<typeof createReauthHandler>;
  let deps: ReauthDeps;

  beforeEach(() => {
    deps = makeReauthDeps();
    handler = createReauthHandler(deps);
  });

  it("returns 400 when Content-Type is missing", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: {},
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
  });

  it("returns 400 when Content-Type is not application/json", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "text/plain" },
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: "not json{",
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
  });

  it("returns 400 when newToken is missing from body", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newSecret: "secret-value" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
  });

  it("returns 400 when newSecret is missing from body", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: "token-value" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
  });

  it("with valid body calls updateToken, updateBridgeSecret, and updateOptionsBridgeSecret", async () => {
    const { res } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: "rotated-token-xyz", newSecret: "rotated-secret-xyz" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(deps.updateToken).toHaveBeenCalledWith("rotated-token-xyz");
    expect(deps.updateBridgeSecret).toHaveBeenCalledWith("rotated-secret-xyz");
    expect(deps.updateOptionsBridgeSecret).toHaveBeenCalledWith("rotated-secret-xyz");
  });

  it("with valid body returns 200 and empty JSON object", async () => {
    const { res, statusCode, body } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: "new-token", newSecret: "new-secret" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(200);
    expect(body()).toBe("{}");
  });

  it("with valid body passes strings (not numbers or objects) to update functions", async () => {
    const { res } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: "my-token", newSecret: "my-secret" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    // Ensure the values passed are strings
    const tokenArg = (deps.updateToken as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const secretArg = (deps.updateBridgeSecret as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof tokenArg).toBe("string");
    expect(typeof secretArg).toBe("string");
  });

  it("invalid JSON body does NOT call updateToken/updateBridgeSecret/updateOptionsBridgeSecret", async () => {
    const { res } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: "not valid json{",
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(deps.updateToken).not.toHaveBeenCalled();
    expect(deps.updateBridgeSecret).not.toHaveBeenCalled();
    expect(deps.updateOptionsBridgeSecret).not.toHaveBeenCalled();
  });

  it("missing newToken does NOT call any update callback", async () => {
    const { res } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newSecret: "secret-value" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(deps.updateToken).not.toHaveBeenCalled();
    expect(deps.updateBridgeSecret).not.toHaveBeenCalled();
    expect(deps.updateOptionsBridgeSecret).not.toHaveBeenCalled();
  });

  it("missing newSecret does NOT call any update callback", async () => {
    const { res } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: "token-value" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(deps.updateToken).not.toHaveBeenCalled();
    expect(deps.updateBridgeSecret).not.toHaveBeenCalled();
    expect(deps.updateOptionsBridgeSecret).not.toHaveBeenCalled();
  });

  it("newToken as number (non-string) is rejected with 400", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: 123, newSecret: "valid-secret" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
    expect(deps.updateToken).not.toHaveBeenCalled();
  });

  it("newSecret as object (non-string) is rejected with 400", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: "valid-token", newSecret: {} }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
    expect(deps.updateBridgeSecret).not.toHaveBeenCalled();
  });

  it("newToken as boolean (non-string) is rejected with 400", async () => {
    const { res, statusCode } = makeRes();
    handler.handleReauth(
      makeReq({
        method: "POST",
        url: "/bridge/reauth",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newToken: true, newSecret: "valid-secret" }),
      }),
      res,
    );
    await new Promise<void>(r => setTimeout(r, 10));
    expect(statusCode()).toBe(400);
    expect(deps.updateToken).not.toHaveBeenCalled();
  });
});
