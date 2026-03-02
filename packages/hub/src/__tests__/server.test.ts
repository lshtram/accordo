/**
 * Tests for server.ts (HubServer + /health)
 * Requirements: requirements-hub.md §2.4, §8
 *
 * Week 1 Module #7: Hub server wiring + /health endpoint
 *
 * Integration-level tests (start, bind, PID file) are deferred to Week 2.
 * Unit tests here cover:
 *   - HealthResponse shape and defaults before start
 *   - getHealth() field values on an unstarted server
 */

import { describe, it, expect, beforeEach } from "vitest";
import { HubServer } from "../server.js";
import type { HubServerOptions } from "../server.js";

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

// ── HubServer ─────────────────────────────────────────────────────────────────

describe("HubServer", () => {
  let server: HubServer;

  beforeEach(() => {
    server = new HubServer(makeOptions());
  });

  // ── getHealth ─────────────────────────────────────────────────────────────

  describe("getHealth (§2.4: GET /health response shape)", () => {
    it("§2.4: returns ok: true", () => {
      // req-hub §2.4: { "ok": true, ... }
      const health = server.getHealth();
      expect(health.ok).toBe(true);
    });

    it("§2.4: returns uptime as a non-negative number", () => {
      // req-hub §2.4: uptime in seconds
      const health = server.getHealth();
      expect(typeof health.uptime).toBe("number");
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it("§2.4: returns bridge: 'disconnected' before any Bridge connects", () => {
      // req-hub §2.4: bridge field is 'connected' | 'disconnected'
      const health = server.getHealth();
      expect(health.bridge).toBe("disconnected");
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

    it("§2.4: returns all seven required fields with no extras missing", () => {
      // req-hub §2.4: exact shape { ok, uptime, bridge, toolCount, protocolVersion, inflight, queued }
      const health = server.getHealth();
      expect(health).toHaveProperty("ok");
      expect(health).toHaveProperty("uptime");
      expect(health).toHaveProperty("bridge");
      expect(health).toHaveProperty("toolCount");
      expect(health).toHaveProperty("protocolVersion");
      expect(health).toHaveProperty("inflight");
      expect(health).toHaveProperty("queued");
    });

    it("§2.4: toolCount is 0 before any tool registry update", () => {
      // No tools registered yet on fresh server
      const health = server.getHealth();
      expect(health.toolCount).toBe(0);
    });

    it("§2.4: inflight is 0 before any invocations", () => {
      const health = server.getHealth();
      expect(health.inflight).toBe(0);
    });

    it("§2.4: queued is 0 before any invocations", () => {
      const health = server.getHealth();
      expect(health.queued).toBe(0);
    });
  });

  // ── start ─────────────────────────────────────────────────────────────────

  describe("start (§8: PID file, §2.4 server binding)", () => {
    it("§8: start() returns a promise", () => {
      // req-hub §8: start() → Promise<void>
      const result = server.start();
      expect(result).toBeInstanceOf(Promise);
      // Prevent unhandled rejection from the stub throw
      result.catch(() => {});
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────────

  describe("stop (§8: graceful shutdown)", () => {
    it("§8: stop() returns a promise", () => {
      // req-hub §8: stop() → Promise<void>
      const result = server.stop();
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  // ── constructor options ───────────────────────────────────────────────────

  describe("constructor (§4.1 defaults)", () => {
    it("§4.1: accepts maxConcurrent override", () => {
      const s = new HubServer(makeOptions({ maxConcurrent: 4 }));
      expect(s).toBeDefined();
    });

    it("§4.1: accepts maxQueueDepth override", () => {
      const s = new HubServer(makeOptions({ maxQueueDepth: 8 }));
      expect(s).toBeDefined();
    });

    it("§4.1: accepts auditFile override", () => {
      const s = new HubServer(makeOptions({ auditFile: "/tmp/audit.jsonl" }));
      expect(s).toBeDefined();
    });

    it("§4.1: accepts logLevel override", () => {
      const s = new HubServer(makeOptions({ logLevel: "debug" }));
      expect(s).toBeDefined();
    });
  });
});
