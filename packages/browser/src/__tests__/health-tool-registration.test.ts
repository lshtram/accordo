import { describe, it, expect } from "vitest";
import { buildHealthTool } from "./health-tool-fixtures.js";
import { createMockRelay } from "./health-tool-fixtures.js";

describe("accordo_browser_health tool registration", () => {
  it("buildHealthTool returns tool with name 'accordo_browser_health'", () => {
    expect(buildHealthTool(createMockRelay()).name).toBe("accordo_browser_health");
  });

  it("Tool description mentions connection health and connection", () => {
    const tool = buildHealthTool(createMockRelay());
    expect(tool.description).toMatch(/health/i);
    expect(tool.description).toMatch(/connection/i);
  });

  it("Tool metadata is safe, idempotent, and has empty object schema", () => {
    const tool = buildHealthTool(createMockRelay());
    expect(tool.dangerLevel).toBe("safe");
    expect(tool.idempotent).toBe(true);
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
    expect(typeof tool.handler).toBe("function");
  });
});
