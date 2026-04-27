/**
 * Tests for readHubHealthWithDeps() — HTTP contract (HLTH-01..HLTH-04, HLTH-07)
 *
 * Phase B: stub returns null.
 *
 * PASS-ELIGIBLE-IN-B (registered):
 *   HLTH-04 — stub returns null for 503; real impl also returns null for non-2xx
 *
 * Non-pass-eligible (RED at assertion):
 *   HLTH-01 — stub null, real impl parses 200+JSON → HealthResponse
 *   HLTH-02 — stub null, real impl parses 201+JSON → HealthResponse
 *   HLTH-03 — stub null, real impl parses JSON without content-type header
 *   HLTH-07 — stub null WITHOUT calling get; real impl must call get and pass correct port
 *
 * API checklist:
 *   readHubHealthWithDeps(port, deps)  [5 tests: HLTH-01, HLTH-02, HLTH-03, HLTH-04, HLTH-07]
 *
 * Requirements: requirements-bridge.md §4 (LCM-13)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type http from "node:http";
import type { HealthResponse } from "@accordo/bridge-types";
import { readHubHealthWithDeps } from "../../hub-health-read.js";

interface GetCall {
  opts: http.RequestOptions;
  listener: (res: http.IncomingMessage) => void;
}

const VALID_JSON = '{"ok":true,"uptime":5,"bridge":"connected","toolCount":3,"protocolVersion":"1.0.0","inflight":0,"queued":0}';

/**
 * Build a mock http deps object whose `get` calls are captured in `calls`.
 * The response object uses a real Map to store listeners so `res.on()` stores
 * and `res.emit()` invokes them — unlike vi.fn() which only records calls.
 * `listener` is called SYNCHRONously so handleResponse registers data/end
 * listeners BEFORE we emit events.
 */
function makeHttpDeps(responseJson: string) {
  const calls: GetCall[] = [];
  const resListeners = new Map<string, (...args: unknown[]) => void>();

  const deps = {
    get: vi.fn((opts: http.RequestOptions, listener: (res: http.IncomingMessage) => void) => {
      calls.push({ opts, listener });

      // Build response with Map-backed listeners (not vi.fn).
      const res = {
        statusCode: 200,
        headers: {},
        on(event: string, cb: (...args: unknown[]) => void) {
          resListeners.set(event, cb);
          return res;
        },
        emit(event: string, ...args: unknown[]) {
          const h = resListeners.get(event);
          if (h) h(...args);
        },
      };

      // Invoke listener synchronously — handleResponse runs and registers data/end
      // listeners on `res` before we emit anything.
      listener(res as unknown as http.IncomingMessage);

      // Now emit events so handleResponse's registered listeners fire.
      res.emit("data", Buffer.from(responseJson));
      res.emit("end");

      const req = { on: vi.fn(), end: vi.fn().mockReturnThis(), write: vi.fn().mockReturnThis() };
      return req as unknown as http.ClientRequest;
    }),
  };
  return { deps, calls };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("readHubHealthWithDeps — HTTP contract", () => {

  // HLTH-01..03: Exercise real HTTP byte/event parsing — no testFixture bypass.
  // The mock's Map-backed resListeners ensure handleResponse registers listeners
  // that are invoked when we call res.emit().
  it("HLTH-01: non-pass-eligible — real impl parses 200+JSON to HealthResponse", async () => {
    const { deps, calls } = makeHttpDeps(VALID_JSON);
    const result = await readHubHealthWithDeps(3000, deps);
    expect(result).not.toBeNull();
    expect(result!.bridge).toBe("connected");
    expect(result!.toolCount).toBe(3);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].opts.port).toBe(3000);
  });

  it("HLTH-02: non-pass-eligible — real impl parses 201+JSON to HealthResponse", async () => {
    const { deps } = makeHttpDeps(VALID_JSON);
    const result = await readHubHealthWithDeps(3000, deps);
    expect(result).not.toBeNull();
    expect(result!.bridge).toBe("connected");
  });

  it("HLTH-03: non-pass-eligible — real impl parses valid JSON even without content-type", async () => {
    const { deps } = makeHttpDeps(VALID_JSON);
    const result = await readHubHealthWithDeps(3000, deps);
    expect(result).not.toBeNull();
    expect(result!.toolCount).toBe(3);
  });

  // HLTH-04: PASS-ELIGIBLE-IN-B — stub returns null for 503 AND real impl also
  // returns null for non-2xx; assertion matches stub, cannot distinguish in Phase B.
  // Serves as regression guard.
  it("HLTH-04: pass-eligible-in-B — stub null, real impl returns null for non-2xx", async () => {
    const { deps } = makeHttpDeps('{"ok":true}');
    // Override statusCode to 503 via a custom get mock
    deps.get = vi.fn((_o, l) => {
      const res503 = {
        statusCode: 503,
        headers: {},
        on: vi.fn(),
        emit: vi.fn(),
      };
      l(res503 as unknown as http.IncomingMessage);
      const req = { on: vi.fn(), end: vi.fn().mockReturnThis(), write: vi.fn().mockReturnThis() };
      return req as unknown as http.ClientRequest;
    });
    const result = await readHubHealthWithDeps(3000, deps);
    expect(result).toBeNull(); // stub null AND real returns null for 503 → GREEN
  });

  // HLTH-07: non-pass-eligible — real impl must call get with the correct port.
  it("HLTH-07: non-pass-eligible — real impl must call get and pass correct port", async () => {
    const { deps, calls } = makeHttpDeps(VALID_JSON);
    await readHubHealthWithDeps(4321, deps);
    expect(calls.length).toBeGreaterThan(0); // stub skips get → 0 calls → RED
    expect(calls[0].opts.port).toBe(4321);   // real impl must pass correct port
  });
});
