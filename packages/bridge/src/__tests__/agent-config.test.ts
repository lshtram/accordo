/**
 * Tests for agent-config.ts
 * Requirements: requirements-bridge.md §8.2–§8.5 (CFG-01 to CFG-10)
 *
 * All functions throw "not implemented" on stubs → all tests are RED until Phase C.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  buildOpencodeConfig,
  buildClaudeConfig,
  appendGitignore,
  writeOpencodeConfig,
  writeClaudeConfig,
  writeAgentConfigs,
  writeVscodeSettings,
  ACCORDO_SCHEMA_VERSION,
} from "../agent-config.js";
import type { AgentConfigParams } from "../agent-config.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "accordo-agent-config-test-"));
}

function makeOutputChannel() {
  const lines: string[] = [];
  return {
    appendLine: (v: string) => lines.push(v),
    lines,
  };
}

function makeParams(
  workspaceRoot: string,
  overrides: Partial<AgentConfigParams> = {},
): AgentConfigParams {
  return {
    workspaceRoot,
    port: 3000,
    token: "test-token-abc",
    configureOpencode: true,
    configureClaude: true,
    outputChannel: makeOutputChannel(),
    ...overrides,
  };
}

// ── ACCORDO_SCHEMA_VERSION ────────────────────────────────────────────────────

describe("ACCORDO_SCHEMA_VERSION", () => {
  it("CFG-10: schema version is '1.0'", () => {
    expect(ACCORDO_SCHEMA_VERSION).toBe("1.0");
  });
});

// ── buildOpencodeConfig ───────────────────────────────────────────────────────

describe("buildOpencodeConfig", () => {
  it("CFG-01/CFG-03: returns an object with mcp key", () => {
    const cfg = buildOpencodeConfig(3000, "tok");
    expect(typeof cfg).toBe("object");
    expect(cfg["mcp"]).toBeDefined();
  });

  it("CFG-03: mcp.accordo-hub.type is 'remote'", () => {
    const cfg = buildOpencodeConfig(3000, "tok") as Record<string, Record<string, Record<string, unknown>>>;
    expect(cfg.mcp["accordo-hub"].type).toBe("remote");
  });

  it("CFG-03: mcp.accordo-hub.url uses the provided port", () => {
    const cfg = buildOpencodeConfig(4200, "tok") as Record<string, Record<string, Record<string, unknown>>>;
    expect(cfg.mcp["accordo-hub"].url).toBe("http://localhost:4200/mcp");
  });

  it("CFG-03: Authorization header contains Bearer token", () => {
    const cfg = buildOpencodeConfig(3000, "my-secret-token") as Record<string, Record<string, Record<string, Record<string, string>>>>;
    expect(cfg.mcp["accordo-hub"].headers["Authorization"]).toBe("Bearer my-secret-token");
  });

  it("CFG-04: includes instructions_url pointing to /instructions endpoint", () => {
    const cfg = buildOpencodeConfig(3000, "tok") as Record<string, unknown>;
    expect(cfg["instructions_url"]).toBe("http://localhost:3000/instructions");
  });

  it("CFG-04: instructions_url uses the provided port", () => {
    const cfg = buildOpencodeConfig(4567, "tok") as Record<string, unknown>;
    expect(cfg["instructions_url"]).toBe("http://localhost:4567/instructions");
  });

  it("CFG-10: includes _accordo_schema field with current version", () => {
    const cfg = buildOpencodeConfig(3000, "tok") as Record<string, unknown>;
    expect(cfg["_accordo_schema"]).toBe(ACCORDO_SCHEMA_VERSION);
  });
});

// ── buildClaudeConfig ─────────────────────────────────────────────────────────

describe("buildClaudeConfig", () => {
  it("CFG-02/CFG-03: returns an object with mcpServers key", () => {
    const cfg = buildClaudeConfig(3000, "tok", undefined);
    expect(typeof cfg).toBe("object");
    expect(cfg["mcpServers"]).toBeDefined();
  });

  it("CFG-03: mcpServers.accordo-hub.type is 'http'", () => {
    const cfg = buildClaudeConfig(3000, "tok", undefined) as Record<string, Record<string, Record<string, unknown>>>;
    expect(cfg.mcpServers["accordo-hub"].type).toBe("http");
  });

  it("CFG-03: mcpServers.accordo-hub.url uses the provided port", () => {
    const cfg = buildClaudeConfig(4200, "tok", undefined) as Record<string, Record<string, Record<string, unknown>>>;
    expect(cfg.mcpServers["accordo-hub"].url).toBe("http://localhost:4200/mcp");
  });

  it("CFG-03: Authorization header contains Bearer token", () => {
    const cfg = buildClaudeConfig(3000, "my-secret", undefined) as Record<string, Record<string, Record<string, Record<string, string>>>>;
    expect(cfg.mcpServers["accordo-hub"].headers["Authorization"]).toBe("Bearer my-secret");
  });

  it("CFG-05: preserves existing non-accordo entries from existingRaw", () => {
    const existing = JSON.stringify({
      mcpServers: {
        "other-tool": { type: "stdio", command: "other" },
      },
    });
    const cfg = buildClaudeConfig(3000, "tok", existing) as Record<string, Record<string, unknown>>;
    expect(cfg.mcpServers["other-tool"]).toBeDefined();
  });

  it("CFG-05: overwrites the accordo-hub entry when updating token", () => {
    const existing = JSON.stringify({
      mcpServers: {
        "accordo-hub": { type: "http", url: "http://localhost:3000/mcp", headers: { Authorization: "Bearer old-token" } },
      },
    });
    const cfg = buildClaudeConfig(3000, "new-token", existing) as Record<string, Record<string, Record<string, Record<string, string>>>>;
    expect(cfg.mcpServers["accordo-hub"].headers["Authorization"]).toBe("Bearer new-token");
  });

  it("CFG-09: treats corrupt JSON existingRaw as absent (no crash)", () => {
    expect(() => buildClaudeConfig(3000, "tok", "NOT VALID JSON")).not.toThrow();
  });

  it("CFG-09: still writes accordo-hub entry when existing file is corrupt", () => {
    const cfg = buildClaudeConfig(3000, "tok", "INVALID") as Record<string, Record<string, unknown>>;
    expect(cfg.mcpServers["accordo-hub"]).toBeDefined();
  });

  it("CFG-10: includes _accordo_schema field with current version", () => {
    const cfg = buildClaudeConfig(3000, "tok", undefined) as Record<string, unknown>;
    expect(cfg["_accordo_schema"]).toBe(ACCORDO_SCHEMA_VERSION);
  });
});

// ── appendGitignore ───────────────────────────────────────────────────────────

describe("appendGitignore", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("CFG-06: creates .gitignore if it does not exist", () => {
    const p = path.join(tmpDir, ".gitignore");
    appendGitignore(p, "opencode.json");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("CFG-06: appends entry to .gitignore", () => {
    const p = path.join(tmpDir, ".gitignore");
    appendGitignore(p, "opencode.json");
    expect(fs.readFileSync(p, "utf8")).toContain("opencode.json");
  });

  it("CFG-06: does not duplicate existing entry", () => {
    const p = path.join(tmpDir, ".gitignore");
    fs.writeFileSync(p, "opencode.json\n");
    appendGitignore(p, "opencode.json");
    const content = fs.readFileSync(p, "utf8");
    const matches = content.match(/opencode\.json/g);
    expect(matches?.length).toBe(1);
  });

  it("CFG-06: appends a new entry when file exists but entry is absent", () => {
    const p = path.join(tmpDir, ".gitignore");
    fs.writeFileSync(p, "node_modules\n");
    appendGitignore(p, "opencode.json");
    expect(fs.readFileSync(p, "utf8")).toContain("opencode.json");
  });

  it("CFG-06: appends different entries independently", () => {
    const p = path.join(tmpDir, ".gitignore");
    appendGitignore(p, "opencode.json");
    appendGitignore(p, ".claude/mcp.json");
    const content = fs.readFileSync(p, "utf8");
    expect(content).toContain("opencode.json");
    expect(content).toContain(".claude/mcp.json");
  });
});

// ── writeOpencodeConfig ───────────────────────────────────────────────────────

describe("writeOpencodeConfig", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("CFG-01: creates opencode.json when configureOpencode is true", () => {
    writeOpencodeConfig(makeParams(tmpDir));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(true);
  });

  it("CFG-01: does NOT create opencode.json when configureOpencode is false", () => {
    writeOpencodeConfig(makeParams(tmpDir, { configureOpencode: false }));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(false);
  });

  it("CFG-03: written file contains valid JSON with mcp", () => {
    writeOpencodeConfig(makeParams(tmpDir));
    const raw = fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["mcp"]).toBeDefined();
  });

  it("CFG-03: Bearer token is in the written file", () => {
    writeOpencodeConfig(makeParams(tmpDir, { token: "my-real-token" }));
    const raw = fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf8");
    expect(raw).toContain("my-real-token");
  });

  it("CFG-04: written file contains instructions_url", () => {
    writeOpencodeConfig(makeParams(tmpDir, { port: 3001 }));
    const raw = fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf8");
    expect(raw).toContain("http://localhost:3001/instructions");
  });

  it("CFG-06: appends opencode.json to workspace .gitignore", () => {
    writeOpencodeConfig(makeParams(tmpDir));
    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("opencode.json");
  });

  it("CFG-06: written file has mode 0600 (owner read/write only)", () => {
    writeOpencodeConfig(makeParams(tmpDir));
    const mode = fs.statSync(path.join(tmpDir, "opencode.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("CFG-10: written file contains _accordo_schema", () => {
    writeOpencodeConfig(makeParams(tmpDir));
    const raw = fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf8");
    expect(raw).toContain("_accordo_schema");
  });
});

// ── writeClaudeConfig ─────────────────────────────────────────────────────────

describe("writeClaudeConfig", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("CFG-02: creates .claude/mcp.json when configureClaude is true", () => {
    writeClaudeConfig(makeParams(tmpDir));
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(true);
  });

  it("CFG-02: does NOT create .claude/mcp.json when configureClaude is false", () => {
    writeClaudeConfig(makeParams(tmpDir, { configureClaude: false }));
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(false);
  });

  it("CFG-03: written file contains valid JSON with mcpServers", () => {
    writeClaudeConfig(makeParams(tmpDir));
    const raw = fs.readFileSync(path.join(tmpDir, ".claude", "mcp.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["mcpServers"]).toBeDefined();
  });

  it("CFG-05: merges existing non-accordo entries", () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "mcp.json"),
      JSON.stringify({ mcpServers: { "other-tool": { type: "stdio" } } }),
    );
    writeClaudeConfig(makeParams(tmpDir));
    const parsed = JSON.parse(
      fs.readFileSync(path.join(claudeDir, "mcp.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers["other-tool"]).toBeDefined();
    expect(parsed.mcpServers["accordo-hub"]).toBeDefined();
  });

  it("CFG-09: backs up corrupt .claude/mcp.json as .bak before overwriting", () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "mcp.json"), "NOT VALID JSON");
    writeClaudeConfig(makeParams(tmpDir));
    expect(fs.existsSync(path.join(claudeDir, "mcp.json.bak"))).toBe(true);
    expect(fs.readFileSync(path.join(claudeDir, "mcp.json.bak"), "utf8")).toBe("NOT VALID JSON");
  });

  it("CFG-09: still writes valid .claude/mcp.json after backing up corrupt file", () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "mcp.json"), "TRASH");
    writeClaudeConfig(makeParams(tmpDir));
    const raw = fs.readFileSync(path.join(claudeDir, "mcp.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("CFG-06: appends .claude/mcp.json to workspace .gitignore", () => {
    writeClaudeConfig(makeParams(tmpDir));
    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".claude/mcp.json");
  });

  it("CFG-06: written file has mode 0600 (owner read/write only)", () => {
    writeClaudeConfig(makeParams(tmpDir));
    const mode = fs.statSync(path.join(tmpDir, ".claude", "mcp.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("CFG-10: written file contains _accordo_schema", () => {
    writeClaudeConfig(makeParams(tmpDir));
    const raw = fs.readFileSync(path.join(tmpDir, ".claude", "mcp.json"), "utf8");
    expect(raw).toContain("_accordo_schema");
  });
});

// ── writeAgentConfigs ─────────────────────────────────────────────────────────

describe("writeAgentConfigs", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("CFG-01/CFG-02: writes both files when both enabled", () => {
    writeAgentConfigs(makeParams(tmpDir, { configureOpencode: true, configureClaude: true }));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(true);
  });

  it("CFG-01: writes only opencode.json when only configureOpencode is true", () => {
    writeAgentConfigs(makeParams(tmpDir, { configureOpencode: true, configureClaude: false }));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(false);
  });

  it("CFG-02: writes only .claude/mcp.json when only configureClaude is true", () => {
    writeAgentConfigs(makeParams(tmpDir, { configureOpencode: false, configureClaude: true }));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(true);
  });

  it("CFG-01/CFG-02: writes neither file when both disabled", () => {
    writeAgentConfigs(makeParams(tmpDir, { configureOpencode: false, configureClaude: false }));
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "mcp.json"))).toBe(false);
  });

  it("M26/M27: opencode.json is still written when .claude/ write fails (fault isolation)", () => {
    // Create .claude as a plain file so mkdirSync will fail when writeClaudeConfig
    // tries to create it as a directory — simulating an unwritable .claude/ dir.
    const claudePath = path.join(tmpDir, ".claude");
    fs.writeFileSync(claudePath, "not-a-dir");

    const warnings: string[] = [];
    const outputChannel = { appendLine: (v: string) => { warnings.push(v); } };
    const params = { ...makeParams(tmpDir, { configureOpencode: true, configureClaude: true }), outputChannel };

    // Must not throw — each write is independent
    expect(() => writeAgentConfigs(params)).not.toThrow();

    // opencode.json should be written despite .claude/ failure
    expect(fs.existsSync(path.join(tmpDir, "opencode.json"))).toBe(true);
    // A warning about the failed .claude/mcp.json write should be logged
    expect(warnings.some((w) => w.includes(".claude/mcp.json"))).toBe(true);
  });
});

// ── CFG-07: token rotation — config files are rewritten with the new token ────

describe("writeAgentConfigs — CFG-07: rewrite on token rotation", () => {
  let rotationDir: string;

  beforeEach(() => {
    rotationDir = fs.mkdtempSync(path.join(os.tmpdir(), "accordo-cfg07-"));
  });

  afterEach(() => {
    fs.rmSync(rotationDir, { recursive: true, force: true });
  });

  it("CFG-07: second writeAgentConfigs with new token overwrites opencode.json bearer token", () => {
    // RED: stubs throw — no writes happen at all
    writeAgentConfigs(makeParams(rotationDir, { token: "initial-token", configureOpencode: true, configureClaude: false }));
    writeAgentConfigs(makeParams(rotationDir, { token: "rotated-token", configureOpencode: true, configureClaude: false }));

    const content = JSON.parse(
      fs.readFileSync(path.join(rotationDir, "opencode.json"), "utf8"),
    ) as Record<string, Record<string, Record<string, Record<string, string>>>>;
    const auth = content.mcp["accordo-hub"].headers["Authorization"];
    expect(auth).toBe("Bearer rotated-token");
    expect(auth).not.toContain("initial-token");
  });

  it("CFG-07: second writeAgentConfigs with new token overwrites .claude/mcp.json bearer token", () => {
    // RED: stubs throw
    writeAgentConfigs(makeParams(rotationDir, { token: "initial-token", configureOpencode: false, configureClaude: true }));
    writeAgentConfigs(makeParams(rotationDir, { token: "rotated-token", configureOpencode: false, configureClaude: true }));

    const content = JSON.parse(
      fs.readFileSync(path.join(rotationDir, ".claude", "mcp.json"), "utf8"),
    ) as Record<string, Record<string, Record<string, Record<string, string>>>>;
    const auth = content.mcpServers["accordo-hub"].headers["Authorization"];
    expect(auth).toBe("Bearer rotated-token");
    expect(auth).not.toContain("initial-token");
  });

  it("CFG-07: both files are updated atomically on a single rotation call", () => {
    // RED: stubs throw
    writeAgentConfigs(makeParams(rotationDir, { token: "v1", configureOpencode: true, configureClaude: true }));
    writeAgentConfigs(makeParams(rotationDir, { token: "v2", configureOpencode: true, configureClaude: true }));

    const opencode = JSON.parse(
      fs.readFileSync(path.join(rotationDir, "opencode.json"), "utf8"),
    ) as Record<string, Record<string, Record<string, Record<string, string>>>>;
    const claude = JSON.parse(
      fs.readFileSync(path.join(rotationDir, ".claude", "mcp.json"), "utf8"),
    ) as Record<string, Record<string, Record<string, Record<string, string>>>>;

    expect(opencode.mcp["accordo-hub"].headers["Authorization"]).toBe("Bearer v2");
    expect(claude.mcpServers["accordo-hub"].headers["Authorization"]).toBe("Bearer v2");
  });
});

// ---------------------------------------------------------------------------
// writeVscodeSettings — CFG-11
// ---------------------------------------------------------------------------

describe("writeVscodeSettings — CFG-11", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "accordo-vscode-settings-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("CFG-11: creates .vscode/settings.json with threshold 300 when file absent", () => {
    writeVscodeSettings(tmpDir);
    const settingsPath = path.join(tmpDir, ".vscode", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(content["github.copilot.chat.virtualTools.threshold"]).toBe(300);
  });

  it("CFG-11: merges with existing settings without overwriting other keys", () => {
    const vscodeDir = path.join(tmpDir, ".vscode");
    fs.mkdirSync(vscodeDir);
    fs.writeFileSync(
      path.join(vscodeDir, "settings.json"),
      JSON.stringify({ "editor.fontSize": 14, "other.setting": true }),
    );
    writeVscodeSettings(tmpDir);
    const content = JSON.parse(
      fs.readFileSync(path.join(vscodeDir, "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(content["editor.fontSize"]).toBe(14);
    expect(content["other.setting"]).toBe(true);
    expect(content["github.copilot.chat.virtualTools.threshold"]).toBe(300);
  });

  it("CFG-11: skips write when threshold is already >= 300", () => {
    const vscodeDir = path.join(tmpDir, ".vscode");
    fs.mkdirSync(vscodeDir);
    const settingsPath = path.join(vscodeDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ "github.copilot.chat.virtualTools.threshold": 400 }),
    );
    const mtimeBefore = fs.statSync(settingsPath).mtimeMs;
    writeVscodeSettings(tmpDir);
    const mtimeAfter = fs.statSync(settingsPath).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("CFG-11: creates .vscode/ directory if absent", () => {
    const vscodeDir = path.join(tmpDir, ".vscode");
    expect(fs.existsSync(vscodeDir)).toBe(false);
    writeVscodeSettings(tmpDir);
    expect(fs.existsSync(vscodeDir)).toBe(true);
  });

  it("CFG-11: backs up corrupt JSON and writes fresh settings", () => {
    const vscodeDir = path.join(tmpDir, ".vscode");
    fs.mkdirSync(vscodeDir);
    const settingsPath = path.join(vscodeDir, "settings.json");
    fs.writeFileSync(settingsPath, "{ this is not valid json");
    writeVscodeSettings(tmpDir);
    expect(fs.existsSync(settingsPath + ".bak")).toBe(true);
    const content = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(content["github.copilot.chat.virtualTools.threshold"]).toBe(300);
  });

  it("CFG-11: writeAgentConfigs calls writeVscodeSettings by default", () => {
    const paramsDir = fs.mkdtempSync(path.join(os.tmpdir(), "accordo-cfg11-default-"));
    try {
      writeAgentConfigs(makeParams(paramsDir, { configureOpencode: false, configureClaude: false }));
      const settingsPath = path.join(paramsDir, ".vscode", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
    } finally {
      fs.rmSync(paramsDir, { recursive: true, force: true });
    }
  });

  it("CFG-11: writeAgentConfigs skips writeVscodeSettings when configureVscodeSettings is false", () => {
    const paramsDir = fs.mkdtempSync(path.join(os.tmpdir(), "accordo-cfg11-skip-"));
    try {
      writeAgentConfigs(makeParams(paramsDir, { configureOpencode: false, configureClaude: false, configureVscodeSettings: false }));
      const settingsPath = path.join(paramsDir, ".vscode", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(false);
    } finally {
      fs.rmSync(paramsDir, { recursive: true, force: true });
    }
  });
});

