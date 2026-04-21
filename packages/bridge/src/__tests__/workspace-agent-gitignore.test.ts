import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendGitignore } from "../agent-config.js";
import { makeTmpDir, removeTmpDir } from "./agent-config-test-helpers.js";

describe("appendGitignore", () => {
  let tmpDir = "";

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { removeTmpDir(tmpDir); });

  it("CFG-06: creates .gitignore when absent and appends entries without duplication", () => {
    const filePath = path.join(tmpDir, ".gitignore");
    appendGitignore(filePath, "opencode.json");
    appendGitignore(filePath, "opencode.json");
    appendGitignore(filePath, ".claude/mcp.json");
    const content = fs.readFileSync(filePath, "utf8");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(content.match(/opencode\.json/g)?.length).toBe(1);
    expect(content).toContain(".claude/mcp.json");
  });

  it("CFG-06: appends to an existing .gitignore without removing prior lines", () => {
    const filePath = path.join(tmpDir, ".gitignore");
    fs.writeFileSync(filePath, "node_modules\n");
    appendGitignore(filePath, "opencode.json");
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("node_modules");
    expect(content).toContain("opencode.json");
  });
});
