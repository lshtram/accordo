/**
 * Tests for bridge-server.ts
 * Requirements: requirements-hub.md §2.5, §5.4, §9 (CONC-01 to CONC-07)
 *
 * Note: Full WS lifecycle tests (connect/disconnect/invoke/reconnect) are
 * integration tests tracked in requirements-hub.md §11 under "Integration:
 * WebSocket lifecycle". The unit tests here cover:
 *   - Initial state of the server before any connection
 *   - Concurrency tracking logic (CONC-01 to CONC-07)
 *   - Configuration defaults
 *   - Secret rotation (updateSecret)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_MAX_CONCURRENT_INVOCATIONS,
  DEFAULT_MAX_QUEUE_DEPTH,
} from "@accordo/bridge-types";
import { BridgeServer } from "../bridge-server.js";
import { JsonRpcError } from "../errors.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("Concurrency constants", () => {
  it("CONC-02: DEFAULT_MAX_CONCURRENT_INVOCATIONS is 16", () => {
    expect(DEFAULT_MAX_CONCURRENT_INVOCATIONS).toBe(16);
  });

  it("CONC-03: DEFAULT_MAX_QUEUE_DEPTH is 64", () => {
    expect(DEFAULT_MAX_QUEUE_DEPTH).toBe(64);
  });
});

// ── BridgeServer ──────────────────────────────────────────────────────────────

describe("BridgeServer", () => {
  let server: BridgeServer;

  beforeEach(() => {
    server = new BridgeServer({
      secret: "test-secret",
      maxConcurrent: 16,
      maxQueueDepth: 64,
    });
  });

  // ── isConnected ───────────────────────────────────────────────────────────

  describe("isConnected", () => {
    it("§5.4: isConnected returns false before any Bridge connects", () => {
      // req-hub §5.4: isConnected() → boolean
      expect(server.isConnected()).toBe(false);
    });
  });

  // ── getConcurrencyStats ───────────────────────────────────────────────────

  describe("getConcurrencyStats", () => {
    it("CONC-01: getConcurrencyStats initial inflight=0, queued=0", () => {
      // CONC-01: Hub maintains an in-flight counter
      const stats = server.getConcurrencyStats();
      expect(stats.inflight).toBe(0);
      expect(stats.queued).toBe(0);
    });

    it("CONC-02: getConcurrencyStats reports the configured limit", () => {
      // CONC-02: limit is from ACCORDO_MAX_CONCURRENT_INVOCATIONS
      const stats = server.getConcurrencyStats();
      expect(stats.limit).toBe(16);
    });

    it("CONC-02: defaults to DEFAULT_MAX_CONCURRENT_INVOCATIONS when maxConcurrent omitted", () => {
      const defaultServer = new BridgeServer({ secret: "s" });
      expect(defaultServer.getConcurrencyStats().limit).toBe(DEFAULT_MAX_CONCURRENT_INVOCATIONS);
    });

    it("CONC-02: custom maxConcurrent is reflected in concurrency stats limit", () => {
      const custom = new BridgeServer({ secret: "s", maxConcurrent: 4 });
      expect(custom.getConcurrencyStats().limit).toBe(4);
    });
  });

  // ── invoke — no Bridge connected ──────────────────────────────────────────

  describe("invoke", () => {
    it("§6: invoke rejects with error when Bridge is not connected", async () => {
      // req-hub §6: "Bridge not connected → { code: -32603, message: 'Bridge not connected' }"
      await expect(
        server.invoke("accordo.editor.open", { path: "/foo.ts" }, 5000)
      ).rejects.toThrow();
    });

    it("CONC-04: invoke with maxQueueDepth=0 rejects immediately — queue full", async () => {
      // CONC-04: If queue is full, Hub immediately returns MCP error -32004.
      // Queue-full is checked before the connection check so it fires even
      // without a live Bridge connection (maxConcurrent=0 means no capacity).
      const tightServer = new BridgeServer({ secret: "s", maxConcurrent: 0, maxQueueDepth: 0 });
      try {
        await tightServer.invoke("accordo.editor.open", {}, 5000);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(JsonRpcError);
        expect((e as JsonRpcError).code).toBe(-32004);
      }
    });
  });

  describe("cancel", () => {
    it("CONC-06: cancel does not throw for an unrecognised invocation ID", () => {
      // CONC-06: Cancelled invocations that have been forwarded still occupy an in-flight slot.
      // cancel() on a disconnected / no-such-id server must be a silent no-op.
      expect(() => server.cancel("nonexistent-invocation-id")).not.toThrow();
    });

    it("CONC-06: cancel does not throw when called with an empty string ID", () => {
      expect(() => server.cancel("")).not.toThrow();
    });
  });

  describe("requestState", () => {
    it("§5.4: requestState rejects when no Bridge is connected", async () => {
      // req-hub §5.4: requestState() → Promise<IDEState>
      await expect(server.requestState()).rejects.toThrow();
    });
  });

  describe("close", () => {
    it("§5.4: close returns a promise", () => {
      // req-hub §5.4: close() → Promise<void>
      const result = server.close();
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  describe("updateSecret", () => {
    it("§2.6: updateSecret does not throw with a new secret value", () => {
      // req-hub §2.6: Hub atomically updates secret in memory
      expect(() => server.updateSecret("new-secret-value")).not.toThrow();
    });

    it("§2.6: updateSecret accepts any non-empty string", () => {
      expect(() => server.updateSecret("totally-different-secret-123")).not.toThrow();
    });
  });

  // ── onRegistryUpdate / onStateUpdate callbacks ────────────────────────────

  describe("onRegistryUpdate", () => {
    it("§5.4: onRegistryUpdate registers callback without throwing", () => {
      expect(() => server.onRegistryUpdate((_tools) => {})).not.toThrow();
    });
  });

  describe("onStateUpdate", () => {
    it("§5.4: onStateUpdate registers callback without throwing", () => {
      expect(() => server.onStateUpdate((_patch) => {})).not.toThrow();
    });
  });

  // ── validateProtocolVersion ───────────────────────────────────────────────

  describe("validateProtocolVersion", () => {
    it("§5.4: validateProtocolVersion returns true for matching version", () => {
      // req-hub §5.4: compare received version against ACCORDO_PROTOCOL_VERSION
      expect(server.validateProtocolVersion("1")).toBe(true);
    });

    it("§5.4: validateProtocolVersion returns false for mismatched version", () => {
      // Close WS with 4002 on mismatch per §5.4
      expect(server.validateProtocolVersion("0")).toBe(false);
      expect(server.validateProtocolVersion("2")).toBe(false);
    });

    it("§5.4: validateProtocolVersion returns false for empty string", () => {
      expect(server.validateProtocolVersion("")).toBe(false);
    });
  });
});
