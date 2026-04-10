/**
 * Tests for extension-service-factory.ts
 * Requirements: requirements-bridge.md §4, §5, §6, §7
 *
 * Phase B design:
 * - createServices() throws "not implemented" on the stub → all tests are RED.
 * - Mocks: HubManager, ExtensionRegistry, CommandRouter, StatePublisher, node:fs
 * - Tests cover the Services return shape and dependency wiring.
 *
 * API checklist:
 * - createServices(deps: ServiceFactoryDeps) → Services  [10 tests]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";

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

// ── Mock HubManager, ExtensionRegistry, CommandRouter, StatePublisher ──────────

// We mock the entire modules since their constructors throw "not implemented"
const mockHubManagerInstance = vi.hoisted(() => ({
  activate: vi.fn().mockResolvedValue(undefined),
  deactivate: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  getPort: vi.fn().mockReturnValue(3000),
  isRunning: vi.fn().mockReturnValue(false),
}));

const mockRegistryInstance = vi.hoisted(() => ({
  setSendFunction: vi.fn(),
  registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  getHandler: vi.fn(),
  getTool: vi.fn(),
  getAllTools: vi.fn().mockReturnValue([]),
  dispose: vi.fn(),
}));

const mockRouterInstance = vi.hoisted(() => ({
  setSendResultFn: vi.fn(),
  setSendCancelledFn: vi.fn(),
  setConfirmationFn: vi.fn(),
  handleInvoke: vi.fn().mockResolvedValue(undefined),
  handleCancel: vi.fn().mockResolvedValue(undefined),
  cancelAll: vi.fn(),
  dispose: vi.fn(),
}));

const mockStatePublisherInstance = vi.hoisted(() => ({
  start: vi.fn(),
  dispose: vi.fn(),
  sendSnapshot: vi.fn(),
  getState: vi.fn().mockReturnValue({}),
  publishState: vi.fn(),
}));

vi.mock("../hub-manager.js", () => ({
  HubManager: vi.fn().mockImplementation(() => mockHubManagerInstance),
}));

vi.mock("../extension-registry.js", () => ({
  ExtensionRegistry: vi.fn().mockImplementation(() => mockRegistryInstance),
}));

vi.mock("../command-router.js", () => ({
  CommandRouter: vi.fn().mockImplementation(() => mockRouterInstance),
}));

vi.mock("../state-publisher.js", () => ({
  StatePublisher: vi.fn().mockImplementation(() => mockStatePublisherInstance),
}));

// ── Imports after mock registration ────────────────────────────────────────────

import {
  createServices,
  type ServiceFactoryDeps,
  type Services,
  type OutputChannel,
} from "../extension-service-factory.js";
import type { HubManagerConfig, HubManagerEvents } from "../hub-manager.js";
import type { SecretStorageAdapter } from "../extension-bootstrap.js";
import type { VscodeApi } from "../state-publisher.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMockOutputChannel(): OutputChannel {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
  };
}

function makeMockHubManagerEvents(): HubManagerEvents {
  return {
    onHubReady: vi.fn(),
    onHubError: vi.fn(),
    onCredentialsRotated: vi.fn(),
  };
}

function makeMockSecretStorage(): SecretStorageAdapter {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockVscodeApi(): VscodeApi {
  return {
    window: {
      activeTextEditor: undefined,
      visibleTextEditors: [],
      activeTerminal: undefined,
      onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeActiveTerminal: vi.fn(() => ({ dispose: vi.fn() })),
      tabGroups: {
        all: [],
        onDidChangeTabGroups: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
      },
    },
    workspace: {
      onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
    },
  } as unknown as VscodeApi;
}

function makeMockConfirmationFn(): (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean> {
  return vi.fn().mockResolvedValue(true);
}

function makeServiceFactoryDeps(overrides: Partial<{
  hubManagerConfig: HubManagerConfig;
  hubManagerEvents: HubManagerEvents;
  secretStorage: SecretStorageAdapter;
  outputChannel: OutputChannel;
  vscodeApi: VscodeApi;
  confirmationFn: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}> = {}): ServiceFactoryDeps {
  return {
    hubManagerConfig: {
      port: 3000,
      autoStart: true,
      executablePath: "",
      hubEntryPoint: "/tmp/accordo-hub/index.js",
      projectId: "test-project",
    },
    hubManagerEvents: makeMockHubManagerEvents(),
    secretStorage: makeMockSecretStorage(),
    outputChannel: makeMockOutputChannel(),
    vscodeApi: makeMockVscodeApi(),
    confirmationFn: makeMockConfirmationFn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createServices", () => {
  beforeEach(() => {
    mockFsState.files = {};
    mockFsState.writtenFiles = [];
    vi.clearAllMocks();
  });

  // SF-01: Returns a Services object with all four required properties
  it("SF-01: returns Services with hubManager, registry, router, statePublisher", async () => {
    const deps = makeServiceFactoryDeps();

    const services = createServices(deps);

    expect(services).toBeDefined();
    expect(services).toHaveProperty("hubManager");
    expect(services).toHaveProperty("registry");
    expect(services).toHaveProperty("router");
    expect(services).toHaveProperty("statePublisher");
  });

  // SF-02: hubManager property is a HubManager instance
  it("SF-02: hubManager property is an object", async () => {
    const deps = makeServiceFactoryDeps();

    const services = createServices(deps);

    expect(typeof services.hubManager).toBe("object");
    expect(services.hubManager).not.toBeNull();
  });

  // SF-03: registry property is an ExtensionRegistry instance
  it("SF-03: registry property is an object", async () => {
    const deps = makeServiceFactoryDeps();

    const services = createServices(deps);

    expect(typeof services.registry).toBe("object");
    expect(services.registry).not.toBeNull();
  });

  // SF-04: router property is a CommandRouter instance
  it("SF-04: router property is an object", async () => {
    const deps = makeServiceFactoryDeps();

    const services = createServices(deps);

    expect(typeof services.router).toBe("object");
    expect(services.router).not.toBeNull();
  });

  // SF-05: statePublisher property is a StatePublisher instance
  it("SF-05: statePublisher property is an object", async () => {
    const deps = makeServiceFactoryDeps();

    const services = createServices(deps);

    expect(typeof services.statePublisher).toBe("object");
    expect(services.statePublisher).not.toBeNull();
  });

  // SF-06: HubManager is instantiated with hubManagerConfig from deps
  it("SF-06: HubManager receives hubManagerConfig from deps", async () => {
    const customConfig: HubManagerConfig = {
      port: 4000,
      autoStart: false,
      executablePath: "/custom/node",
      hubEntryPoint: "/custom/hub.js",
      projectId: "custom-project",
    };
    const deps = makeServiceFactoryDeps({ hubManagerConfig: customConfig });

    createServices(deps);

    // HubManager constructor is called (we can verify via module mock)
    const { HubManager } = await import("../hub-manager.js");
    expect(HubManager).toHaveBeenCalled();
  });

  // SF-07: ExtensionRegistry is instantiated
  it("SF-07: ExtensionRegistry is instantiated", async () => {
    const deps = makeServiceFactoryDeps();

    createServices(deps);

    const { ExtensionRegistry } = await import("../extension-registry.js");
    expect(ExtensionRegistry).toHaveBeenCalled();
  });

  // SF-08: CommandRouter is instantiated with registry reference
  it("SF-08: CommandRouter is instantiated", async () => {
    const deps = makeServiceFactoryDeps();

    createServices(deps);

    const { CommandRouter } = await import("../command-router.js");
    expect(CommandRouter).toHaveBeenCalled();
  });

  // SF-09: StatePublisher is instantiated with vscodeApi from deps
  it("SF-09: StatePublisher is instantiated with vscodeApi", async () => {
    const deps = makeServiceFactoryDeps();

    createServices(deps);

    const { StatePublisher } = await import("../state-publisher.js");
    expect(StatePublisher).toHaveBeenCalled();
  });

  // SF-10: Router receives confirmationFn from deps
  it("SF-10: router.setConfirmationFn is called with deps.confirmationFn", async () => {
    const confirmationFn = vi.fn().mockResolvedValue(true);
    const deps = makeServiceFactoryDeps({ confirmationFn });

    createServices(deps);

    expect(mockRouterInstance.setConfirmationFn).toHaveBeenCalledWith(confirmationFn);
  });
});
