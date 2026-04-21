import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeOpencodeConfig } from "../agent-config.js";
import { makeParams, makeTmpDir, removeTmpDir } from "./agent-config-test-helpers.js";

describe("writeOpencodeConfig", () => {
  let tmpDir = "";

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { removeTmpDir(tmpDir); });

  it("CFG-01/CFG-03/CFG-04/CFG-10: writes opencode.json when enabled", () => {
    writeOpencodeConfig(makeParams(tmpDir, { token: "my-real-token", port: 3001 }));
    const raw = fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf8");
    expect(raw).toContain("my-real-token");
    expect(raw).toContain("opencode.ai/config.json");
    expect(raw).not.toContain("/instructions");
    expect(JSON.parse(raw)["mcp"]).toBeDefined();
  });

  it("CFG-01/CFG-06: skips when disabled and appends workspace .gitignore when enabled", () => {
    writeOpencodeConfig(makeParams(tmpDir, { configureOpencode: false }));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(false);
    writeOpencodeConfig(makeParams(tmpDir));
    expect(fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf8")).toContain("opencode.json");
  });

  it("CFG-06: writes file mode 0600 on unix-like platforms", () => {
    if (process.platform === "win32") {
      expect(true).toBe(true);
      return;
    }
    writeOpencodeConfig(makeParams(tmpDir));
    expect(fs.statSync(path.join(tmpDir, "opencode.json")).mode & 0o777).toBe(0o600);
  });
});
