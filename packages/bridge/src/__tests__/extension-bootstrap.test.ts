/**
 * Tests for extension-bootstrap.ts
 * Requirements: requirements-bridge.md §2, §8.1, §9
 *
 * Phase B design:
 * - bootstrapExtension() throws "not implemented" on the stub → all tests are RED.
 * - syncMcpSettings() throws "not implemented" on the stub → all tests are RED.
 * - Mocks: vscode API, node:fs, node:os, node:path
 * - Tests cover all public functions and their key behaviours.
 *
 * API checklist:
 * - bootstrapExtension(context) → BootstrapResult   [7 tests]
 * - syncMcpSettings(outputChannel, mcpConfigPath, port, token) → void [6 tests]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Mock node:fs ───────────────────────────────────────────────────────────────

const mockFsState = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  writtenFiles: [] as { path: string; content: string }[],
}));

vi.mock("node:fs", async () => {
  const actual = await import("node:fs");
  const state = mockFsState;
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string, encoding: BufferEncoding | null) => {
      const content = state.files[filePath];
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }
      return content;
    }),
    writeFileSync: vi.fn((filePath: string, data: string) => {
      state.files[filePath] = data;
      state.writtenFiles.push({ path: filePath, content: data });
    }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((filePath: string) => {
      delete state.files[filePath];
    }),
    existsSync: vi.fn((filePath: string) => filePath in state.files),
  };
});

// ── Imports after mock registration ────────────────────────────────────────────

import {
  bootstrapExtension,
  syncMcpSettings,
  type BootstrapResult,
  type BridgeConfig,
  type SecretStorageAdapter,
} from "../extension-bootstrap.js";
import type { HubManagerConfig } from "../hub-manager.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeMockVscodeContext(overrides: Partial<{
  globalStorageUri: string;
  secrets: Record<string, string>;
  extensions: { all: { id: string }[] };
}> = {}): vscode.ExtensionContext {
  const storageUri = overrides.globalStorageUri ?? "/tmp/accordo-test-storage";
  const secretStore: Record<string, string> = overrides.secrets ?? {};

  return {
    globalStorageUri: {
      fsPath: storageUri,
    },
    secrets: {
      get: vi.fn(async (key: string) => secretStore[key]),
      store: vi.fn(async (key: string, value: string) => {
        secretStore[key] = value;
      }),
      delete: vi.fn(async (key: string) => {
        delete secretStore[key];
      }),
    } as unknown as vscode.SecretStorage,
    extensions: {
      all: overrides.extensions?.all ?? [],
    } as unknown as typeof vscode.extensions,
    subscriptions: [],
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
    },
    globalState: {
      get: vi.fn(),
      update: vi.fn(),
    },
    extensionPath: "/tmp/accordo-test",
    extensionUri: { fsPath: "/tmp/accordo-test" } as vscode.Uri,
    environmentVariableCollection: { replace: vi.fn() } as unknown as vscode.GlobalEnvironmentVariableCollection,
  } as unknown as vscode.ExtensionContext;
}

function makeMockOutputChannel() {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
  };
}

function makeMockConfiguration(overrides: Partial<{
  port: number;
  autoStart: boolean;
  executablePath: string;
  wantCopilot: boolean;
  wantOpencode: boolean;
  wantClaude: boolean;
}> = {}): vscode.WorkspaceConfiguration {
  const defaults = {
    port: 3000,
    autoStart: true,
    executablePath: "",
    wantCopilot: true,
    wantOpencode: true,
    wantClaude: true,
    ...overrides,
  };

  return {
    get: vi.fn((key: string) => {
      const map: Record<string, unknown> = {
        "hub.port": defaults.port,
        "hub.autoStart": defaults.autoStart,
        "hub.executablePath": defaults.executablePath,
        "agent.configureCopilot": defaults.wantCopilot,
        "agent.configureOpencode": defaults.wantOpencode,
        "agent.configureClaude": defaults.wantClaude,
      };
      return map[key];
    }),
    has: vi.fn(() => false),
    inspect: vi.fn(() => ({ defaultValue: undefined, globalValue: undefined, workspaceValue: undefined })),
    update: vi.fn(),
  } as unknown as vscode.WorkspaceConfiguration;
}

// ── bootstrapExtension tests ────────────────────────────────────────────────────

describe("bootstrapExtension", () => {
  beforeEach(() => {
    mockFsState.files = {};
    mockFsState.writtenFiles = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // REQ-01: returns a BootstrapResult with the correct shape
  it("REQ-01: returns a BootstrapResult with correct property types", async () => {
    const context = makeMockVscodeContext();
    const outputChannel = makeMockOutputChannel();

    vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as unknown as vscode.LogOutputChannel);
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(makeMockConfiguration());

    const result = await bootstrapExtension(context);

    // Verify the return value has all required BootstrapResult fields
    expect(result).toBeDefined();
    expect(typeof result.outputChannel).toBe("object");
    expect(typeof result.mcpConfigPath).toBe("string");
    expect(typeof result.config).toBe("object");
    expect(typeof result.hubManagerConfig).toBe("object");
    expect(typeof result.secretStorage).toBe("object");
    expect(typeof result.connectionStatusEmitter).toBe("object");
    expect(typeof result.updateStatusBar).toBe("function");
    expect(typeof result.pushDisposable).toBe("function");
  });

  // REQ-02: creates and returns an output channel
  it("REQ-02: creates and returns an output channel", async () => {
    const context = makeMockVscodeContext();
    const outputChannel = makeMockOutputChannel();

    vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as unknown as vscode.LogOutputChannel);
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(makeMockConfiguration());

    const result = await bootstrapExtension(context);

    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith("Accordo Hub");
    expect(result.outputChannel).toBe(outputChannel);
  });

  // REQ-03: derives mcpConfigPath correctly (user-level mcp.json path)
  it("REQ-03: mcpConfigPath is derived to user-level mcp.json", async () => {
    const context = makeMockVscodeContext({ globalStorageUri: "/custom/storage" });
    const outputChannel = makeMockOutputChannel();

    vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as unknown as vscode.LogOutputChannel);
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(makeMockConfiguration());

    const result = await bootstrapExtension(context);

    // mcpConfigPath should point to the user-level mcp.json for VS Code Copilot
    expect(result.mcpConfigPath).toContain(".vscode");
    expect(result.mcpConfigPath).toContain("mcp.json");
  });

  // REQ-04: reads BridgeConfig values (port, autoStart, etc.)
  it("REQ-04: reads BridgeConfig port from settings", async () => {
    const context = makeMockVscodeContext();
    const outputChannel = makeMockOutputChannel();

    vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as unknown as vscode.LogOutputChannel);
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
      makeMockConfiguration({ port: 4000, autoStart: false })
    );

    const result = await bootstrapExtension(context);

    expect(result.config.port).toBe(4000);
    expect(result.config.autoStart).toBe(false);
  });

  // REQ-05: creates HubManagerConfig with correct values
  it("REQ-05: creates HubManagerConfig with correct structure", async () => {
    const context = makeMockVscodeContext();
    const outputChannel = makeMockOutputChannel();

    vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as unknown as vscode.LogOutputChannel);
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(makeMockConfiguration());

    const result = await bootstrapExtension(context);

    expect(result.hubManagerConfig).toHaveProperty("port");
    expect(result.hubManagerConfig).toHaveProperty("autoStart");
    expect(result.hubManagerConfig).toHaveProperty("executablePath");
    expect(result.hubManagerConfig).toHaveProperty("hubEntryPoint");
  });

  // REQ-06: creates SecretStorageAdapter wrapping context.secrets
  it("REQ-06: secretStorage adapter wraps context.secrets", async () => {
    const secrets: Record<string, string> = {};
    const context = makeMockVscodeContext({ secrets });
    const outputChannel = makeMockOutputChannel();

    vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as unknown as vscode.LogOutputChannel);
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(makeMockConfiguration());

    const result = await bootstrapExtension(context);

    // SecretStorageAdapter should implement get, store, delete
    expect(typeof result.secretStorage.get).toBe("function");
    expect(typeof result.secretStorage.store).toBe("function");
    expect(typeof result.secretStorage.delete).toBe("function");

    // Verify it delegates to context.secrets
    await result.secretStorage.store("test-key", "test-value");
    expect(context.secrets.store).toHaveBeenCalledWith("test-key", "test-value");
  });

  // REQ-07: creates status bar item and registers disposables
  it("REQ-07: status bar item is created and registered for disposal", async () => {
    const context = makeMockVscodeContext();
    const outputChannel = makeMockOutputChannel();
    const mockDisposable = { dispose: vi.fn() };
    const mockStatusBarItem = {
      text: "",
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn().mockReturnValue(undefined),
    };

    vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as unknown as vscode.LogOutputChannel);
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(makeMockConfiguration());
    vi.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(
      mockStatusBarItem as unknown as vscode.StatusBarItem
    );

    const result = await bootstrapExtension(context);

    expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
    expect(typeof result.updateStatusBar).toBe("function");
  });
});

// ── syncMcpSettings tests ──────────────────────────────────────────────────────

describe("syncMcpSettings", () => {
  beforeEach(() => {
    mockFsState.files = {};
    mockFsState.writtenFiles = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // REQ-08: writes mcp.json when no file exists (creates new file)
  it("REQ-08: creates mcp.json when file does not exist", async () => {
    const outputChannel = makeMockOutputChannel();
    const mcpConfigPath = path.join(os.tmpdir(), "mcp.json");

    await syncMcpSettings(outputChannel, mcpConfigPath, 3000, "test-token");

    // File should be written
    const writeCall = mockFsState.writtenFiles.find(
      (f) => f.path === mcpConfigPath
    );
    expect(writeCall).toBeDefined();

    const written = JSON.parse(writeCall!.content);
    expect(written).toHaveProperty("servers");
    expect(written.servers).toHaveProperty("accordo");
    expect(written.servers.accordo.url).toContain("3000");
    expect(written.servers.accordo.headers.Authorization).toContain("test-token");
  });

  // REQ-09: skips write when entry unchanged (same port and token)
  it("REQ-09: skips write when existing entry matches", async () => {
    const outputChannel = makeMockOutputChannel();
    const mcpConfigPath = path.join(os.tmpdir(), "mcp.json");

    // Pre-populate with matching content
    const existingContent = JSON.stringify({
      servers: {
        accordo: {
          type: "http",
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer test-token" },
        },
      },
    });
    mockFsState.files[mcpConfigPath] = existingContent;

    await syncMcpSettings(outputChannel, mcpConfigPath, 3000, "test-token");

    // No write should occur since nothing changed
    const writesAfter = mockFsState.writtenFiles.filter((f) => f.path === mcpConfigPath);
    expect(writesAfter.length).toBe(0);
  });

  // REQ-10: updates existing mcp.json with new accordo entry
  it("REQ-10: updates existing mcp.json preserving other servers", async () => {
    const outputChannel = makeMockOutputChannel();
    const mcpConfigPath = path.join(os.tmpdir(), "mcp.json");

    // Pre-populate with another server
    const existingContent = JSON.stringify({
      servers: {
        "other-server": {
          type: "http",
          url: "http://localhost:9000/mcp",
          headers: { Authorization: "Bearer other-token" },
        },
      },
    });
    mockFsState.files[mcpConfigPath] = existingContent;

    await syncMcpSettings(outputChannel, mcpConfigPath, 3000, "new-token");

    const writeCall = mockFsState.writtenFiles.find((f) => f.path === mcpConfigPath);
    expect(writeCall).toBeDefined();

    const written = JSON.parse(writeCall!.content);
    // Other server should be preserved
    expect(written.servers["other-server"]).toBeDefined();
    // New accordo entry should be present
    expect(written.servers.accordo).toBeDefined();
    expect(written.servers.accordo.url).toContain("3000");
    expect(written.servers.accordo.headers.Authorization).toContain("new-token");
  });

  // REQ-11: handles malformed JSON gracefully (treats as absent)
  it("REQ-11: handles malformed JSON gracefully", async () => {
    const outputChannel = makeMockOutputChannel();
    const mcpConfigPath = path.join(os.tmpdir(), "mcp.json");

    // Corrupt JSON
    mockFsState.files[mcpConfigPath] = "{ not valid json";

    // Should not throw, should create valid mcp.json
    await syncMcpSettings(outputChannel, mcpConfigPath, 3000, "test-token");

    const writeCall = mockFsState.writtenFiles.find((f) => f.path === mcpConfigPath);
    expect(writeCall).toBeDefined();

    const written = JSON.parse(writeCall!.content);
    expect(written).toHaveProperty("servers");
    expect(written.servers.accordo).toBeDefined();
  });

  // REQ-12: updates when port changes
  it("REQ-12: updates mcp.json when port changes", async () => {
    const outputChannel = makeMockOutputChannel();
    const mcpConfigPath = path.join(os.tmpdir(), "mcp.json");

    // Pre-populate with old port
    const existingContent = JSON.stringify({
      servers: {
        accordo: {
          type: "http",
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer test-token" },
        },
      },
    });
    mockFsState.files[mcpConfigPath] = existingContent;

    await syncMcpSettings(outputChannel, mcpConfigPath, 4000, "test-token");

    const writeCall = mockFsState.writtenFiles.find((f) => f.path === mcpConfigPath);
    expect(writeCall).toBeDefined();

    const written = JSON.parse(writeCall!.content);
    expect(written.servers.accordo.url).toContain("4000");
  });

  // REQ-13: updates when token changes
  it("REQ-13: updates mcp.json when token changes", async () => {
    const outputChannel = makeMockOutputChannel();
    const mcpConfigPath = path.join(os.tmpdir(), "mcp.json");

    // Pre-populate with old token
    const existingContent = JSON.stringify({
      servers: {
        accordo: {
          type: "http",
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer old-token" },
        },
      },
    });
    mockFsState.files[mcpConfigPath] = existingContent;

    await syncMcpSettings(outputChannel, mcpConfigPath, 3000, "new-token");

    const writeCall = mockFsState.writtenFiles.find((f) => f.path === mcpConfigPath);
    expect(writeCall).toBeDefined();

    const written = JSON.parse(writeCall!.content);
    expect(written.servers.accordo.headers.Authorization).toContain("new-token");
  });
});
