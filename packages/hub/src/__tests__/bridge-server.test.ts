/**
 * Tests for bridge-server.ts
 * Requirements: requirements-hub.md §2.5, §5.4, §9 (CONC-01 to CONC-07)
 *
 * Note: Full WS lifecycle tests (connect/disconnect/invoke/reconnect) are
 * integration tests tracked in requirements-hub.md §11 under "Integration:
 * WebSocket lifecycle". The unit tests here cover:
 *   - Initial state of the server before any connection
 *   - Concurrency tracking logic (CONC-01 to CONC-07)
 *   - Configuration defaults
 *   - Secret rotation (updateSecret)
 *   - M34: Hub message size limit (maxPayload)
 *   - M33: WS flood protection (rate limiting)
 *   - M31: State hold grace window (disconnect timer, clearModalities)
 *
 * API checklist:
 * ✓ isConnected — 1 test
 * ✓ getConcurrencyStats — 4 tests
 * ✓ invoke — 2 tests
 * ✓ cancel — 2 tests
 * ✓ requestState — 1 test
 * ✓ close — 1 test
 * ✓ updateSecret — 2 tests
 * ✓ onRegistryUpdate — 1 test
 * ✓ onStateUpdate — 1 test
 * ✓ validateProtocolVersion — 3 tests
 * ✓ M34 maxPayload — 2 tests in bridge-server-m34.test.ts (vi.mock boundary)
 * ✓ M33 flood protection — 4 tests (handleMessage ingress, config + drop + no-close)
 * ✓ M31 grace window — 6 tests (onGraceExpired in options, handleConnect cancel)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_MAX_CONCURRENT_INVOCATIONS,
  DEFAULT_MAX_QUEUE_DEPTH,
  ACCORDO_PROTOCOL_VERSION,
} from "@accordo/bridge-types";
import { BridgeServer } from "../bridge-server.js";
import type { BridgeServerOptions } from "../bridge-server.js";
import { JsonRpcError } from "../errors.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("Concurrency constants", () => {
  it("CONC-02: DEFAULT_MAX_CONCURRENT_INVOCATIONS is 16", () => {
    expect(DEFAULT_MAX_CONCURRENT_INVOCATIONS).toBe(16);
  });

  it("CONC-03: DEFAULT_MAX_QUEUE_DEPTH is 64", () => {
    expect(DEFAULT_MAX_QUEUE_DEPTH).toBe(64);
  });
});

// ── BridgeServer ──────────────────────────────────────────────────────────────

describe("BridgeServer", () => {
  let server: BridgeServer;

  beforeEach(() => {
    server = new BridgeServer({
      secret: "test-secret",
      maxConcurrent: 16,
      maxQueueDepth: 64,
    });
  });

  // ── isConnected ───────────────────────────────────────────────────────────

  describe("isConnected", () => {
    it("§5.4: isConnected returns false before any Bridge connects", () => {
      // req-hub §5.4: isConnected() → boolean
      expect(server.isConnected()).toBe(false);
    });
  });

  // ── getConcurrencyStats ───────────────────────────────────────────────────

  describe("getConcurrencyStats", () => {
    it("CONC-01: getConcurrencyStats initial inflight=0, queued=0", () => {
      // CONC-01: Hub maintains an in-flight counter
      const stats = server.getConcurrencyStats();
      expect(stats.inflight).toBe(0);
      expect(stats.queued).toBe(0);
    });

    it("CONC-02: getConcurrencyStats reports the configured limit", () => {
      // CONC-02: limit is from ACCORDO_MAX_CONCURRENT_INVOCATIONS
      const stats = server.getConcurrencyStats();
      expect(stats.limit).toBe(16);
    });

    it("CONC-02: defaults to DEFAULT_MAX_CONCURRENT_INVOCATIONS when maxConcurrent omitted", () => {
      const defaultServer = new BridgeServer({ secret: "s" });
      expect(defaultServer.getConcurrencyStats().limit).toBe(DEFAULT_MAX_CONCURRENT_INVOCATIONS);
    });

    it("CONC-02: custom maxConcurrent is reflected in concurrency stats limit", () => {
      const custom = new BridgeServer({ secret: "s", maxConcurrent: 4 });
      expect(custom.getConcurrencyStats().limit).toBe(4);
    });
  });

  // ── invoke — no Bridge connected ──────────────────────────────────────────

  describe("invoke", () => {
    it("§6: invoke rejects with error when Bridge is not connected", async () => {
      // req-hub §6: "Bridge not connected → { code: -32603, message: 'Bridge not connected' }"
      await expect(
        server.invoke("accordo_editor_open", { path: "/foo.ts" }, 5000)
      ).rejects.toThrow();
    });

    it("CONC-04: invoke with maxQueueDepth=0 rejects immediately — queue full", async () => {
      // CONC-04: If queue is full, Hub immediately returns MCP error -32004.
      // Queue-full is checked before the connection check so it fires even
      // without a live Bridge connection (maxConcurrent=0 means no capacity).
      const tightServer = new BridgeServer({ secret: "s", maxConcurrent: 0, maxQueueDepth: 0 });
      try {
        await tightServer.invoke("accordo_editor_open", {}, 5000);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(JsonRpcError);
        expect((e as JsonRpcError).code).toBe(-32004);
      }
    });
  });

  describe("cancel", () => {
    it("CONC-06: cancel does not throw for an unrecognised invocation ID", () => {
      // CONC-06: Cancelled invocations that have been forwarded still occupy an in-flight slot.
      // cancel() on a disconnected / no-such-id server must be a silent no-op.
      expect(() => server.cancel("nonexistent-invocation-id")).not.toThrow();
    });

    it("CONC-06: cancel does not throw when called with an empty string ID", () => {
      expect(() => server.cancel("")).not.toThrow();
    });
  });

  describe("requestState", () => {
    it("§5.4: requestState rejects when no Bridge is connected", async () => {
      // req-hub §5.4: requestState() → Promise<IDEState>
      await expect(server.requestState()).rejects.toThrow();
    });
  });

  describe("close", () => {
    it("§5.4: close returns a promise", () => {
      // req-hub §5.4: close() → Promise<void>
      const result = server.close();
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  describe("updateSecret", () => {
    it("§2.6: updateSecret does not throw with a new secret value", () => {
      // req-hub §2.6: Hub atomically updates secret in memory
      expect(() => server.updateSecret("new-secret-value")).not.toThrow();
    });

    it("§2.6: updateSecret accepts any non-empty string", () => {
      expect(() => server.updateSecret("totally-different-secret-123")).not.toThrow();
    });
  });

  // ── onRegistryUpdate / onStateUpdate callbacks ────────────────────────────

  describe("onRegistryUpdate", () => {
    it("§5.4: onRegistryUpdate registers callback without throwing", () => {
      expect(() => server.onRegistryUpdate((_tools) => {})).not.toThrow();
    });
  });

  describe("onStateUpdate", () => {
    it("§5.4: onStateUpdate registers callback without throwing", () => {
      expect(() => server.onStateUpdate((_patch) => {})).not.toThrow();
    });
  });

  // ── validateProtocolVersion ───────────────────────────────────────────────

  describe("validateProtocolVersion", () => {
    it("§5.4: validateProtocolVersion returns true for matching version", () => {
      // req-hub §5.4: compare received version against ACCORDO_PROTOCOL_VERSION
      expect(server.validateProtocolVersion("1")).toBe(true);
    });

    it("§5.4: validateProtocolVersion returns false for mismatched version", () => {
      // Close WS with 4002 on mismatch per §5.4
      expect(server.validateProtocolVersion("0")).toBe(false);
      expect(server.validateProtocolVersion("2")).toBe(false);
    });

    it("§5.4: validateProtocolVersion returns false for empty string", () => {
      expect(server.validateProtocolVersion("")).toBe(false);
    });
  });
});

// ── Mock-connected BridgeServer (no real sockets) ────────────────────────────
//
// Injects a fake WS + connected=true directly into BridgeServer private state.
// Lets us drive queue/concurrency logic without binding any TCP ports.
// ─────────────────────────────────────────────────────────────────────────────

interface MockWs {
  OPEN: 1;
  readyState: 1;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockConnectedServer {
  bridgeServer: BridgeServer;
  mockWs: MockWs;
  sentMessages: Array<Record<string, unknown>>;
  /** Simulate Bridge → Hub result */
  triggerResult(id: string, success: boolean, data?: unknown): void;
  /** Simulate Bridge → Hub cancelled frame */
  triggerCancelled(id: string, late: boolean): void;
  /** Simulate Bridge → Hub stateSnapshot (for protocol-version tests) */
  triggerStateSnapshot(protocolVersion: string): void;
}

function makeMockConnectedServer(
  maxConcurrent: number,
  maxQueueDepth = 64,
): MockConnectedServer {
  const bridgeServer = new BridgeServer({ secret: "s", maxConcurrent, maxQueueDepth });
  const sentMessages: Array<Record<string, unknown>> = [];

  const mockWs: MockWs = {
    OPEN: 1,
    readyState: 1,
    send: vi.fn((data: string) => {
      sentMessages.push(JSON.parse(data) as Record<string, unknown>);
    }),
    close: vi.fn(),
  };

  // Inject fake connected state into private fields
  const internal = bridgeServer as unknown as Record<string, unknown>;
  internal["ws"] = mockWs;
  internal["connected"] = true;

  function pumpMessage(raw: string): void {
    (bridgeServer as unknown as { handleMessage(s: string): void }).handleMessage(raw);
  }

  return {
    bridgeServer,
    mockWs,
    sentMessages,
    triggerResult(id, success, data) {
      pumpMessage(JSON.stringify({ type: "result", id, success, data: data ?? {} }));
    },
    triggerCancelled(id, late) {
      pumpMessage(JSON.stringify({ type: "cancelled", id, late }));
    },
    triggerStateSnapshot(protocolVersion) {
      pumpMessage(JSON.stringify({
        type: "stateSnapshot",
        protocolVersion,
        state: {
          activeFile: null, activeFileLine: 0, activeFileColumn: 0,
          openEditors: [], visibleEditors: [], workspaceFolders: [],
          activeTerminal: null, workspaceName: null, remoteAuthority: null,
          modalities: {},
        },
      }));
    },
  };
}

// ── FIFO Queue unit tests (CONC-03, CONC-05, CONC-07) ────────────────────────

describe("BridgeServer — FIFO queue (CONC-03, CONC-05, CONC-07)", () => {
  it("CONC-03: queued counter increments when in-flight limit is full", () => {
    const { bridgeServer } = makeMockConnectedServer(1);

    // First invoke fills the single in-flight slot
    void bridgeServer.invoke("tool.a", {}, 2000).catch(() => {});
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(1);
    expect(bridgeServer.getConcurrencyStats().queued).toBe(0);

    // Second invoke — slot full → should queue, NOT dispatch immediately
    void bridgeServer.invoke("tool.b", {}, 2000).catch(() => {});

    // RED: current impl dispatches immediately (inflight=2, queued stays 0)
    expect(bridgeServer.getConcurrencyStats().queued).toBe(1);
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(1); // must stay at 1
  });

  it("CONC-05: result receipt dequeues and dispatches the next queued item", async () => {
    const { bridgeServer, sentMessages, triggerResult } = makeMockConnectedServer(1);

    // First invoke occupies the only slot
    void bridgeServer.invoke("tool.a", {}, 2000).catch(() => {});
    // Second should be queued — NOT dispatched immediately  
    void bridgeServer.invoke("tool.b", {}, 2000).catch(() => {});

    // RED: current impl dispatches both immediately → 2 invoke messages sent
    // After M25: only 1 message sent at this point (tool.b sits in queue)
    expect(sentMessages.filter((m) => m["type"] === "invoke")).toHaveLength(1);

    // Capture tool.a's ID from the single dispatched message
    const firstMsg = sentMessages.find(
      (m) => m["type"] === "invoke",
    ) as { id: string } | undefined;
    expect(firstMsg?.id).toBeDefined();

    // Simulate Bridge returning success for tool.a → triggers dequeue
    triggerResult(firstMsg!.id, true, { ok: true });
    await new Promise<void>((r) => setTimeout(r, 0)); // flush microtasks

    // After dequeue: tool.b should now be dispatched
    expect(sentMessages.filter((m) => m["type"] === "invoke")).toHaveLength(2);
    expect(bridgeServer.getConcurrencyStats().queued).toBe(0);
  });

  it("CONC-05: inflight counter decrements when a result arrives", async () => {
    const { bridgeServer, sentMessages, triggerResult } = makeMockConnectedServer(2);

    const p1 = bridgeServer.invoke("tool.a", {}, 2000);
    const p2 = bridgeServer.invoke("tool.b", {}, 2000);
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(2);

    const ids = sentMessages
      .filter((m) => m["type"] === "invoke")
      .map((m) => (m as { id: string }).id);
    expect(ids.length).toBe(2);

    triggerResult(ids[0]!, true, {});
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(1);

    triggerResult(ids[1]!, true, {});
    await Promise.allSettled([p1, p2]);
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(0);
  });

  it("CONC-07: all invocations within the Hub-wide limit go in-flight simultaneously", async () => {
    const { bridgeServer, sentMessages, triggerResult } = makeMockConnectedServer(4);

    const promises = [
      bridgeServer.invoke("tool.a", {}, 2000),
      bridgeServer.invoke("tool.b", {}, 2000),
      bridgeServer.invoke("tool.c", {}, 2000),
      bridgeServer.invoke("tool.d", {}, 2000),
    ];
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(4);
    expect(bridgeServer.getConcurrencyStats().queued).toBe(0);

    const ids = sentMessages
      .filter((m) => m["type"] === "invoke")
      .map((m) => (m as { id: string }).id);
    expect(ids.length).toBe(4);

    for (const id of ids) triggerResult(id, true, {});
    await Promise.allSettled(promises);
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(0);
  });
});

// ── §Cancelled incoming frame (late semantics) ───────────────────────────────

describe("BridgeServer — cancelled frame late-semantics", () => {
  it("cancelled(late=false): rejects the pending invoke and frees the in-flight slot", async () => {
    const { bridgeServer, sentMessages, triggerCancelled } = makeMockConnectedServer(1);

    const invokeP = bridgeServer.invoke("tool.x", {}, 5000);
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(1);

    const invId = (sentMessages.find((m) => m["type"] === "invoke") as { id: string } | undefined)?.id;
    expect(invId).toBeDefined();

    triggerCancelled(invId!, false);

    await expect(invokeP).rejects.toThrow("Invocation cancelled");
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(0);
  });

  it("cancelled(late=false): dequeues the next waiting invocation after freeing the slot", async () => {
    const { bridgeServer, sentMessages, triggerCancelled } = makeMockConnectedServer(1);

    void bridgeServer.invoke("tool.a", {}, 5000).catch(() => {});
    void bridgeServer.invoke("tool.b", {}, 5000).catch(() => {});

    // tool.b sits in queue
    expect(bridgeServer.getConcurrencyStats().queued).toBe(1);
    const firstId = (sentMessages.find((m) => m["type"] === "invoke") as { id: string } | undefined)?.id;
    expect(firstId).toBeDefined();

    triggerCancelled(firstId!, false);
    await new Promise<void>((r) => setTimeout(r, 0));

    // tool.b should now be dispatched
    expect(sentMessages.filter((m) => m["type"] === "invoke")).toHaveLength(2);
    expect(bridgeServer.getConcurrencyStats().queued).toBe(0);
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(1);
  });

  it("cancelled(late=true): slot is NOT freed — invoke remains pending for result frame", async () => {
    const { bridgeServer, sentMessages, triggerCancelled, triggerResult } = makeMockConnectedServer(1);

    const invokeP = bridgeServer.invoke("tool.y", {}, 5000);
    const invId = (sentMessages.find((m) => m["type"] === "invoke") as { id: string } | undefined)?.id;
    expect(invId).toBeDefined();

    // late=true → result already in-flight from Bridge; Hub must NOT free slot yet
    triggerCancelled(invId!, true);

    // Invoke promise must still be pending (slot still occupied)
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(1);

    // Now the result arrives
    triggerResult(invId!, true, { done: true });
    await new Promise<void>((r) => setTimeout(r, 0));

    const result = await invokeP;
    expect(result.success).toBe(true);
    expect(bridgeServer.getConcurrencyStats().inflight).toBe(0);
  });

  it("cancelled(late=true): a queued item is NOT prematurely dequeued", async () => {
    const { bridgeServer, sentMessages, triggerCancelled } = makeMockConnectedServer(1);

    void bridgeServer.invoke("tool.a", {}, 5000).catch(() => {});
    void bridgeServer.invoke("tool.b", {}, 5000).catch(() => {});

    expect(bridgeServer.getConcurrencyStats().queued).toBe(1);
    const firstId = (sentMessages.find((m) => m["type"] === "invoke") as { id: string } | undefined)?.id;

    // late=true → do NOT dequeue tool.b
    triggerCancelled(firstId!, true);
    await new Promise<void>((r) => setTimeout(r, 0));

    // tool.b must remain queued
    expect(bridgeServer.getConcurrencyStats().queued).toBe(1);
    expect(sentMessages.filter((m) => m["type"] === "invoke")).toHaveLength(1);
  });
});

// ── M33: WS flood protection ─────────────────────────────────────────────────
//
// Week 5 workplan (Tue): WS message flood protection.
// Bridge → Hub message rate is capped at maxMessagesPerSecond (default 100).
// Excess messages are dropped with a warning; connection stays open.
//
// Tests call handleMessage() directly — the private ingress that start() wires
// to ws.on("message").  M33 implementation places rate-limiting inside
// handleMessage (or as the first thing it calls), so this is the right layer.
// ─────────────────────────────────────────────────────────────────────────────

describe("BridgeServer — M33: WS flood protection", () => {
  it("M33: BridgeServerOptions accepts maxMessagesPerSecond and stores it", () => {
    // RED: constructor does not accept or store this option yet.
    const server = new BridgeServer({
      secret: "s",
      maxMessagesPerSecond: 50,
    } as BridgeServerOptions);
    expect(
      (server as unknown as Record<string, unknown>)["maxMessagesPerSecond"],
    ).toBe(50);
  });

  it("M33: default maxMessagesPerSecond is 100", () => {
    // RED: constructor does not set this default yet.
    const server = new BridgeServer({ secret: "s" });
    expect(
      (server as unknown as Record<string, unknown>)["maxMessagesPerSecond"],
    ).toBe(100);
  });

  it("M33: messages exceeding rate limit are dropped (not processed)", () => {
    const server = new BridgeServer({
      secret: "s",
      maxConcurrent: 16,
      maxMessagesPerSecond: 3,
    } as BridgeServerOptions);

    const mockWs = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const internal = server as unknown as Record<string, unknown>;
    internal["ws"] = mockWs;
    internal["connected"] = true;

    const patches: unknown[] = [];
    server.onStateUpdate((patch) => patches.push(patch));

    // Pump 10 messages rapidly (limit is 3/sec)
    for (let i = 0; i < 10; i++) {
      (server as unknown as { handleMessage(s: string): void }).handleMessage(
        JSON.stringify({ type: "stateUpdate", patch: { activeFile: `/f${i}` } }),
      );
    }

    // RED: current code processes all 10; M33 implementation should drop 7
    expect(patches.length).toBeLessThanOrEqual(3);
  });

  it("M33: flood-dropped messages do NOT close the WebSocket connection", () => {
    const server = new BridgeServer({
      secret: "s",
      maxConcurrent: 16,
      maxMessagesPerSecond: 2,
    } as BridgeServerOptions);

    const mockWs = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const internal = server as unknown as Record<string, unknown>;
    internal["ws"] = mockWs;
    internal["connected"] = true;

    const patches: unknown[] = [];
    server.onStateUpdate((patch) => patches.push(patch));

    for (let i = 0; i < 20; i++) {
      (server as unknown as { handleMessage(s: string): void }).handleMessage(
        JSON.stringify({ type: "stateUpdate", patch: { activeFile: `/f${i}` } }),
      );
    }

    // Connection must NOT be closed due to flooding
    expect(mockWs.close).not.toHaveBeenCalled();
    expect(server.isConnected()).toBe(true);
    // RED: some messages must have been dropped (only 2/sec allowed)
    expect(patches.length).toBeLessThanOrEqual(2);
  });
});

// ── M31: State hold grace window ─────────────────────────────────────────────
//
// architecture.md §3.6: Hub holds state for 15s after Bridge disconnect.
// If Bridge reconnects within window → no state is lost.
// If window expires → Hub clears modality state (clearModalities-equivalent).
// During window: tool invocations return "Bridge reconnecting" error.
//
// The BridgeServer accepts an `onGraceExpired` callback in its options.
// HubServer wires this to `stateCache.clearModalities()`.  Tests assert:
//   1. The callback fires after graceWindowMs.
//   2. During the grace window, invoke() rejects with "Bridge reconnecting".
//   3. Reconnect within the window cancels the timer (callback never fires).
//   4. Pending invocations are still rejected immediately on disconnect.
//   5. graceWindowMs=0 means callback fires synchronously (no deferred timer).
// ─────────────────────────────────────────────────────────────────────────────

describe("BridgeServer — M31: state hold grace window", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("M31: graceWindowMs defaults to 15 000 ms", () => {
    // RED: constructor does not store graceWindowMs yet.
    const server = new BridgeServer({ secret: "s" });
    // After M31 the default must be observable so HubServer can rely on it.
    expect(
      (server as unknown as { graceWindowMs: number }).graceWindowMs,
    ).toBe(15_000);
  });

  it("M31: invoke during grace window rejects with 'Bridge reconnecting'", async () => {
    vi.useFakeTimers();
    const server = new BridgeServer({
      secret: "s",
      graceWindowMs: 15_000,
      onGraceExpired: vi.fn(),
    } as BridgeServerOptions);

    // Inject a connected state then disconnect.
    const mockWs = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const internal = server as unknown as Record<string, unknown>;
    internal["ws"] = mockWs;
    internal["connected"] = true;

    (server as unknown as { handleDisconnect(): void }).handleDisconnect();

    // During grace window, invoke must reject with "Bridge reconnecting"
    // (not "Bridge not connected").
    try {
      await server.invoke("tool.a", {}, 5000);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonRpcError);
      // RED: current code says "Bridge not connected"
      expect((e as JsonRpcError).message).toContain("Bridge reconnecting");
    }
  });

  it("M31: onGraceExpired callback fires after graceWindowMs — models clearModalities", async () => {
    vi.useFakeTimers();
    // The callback represents what HubServer wires to stateCache.clearModalities().
    const onExpired = vi.fn();

    const server = new BridgeServer({
      secret: "s",
      graceWindowMs: 500,
      onGraceExpired: onExpired,
    } as BridgeServerOptions);

    const mockWs = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const internal = server as unknown as Record<string, unknown>;
    internal["ws"] = mockWs;
    internal["connected"] = true;

    // Disconnect → starts grace timer
    (server as unknown as { handleDisconnect(): void }).handleDisconnect();

    // Timer not yet fired.
    expect(onExpired).not.toHaveBeenCalled();

    // Advance past grace window.
    vi.advanceTimersByTime(501);

    // RED: handleDisconnect() does not start a timer today.
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it("M31: reconnect within grace window cancels the timer — state is preserved", () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();

    const server = new BridgeServer({
      secret: "s",
      graceWindowMs: 500,
      onGraceExpired: onExpired,
    } as BridgeServerOptions);

    const mockWs = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const internal = server as unknown as Record<string, unknown>;
    internal["ws"] = mockWs;
    internal["connected"] = true;

    // Disconnect starts the grace timer.
    (server as unknown as { handleDisconnect(): void }).handleDisconnect();

    // Simulate reconnect: the new-connection handler inside start() delegates
    // to handleConnect() — the complement of the existing handleDisconnect().
    // RED: handleConnect does not exist today.
    const mockWs2 = { OPEN: 1, readyState: 1, on: vi.fn(), send: vi.fn(), close: vi.fn() };
    (server as unknown as {
      handleConnect(ws: unknown): void;
    }).handleConnect(mockWs2);

    // Advance well past the original window.
    vi.advanceTimersByTime(1000);

    // onGraceExpired must NOT have fired — state is preserved.
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("M31: pending invocations are still rejected immediately on disconnect", async () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();

    const server = new BridgeServer({
      secret: "s",
      maxConcurrent: 1,
      graceWindowMs: 15_000,
      onGraceExpired: onExpired,
    } as BridgeServerOptions);

    const sentMessages: Array<Record<string, unknown>> = [];
    const mockWs = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((d: string) => sentMessages.push(JSON.parse(d) as Record<string, unknown>)),
      close: vi.fn(),
    };
    const internal = server as unknown as Record<string, unknown>;
    internal["ws"] = mockWs;
    internal["connected"] = true;

    // Start an invocation.
    const invokeP = server.invoke("tool.a", {}, 5000);

    // Disconnect — pending invoke must be rejected IMMEDIATELY (can't complete
    // without a Bridge), even though state is held during the grace window.
    (server as unknown as { handleDisconnect(): void }).handleDisconnect();

    await expect(invokeP).rejects.toThrow();

    // But the grace timer must still be running (onGraceExpired not called yet).
    // RED: handleDisconnect today does not start a grace timer.
    expect(onExpired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_001);
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it("M31: graceWindowMs=0 fires onGraceExpired synchronously — no deferred timer", () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();

    const server = new BridgeServer({
      secret: "s",
      graceWindowMs: 0,
      onGraceExpired: onExpired,
    } as BridgeServerOptions);

    const mockWs = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const internal = server as unknown as Record<string, unknown>;
    internal["ws"] = mockWs;
    internal["connected"] = true;

    (server as unknown as { handleDisconnect(): void }).handleDisconnect();

    // With graceWindowMs=0 the callback should fire immediately —
    // no deferred timer, no dangling setTimeout.
    // RED: handleDisconnect does not call onGraceExpired today.
    expect(onExpired).toHaveBeenCalledOnce();
    expect(server.isConnected()).toBe(false);
  });
});

// ── M22: Protocol-mismatch close reason (§5.4) ───────────────────────────────

describe("BridgeServer — §5.4 protocol-mismatch close reason (M22)", () => {
  it("§5.4: close message includes 'expected' and the received version number", () => {
    const { mockWs, triggerStateSnapshot } = makeMockConnectedServer(16);

    triggerStateSnapshot("999");

    // RED: current impl passes the generic string "Protocol version mismatch"
    expect(mockWs.close).toHaveBeenCalledWith(4002, expect.stringContaining("expected"));
    expect(mockWs.close).toHaveBeenCalledWith(4002, expect.stringContaining("999"));
  });

  it("§5.4: close message includes 'got' keyword", () => {
    const { mockWs, triggerStateSnapshot } = makeMockConnectedServer(16);

    triggerStateSnapshot("0");

    expect(mockWs.close).toHaveBeenCalledWith(4002, expect.stringContaining("got"));
  });
});
