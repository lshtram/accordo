import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeClaudeConfig } from "../agent-config.js";
import { makeParams, makeTmpDir, removeTmpDir } from "./agent-config-test-helpers.js";

describe("writeClaudeConfig", () => {
  let tmpDir = "";

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { removeTmpDir(tmpDir); });

  it("CFG-02/CFG-03/CFG-05/CFG-10: writes and merges .claude/mcp.json", () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "mcp.json"), JSON.stringify({ mcpServers: { other: { type: "stdio" } } }));
    writeClaudeConfig(makeParams(tmpDir));
    const parsed = JSON.parse(fs.readFileSync(path.join(claudeDir, "mcp.json"), "utf8")) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers["accordo"]).toBeDefined();
    expect(parsed.mcpServers["other"]).toBeDefined();
    expect(JSON.stringify(parsed)).toContain("_accordo_schema");
  });

  it("CFG-02/CFG-09: skips when disabled and backs up corrupt input when enabled", () => {
    writeClaudeConfig(makeParams(tmpDir, { configureClaude: false }));
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(false);
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "mcp.json"), "NOT VALID JSON");
    writeClaudeConfig(makeParams(tmpDir));
    expect(fs.existsSync(path.join(claudeDir, "mcp.json.bak"))).toBe(true);
    expect(() => JSON.parse(fs.readFileSync(path.join(claudeDir, "mcp.json"), "utf8"))).not.toThrow();
  });

  it("CFG-06: appends .claude/mcp.json to .gitignore and writes file mode 0600 on unix-like platforms", () => {
    writeClaudeConfig(makeParams(tmpDir));
    expect(fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf8")).toContain(".claude/mcp.json");
    if (process.platform !== "win32") expect(fs.statSync(path.join(tmpDir, ".claude", "mcp.json")).mode & 0o777).toBe(0o600);
  });
});
