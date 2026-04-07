/**
 * Tests for extension-composition.ts
 * Requirements: requirements-bridge.md §3, §5, §8, §9
 * Reconnect scenarios: docs/10-architecture/reload-reconnect-test-scenarios.md §7–8
 *
 * Phase B design:
 * - All functions throw "not implemented" on the stub → all tests are RED.
 * - Mocks: vscode API, node:fs, node:ws, WsClient, HubManager, agent-config, etc.
 * - Tests cover all public functions and their wiring behaviours.
 *
 * API checklist:
 * - buildHubManagerEvents(deps: CompositionDeps) → HubManagerEvents  [8 tests]  (6 existing + AR-05, AR-06)
 * - makeWsClientEvents(deps: CompositionDeps) → WsClientEvents      [7 tests]
 * - composeExtension(deps, registerFn) → ComposedBridgeAPI           [7 tests]
 * - registerCommands(deps, registerFn) → Disposable[]               [4 tests]
 * - cleanupExtension(state, services) → Promise<void>              [8 tests]  (5 existing + RCE-01, RCE-02, RCE-03)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

// ── Mock WebSocket (node:ws) ───────────────────────────────────────────────────

const mockWsState = vi.hoisted(() => ({
  instance: null as {
    url: string;
    constructorOptions: Record<string, unknown>;
    sent: string[];
    lastCloseCode?: number;
    lastCloseReason?: string;
    triggerOpen(): void;
    triggerMessage(data: unknown): void;
    triggerClose(code: number, reason?: string): void;
    parseSent(): unknown[];
  } | null,
}));

vi.mock("ws", async () => {
  const { EventEmitter: EE } = await import("node:events");
  const state = mockWsState;

  class MockWS extends EE {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 0;
    readonly sent: string[] = [];
    lastCloseCode: number | undefined = undefined;
    lastCloseReason: string | undefined = undefined;

    constructor(
      public readonly url: string,
      public readonly constructorOptions: Record<string, unknown> = {},
    ) {
      super();
      (state as typeof mockWsState).instance = this as unknown as typeof state.instance;
    }

    send(data: string | Buffer) {
      this.sent.push(typeof data === "string" ? data : data.toString());
    }

    close(code?: number, reason?: string) {
      this.lastCloseCode = code;
      this.lastCloseReason = reason;
      this.readyState = 3;
    }

    triggerOpen() {
      this.readyState = 1;
      this.emit("open");
    }

    triggerMessage(data: unknown) {
      const buf = Buffer.from(JSON.stringify(data));
      this.emit("message", buf, { binary: false });
    }

    triggerClose(code: number, reason = "") {
      this.readyState = 3;
      this.emit("close", code, Buffer.from(reason));
    }

    parseSent(): unknown[] {
      return this.sent.map((s) => JSON.parse(s));
    }
  }

  return { default: MockWS, WebSocket: MockWS };
});

// ── Mock WsClient ─────────────────────────────────────────────────────────────

const mockWsClientInstance = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  sendToolRegistry: vi.fn(),
  sendStateSnapshot: vi.fn(),
  isConnected: vi.fn().mockReturnValue(false),
}));

vi.mock("../ws-client.js", () => ({
  WsClient: vi.fn().mockImplementation(() => mockWsClientInstance),
}));

// ── Mock HubManager ────────────────────────────────────────────────────────────

const mockHubManagerInstance = vi.hoisted(() => ({
  activate: vi.fn().mockResolvedValue(undefined),
  deactivate: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  getPort: vi.fn().mockReturnValue(3000),
  isRunning: vi.fn().mockReturnValue(false),
  softDisconnect: vi.fn().mockResolvedValue(true),
}));

vi.mock("../hub-manager.js", () => ({
  HubManager: vi.fn().mockImplementation(() => mockHubManagerInstance),
}));

// ── Mock ExtensionRegistry ──────────────────────────────────────────────────────

const mockRegistryInstance = vi.hoisted(() => ({
  setSendFunction: vi.fn(),
  registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  getHandler: vi.fn(),
  getTool: vi.fn(),
  getAllTools: vi.fn().mockReturnValue([]),
  dispose: vi.fn(),
}));

vi.mock("../extension-registry.js", () => ({
  ExtensionRegistry: vi.fn().mockImplementation(() => mockRegistryInstance),
}));

// ── Mock CommandRouter ─────────────────────────────────────────────────────────

const mockRouterInstance = vi.hoisted(() => ({
  setSendResultFn: vi.fn(),
  setSendCancelledFn: vi.fn(),
  setConfirmationFn: vi.fn(),
  handleInvoke: vi.fn().mockResolvedValue(undefined),
  handleCancel: vi.fn().mockResolvedValue(undefined),
  cancelAll: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../command-router.js", () => ({
  CommandRouter: vi.fn().mockImplementation(() => mockRouterInstance),
}));

// ── Mock StatePublisher ────────────────────────────────────────────────────────

const mockStatePublisherInstance = vi.hoisted(() => ({
  start: vi.fn(),
  dispose: vi.fn(),
  sendSnapshot: vi.fn(),
  getState: vi.fn().mockReturnValue({}),
  publishState: vi.fn(),
}));

vi.mock("../state-publisher.js", () => ({
  StatePublisher: vi.fn().mockImplementation(() => mockStatePublisherInstance),
}));

// ── Mock agent-config (writeAgentConfigs) ─────────────────────────────────────

const mockWriteAgentConfigs = vi.hoisted(() => vi.fn());

vi.mock("../agent-config.js", () => ({
  writeAgentConfigs: mockWriteAgentConfigs,
}));

// ── Imports after mock registration ───────────────────────────────────────────

import type { WsClient } from "../ws-client.js";
import type { WsClientEvents } from "../ws-client.js";
import type { HubManagerEvents } from "../hub-manager.js";
import type {
  BootstrapResult,
  BridgeConfig,
  SecretStorageAdapter,
} from "../extension-bootstrap.js";
import type { Services } from "../extension-service-factory.js";
import type { IDEState } from "@accordo/bridge-types";
import {
  buildHubManagerEvents,
  makeWsClientEvents,
  composeExtension,
  registerCommands,
  cleanupExtension,
  type ExtensionState,
  type CompositionDeps,
  type ComposedBridgeAPI,
} from "../extension-composition.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMockOutputChannel() {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
  };
}

function makeMockVscodeContext(overrides: Partial<{
  globalStorageUri: string;
  secrets: Record<string, string>;
  extensions: { all: { id: string }[] };
}> = {}): {
  globalStorageUri: { fsPath: string };
  secrets: Record<string, string>;
  subscriptions: unknown[];
} {
  return {
    globalStorageUri: {
      fsPath: overrides.globalStorageUri ?? "/tmp/accordo-test-storage",
    },
    secrets: overrides.secrets ?? {},
    subscriptions: [],
  };
}

function makeMockVscodeEventEmitter(): BootstrapResult["connectionStatusEmitter"] {
  const listeners: Array<(e: boolean) => unknown> = [];
  return {
    event: (listener: (e: boolean) => unknown): { dispose: () => void } => {
      listeners.push(listener);
      return { dispose: () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); } };
    },
    fire: (e: boolean): void => {
      for (const l of listeners) l(e);
    },
    dispose: (): void => { listeners.length = 0; },
  };
}

function makeMockBootstrapResult(overrides: Partial<{
  outputChannel: ReturnType<typeof makeMockOutputChannel>;
  mcpConfigPath: string;
  config: BridgeConfig;
  secretStorage: SecretStorageAdapter;
  connectionStatusEmitter: BootstrapResult["connectionStatusEmitter"];
  updateStatusBar: () => void;
  pushDisposable: (d: unknown) => void;
}> = {}): BootstrapResult {
  const outputChannel = makeMockOutputChannel();
  return {
    outputChannel: (overrides.outputChannel ?? outputChannel) as unknown as BootstrapResult["outputChannel"],
    mcpConfigPath: overrides.mcpConfigPath ?? "/tmp/.vscode/mcp.json",
    config: overrides.config ?? {
      port: 3000,
      autoStart: true,
      executablePath: "",
      wantCopilot: true,
      wantOpencode: true,
      wantClaude: true,
      workspaceRoot: "",
    },
    secretStorage: overrides.secretStorage ?? {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    connectionStatusEmitter: overrides.connectionStatusEmitter ?? makeMockVscodeEventEmitter(),
    updateStatusBar: overrides.updateStatusBar ?? vi.fn(),
    pushDisposable: overrides.pushDisposable ?? vi.fn(),
    hubManagerConfig: { port: 3000, autoStart: true, executablePath: "", hubEntryPoint: "" } as unknown as BootstrapResult["hubManagerConfig"],
    setStatusBarUpdater: vi.fn() as unknown as BootstrapResult["setStatusBarUpdater"],
    statusBarItem: { text: "" } as BootstrapResult["statusBarItem"],
  };
}

function makeMockServices(): Services {
  return {
    hubManager: mockHubManagerInstance as unknown as Services["hubManager"],
    registry: mockRegistryInstance as unknown as Services["registry"],
    router: mockRouterInstance as unknown as Services["router"],
    statePublisher: mockStatePublisherInstance as unknown as Services["statePublisher"],
    sendBridge: { sendSnapshot: vi.fn(), sendUpdate: vi.fn() } as unknown as Services["sendBridge"],
  };
}

function makeMockExtensionState(overrides: Partial<ExtensionState> = {}): ExtensionState {
  return {
    wsClient: null,
    currentHubToken: "",
    currentHubPort: 0,
    ...overrides,
  };
}

function makeCompositionDeps(overrides: Partial<{
  bootstrap: BootstrapResult;
  services: Services;
  state: ExtensionState;
}> = {}): CompositionDeps {
  return {
    bootstrap: makeMockBootstrapResult(),
    services: makeMockServices(),
    state: makeMockExtensionState(),
    ...overrides,
  };
}

function makeMockRegisterFn() {
  return vi.fn().mockReturnValue({ dispose: vi.fn() });
}

// ── buildHubManagerEvents tests ────────────────────────────────────────────────

describe("buildHubManagerEvents", () => {
  beforeEach(() => {
    mockFsState.files = {};
    mockFsState.writtenFiles = [];
    vi.clearAllMocks();
  });

  // CE-01: Returns an object with all HubManagerEvents callbacks
  it("CE-01: returns object with onHubReady, onHubError, onCredentialsRotated", () => {
    const deps = makeCompositionDeps();

    const events = buildHubManagerEvents(deps);

    expect(events).toBeDefined();
    expect(typeof events.onHubReady).toBe("function");
    expect(typeof events.onHubError).toBe("function");
    expect(typeof events.onCredentialsRotated).toBe("function");
  });

  // CE-02: onHubReady is a HubManagerEvents callback
  it("CE-02: onHubReady accepts (port: number, token: string)", () => {
    const deps = makeCompositionDeps();

    const events = buildHubManagerEvents(deps);

    // Should not throw when called with correct signature
    expect(() => events.onHubReady(3000, "test-token")).not.toThrow();
  });

  // CE-03: onHubError is a HubManagerEvents callback
  it("CE-03: onHubError accepts (error: Error)", () => {
    const deps = makeCompositionDeps();

    const events = buildHubManagerEvents(deps);

    expect(() => events.onHubError(new Error("test error"))).not.toThrow();
  });

  // CE-04: onCredentialsRotated is a HubManagerEvents callback
  it("CE-04: onCredentialsRotated accepts (token: string, secret: string)", () => {
    const deps = makeCompositionDeps();

    const events = buildHubManagerEvents(deps);

    expect(() => events.onCredentialsRotated("new-token", "new-secret")).not.toThrow();
  });

  // CE-05: onHubReady callback is callable (wiring verified via integration)
  it("CE-05: onHubReady is callable without throwing", () => {
    const deps = makeCompositionDeps();

    const events = buildHubManagerEvents(deps);

    // Call with valid args - should not throw
    events.onHubReady(3000, "test-token");
  });

  // CE-06: onCredentialsRotated callback is callable without throwing
  it("CE-06: onCredentialsRotated is callable without throwing", () => {
    const deps = makeCompositionDeps();

    const events = buildHubManagerEvents(deps);

    events.onCredentialsRotated("new-token", "new-secret");
  });
});

// ── makeWsClientEvents tests ───────────────────────────────────────────────────

describe("makeWsClientEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CE-07: Returns an object with all WsClientEvents callbacks
  it("CE-07: returns object with all WsClientEvents callbacks", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    expect(events).toBeDefined();
    expect(typeof events.onConnected).toBe("function");
    expect(typeof events.onDisconnected).toBe("function");
    expect(typeof events.onAuthFailure).toBe("function");
    expect(typeof events.onProtocolMismatch).toBe("function");
    expect(typeof events.onInvoke).toBe("function");
    expect(typeof events.onCancel).toBe("function");
    expect(typeof events.onGetState).toBe("function");
  });

  // CE-08: onConnected is callable without throwing
  it("CE-08: onConnected is callable without throwing", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    expect(() => events.onConnected()).not.toThrow();
  });

  // CE-09: onDisconnected is a WsClientEvents callback
  it("CE-09: onDisconnected accepts (code: number, reason: string)", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    expect(() => events.onDisconnected(1000, "normal close")).not.toThrow();
  });

  // CE-10: onAuthFailure is a WsClientEvents callback
  it("CE-10: onAuthFailure is callable without throwing", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    expect(() => events.onAuthFailure()).not.toThrow();
  });

  // CE-11: onProtocolMismatch is a WsClientEvents callback
  it("CE-11: onProtocolMismatch accepts (message: string)", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    expect(() => events.onProtocolMismatch("version mismatch")).not.toThrow();
  });

  // CE-12: onInvoke is a WsClientEvents callback
  it("CE-12: onInvoke is callable with InvokeMessage", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    const mockMessage = {
      type: "invoke" as const,
      id: "invoke-1",
      tool: "test:tool",
      args: {},
      timeout: 5000,
    };

    expect(() => events.onInvoke(mockMessage)).not.toThrow();
  });

  // CE-13: onCancel is a WsClientEvents callback
  it("CE-13: onCancel is callable with CancelMessage", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    const mockMessage = {
      type: "cancel" as const,
      id: "invoke-1",
    };

    expect(() => events.onCancel(mockMessage)).not.toThrow();
  });

  // CE-14: onGetState is a WsClientEvents callback
  it("CE-14: onGetState is callable with GetStateMessage", () => {
    const deps = makeCompositionDeps();

    const events = makeWsClientEvents(deps);

    const mockMessage = {
      type: "getState" as const,
      id: "state-1",
    };

    expect(() => events.onGetState(mockMessage)).not.toThrow();
  });
});

// ── composeExtension tests ─────────────────────────────────────────────────────

describe("composeExtension", () => {
  beforeEach(() => {
    mockFsState.files = {};
    mockFsState.writtenFiles = [];
    vi.clearAllMocks();
  });

  // CE-15: Returns a ComposedBridgeAPI with all required methods
  it("CE-15: returns object with registerTools, publishState, getState, isConnected, onConnectionStatusChanged", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const api = composeExtension(deps, registerFn);

    expect(api).toBeDefined();
    expect(typeof api.registerTools).toBe("function");
    expect(typeof api.publishState).toBe("function");
    expect(typeof api.getState).toBe("function");
    expect(typeof api.isConnected).toBe("function");
    expect(typeof api.onConnectionStatusChanged).toBe("function");
    expect(typeof api.invokeTool).toBe("function");
  });

  // CE-16: registerTools accepts extensionId and tools array
  it("CE-16: registerTools accepts extensionId and tools array", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const api = composeExtension(deps, registerFn);

    const tools = [
      {
        name: "test:tool",
        handler: vi.fn().mockResolvedValue("result"),
      },
    ];

    expect(() => api.registerTools("test.extension", tools)).not.toThrow();
  });

  // CE-17: publishState accepts extensionId and state
  it("CE-17: publishState accepts extensionId and state object", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const api = composeExtension(deps, registerFn);

    expect(() => api.publishState("test.extension", { key: "value" })).not.toThrow();
  });

  // CE-18: getState returns IDEState
  it("CE-18: getState is callable and returns something", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const api = composeExtension(deps, registerFn);

    const state = api.getState();
    expect(state).toBeDefined();
  });

  // CE-19: isConnected returns boolean
  it("CE-19: isConnected returns boolean", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const api = composeExtension(deps, registerFn);

    const connected = api.isConnected();
    expect(typeof connected).toBe("boolean");
  });

  // CE-20: onConnectionStatusChanged is an Event<boolean>
  it("CE-20: onConnectionStatusChanged is an Event<boolean>", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const api = composeExtension(deps, registerFn);

    expect(typeof api.onConnectionStatusChanged).toBe("function");
    // Event returns a disposable
    const disposable = api.onConnectionStatusChanged(vi.fn());
    expect(typeof disposable.dispose).toBe("function");
  });

  // CE-21: invokeTool is callable with toolName, args, and optional timeout
  it("CE-21: invokeTool is callable with toolName, args, timeout", async () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const api = composeExtension(deps, registerFn);

    const result = await api.invokeTool("test:tool", { arg: 1 }, 5000);
    // Result may be undefined or a value - we just verify it doesn't throw
    expect(result).toBeDefined();
  });
});

// ── registerCommands tests ─────────────────────────────────────────────────────

describe("registerCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CE-22: Returns an array of Disposables
  it("CE-22: returns an array of Disposable objects", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const disposables = registerCommands(deps, registerFn);

    expect(Array.isArray(disposables)).toBe(true);
    expect(disposables.length).toBeGreaterThan(0);
    for (const d of disposables) {
      expect(typeof d.dispose).toBe("function");
    }
  });

  // CE-23: registerFn is called for each command
  it("CE-23: registerFn is called for each command", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    registerCommands(deps, registerFn);

    expect(registerFn).toHaveBeenCalled();
  });

  // CE-24: Each disposable has a dispose method
  it("CE-24: each disposable has a dispose method", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const disposables = registerCommands(deps, registerFn);

    for (const d of disposables) {
      expect(typeof d.dispose).toBe("function");
    }
  });

  // CE-25: disposing a disposable does not throw
  it("CE-25: disposing a disposable does not throw", () => {
    const deps = makeCompositionDeps();
    const registerFn = makeMockRegisterFn();

    const disposables = registerCommands(deps, registerFn);

    for (const d of disposables) {
      expect(() => d.dispose()).not.toThrow();
    }
  });
});

// ── cleanupExtension tests ─────────────────────────────────────────────────────

describe("cleanupExtension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CE-26: cleanupExtension is async and does not throw
  it("CE-26: cleanupExtension is async and resolves without throwing", async () => {
    const state = makeMockExtensionState({
      wsClient: mockWsClientInstance as unknown as WsClient,
    });
    const services = makeMockServices();

    await expect(cleanupExtension(state, services)).resolves.not.toThrow();
  });

  // CE-27: cleanupExtension disconnects wsClient when present
  it("CE-27: cleanupExtension disconnects wsClient when wsClient is set", async () => {
    const state = makeMockExtensionState({
      wsClient: mockWsClientInstance as unknown as WsClient,
    });
    const services = makeMockServices();

    await cleanupExtension(state, services);

    expect(mockWsClientInstance.disconnect).toHaveBeenCalled();
  });

  // CE-28: cleanupExtension disposes statePublisher
  it("CE-28: cleanupExtension disposes statePublisher", async () => {
    const state = makeMockExtensionState();
    const services = makeMockServices();

    await cleanupExtension(state, services);

    expect(mockStatePublisherInstance.dispose).toHaveBeenCalled();
  });

  // CE-29: cleanupExtension cancels router in-flight operations
  it("CE-29: cleanupExtension calls router.cancelAll", async () => {
    const state = makeMockExtensionState();
    const services = makeMockServices();

    await cleanupExtension(state, services);

    expect(mockRouterInstance.cancelAll).toHaveBeenCalled();
  });

  // CE-30: cleanupExtension disposes registry when wsClient is set
  it("CE-30: cleanupExtension disposes registry", async () => {
    const state = makeMockExtensionState({
      wsClient: mockWsClientInstance as unknown as WsClient,
    });
    const services = makeMockServices();

    await cleanupExtension(state, services);

    expect(mockRegistryInstance.dispose).toHaveBeenCalled();
  });
});

// ── cleanupExtension — reconnect scenarios (RCE-01 to RCE-03) ─────────────────
// Scenarios from: docs/10-architecture/reload-reconnect-test-scenarios.md §8
// These verify that cleanupExtension() calls softDisconnect() BEFORE WsClient disconnect.

describe("cleanupExtension() — reconnect scenarios (RCE-01 to RCE-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RCE-01: cleanupExtension() calls hubManager.softDisconnect() before wsClient.disconnect()
  it("RCE-01: cleanupExtension() calls hubManager.softDisconnect() before wsClient.disconnect()", async () => {
    const callOrder: string[] = [];

    mockHubManagerInstance.softDisconnect.mockImplementation(async () => {
      callOrder.push("softDisconnect");
      return true;
    });
    mockWsClientInstance.disconnect.mockImplementation(async () => {
      callOrder.push("disconnect");
    });

    const state = makeMockExtensionState({
      wsClient: mockWsClientInstance as unknown as WsClient,
    });
    const services = makeMockServices();

    await cleanupExtension(state, services);

    expect(mockHubManagerInstance.softDisconnect).toHaveBeenCalled();
    expect(mockWsClientInstance.disconnect).toHaveBeenCalled();
    // softDisconnect must be called before wsClient.disconnect
    expect(callOrder.indexOf("softDisconnect")).toBeLessThan(
      callOrder.indexOf("disconnect"),
    );
  });

  // RCE-02: cleanupExtension() full order: softDisconnect → wsClient.disconnect → router.cancelAll → statePublisher.dispose
  it("RCE-02: cleanupExtension() order: softDisconnect → wsClient.disconnect → router.cancelAll → statePublisher.dispose", async () => {
    const callOrder: string[] = [];

    mockHubManagerInstance.softDisconnect.mockImplementation(async () => {
      callOrder.push("softDisconnect");
      return true;
    });
    mockWsClientInstance.disconnect.mockImplementation(async () => {
      callOrder.push("disconnect");
    });
    mockRouterInstance.cancelAll.mockImplementation(() => {
      callOrder.push("cancelAll");
    });
    mockStatePublisherInstance.dispose.mockImplementation(() => {
      callOrder.push("dispose");
    });

    const state = makeMockExtensionState({
      wsClient: mockWsClientInstance as unknown as WsClient,
    });
    const services = makeMockServices();

    await cleanupExtension(state, services);

    expect(callOrder).toContain("softDisconnect");
    expect(callOrder).toContain("disconnect");
    expect(callOrder).toContain("cancelAll");
    expect(callOrder).toContain("dispose");

    const idxSoft = callOrder.indexOf("softDisconnect");
    const idxDisc = callOrder.indexOf("disconnect");
    const idxCancel = callOrder.indexOf("cancelAll");
    const idxDispose = callOrder.indexOf("dispose");

    expect(idxSoft).toBeLessThan(idxDisc);
    expect(idxDisc).toBeLessThan(idxCancel);
    expect(idxCancel).toBeLessThan(idxDispose);
  });

  // RCE-03: softDisconnect() failure does NOT prevent remaining cleanup steps
  it("RCE-03: softDisconnect() failure does NOT prevent wsClient.disconnect() from running", async () => {
    mockHubManagerInstance.softDisconnect.mockRejectedValue(
      new Error("soft disconnect failed"),
    );

    const state = makeMockExtensionState({
      wsClient: mockWsClientInstance as unknown as WsClient,
    });
    const services = makeMockServices();

    // Must not throw even though softDisconnect rejects
    await expect(cleanupExtension(state, services)).resolves.toBeUndefined();

    // All other cleanup steps must still run
    expect(mockWsClientInstance.disconnect).toHaveBeenCalled();
    expect(mockRouterInstance.cancelAll).toHaveBeenCalled();
    expect(mockStatePublisherInstance.dispose).toHaveBeenCalled();
    expect(mockRegistryInstance.dispose).toHaveBeenCalled();
  });
});

// ── buildHubManagerEvents — reconnect: isReconnect flag (AR-05 to AR-06) ──────
// Scenarios from: docs/10-architecture/reload-reconnect-test-scenarios.md §5
// Verifies that the onHubReady callback skips writeAgentConfigs when isReconnect=true.

describe("buildHubManagerEvents() — reconnect: isReconnect flag (AR-05 to AR-06)", () => {
  beforeEach(() => {
    mockFsState.files = {};
    mockFsState.writtenFiles = [];
    vi.clearAllMocks();
    // Prevent secretStorage.get from hanging
    vi.spyOn(
      makeCompositionDeps().bootstrap.secretStorage,
      "get",
    ).mockResolvedValue(undefined);
  });

  // AR-05: onHubReady(port, token, true) — reconnect path — does NOT call writeAgentConfigs
  it("AR-05: onHubReady(port, token, isReconnect=true) skips writeAgentConfigs()", () => {
    const deps = makeCompositionDeps();
    const events = buildHubManagerEvents(deps);

    events.onHubReady(3000, "test-token", true);

    expect(mockWriteAgentConfigs).not.toHaveBeenCalled();
  });

  // AR-06: onHubReady(port, token) — fresh-spawn path — DOES call writeAgentConfigs
  it("AR-06: onHubReady(port, token) without isReconnect flag calls writeAgentConfigs()", () => {
    const deps = makeCompositionDeps();
    const events = buildHubManagerEvents(deps);

    // Call without isReconnect (fresh spawn path)
    events.onHubReady(3000, "test-token");

    expect(mockWriteAgentConfigs).toHaveBeenCalledOnce();
    expect(mockWriteAgentConfigs).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000, token: "test-token" }),
    );
  });
});
