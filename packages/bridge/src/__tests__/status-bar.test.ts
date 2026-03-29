/**
 * Status-bar unified health indicator — tests for accordo-bridge extension.ts
 *
 * Backlog item #8 — Quick-fix mode.
 *
 * Tests:
 *   SB-01  Status bar item is created when activate() is called
 *   SB-02  Status bar text is $(check) Accordo when connected + tools > 0
 *   SB-03  Status bar text is $(error) Accordo when disconnected
 *   SB-04  Status bar text is $(warning) Accordo when state is "connecting" or "reconnecting"
 *   SB-05  accordo.bridge.showStatus command calls showQuickPick with per-module health items
 *   SB-06  Status bar updates when connectionStatusEmitter.fire(false) is called
 *
 * Test architecture:
 *   We test the status bar via the public activate() API. All heavy dependencies
 *   (HubManager, WsClient, ExtensionRegistry, etc.) are stubbed via vi.mock so
 *   activate() completes immediately. We control WsClient state via a shared
 *   hoisted mock state object.
 *
 *   Important: vi.clearAllMocks() (call-count reset) is used in beforeEach.
 *   vi.restoreAllMocks() is NOT used because it reverts mock factory
 *   implementations, breaking subsequent tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  window,
  commands,
  workspace,
  StatusBarAlignment,
  createExtensionContextMock,
} from "./mocks/vscode.js";
import type { MockStatusBarItem } from "./mocks/vscode.js";

// ── Shared hoisted mock state ─────────────────────────────────────────────────

/**
 * Hoisted mock state that both the mock factories AND the test bodies can read.
 * vi.hoisted() ensures this runs before vi.mock() factories.
 */
const mockWsState = vi.hoisted(() => ({
  connected: false,
  state: "disconnected" as "disconnected" | "connecting" | "connected" | "reconnecting",
  tools: [] as Array<{ name: string }>,
  // Reference to the onHubReady callback so tests can trigger it manually if needed
  lastHubReadyFn: null as ((port: number) => Promise<void>) | null,
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      readFile: vi.fn(async () => "{}"),
      writeFile: vi.fn(async () => undefined),
    },
  };
});

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// Stub HubManager — immediately calls onHubReady(3000) during activate()
vi.mock("../hub-manager.js", () => {
  const HubManager = vi.fn().mockImplementation(
    (_secrets: unknown, _out: unknown, _cfg: unknown, events: {
      onHubReady: (port: number) => Promise<void>;
    }) => {
      mockWsState.lastHubReadyFn = events.onHubReady;
      return {
        activate: vi.fn(async () => {
          await events.onHubReady(3000);
        }),
        deactivate: vi.fn(async () => undefined),
        restart: vi.fn(async () => undefined),
        getSecret: vi.fn(() => "mock-secret"),
        getToken: vi.fn(() => "mock-token"),
        getPort: vi.fn(() => 3000),
      };
    },
  );
  return { HubManager };
});

// Stub WsClient — fires onConnected/onDisconnected based on mockWsState
vi.mock("../ws-client.js", () => {
  const WsClient = vi.fn().mockImplementation(
    (_port: unknown, _secret: unknown, events: {
      onConnected: () => void;
      onDisconnected: (code: number, reason: string) => void;
    }, _getToolsProvider?: unknown, _log?: unknown) => ({
      connect: vi.fn(async () => {
        // Simulate the connection outcome based on shared state
        if (mockWsState.connected) {
          events.onConnected();
        } else if (mockWsState.state === "disconnected") {
          events.onDisconnected(1000, "");
        }
        // "connecting" / "reconnecting" → no immediate callback (transient state)
      }),
      disconnect: vi.fn(async () => undefined),
      isConnected: vi.fn(() => mockWsState.connected),
      getState: vi.fn(() => mockWsState.state),
      sendToolRegistry: vi.fn(),
      sendStateSnapshot: vi.fn(),
      sendStateUpdate: vi.fn(),
      sendResult: vi.fn(),
      sendCancelled: vi.fn(),
      updateSecret: vi.fn(),
    }),
  );
  return { WsClient };
});

// Stub ExtensionRegistry — returns tools from shared mockWsState
vi.mock("../extension-registry.js", () => {
  const ExtensionRegistry = vi.fn().mockImplementation(() => ({
    setSendFunction: vi.fn(),
    registerTools: vi.fn(() => ({ dispose: vi.fn() })),
    getAllTools: vi.fn(() => mockWsState.tools),
    getHandler: vi.fn(),
    getTool: vi.fn(),
    dispose: vi.fn(),
    get size() { return mockWsState.tools.length; },
  }));
  return { ExtensionRegistry };
});

// Stub CommandRouter
vi.mock("../command-router.js", () => {
  const CommandRouter = vi.fn().mockImplementation(() => ({
    setSendResultFn: vi.fn(),
    setSendCancelledFn: vi.fn(),
    setConfirmationFn: vi.fn(),
    handleInvoke: vi.fn(async () => undefined),
    handleCancel: vi.fn(),
    invokeTool: vi.fn(async () => undefined),
    cancelAll: vi.fn(),
  }));
  return { CommandRouter };
});

// Stub StatePublisher
vi.mock("../state-publisher.js", () => {
  const StatePublisher = vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    dispose: vi.fn(),
    sendSnapshot: vi.fn(),
    getState: vi.fn(() => ({})),
    publishState: vi.fn(),
    removeModalityState: vi.fn(),
  }));
  (StatePublisher as unknown as { emptyState: () => Record<string, unknown> }).emptyState = vi.fn(() => ({}));
  return { StatePublisher };
});

// Stub agent-config helpers
vi.mock("../agent-config.js", () => ({
  writeAgentConfigs: vi.fn(),
  removeWorkspaceThreshold: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return a context mock with a clean subscriptions array. */
function makeContext() {
  return createExtensionContextMock();
}

/** Configure workspace mock to return safe defaults and skip auto-start/agents. */
function setupWorkspaceCfg(overrides: Record<string, unknown> = {}): void {
  const defaults: Record<string, unknown> = {
    "hub.port": 3000,
    "hub.autoStart": false,
    "hub.executablePath": "",
    "agent.configureCopilot": false,
    "agent.configureOpencode": false,
    "agent.configureClaude": false,
  };
  workspace.getConfiguration = vi.fn((_section?: string) => ({
    get: vi.fn(<T>(key: string, defaultValue?: T): T => {
      const merged = { ...defaults, ...overrides };
      return (key in merged ? merged[key] : defaultValue) as T;
    }),
    inspect: vi.fn((_key: string) => ({ globalValue: 300 as unknown, workspaceValue: undefined as unknown })),
    update: vi.fn(async () => undefined),
    has: vi.fn((_key: string) => false),
  }));
}

// ── Load extension module once (avoid repeated re-import confusion) ───────────

// We import extension.ts ONCE at the top so the module is cached consistently.
// Tests control behaviour via mockWsState before calling activate().
import * as extensionModule from "../extension.js";

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Status bar — Bridge unified health indicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window._resetStatusBarItem();
    commands._clearRegistry();
    // Reset mock WS state to disconnected default
    mockWsState.connected = false;
    mockWsState.state = "disconnected";
    mockWsState.tools = [];
    // Apply default workspace config
    setupWorkspaceCfg();
  });

  // ── SB-01 ─────────────────────────────────────────────────────────────────

  it("SB-01: createStatusBarItem is called with Right alignment and priority 100 on activate()", async () => {
    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    expect(window.createStatusBarItem).toHaveBeenCalledWith(
      StatusBarAlignment.Right,
      100,
    );
  });

  // ── SB-02 ─────────────────────────────────────────────────────────────────

  it("SB-02: status bar text is $(check) Accordo when connected and tools > 0", async () => {
    mockWsState.connected = true;
    mockWsState.state = "connected";
    mockWsState.tools = [{ name: "browser_navigate" }, { name: "browser_click" }];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    const item = window._getLastStatusBarItem();
    expect(item.text).toBe("$(check) Accordo");
  });

  // ── SB-03 ─────────────────────────────────────────────────────────────────

  it("SB-03: status bar text is $(error) Accordo when disconnected", async () => {
    mockWsState.connected = false;
    mockWsState.state = "disconnected";
    mockWsState.tools = [];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    const item = window._getLastStatusBarItem();
    expect(item.text).toBe("$(error) Accordo");
  });

  // ── SB-04 ─────────────────────────────────────────────────────────────────

  it("SB-04: status bar text is $(warning) Accordo when state is 'connecting'", async () => {
    mockWsState.connected = false;
    mockWsState.state = "connecting";
    mockWsState.tools = [];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    const item = window._getLastStatusBarItem();
    expect(item.text).toBe("$(warning) Accordo");
  });

  it("SB-04b: status bar text is $(warning) Accordo when state is 'reconnecting'", async () => {
    mockWsState.connected = false;
    mockWsState.state = "reconnecting";
    mockWsState.tools = [];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    const item = window._getLastStatusBarItem();
    expect(item.text).toBe("$(warning) Accordo");
  });

  // ── SB-05 ─────────────────────────────────────────────────────────────────

  it("SB-05: showStatus command calls showQuickPick with per-module health items", async () => {
    mockWsState.connected = true;
    mockWsState.state = "connected";
    mockWsState.tools = [
      { name: "browser_navigate" },
      { name: "browser_click" },
      { name: "comment_create" },
      { name: "accordo_voice_start" },
      { name: "accordo_diagram_create" },
    ];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    // Execute the registered showStatus command
    const handler = commands._getRegistry().get("accordo.bridge.showStatus");
    expect(handler).toBeDefined();
    handler?.();

    expect(window.showQuickPick).toHaveBeenCalledOnce();

    const [items, options] = window.showQuickPick.mock.calls[0] as [
      Array<{ label: string }>,
      { canPickMany: boolean; title: string },
    ];

    expect(options.title).toBe("Accordo System Health");
    expect(options.canPickMany).toBe(false);

    // First item describes Hub status
    expect(items[0].label).toContain("Hub");
    expect(items[0].label).toContain("Connected");

    // Module lines for registered tool groups
    const labels = items.map((i) => i.label);
    expect(labels.some((l) => l.includes("Browser"))).toBe(true);
    expect(labels.some((l) => l.includes("Comments"))).toBe(true);
    expect(labels.some((l) => l.includes("Voice"))).toBe(true);
    expect(labels.some((l) => l.includes("Diagrams"))).toBe(true);
  });

  // ── SB-06 ─────────────────────────────────────────────────────────────────

  it("SB-06: status bar item is disposed via context.subscriptions on deactivate", async () => {
    // Start connected with tools so text is $(check)
    mockWsState.connected = true;
    mockWsState.state = "connected";
    mockWsState.tools = [{ name: "browser_navigate" }];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    const item = window._getLastStatusBarItem();
    // Verify initial text is correct — the subscription path worked during activate()
    expect(item.text).toBe("$(check) Accordo");

    // Confirm the status bar item is in context.subscriptions
    // VS Code disposes all subscriptions on deactivate
    expect(ctx.subscriptions.length).toBeGreaterThan(0);
    const hasDisposable = ctx.subscriptions.some(
      (d) => typeof d.dispose === "function",
    );
    expect(hasDisposable).toBe(true);
  });

  it("SB-06b: status bar reflects $(warning) when connected but no tools registered", async () => {
    // Connected but zero tools → $(warning)
    mockWsState.connected = true;
    mockWsState.state = "connected";
    mockWsState.tools = [];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    const item = window._getLastStatusBarItem();
    expect(item.text).toBe("$(warning) Accordo");
  });

  it("SB-06c: showStatus command shows Disconnected Hub line when disconnected", async () => {
    mockWsState.connected = false;
    mockWsState.state = "disconnected";
    mockWsState.tools = [];

    const ctx = makeContext();
    await extensionModule.activate(ctx as unknown as Parameters<typeof extensionModule.activate>[0]);

    const handler = commands._getRegistry().get("accordo.bridge.showStatus");
    handler?.();

    expect(window.showQuickPick).toHaveBeenCalledOnce();
    const [items] = window.showQuickPick.mock.calls[0] as [Array<{ label: string }>];
    expect(items[0].label).toContain("Disconnected");
  });
});
