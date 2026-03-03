/**
 * M34 — Hub message size limit
 *
 * Tests live in a separate file because they need `vi.mock("ws")` hoisted at
 * module scope.  This avoids the ESM read-only property error that occurs when
 * trying to replace named exports after import.
 *
 * Requirement: architecture.md §8, Bridge WS-08 parity.
 * The Hub WebSocket server MUST be created with `maxPayload` so that the ws
 * library rejects inbound frames larger than the configured limit.
 *
 * API checklist:
 * ✓ start() passes maxPayload to WebSocketServer — 2 tests (behavioral)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.mock is hoisted above imports.  When bridge-server.ts calls
// `new WebSocketServer(...)` inside start(), it gets this mock.
vi.mock("ws", () => {
  const WebSocketServer = vi.fn().mockImplementation(() => ({ on: vi.fn() }));
  return { WebSocketServer, default: { WebSocketServer } };
});

import type { BridgeServerOptions } from "../bridge-server.js";
import { BridgeServer } from "../bridge-server.js";
import { WebSocketServer } from "ws";

describe("BridgeServer — M34: Hub message size limit", () => {
  beforeEach(() => {
    vi.mocked(WebSocketServer).mockClear();
  });

  it("M34: start() passes custom maxPayload to WebSocketServer", () => {
    const server = new BridgeServer({
      secret: "s",
      maxPayload: 2_097_152,
    } as BridgeServerOptions);

    const fakeHttp = { on: vi.fn() } as unknown as import("http").Server;
    server.start(fakeHttp);

    // RED: current start() passes { noServer: true } without maxPayload.
    const [callArgs] = vi.mocked(WebSocketServer).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(callArgs["maxPayload"]).toBe(2_097_152);
  });

  it("M34: start() defaults maxPayload to 1 MB when option is omitted", () => {
    const server = new BridgeServer({ secret: "s" });
    const fakeHttp = { on: vi.fn() } as unknown as import("http").Server;
    server.start(fakeHttp);

    // RED: current start() passes { noServer: true } without maxPayload.
    const [callArgs] = vi.mocked(WebSocketServer).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(callArgs["maxPayload"]).toBe(1_048_576);
  });
});
