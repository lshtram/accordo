import { describe, it, expect } from "vitest";
import { buildHealthTool, type HealthResponse } from "./health-tool-fixtures.js";
import { createMockRelay } from "./health-tool-fixtures.js";

describe("health-tool status", () => {
  it("returns connected=true and a known debuggerUrl when available", async () => {
    const tool = buildHealthTool(createMockRelay({ connected: true, debuggerUrl: "ws://localhost:9222" }));
    const result = await (tool.handler as () => Promise<HealthResponse>)();
    expect(result.connected).toBe(true);
    expect(typeof result.debuggerUrl).toBe("string");
    expect(result.uptimeSeconds).toBeGreaterThan(0);
    expect(Array.isArray(result.recentErrors)).toBe(true);
  });

  it("returns disconnected with undefined debuggerUrl when disconnected", async () => {
    const tool = buildHealthTool(createMockRelay({ connected: false }));
    const result = await (tool.handler as () => Promise<HealthResponse>)();
    expect(result.connected).toBe(false);
    expect(result.debuggerUrl).toBeUndefined();
  });

  it("returns undefined debuggerUrl when connected but unknown", async () => {
    const tool = buildHealthTool(createMockRelay({ connected: true, debuggerUrl: undefined }));
    const result = await (tool.handler as () => Promise<HealthResponse>)();
    expect(result.connected).toBe(true);
    expect(result.debuggerUrl).toBeUndefined();
  });

  it("returns required telemetry and session isolation fields", async () => {
    const tool = buildHealthTool(createMockRelay({ connected: true }));
    const result = await (tool.handler as () => Promise<HealthResponse>)();
    expect(result).toHaveProperty("connected");
    expect(result).toHaveProperty("uptimeSeconds");
    expect(result).toHaveProperty("recentErrors");
    expect(result.telemetryPolicy.enabled).toBe(false);
    expect(result.sessionIsolation.model).toBe("shared-profile");
    expect(result.sessionIsolation.controlsAvailable).toBe(false);
    expect(result.sessionIsolation.description).toContain("active Chrome profile");
    expect(result.sessionIsolation.description).toContain("authenticated page views");
    expect(result.sessionIsolation.description).toContain("does not automatically sandbox");
    expect(result.sessionIsolation.description).not.toContain("cookies");
    expect(result.sessionIsolation.description).not.toContain("localStorage");
    expect(result.sessionIsolation.recommendation).toContain("separate Chrome profile");
    expect(result.sessionIsolation.recommendation).toContain("target that tab explicitly");
  });
});
