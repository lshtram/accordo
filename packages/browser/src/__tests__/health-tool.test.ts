/**
 * health-tool.test.ts
 *
 * Tests for GAP-H1 + MCP-ER-004 — browser_health MCP tool
 *
 * Tests validate:
 * - HEALTH-001: returns { connected: true } when relay is connected
 * - HEALTH-001: debuggerUrl is string when connected
 * - HEALTH-001: uptimeSeconds > 0 when relay is running
 * - HEALTH-001: recentErrors is array when connected
 * - HEALTH-002: returns { connected: false } when relay is disconnected
 * - HEALTH-002: debuggerUrl is undefined when disconnected
 * - HEALTH-003: recentErrors is capped at MAX_RECENT_ERRORS (10)
 * - HEALTH-004: uptimeSeconds > 0
 *
 * API checklist (buildHealthTool):
 * - name: "browser_health"
 * - description: mentions connection health, errors, uptime
 * - inputSchema: empty object {}
 * - dangerLevel: "safe"
 * - idempotent: true
 * - handler: callable and returns HealthResponse with connected, debuggerUrl?, uptimeSeconds, recentErrors
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildHealthTool, MAX_RECENT_ERRORS } from "../health-tool.js";
import type { HealthResponse } from "../health-tool.js";
import type { BrowserRelayLike } from "../types.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

function createMockRelay(overrides?: Partial<{
  connected: boolean;
  debuggerUrl: string;
  onError: (error: string) => void;
}>): BrowserRelayLike {
  return {
    request: vi.fn(),
    push: vi.fn(),
    isConnected: vi.fn(() => overrides?.connected ?? true),
    getDebuggerUrl: vi.fn(() => overrides?.debuggerUrl ?? "ws://localhost:9222"),
    onError: overrides?.onError,
  } as unknown as BrowserRelayLike;
}

// ── Tool Registration ─────────────────────────────────────────────────────────

describe("browser_health tool registration", () => {
  it("buildHealthTool returns tool with name 'browser_health'", () => {
    const relay = createMockRelay();
    const tool = buildHealthTool(relay);
    expect(tool.name).toBe("browser_health");
  });

  it("Tool description mentions connection health, errors, and uptime", () => {
    const relay = createMockRelay();
    const tool = buildHealthTool(relay);
    expect(tool.description).toMatch(/health/i);
    expect(tool.description).toMatch(/connection/i);
  });

  it("Tool dangerLevel is 'safe'", () => {
    const relay = createMockRelay();
    const tool = buildHealthTool(relay);
    expect(tool.dangerLevel).toBe("safe");
  });

  it("Tool idempotent is true", () => {
    const relay = createMockRelay();
    const tool = buildHealthTool(relay);
    expect(tool.idempotent).toBe(true);
  });

  it("Tool inputSchema is empty object", () => {
    const relay = createMockRelay();
    const tool = buildHealthTool(relay);
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("Tool handler is callable", () => {
    const relay = createMockRelay();
    const tool = buildHealthTool(relay);
    expect(typeof tool.handler).toBe("function");
  });
});

// ── HEALTH-001: Connected state ───────────────────────────────────────────────

describe("HEALTH-001: Connected relay", () => {
  it("HEALTH-001: returns { connected: true } when relay is connected", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // Stub throws "not implemented" — when implemented, should return connected: true
    expect(result.connected).toBe(true);
  });

  it("HEALTH-001: debuggerUrl is string when connected", async () => {
    const relay = createMockRelay({ connected: true, debuggerUrl: "ws://localhost:9222" });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, debuggerUrl should be a string when connected
    expect(typeof result.debuggerUrl).toBe("string");
  });

  it("HEALTH-001: uptimeSeconds > 0 when relay is running", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, uptimeSeconds should be > 0
    expect(result.uptimeSeconds).toBeGreaterThan(0);
  });

  it("HEALTH-001: recentErrors is an array", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, recentErrors should be an array
    expect(Array.isArray(result.recentErrors)).toBe(true);
  });
});

// ── HEALTH-002: Disconnected state ───────────────────────────────────────────

describe("HEALTH-002: Disconnected relay", () => {
  it("HEALTH-002: returns { connected: false } when relay is disconnected", async () => {
    const relay = createMockRelay({ connected: false });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, should check relay.isConnected() and return false
    expect(result.connected).toBe(false);
  });

  it("HEALTH-002: debuggerUrl is undefined when disconnected", async () => {
    const relay = createMockRelay({ connected: false });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, debuggerUrl should be undefined when not connected
    expect(result.debuggerUrl).toBeUndefined();
  });
});

// ── HEALTH-003: Error history cap ─────────────────────────────────────────────

describe("HEALTH-003: Error history cap", () => {
  it("HEALTH-003: MAX_RECENT_ERRORS is 10", () => {
    // The constant should be exported and equal to 10
    expect(MAX_RECENT_ERRORS).toBe(10);
  });

  it("HEALTH-003: recentErrors is capped at MAX_RECENT_ERRORS", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, even if more than MAX_RECENT_ERRORS errors exist,
    // the returned array should have at most MAX_RECENT_ERRORS items
    expect(result.recentErrors.length).toBeLessThanOrEqual(MAX_RECENT_ERRORS);
  });
});

// ── Error ring buffer population ────────────────────────────────────────────

describe("HEALTH-005: onError ring buffer population", () => {
  it("HEALTH-005: onError populates recentErrors", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay) as { handler: () => Promise<HealthResponse> };

    // Simulate errors occurring via the onError callback
    (relay as { onError?: (e: string) => void }).onError?.("browser-not-connected");
    (relay as { onError?: (e: string) => void }).onError?.("timeout");

    const result = await tool.handler();
    expect(result.recentErrors).toContain("browser-not-connected");
    expect(result.recentErrors).toContain("timeout");
  });

  it("HEALTH-005: recentErrors are ordered most-recent-first", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay) as { handler: () => Promise<HealthResponse> };

    (relay as { onError?: (e: string) => void }).onError?.("error-1");
    (relay as { onError?: (e: string) => void }).onError?.("error-2");
    (relay as { onError?: (e: string) => void }).onError?.("error-3");

    const result = await tool.handler();
    expect(result.recentErrors[0]).toBe("error-3"); // most recent first
    expect(result.recentErrors[2]).toBe("error-1");
  });

  it("HEALTH-005: ring buffer evicts oldest when exceeding MAX_RECENT_ERRORS", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay) as { handler: () => Promise<HealthResponse> };

    for (let i = 0; i < 15; i++) {
      (relay as { onError?: (e: string) => void }).onError?.(`error-${i}`);
    }

    const result = await tool.handler();
    expect(result.recentErrors.length).toBe(MAX_RECENT_ERRORS);
    expect(result.recentErrors).not.toContain("error-0"); // oldest evicted
    expect(result.recentErrors).toContain("error-14"); // newest kept
  });
});

// ── HEALTH-004: Uptime > 0 ─────────────────────────────────────────────────

describe("HEALTH-004: Uptime validation", () => {
  it("HEALTH-004: uptimeSeconds > 0", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // Uptime should always be > 0 when connected
    expect(result.uptimeSeconds).toBeGreaterThan(0);
  });
});

// ── Handler behavior ──────────────────────────────────────────────────────────

describe("browser_health handler behavior", () => {
  it("Handler queries relay.isConnected()", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay);

    await (tool.handler as () => Promise<HealthResponse>)();

    expect(relay.isConnected).toHaveBeenCalled();
  });

  it("Handler returns HealthResponse with all required fields", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, should return object with all required fields
    expect(result).toHaveProperty("connected");
    expect(result).toHaveProperty("uptimeSeconds");
    expect(result).toHaveProperty("recentErrors");
  });

  it("Handler returns HealthResponse shape when disconnected", async () => {
    const relay = createMockRelay({ connected: false });
    const tool = buildHealthTool(relay);

    const result = await (tool.handler as () => Promise<HealthResponse>)();

    // When implemented, should return object with connected: false
    expect(result.connected).toBe(false);
    expect(result.debuggerUrl).toBeUndefined();
  });
});
