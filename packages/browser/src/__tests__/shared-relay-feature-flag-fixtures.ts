import { vi } from "vitest";
import type { BrowserBridgeAPI } from "../types.js";

export const sharedFsState = new Map<string, string>();
export const ACCORDO_DIR = "/home/test/.accordo";
export const sharedRelayDiscoveryMock = { isRelayAlive: false, acquireRelayLockResult: true };
export const mockStart = vi.fn().mockResolvedValue(undefined);
export const mockStop = vi.fn().mockResolvedValue(undefined);
export const mockIsConnected = vi.fn(() => false);
export const mockPush = vi.fn();
export const mockIsChromeConnected = vi.fn(() => false);
export const mockGetConnectedHubs = vi.fn(() => new Map());
export const sharedRelayClientState = { onEvent: null as ((event: string, details?: Record<string, unknown>) => void) | null };

export function createVscodeMock(sharedRelay: boolean) {
  const state = new Map<string, unknown>();
  return {
    workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(<T>(_key: string, defaultValue: T): T => (_key === "sharedRelay" ? (sharedRelay as unknown as T) : defaultValue)) })) },
    extensions: { getExtension: vi.fn(() => ({ exports: null })) },
    window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })) },
    commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
    Disposable: class Disposable { constructor(private readonly fn: () => void) {} dispose(): void { this.fn(); } },
    createExtensionContextMock: () => ({ subscriptions: [] as Array<{ dispose(): void }>, globalState: { get: vi.fn((k: string) => state.get(k)), update: vi.fn(async (k: string, v: unknown) => { state.set(k, v); }) } }),
  };
}

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createServer: vi.fn(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const server = { once: vi.fn((event: string, cb: (...args: unknown[]) => void) => { listeners[event] = listeners[event] ?? []; listeners[event].push(cb); return server; }), listen: vi.fn((_port: number, _host: string) => { Promise.resolve().then(() => (listeners["listening"] ?? []).forEach((cb) => cb())); return server; }), close: vi.fn((cb?: () => void) => { if (cb) cb(); return server; }), address: vi.fn(() => ({ port: 40111 })) };
    return server;
  }) };
});

vi.mock("../relay-server.js", () => ({ BrowserRelayServer: vi.fn().mockImplementation(() => ({ start: mockStart, stop: mockStop, isConnected: mockIsConnected, push: mockPush, request: vi.fn() })) }));
vi.mock("../shared-relay-server.js", () => ({ SharedBrowserRelayServer: vi.fn().mockImplementation(() => ({ start: mockStart, stop: mockStop, push: mockPush, isChromeConnected: mockIsChromeConnected, getConnectedHubs: mockGetConnectedHubs })) }));
vi.mock("../shared-relay-client.js", () => ({ SharedRelayClient: vi.fn().mockImplementation((options?: { onEvent?: (event: string, details?: Record<string, unknown>) => void }) => ({ start: vi.fn(() => { sharedRelayClientState.onEvent = options?.onEvent ?? null; }), stop: vi.fn(), push: mockPush, isConnected: mockIsConnected, request: vi.fn(), isRelayConnected: vi.fn(() => false) })) }));
vi.mock("../relay-discovery.js", () => ({
  SHARED_RELAY_FILE: "shared-relay.json",
  SHARED_RELAY_LOCK_FILE: "shared-relay.json.lock",
  readSharedRelayInfo: () => { const content = sharedFsState.get(`${ACCORDO_DIR}/shared-relay.json`); if (!content) return null; try { return JSON.parse(content); } catch { return null; } },
  writeSharedRelayInfo: (info: Record<string, unknown>) => { sharedFsState.set(`${ACCORDO_DIR}/shared-relay.json`, JSON.stringify(info)); },
  isRelayAlive: () => sharedRelayDiscoveryMock.isRelayAlive,
  acquireRelayLock: () => sharedRelayDiscoveryMock.acquireRelayLockResult,
  releaseRelayLock: () => {},
}));

export const { activate } = await import("../extension.js");
export const vscode = await import("vscode");
export const createExtensionContextMock = (vscode as Record<string, unknown>).createExtensionContextMock as (...args: unknown[]) => ReturnType<typeof vi.fn>;

export function makeBridgeMock() {
  return { registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }), publishState: vi.fn(), invokeTool: vi.fn().mockResolvedValue({ threads: [], total: 0, hasMore: false }) };
}
