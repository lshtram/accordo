/**
 * Tests for checkHubHealth() — HLTH-10..HLTH-12
 *
 * Phase B: checkHubHealth has no injectable deps seam; use vi.spyOn(http, "get")
 * to wrap the real node:http.get so we can simulate status codes and connection
 * errors and verify the boolean return contract.
 *
 * PASS-ELIGIBLE-IN-B (registered):
 *   HLTH-11 — stub returns false for 503; real impl also returns false for non-2xx
 *   HLTH-12 — stub returns false for ECONNREFUSED; real impl also returns false on connection errors
 *
 * Non-pass-eligible (RED at assertion):
 *   HLTH-10 — stub returns false for 200; real impl must return true
 *
 * API checklist:
 *   checkHubHealth(port)  [3 tests: HLTH-10, HLTH-11, HLTH-12]
 *
 * Requirements: requirements-bridge.md §4 (LCM-13)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";

import { checkHubHealth } from "../../hub-health-read.js";

// Real EventEmitter for the mock response so res.on()/res.emit() work correctly.
import { EventEmitter } from "node:events";

const HEALTH_JSON = JSON.stringify({ ok: true, uptime: 5, bridge: "connected", toolCount: 3, protocolVersion: "1.0.0", inflight: 0, queued: 0 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkHubHealth — HLTH-10..HLTH-12", () => {

  // HLTH-10: vi.spyOn wraps the real http.get. The mock calls its callback
  // inside setImmediate, AFTER handleResponse has registered 'data'/'end' listeners.
  // Those listeners are registered via res.on() on a real EventEmitter, so when
  // the test calls res.emit() they fire synchronously and run the production
  // parsing pipeline.
  it("HLTH-10: returns true when Hub responds 200 (non-pass-eligible)", async () => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = 200;

    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getSpy = vi.spyOn(http, "get").mockImplementation((...args: unknown[]) => {
      // Find the callback argument (second param or first if it's a function)
      const cb = typeof args[0] === "function" ? args[0] as (r: http.IncomingMessage) => void : args[1] as (r: http.IncomingMessage) => void | undefined;
      // Call cb asynchronously so handleResponse registers data/end listeners first.
      if (cb) setImmediate(() => { cb(res as unknown as http.IncomingMessage); });
      return req as unknown as http.ClientRequest;
    });

    const healthPromise = checkHubHealth(3000);

    // Emit AFTER handleResponse has registered listeners.
    // The setImmediate queue: (1) cb() → handleResponse registers listeners,
    // (2) res.emit() → listeners fire.
    setImmediate(() => {
      res.emit("data", Buffer.from(HEALTH_JSON));
      res.emit("end");
    });

    const result = await healthPromise;
    getSpy.mockRestore();
    expect(result).toBe(true); // stub false → RED, real true → GREEN
  });

  // HLTH-11: PASS-ELIGIBLE-IN-B — stub returns false for 503 AND real impl also
  // returns false for non-2xx; cannot distinguish stub from real in Phase B.
  // Serves as regression guard + error-seam verification.
  it("HLTH-11: pass-eligible-in-B — returns false when Hub responds non-200", async () => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = 503;

    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getSpy = vi.spyOn(http, "get").mockImplementation((...args: unknown[]) => {
      const cb = typeof args[0] === "function" ? args[0] as (r: http.IncomingMessage) => void : args[1] as (r: http.IncomingMessage) => void | undefined;
      if (cb) setImmediate(() => { cb(res as unknown as http.IncomingMessage); });
      return req as unknown as http.ClientRequest;
    });

    const result = await checkHubHealth(3000);
    getSpy.mockRestore();
    expect(result).toBe(false); // passes only when real impl handles non-200 correctly
  });

  // HLTH-12: PASS-ELIGIBLE-IN-B — stub returns false for ECONNREFUSED AND real impl
  // also returns false on connection errors; assertion matches stub, cannot
  // distinguish in Phase B. Serves as regression guard + error-seam verification.
  it("HLTH-12: pass-eligible-in-B — returns false when connection is refused", async () => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getSpy = vi.spyOn(http, "get").mockImplementation((..._args: unknown[]) => {
      // Simulate connection error: req emits 'error' instead of calling cb.
      setImmediate(() => { req.emit("error", new Error("ECONNREFUSED")); });
      return req as unknown as http.ClientRequest;
    });

    const result = await checkHubHealth(3000);
    getSpy.mockRestore();
    expect(result).toBe(false); // passes only when real impl handles connection errors correctly
  });
});
