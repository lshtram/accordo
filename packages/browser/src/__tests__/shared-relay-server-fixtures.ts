import { vi } from "vitest";
import type { SharedRelayServerOptions } from "../shared-relay-types.js";

interface WsMockState { captured: Array<(socket: unknown, request: unknown) => void>; wsServer: unknown; }
const wsMockState = vi.hoisted<WsMockState>(() => ({ captured: [], wsServer: null as unknown }));

vi.mock("node:http", () => {
  const mockHttpServer = { on: vi.fn(), once: vi.fn(), off: vi.fn(), listen: vi.fn((_port: number, _host: string, cb?: () => void) => { Promise.resolve().then(() => cb?.()); }), close: vi.fn((cb?: () => void) => { if (cb) Promise.resolve().then(() => cb()); }), address: vi.fn(() => ({ port: 40111 })) };
  return { __esModule: true, createServer: vi.fn(() => mockHttpServer), default: { createServer: vi.fn(() => mockHttpServer) } };
});

vi.mock("ws", () => {
  const mockWsServer = { on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { if (event === "connection") wsMockState.captured.push(cb as (socket: unknown, request: unknown) => void); return mockWsServer as unknown; }), once: vi.fn(), close: vi.fn() };
  wsMockState.wsServer = mockWsServer;
  const MockWsClass = Object.assign(() => ({}), { OPEN: 1, CLOSED: 3, CONNECTING: 0 });
  return { __esModule: true, WebSocketServer: vi.fn(() => mockWsServer), WebSocket: MockWsClass };
});

export function makeOptions(): SharedRelayServerOptions { return { host: "127.0.0.1", port: 40111, token: "test-shared-token-abc123" }; }
export function clearWsHandlers(): void { wsMockState.captured.length = 0; }
export function getWsHarness(): WsMockState { return wsMockState; }
export function makeMockSocket() {
  const sent: string[] = [];
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const socket = {
    readyState: 1,
    closeCode: null as number | null,
    closeMessage: null as string | null,
    sent,
    handlers,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
    }),
    send: (data: string) => sent.push(data),
    close: (code?: number, msg?: string) => {
      socket.readyState = 3;
      socket.closeCode = code ?? null;
      socket.closeMessage = msg ?? null;
    },
  };
  return socket;
}
export function makeMockRequest(url: string) { return { url, socket: { remoteAddress: "127.0.0.1" } }; }
const actualSharedRelayServer = await vi.importActual<typeof import("../shared-relay-server.js")>("../shared-relay-server.js");
export const SharedBrowserRelayServer = actualSharedRelayServer.SharedBrowserRelayServer;
