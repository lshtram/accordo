import { describe, expect, it } from "vitest";
import { ACCORDO_SCHEMA_VERSION, buildClaudeConfig, buildOpencodeConfig } from "../agent-config.js";

describe("workspace agent config builders", () => {
  it("CFG-10: schema version is '1.0'", () => {
    expect(ACCORDO_SCHEMA_VERSION).toBe("1.0");
  });

  it("CFG-01/CFG-03/CFG-04: buildOpencodeConfig returns remote MCP config without instructions field", () => {
    const config = buildOpencodeConfig(4200, "tok") as Record<string, Record<string, Record<string, unknown>>>;
    expect(config["$schema"]).toBe("https://opencode.ai/config.json");
    expect(config.mcp["accordo"].type).toBe("remote");
    expect(config.mcp["accordo"].url).toBe("http://localhost:4200/mcp");
    expect((config.mcp["accordo"].headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    expect((config as Record<string, unknown>)["instructions"]).toBeUndefined();
  });

  it("CFG-02/CFG-03/CFG-05/CFG-09/CFG-10: buildClaudeConfig preserves peers and overwrites accordo", () => {
    const existing = JSON.stringify({
      mcpServers: {
        accordo: { type: "http", url: "http://localhost:3000/mcp", headers: { Authorization: "Bearer old-token" } },
        other: { type: "stdio", command: "other" },
      },
    });
    const config = buildClaudeConfig(3001, "new-token", existing) as Record<string, Record<string, Record<string, unknown>>>;
    expect(config["_accordo_schema"]).toBe(ACCORDO_SCHEMA_VERSION);
    expect(config.mcpServers["accordo"].url).toBe("http://localhost:3001/mcp");
    expect((config.mcpServers["accordo"].headers as Record<string, string>)["Authorization"]).toBe("Bearer new-token");
    expect(config.mcpServers["other"]).toBeDefined();
    expect(() => buildClaudeConfig(3000, "tok", "NOT VALID JSON")).not.toThrow();
  });
});
