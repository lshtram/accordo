import { describe, it, expect } from "vitest";
import { buildHealthTool, MAX_RECENT_ERRORS, type HealthResponse } from "./health-tool-fixtures.js";
import { createMockRelay } from "./health-tool-fixtures.js";

describe("health-tool errors", () => {
  it("exposes MAX_RECENT_ERRORS = 10 and caps returned history", async () => {
    expect(MAX_RECENT_ERRORS).toBe(10);
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay) as { handler: () => Promise<HealthResponse> };
    for (let i = 0; i < 15; i++) {
      (relay as { onError?: (e: string) => void }).onError?.(`error-${i}`);
    }
    const result = await tool.handler();
    expect(result.recentErrors.length).toBe(MAX_RECENT_ERRORS);
    expect(result.recentErrors).not.toContain("error-0");
    expect(result.recentErrors).toContain("error-14");
  });

  it("populates recentErrors in most-recent-first order", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay) as { handler: () => Promise<HealthResponse> };
    (relay as { onError?: (e: string) => void }).onError?.("browser-not-connected");
    (relay as { onError?: (e: string) => void }).onError?.("timeout");
    const result = await tool.handler();
    expect(result.recentErrors[0]).toBe("timeout");
    expect(result.recentErrors).toContain("browser-not-connected");
  });

  it("queries relay connectivity and always reports positive uptime", async () => {
    const relay = createMockRelay({ connected: true });
    const tool = buildHealthTool(relay) as { handler: () => Promise<HealthResponse> };
    const result = await tool.handler();
    expect(relay.isConnected).toHaveBeenCalled();
    expect(result.uptimeSeconds).toBeGreaterThan(0);
  });
});
