/**
 * shared-relay-feature-flag.test.ts — Feature flag integration for shared relay
 *
 * Tests for `accordo.browser.sharedRelay` VS Code setting (SBR-F-050, SBR-F-051).
 *
 * Tests the real activation logic in extension.ts with mocked VS Code, node:net,
 * and shared-relay components. Each test exercises the full activate() flow
 * and verifies the correct relay type is instantiated and registerTools is called.
 *
 * SBR-F-050: sharedRelay=true activates the shared relay path (Owner or Hub)
 * SBR-F-051: sharedRelay=false or shared relay failure falls back to per-window
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserBridgeAPI } from "../types.js";

// ── Shared in-memory filesystem for relay-discovery mock ──────────────────────

const sharedFsState = new Map<string, string>();
const ACCORDO_DIR = "/home/test/.accordo";

// ── VSCode mock factory ────────────────────────────────────────────────────────

function createVscodeMock(sharedRelay: boolean) {
  const state = new Map<string, unknown>();
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(<T>(_key: string, defaultValue: T): T => {
          if (_key === "sharedRelay") return sharedRelay as unknown as T;
          return defaultValue as T;
        }),
      })),
    },
    extensions: {
      getExtension: vi.fn(() => ({ exports: null })),
    },
    window: {
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    Disposable: class Disposable {
      constructor(private readonly fn: () => void) {}
      dispose(): void { this.fn(); }
    },
    _state: state,
    createExtensionContextMock: () => ({
      subscriptions: [] as Array<{ dispose(): void }>,
      globalState: {
        get: vi.fn((k: string) => state.get(k)),
        update: vi.fn(async (k: string, v: unknown) => { state.set(k, v); }),
      },
    }),
  };
}

// ── Mock node:net so findFreePort always resolves ──────────────────────────────

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    createServer: vi.fn(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const server = {
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(cb);
          return server;
        }),
        listen: vi.fn((_port: number, _host: string) => {
          Promise.resolve().then(() => {
            const l = listeners["listening"] ?? [];
            l.forEach((cb) => cb());
          });
          return server;
        }),
        close: vi.fn((cb?: () => void) => { if (cb) cb(); return server; }),
        address: vi.fn(() => ({ port: 40111 })),
      };
      return server;
    }),
  };
});

// ── Mock relay-server, shared-relay-server, shared-relay-client ────────────────

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockIsConnected = vi.fn(() => false);
const mockPush = vi.fn();
const mockIsChromeConnected = vi.fn(() => false);
const mockGetConnectedHubs = vi.fn(() => new Map());

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    isConnected: mockIsConnected,
    push: mockPush,
    request: vi.fn(),
  })),
}));

vi.mock("../shared-relay-server.js", () => ({
  SharedBrowserRelayServer: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    push: mockPush,
    isChromeConnected: mockIsChromeConnected,
    getConnectedHubs: mockGetConnectedHubs,
  })),
}));

vi.mock("../shared-relay-client.js", () => ({
  SharedRelayClient: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    push: mockPush,
    isConnected: mockIsConnected,
    request: vi.fn(),
  })),
}));

// ── Mock relay-discovery ───────────────────────────────────────────────────────

vi.mock("../relay-discovery.js", () => {
  const SHARED_RELAY_FILE = "shared-relay.json";
  const SHARED_RELAY_LOCK_FILE = "shared-relay.json.lock";
  const RELAY_FILE_PATH = `${ACCORDO_DIR}/${SHARED_RELAY_FILE}`;
  const LOCK_FILE_PATH = `${ACCORDO_DIR}/${SHARED_RELAY_LOCK_FILE}`;

  return {
    SHARED_RELAY_FILE,
    SHARED_RELAY_LOCK_FILE,
    readSharedRelayInfo: () => {
      const content = sharedFsState.get(RELAY_FILE_PATH);
      if (!content) return null;
      try { return JSON.parse(content); } catch { return null; }
    },
    writeSharedRelayInfo: (info: Record<string, unknown>) => {
      sharedFsState.set(RELAY_FILE_PATH, JSON.stringify(info));
    },
    // Controlled via sharedRelayDiscoveryMock.isRelayAlive
    isRelayAlive: () => sharedRelayDiscoveryMock.isRelayAlive,
    acquireRelayLock: () => sharedRelayDiscoveryMock.acquireRelayLockResult,
    releaseRelayLock: () => {},
  };
});

// Shared mutable state to control relay-discovery mock behavior per test
const sharedRelayDiscoveryMock = {
  isRelayAlive: false,        // isRelayAlive return value
  acquireRelayLockResult: true, // acquireRelayLock return value
};

// ── Import activate AFTER all mocks ────────────────────────────────────────────

const { activate } = await import("../extension.js");
const vscode = await import("vscode");
const createExtensionContextMock = (vscode as Record<string, unknown>).createExtensionContextMock as (...args: unknown[]) => ReturnType<typeof vi.fn>;

function makeBridgeMock() {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
    invokeTool: vi.fn().mockResolvedValue({ threads: [], total: 0, hasMore: false }),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("SBR-F-050: sharedRelay=true activates shared relay path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFsState.clear();
    // Reset vscode mock to sharedRelay=true
    const mock = createVscodeMock(true);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mock.workspace.getConfiguration;
    (vscode.extensions as Record<string, unknown>).getExtension = mock.extensions.getExtension;
  });

  it("SBR-F-050: when sharedRelay=true and no existing relay, SharedBrowserRelayServer is created (Owner path)", async () => {
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // SharedBrowserRelayServer should have been constructed (owner path)
    const { SharedBrowserRelayServer } = await import("../shared-relay-server.js");
    expect(SharedBrowserRelayServer).toHaveBeenCalled();

    // registerTools must be called (this was the blocker)
    expect(bridge.registerTools).toHaveBeenCalled();
  });

  it("SBR-F-050: when sharedRelay=true and existing relay found, SharedRelayClient is created (Hub path)", async () => {
    // Pre-write a valid shared-relay.json and mark it as alive so Hub path is triggered
    const aliveInfo = {
      port: 40111,
      pid: 99999,
      token: "hub-token-xyz",
      startedAt: new Date().toISOString(),
      ownerHubId: "owner-uuid",
    };
    sharedFsState.set(`${ACCORDO_DIR}/shared-relay.json`, JSON.stringify(aliveInfo));
    // Make isRelayAlive return true so the Hub path is triggered (not Owner path)
    sharedRelayDiscoveryMock.isRelayAlive = true;

    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // SharedRelayClient should have been constructed (Hub path)
    const { SharedRelayClient } = await import("../shared-relay-client.js");
    expect(SharedRelayClient).toHaveBeenCalled();

    // registerTools must be called
    expect(bridge.registerTools).toHaveBeenCalled();

    // Reset mock state
    sharedRelayDiscoveryMock.isRelayAlive = false;
  });

  it("SBR-F-050: registerTools is called in shared mode (Owner path)", async () => {
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [extId, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string }>];
    expect(extId).toBe("accordo.accordo-browser");
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_get_page_map");
    expect(toolNames).toContain("accordo_browser_wait_for");
    expect(toolNames).toContain("accordo_browser_get_text_map");
  });

  it("SBR-F-050: registerTools is called in shared mode (Hub path)", async () => {
    // Pre-write valid shared-relay.json
    sharedFsState.set(
      `${ACCORDO_DIR}/shared-relay.json`,
      JSON.stringify({
        port: 40111, pid: 99999, token: "hub-token",
        startedAt: new Date().toISOString(), ownerHubId: "owner-1",
      }),
    );

    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(bridge.registerTools).toHaveBeenCalledOnce();
  });
});

describe("SBR-F-051: sharedRelay=false or shared relay failure falls back to per-window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFsState.clear();
  });

  it("SBR-F-051: when sharedRelay=false, BrowserRelayServer is created (not shared relay classes)", async () => {
    // Override vscode mock to return sharedRelay=false
    const mockVscode = createVscodeMock(false);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;

    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // BrowserRelayServer should be constructed (per-window path)
    const { BrowserRelayServer } = await import("../relay-server.js");
    expect(BrowserRelayServer).toHaveBeenCalled();

    // Shared relay classes should NOT be constructed
    const { SharedBrowserRelayServer } = await import("../shared-relay-server.js");
    const { SharedRelayClient } = await import("../shared-relay-client.js");
    expect(SharedBrowserRelayServer).not.toHaveBeenCalled();
    expect(SharedRelayClient).not.toHaveBeenCalled();

    // registerTools must be called
    expect(bridge.registerTools).toHaveBeenCalled();
  });

  it("SBR-F-051: when sharedRelay=false, registerTools is called with correct extension ID", async () => {
    const mockVscode = createVscodeMock(false);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;

    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [extId] = bridge.registerTools.mock.calls[0] as [string, unknown[]];
    expect(extId).toBe("accordo.accordo-browser");
  });

  it("SBR-F-051: when sharedRelay=true but lock cannot be acquired, falls back to per-window BrowserRelayServer", async () => {
    // Override acquireRelayLock to return false (lock contention) so Owner path falls back to per-window
    sharedRelayDiscoveryMock.acquireRelayLockResult = false;

    const mockVscode = createVscodeMock(true);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;

    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const context = createExtensionContextMock();
    await activate(context as never);

    // Per-window BrowserRelayServer should be created (fallback)
    const { BrowserRelayServer } = await import("../relay-server.js");
    expect(BrowserRelayServer).toHaveBeenCalled();

    // registerTools must be called even in fallback
    expect(bridge.registerTools).toHaveBeenCalled();

    // Reset mock state
    sharedRelayDiscoveryMock.acquireRelayLockResult = true;
  });
});

describe("SBR-NF-003: BrowserRelayLike interface unchanged — tools work in both modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFsState.clear();
  });

  it("SBR-NF-003: tools registered in shared mode include get_page_map, wait_for, text_map, semantic_graph", async () => {
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const mockVscode = createVscodeMock(true);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;

    const context = createExtensionContextMock();
    await activate(context as never);

    const [, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string }>];
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_get_page_map");
    expect(toolNames).toContain("accordo_browser_wait_for");
    expect(toolNames).toContain("accordo_browser_get_text_map");
    expect(toolNames).toContain("accordo_browser_get_semantic_graph");
    expect(toolNames).toContain("accordo_browser_diff_snapshots");
  });

  it("SBR-NF-003: tools registered in per-window mode include the same tool set", async () => {
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });

    const mockVscode = createVscodeMock(false);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;

    const context = createExtensionContextMock();
    await activate(context as never);

    const [, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string }>];
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_get_page_map");
    expect(toolNames).toContain("accordo_browser_wait_for");
    expect(toolNames).toContain("accordo_browser_get_text_map");
    expect(toolNames).toContain("accordo_browser_diff_snapshots");
  });
});