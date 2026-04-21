import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeWorkspaceThreshold, writeVscodeSettings } from "../agent-config.js";
import { makeTmpDir, removeTmpDir } from "./agent-config-test-helpers.js";

describe("workspace settings helpers", () => {
  let tmpDir = "";

  beforeEach(() => { tmpDir = makeTmpDir("accordo-vscode-settings-test-"); });
  afterEach(() => { removeTmpDir(tmpDir); });

  it("CFG-11: writeVscodeSettings creates/merges threshold and backs up corrupt JSON", () => {
    expect(writeVscodeSettings(tmpDir)).toBe(true);
    const settingsPath = path.join(tmpDir, ".vscode", "settings.json");
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))["github.copilot.chat.virtualTools.threshold"]).toBe(300);
    fs.writeFileSync(settingsPath, JSON.stringify({ "editor.fontSize": 14 }));
    expect(writeVscodeSettings(tmpDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))["editor.fontSize"]).toBe(14);
    fs.writeFileSync(settingsPath, "{ this is not valid json");
    expect(writeVscodeSettings(tmpDir)).toBe(true);
    expect(fs.existsSync(settingsPath + ".bak")).toBe(true);
  });

  it("CFG-11: writeVscodeSettings skips when threshold is already >= 300", () => {
    const vscodeDir = path.join(tmpDir, ".vscode");
    fs.mkdirSync(vscodeDir, { recursive: true });
    const settingsPath = path.join(vscodeDir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({ "github.copilot.chat.virtualTools.threshold": 400 }));
    expect(writeVscodeSettings(tmpDir)).toBe(false);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))["github.copilot.chat.virtualTools.threshold"]).toBe(400);
  });

  it("CFG-11: removeWorkspaceThreshold removes the key and no-ops when absent", () => {
    const vscodeDir = path.join(tmpDir, ".vscode");
    fs.mkdirSync(vscodeDir, { recursive: true });
    const settingsPath = path.join(vscodeDir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({ "github.copilot.chat.virtualTools.threshold": 300, "editor.fontSize": 14 }));
    removeWorkspaceThreshold(tmpDir);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))["editor.fontSize"]).toBe(14);
    fs.writeFileSync(settingsPath, JSON.stringify({ "github.copilot.chat.virtualTools.threshold": 300 }));
    removeWorkspaceThreshold(tmpDir);
    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(() => removeWorkspaceThreshold(tmpDir)).not.toThrow();
  });
});
