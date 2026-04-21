import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAgentConfigs } from "../agent-config.js";
import { makeParams, makeTmpDir, removeTmpDir } from "./agent-config-test-helpers.js";

describe("writeAgentConfigs", () => {
  let tmpDir = "";

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { removeTmpDir(tmpDir); });

  it("CFG-01/CFG-02: writes enabled workspace files only", () => {
    writeAgentConfigs(makeParams(tmpDir, { configureOpencode: true, configureClaude: false }));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(false);
    writeAgentConfigs(makeParams(tmpDir, { token: "rotated-token", configureOpencode: true, configureClaude: true }));
    expect(fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf8")).toContain("rotated-token");
    expect(fs.readFileSync(path.join(tmpDir, ".claude", "mcp.json"), "utf8")).toContain("rotated-token");
  });

  it("M26/M27: isolates writer failures so opencode still succeeds when .claude path fails", () => {
    fs.writeFileSync(path.join(tmpDir, ".claude"), "not-a-dir");
    const warnings: string[] = [];
    const params = { ...makeParams(tmpDir), outputChannel: { appendLine: (value: string) => { warnings.push(value); } } };
    expect(() => writeAgentConfigs(params)).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(true);
    expect(warnings.some((warning) => warning.includes(".claude/mcp.json"))).toBe(true);
  });
});
