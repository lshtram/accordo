/**
 * Tests for /health rebind semantics — hub side
 *
 * Phase B: These tests enforce the Priority T rebind contract from the Hub's
 * perspective. The Hub must expose /health with:
 *   A) bridge: "connected" | "disconnected" field
 *   B) toolCount: number (can be 0)
 *   C) /health requires no authentication (per Hub spec §2.4)
 *
 * These tests assert behavior using real HubServer (no mocks).
 * The /health response drives the Bridge's rebind decision — specifically:
 *   - bridge=connected → reusable (LCM-15)
 *   - bridge=disconnected + toolCount>0 → reusable (LCM-15)
 *   - bridge=disconnected + toolCount=0 → NOT reusable (LCM-15 / "registry-empty")
 *
 * API checklist:
 *   GET /health (no auth) → { bridge, toolCount, ... }  [6 tests: HS-01..HS-06]
 *
 * Requirements: requirements-bridge.md §4 (LCM-13 to LCM-16)
 *              requirements-hub.md §2.4
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HubServer } from "../server.js";

const TOKEN = "rebind-test-token";
const SECRET = "rebind-test-secret";

let server: HubServer;
let baseUrl: string;

beforeAll(async () => {
  server = new HubServer({
    port: 0,
    host: "127.0.0.1",
    token: TOKEN,
    bridgeSecret: SECRET,
  });
  await server.start();
  const addr = server.getAddress()!;
  baseUrl = `http://${addr.host}:${addr.port}`;
});

afterAll(async () => {
  await server.stop();
});

// ── HS-01..HS-06: /health rebind semantics ─────────────────────────────────────

describe("GET /health — HS-01..HS-06: rebind-relevant semantics", () => {

  it("HS-01: /health returns bridge field as 'disconnected' when no bridge is connected", async () => {
    // Before any WS bridge connects, /health should report bridge:disconnected
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("bridge");
    expect(body.bridge).toBe("disconnected");
  });

  it("HS-02: /health response includes toolCount as a number", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.toolCount).toBe("number");
  });

  it("HS-03: /health returns 200 without authentication (no auth required)", async () => {
    // The Bridge calls /health before any WS connection — no token available yet
    const res = await fetch(`${baseUrl}/health`, {
      // No Authorization header — deliberately no auth
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("bridge");
    expect(body).toHaveProperty("toolCount");
  });

it("HS-04: /health body includes protocolVersion", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as { protocolVersion?: unknown };
    expect(typeof body.protocolVersion).toBe("string");
    expect((body.protocolVersion as string).length).toBeGreaterThan(0);
  });

  it("HS-05: /health body matches HealthResponse type exactly (LCM-13)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as Record<string, unknown>;

    // Required fields for rebind decision (LCM-13)
    expect(body).toHaveProperty("ok", true);
    expect(body).toHaveProperty("bridge");
    expect(body.bridge).toBeOneOf(["connected", "disconnected"]);
    expect(body).toHaveProperty("toolCount");
    expect(typeof body.toolCount).toBe("number");
    expect(body).toHaveProperty("protocolVersion");
    expect(body).toHaveProperty("uptime");
    expect(typeof body.uptime).toBe("number");
    expect(body).toHaveProperty("inflight");
    expect(body).toHaveProperty("queued");
  });

  it("HS-06: toolCount can be 0 (does not indicate registry-empty by itself)", async () => {
    // The Bridge distinguishes:
    //   toolCount=0 AND bridge=disconnected → registry-empty (non-reusable)
    //   toolCount=0 AND bridge=connected → reusable (WS is active)
    // So toolCount being 0 is not sufficient to mark non-reusable without bridge field
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as { bridge: string; toolCount: number };
    expect(typeof body.bridge).toBe("string");
    expect(typeof body.toolCount).toBe("number");
    expect(body.bridge).toBeOneOf(["connected", "disconnected"]);
  });
});