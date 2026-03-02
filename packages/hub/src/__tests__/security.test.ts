/**
 * Tests for security.ts
 * Requirements: requirements-hub.md §2.1 (Origin, Bearer), §5.6
 */

import { describe, it, expect } from "vitest";
import type http from "node:http";
import {
  validateOrigin,
  validateBearer,
  validateBridgeSecret,
  generateToken,
} from "../security.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(
  headers: Record<string, string>,
): http.IncomingMessage {
  return { headers } as unknown as http.IncomingMessage;
}

// ── validateOrigin ────────────────────────────────────────────────────────────

describe("validateOrigin", () => {
  it("§2.1: no Origin header present — non-browser client passes", () => {
    // req-hub §2.1: non-browser agents have no Origin header → must be allowed
    const req = makeReq({});
    expect(validateOrigin(req)).toBe(true);
  });

  it("§2.1: http://localhost (no port) passes", () => {
    const req = makeReq({ origin: "http://localhost" });
    expect(validateOrigin(req)).toBe(true);
  });

  it("§2.1: http://localhost with port passes", () => {
    const req = makeReq({ origin: "http://localhost:3000" });
    expect(validateOrigin(req)).toBe(true);
  });

  it("§2.1: http://127.0.0.1 (no port) passes", () => {
    const req = makeReq({ origin: "http://127.0.0.1" });
    expect(validateOrigin(req)).toBe(true);
  });

  it("§2.1: http://127.0.0.1 with port passes", () => {
    const req = makeReq({ origin: "http://127.0.0.1:3000" });
    expect(validateOrigin(req)).toBe(true);
  });

  it("§2.1: external domain Origin rejected — DNS rebinding protection", () => {
    // req-hub §2.1: "Reject if Origin header present and not localhost/127.0.0.1"
    const req = makeReq({ origin: "http://evil.example.com" });
    expect(validateOrigin(req)).toBe(false);
  });

  it("§2.1: https://localhost Origin rejected — Hub is HTTP-only on loopback", () => {
    const req = makeReq({ origin: "https://localhost" });
    expect(validateOrigin(req)).toBe(false);
  });

  it("§2.1: empty Origin string rejected", () => {
    const req = makeReq({ origin: "" });
    expect(validateOrigin(req)).toBe(false);
  });

  it("§2.1: localhost-prefix external origin rejected — prefix attack prevention", () => {
    const req = makeReq({ origin: "http://localhost.evil.com" });
    expect(validateOrigin(req)).toBe(false);
  });
});

// ── validateBearer ────────────────────────────────────────────────────────────

describe("validateBearer", () => {
  const TOKEN = "test-secret-token-abc123";

  it("§2.1: correct Bearer token accepted", () => {
    // req-hub §2.1: "Authorization: Bearer <ACCORDO_TOKEN> required. 401 if missing/invalid."
    const req = makeReq({ authorization: `Bearer ${TOKEN}` });
    expect(validateBearer(req, TOKEN)).toBe(true);
  });

  it("§2.1: wrong Bearer token rejected with 401", () => {
    const req = makeReq({ authorization: "Bearer wrong-token" });
    expect(validateBearer(req, TOKEN)).toBe(false);
  });

  it("§2.1: absent Authorization header rejected with 401", () => {
    const req = makeReq({});
    expect(validateBearer(req, TOKEN)).toBe(false);
  });

  it("§2.1: token without Bearer prefix rejected", () => {
    const req = makeReq({ authorization: TOKEN });
    expect(validateBearer(req, TOKEN)).toBe(false);
  });

  it("§2.1: lowercase 'bearer' capitalisation rejected", () => {
    const req = makeReq({ authorization: `bearer ${TOKEN}` });
    expect(validateBearer(req, TOKEN)).toBe(false);
  });

  it("§2.1: empty Authorization header rejected", () => {
    const req = makeReq({ authorization: "" });
    expect(validateBearer(req, TOKEN)).toBe(false);
  });

  it("§2.1: token with trailing whitespace rejected — exact match required", () => {
    const req = makeReq({ authorization: `Bearer ${TOKEN} ` });
    expect(validateBearer(req, TOKEN)).toBe(false);
  });
});

// ── validateBridgeSecret ─────────────────────────────────────────────────────

describe("validateBridgeSecret", () => {
  const SECRET = "bridge-secret-xyz-789";

  it("§2.5: correct x-accordo-secret header accepted", () => {
    // req-hub §2.5: "x-accordo-secret header validated on upgrade"
    const req = makeReq({ "x-accordo-secret": SECRET });
    expect(validateBridgeSecret(req, SECRET)).toBe(true);
  });

  it("§2.5: wrong x-accordo-secret value rejected", () => {
    const req = makeReq({ "x-accordo-secret": "wrong-secret" });
    expect(validateBridgeSecret(req, SECRET)).toBe(false);
  });

  it("§2.5: absent x-accordo-secret header rejected", () => {
    const req = makeReq({});
    expect(validateBridgeSecret(req, SECRET)).toBe(false);
  });

  it("§2.5: empty x-accordo-secret value rejected", () => {
    const req = makeReq({ "x-accordo-secret": "" });
    expect(validateBridgeSecret(req, SECRET)).toBe(false);
  });

  it("§2.5: x-accordo-secret with extra whitespace rejected", () => {
    const req = makeReq({ "x-accordo-secret": `${SECRET} ` });
    expect(validateBridgeSecret(req, SECRET)).toBe(false);
  });
});

// ── generateToken ─────────────────────────────────────────────────────────────

describe("generateToken", () => {
  it("§5.6: generateToken returns a non-empty string", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("§5.6: token is at least 32 characters long — entropy requirement", () => {
    // UUID v4 is 36 chars; we expect at least that
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("§5.6: each call to generateToken returns a unique value", () => {
    const a = generateToken();
    const b = generateToken();
    const c = generateToken();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it("§5.6: token contains only printable safe characters", () => {
    const token = generateToken();
    expect(/^[\x21-\x7E]+$/.test(token)).toBe(true);
  });
});
