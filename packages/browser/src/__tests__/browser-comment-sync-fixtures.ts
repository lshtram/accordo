import { vi } from "vitest";
import type { BrowserBridgeAPI, BrowserRelayLike } from "../types.js";
import type { CommentThread } from "@accordo/bridge-types";

vi.mock("vscode", () => {
  const globalStateStore = new Map<string, unknown>();
  const secretsStore = new Map<string, string>();
  return {
    workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(<T>(_key: string, defaultValue: T): T => (_key === "sharedRelay" ? (false as unknown as T) : defaultValue)) })) },
    extensions: { getExtension: vi.fn(() => ({ exports: null })) },
    window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })) },
    commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
    Disposable: class Disposable { constructor(private readonly fn: () => void) {} dispose(): void { this.fn(); } },
    createExtensionContextMock: () => ({ subscriptions: [] as Array<{ dispose(): void }>, globalState: { get: vi.fn((k: string) => globalStateStore.get(k)), update: vi.fn(async (k: string, v: unknown) => { globalStateStore.set(k, v); }) }, secrets: { get: vi.fn(async (k: string) => secretsStore.get(k) ?? undefined), store: vi.fn(async (k: string, v: string) => { secretsStore.set(k, v); }) }, _secretsStore: secretsStore }),
  };
});

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createServer: vi.fn(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const server = { once: vi.fn((event: string, cb: (...args: unknown[]) => void) => { listeners[event] = listeners[event] ?? []; listeners[event].push(cb); return server; }), listen: vi.fn((_port: number, _host: string) => { Promise.resolve().then(() => (listeners["listening"] ?? []).forEach((cb) => cb())); return server; }), close: vi.fn((cb?: () => void) => { if (cb) cb(); return server; }), address: vi.fn(() => ({ port: 40111 })) };
    return server;
  }) };
});

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);
vi.mock("../relay-server.js", () => ({ BrowserRelayServer: vi.fn().mockImplementation(() => ({ start: startMock, stop: stopMock, isConnected: isConnectedMock, request: vi.fn() })) }));

export const vscode = await import("vscode");
export const createExtensionContextMock = (vscode as Record<string, unknown>).createExtensionContextMock as () => ReturnType<typeof vi.fn>;

export function makeRemoteThread(id: string, pageUrl: string, status: "open" | "resolved" = "open") {
  const commentId = `${id}-c1`;
  return { id, anchorKey: "body:center", pageUrl, status, comments: [{ id: commentId, threadId: id, createdAt: "2024-01-01T00:00:00.000Z", author: { kind: "user" as const, name: "Browser User" }, body: `Comment on ${id}`, anchorKey: "body:center", pageUrl, status }], createdAt: "2024-01-01T00:00:00.000Z", lastActivity: "2024-01-01T00:00:00.000Z" };
}

export function makeLocalThread(id: string, uri: string, status: "open" | "resolved" = "open"): CommentThread {
  return { id, anchor: { kind: "surface", uri, surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } }, comments: [{ id: `${id}-c1`, threadId: id, createdAt: "2024-01-01T00:00:00.000Z", author: { kind: "user", name: "VSCode User" }, body: `Comment ${id}`, anchor: { kind: "surface", uri, surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } }, status }], status, createdAt: "2024-01-01T00:00:00.000Z", lastActivity: "2024-01-01T00:00:00.000Z", retention: "volatile-browser" };
}

export function makeLocalThreadWithComments(id: string, uri: string, commentIds: string[]): CommentThread {
  return { ...makeLocalThread(id, uri, "open"), comments: commentIds.map((commentId, index) => ({ id: commentId, threadId: id, createdAt: `2024-01-01T00:0${index}:00.000Z`, author: { kind: "user", name: "VSCode User" }, body: `Comment ${commentId}`, anchor: { kind: "surface", uri, surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } }, status: "open" as const })) };
}

export async function importSyncApi() { return await import("../extension.js"); }
export type { BrowserBridgeAPI, BrowserRelayLike };
