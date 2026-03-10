/**
 * Tests for ws-client.ts
 * Requirements: requirements-bridge.md §5.1 (WS-01 to WS-10)
 *
 * Phase B design:
 * – WS-01..WS-10 behavioural tests are RED on stubs: connect() throws
 *   "not implemented" so no MockWebSocket is constructed, no open/message/
 *   close events fire, and all protocol assertions fail.
 * – Constants + getReconnectDelay tests remain GREEN (already implemented).
 * – A MockWebSocket (via vi.mock('ws')) intercepts WebSocket construction so
 *   tests can inspect outgoing messages and simulate incoming events.
 */

// ── MockWebSocket shared state ─────────────────────────────────────────────────
// vi.hoisted runs before vi.mock (which is itself hoisted before any imports),
// so mockWsState is safely accessible inside the factory.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { IDEState, ToolRegistration, ResultMessage } from "@accordo/bridge-types";

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
  const { EventEmitter } = await import("node:events");
  const state = mockWsState;

  class MockWS extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 0; // CONNECTING
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
      this.readyState = 3; // CLOSED
    }

    triggerOpen() {
      this.readyState = 1; // OPEN
      this.emit("open");
    }

    triggerMessage(data: unknown) {
      const buf = Buffer.from(JSON.stringify(data));
      this.emit("message", buf, { binary: false });
    }

    triggerClose(code: number, reason = "") {
      this.readyState = 3; // CLOSED
      this.emit("close", code, Buffer.from(reason));
    }

    parseSent(): unknown[] {
      return this.sent.map((s) => JSON.parse(s));
    }
  }

  return { default: MockWS, WebSocket: MockWS };
});

// ── Imports (after mock registration) ─────────────────────────────────────────

import {
  WsClient,
  WS_CLOSE_AUTH_FAILURE,
  WS_CLOSE_PROTOCOL_MISMATCH,
  MAX_RECONNECT_BACKOFF_MS,
  MAX_MESSAGE_SIZE,
} from "../ws-client.js";
import type { WsClientEvents } from "../ws-client.js";
import type { GetStateMessage } from "@accordo/bridge-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const IDLE_STATE: IDEState = {
  activeFile: null,
  activeFileLine: 1,
  activeFileColumn: 1,
  openEditors: [],
  visibleEditors: [],
  workspaceFolders: [],
  activeTerminal: null,
  workspaceName: null,
  remoteAuthority: null,
  modalities: {},
};

const SAMPLE_TOOLS: ToolRegistration[] = [
  {
    name: "ext:search",
    description: "Search files",
    inputSchema: { type: "object", properties: {} },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
];

type TrackedEvents = WsClientEvents & {
  authFailureCount: number;
  protocolMismatchArg: string | undefined;
  invokedArgs: unknown[];
  cancelledArgs: unknown[];
  getStateArgs: unknown[];
};

function makeEvents(): TrackedEvents {
  let authFailureCount = 0;
  let protocolMismatchArg: string | undefined;
  const invokedArgs: unknown[] = [];
  const cancelledArgs: unknown[] = [];
  const getStateArgs: unknown[] = [];
  return {
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onAuthFailure: vi.fn(() => { authFailureCount++; }),
    onProtocolMismatch: vi.fn((msg: string) => { protocolMismatchArg = msg; }),
    onInvoke: vi.fn((m: unknown) => { invokedArgs.push(m); }),
    onCancel: vi.fn((m: unknown) => { cancelledArgs.push(m); }),
    onGetState: vi.fn((m: unknown) => { getStateArgs.push(m); }),
    get authFailureCount() { return authFailureCount; },
    get protocolMismatchArg() { return protocolMismatchArg; },
    get invokedArgs() { return invokedArgs; },
    get cancelledArgs() { return cancelledArgs; },
    get getStateArgs() { return getStateArgs; },
  };
}

function makeClient(port = 3000, secret = "test-secret") {
  const events = makeEvents();
  const client = new WsClient(port, secret, events);
  return { client, events };
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe("exported constants", () => {
  it("WS_CLOSE_AUTH_FAILURE is 4001", () => {
    expect(WS_CLOSE_AUTH_FAILURE).toBe(4001);
  });

  it("WS_CLOSE_PROTOCOL_MISMATCH is 4002", () => {
    expect(WS_CLOSE_PROTOCOL_MISMATCH).toBe(4002);
  });

  it("MAX_RECONNECT_BACKOFF_MS is 30 000", () => {
    expect(MAX_RECONNECT_BACKOFF_MS).toBe(30_000);
  });

  it("MAX_MESSAGE_SIZE is 1 048 576 (1 MB)", () => {
    expect(MAX_MESSAGE_SIZE).toBe(1_048_576);
  });
});

// ── getReconnectDelay (instance method, already implemented) ──────────────────

describe("getReconnectDelay", () => {
  let client: WsClient;

  beforeEach(() => {
    ({ client } = makeClient());
  });

  it("attempt 0 → 1 000 ms", () => {
    expect(client.getReconnectDelay(0)).toBe(1_000);
  });

  it("attempt 1 → 2 000 ms", () => {
    expect(client.getReconnectDelay(1)).toBe(2_000);
  });

  it("attempt 2 → 4 000 ms", () => {
    expect(client.getReconnectDelay(2)).toBe(4_000);
  });

  it("attempt 3 → 8 000 ms", () => {
    expect(client.getReconnectDelay(3)).toBe(8_000);
  });

  it("attempt 4 → 16 000 ms", () => {
    expect(client.getReconnectDelay(4)).toBe(16_000);
  });

  it("attempt 5 and above → capped at 30 000 ms", () => {
    expect(client.getReconnectDelay(5)).toBe(30_000);
    expect(client.getReconnectDelay(10)).toBe(30_000);
    expect(client.getReconnectDelay(100)).toBe(30_000);
  });
});

// ── WsClient ──────────────────────────────────────────────────────────────────

// ── WsClient behaviour (WS-01 to WS-10) ─────────────────────────────────────
//
// All tests below are RED on stubs: connect() throws before constructing
// MockWebSocket, so no open/message/close events can fire.

describe("WsClient", () => {
  beforeEach(() => {
    mockWsState.instance = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── construction ─────────────────────────────────────────────────────────

  describe("construction", () => {
    it("creates without throwing", () => {
      expect(() => makeClient()).not.toThrow();
    });

    it("isConnected() returns false before connect()", () => {
      const { client } = makeClient();
      expect(client.isConnected()).toBe(false);
    });

    it("getState() returns 'disconnected' before connect()", () => {
      const { client } = makeClient();
      expect(client.getState()).toBe("disconnected");
    });
  });

  // ── WS-01 / WS-02: connect ────────────────────────────────────────────────

  // ── WS-01: URL format ────────────────────────────────────────────────────

  describe("WS-01: connect() uses ws://127.0.0.1:{port}/bridge", () => {
    it("WS-01: constructs WebSocket with exact URL ws://127.0.0.1:{port}/bridge", async () => {
      const { client } = makeClient(4321);
      await client.connect(IDLE_STATE, []).catch(() => {});
      expect(mockWsState.instance).not.toBeNull();
      expect(mockWsState.instance!.url).toBe("ws://127.0.0.1:4321/bridge");
    });

    it("WS-01: port number is reflected in the URL", async () => {
      const { client } = makeClient(9999);
      await client.connect(IDLE_STATE, []).catch(() => {});
      expect(mockWsState.instance?.url).toBe("ws://127.0.0.1:9999/bridge");
    });
  });

  // ── WS-02: auth header ────────────────────────────────────────────────────

  describe("WS-02: passes x-accordo-secret in upgrade headers", () => {
    it("WS-02: x-accordo-secret header equals the constructor secret", async () => {
      const { client } = makeClient(3000, "my-bridge-secret");
      await client.connect(IDLE_STATE, []).catch(() => {});
      const ws = mockWsState.instance;
      const headers = ((ws?.constructorOptions as { headers?: Record<string, string> } | undefined)?.headers) ?? {};
      expect(headers["x-accordo-secret"]).toBe("my-bridge-secret");
    });

    it("WS-02: secret updated via updateSecret() is used on next connect()", async () => {
      const { client } = makeClient(3000, "old-secret");
      client.updateSecret("rotated-secret");
      await client.connect(IDLE_STATE, []).catch(() => {});
      const headers = ((mockWsState.instance?.constructorOptions as { headers?: Record<string, string> } | undefined)?.headers) ?? {};
      expect(headers["x-accordo-secret"]).toBe("rotated-secret");
    });
  });

  // ── WS-03: stateSnapshot on open ─────────────────────────────────────────

  describe("WS-03: sends stateSnapshot (with protocolVersion) on open", () => {
    it("WS-03: first message batch after open contains type:'stateSnapshot'", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const types = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).map((m) => m["type"]);
      expect(types).toContain("stateSnapshot");
    });

    it("WS-03: stateSnapshot.protocolVersion = ACCORDO_PROTOCOL_VERSION", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const snapshot = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "stateSnapshot",
      ) as Record<string, unknown> | undefined;
      expect(snapshot?.["protocolVersion"]).toBe(ACCORDO_PROTOCOL_VERSION);
    });

    it("WS-03: stateSnapshot.state matches IDEState passed to connect()", async () => {
      const state: IDEState = { ...IDLE_STATE, activeFile: "/workspace/app.ts" };
      const { client } = makeClient();
      const p = client.connect(state, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const snapshot = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "stateSnapshot",
      ) as Record<string, unknown> | undefined;
      expect((snapshot?.["state"] as Record<string, unknown> | undefined)?.["activeFile"]).toBe("/workspace/app.ts");
    });

    it("WS-03: sendStateSnapshot() sends a fresh stateSnapshot when called on connected client", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      client.sendStateSnapshot({ ...IDLE_STATE, activeFile: "/updated.ts" });
      const snapshot = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "stateSnapshot",
      ) as Record<string, unknown> | undefined;
      expect(snapshot?.["protocolVersion"]).toBe(ACCORDO_PROTOCOL_VERSION);
      expect((snapshot?.["state"] as Record<string, unknown> | undefined)?.["activeFile"]).toBe("/updated.ts");
    });
  });

  // ── WS-04: toolRegistry on open ──────────────────────────────────────────

  describe("WS-04: sends toolRegistry on open", () => {
    it("WS-04: open sends a message with type:'toolRegistry'", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, SAMPLE_TOOLS);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const types = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).map((m) => m["type"]);
      expect(types).toContain("toolRegistry");
    });

    it("WS-04: toolRegistry.tools contains all tools passed to connect()", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, SAMPLE_TOOLS);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const registry = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "toolRegistry",
      ) as Record<string, unknown> | undefined;
      expect((registry?.["tools"] as ToolRegistration[])).toHaveLength(1);
      expect((registry?.["tools"] as ToolRegistration[])[0]?.name).toBe("ext:search");
    });

    it("WS-04: stateSnapshot is sent before toolRegistry", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, SAMPLE_TOOLS);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const msgs = (mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>;
      const snapshotIdx = msgs.findIndex((m) => m["type"] === "stateSnapshot");
      const registryIdx = msgs.findIndex((m) => m["type"] === "toolRegistry");
      expect(snapshotIdx).toBeGreaterThanOrEqual(0);
      expect(registryIdx).toBeGreaterThan(snapshotIdx);
    });

    it("WS-04: sendToolRegistry() sends a toolRegistry message when called", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      client.sendToolRegistry(SAMPLE_TOOLS);
      const registry = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "toolRegistry",
      ) as Record<string, unknown> | undefined;
      expect((registry?.["tools"] as ToolRegistration[])).toHaveLength(1);
    });
  });

  // ── WS-05: ping → pong ───────────────────────────────────────────────────

  describe("WS-05: responds to ping with pong within 5s", () => {
    it("WS-05: incoming ping message triggers a pong response", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      mockWsState.instance?.triggerMessage({ type: "ping", ts: 1_700_000_000_000 });
      await Promise.resolve();
      const sent = (mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>;
      expect(sent.find((m) => m["type"] === "pong")).toBeDefined();
    });

    it("WS-05: pong.ts echoes the same ts value from the ping", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      const pingTs = 1_700_000_000_123;
      mockWsState.instance?.triggerMessage({ type: "ping", ts: pingTs });
      await Promise.resolve();
      const pong = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "pong",
      ) as Record<string, unknown> | undefined;
      expect(pong?.["ts"]).toBe(pingTs);
    });

    it("WS-05: sendPong(ts) sends pong with matching ts", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      client.sendPong(999_888_777);
      const pong = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "pong",
      ) as Record<string, unknown> | undefined;
      expect(pong?.["ts"]).toBe(999_888_777);
    });
  });

  // ── WS-07: re-send on reconnect ───────────────────────────────────────────

  describe("WS-07: re-sends stateSnapshot and toolRegistry on reconnect", () => {
    it("WS-07: after reconnect, stateSnapshot is sent again", async () => {
      const { client } = makeClient();
      const p1 = client.connect(IDLE_STATE, SAMPLE_TOOLS);
      p1.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerClose(1000, "normal");
      vi.advanceTimersByTime(1_500); // past first backoff delay (1 000 ms)
      await Promise.resolve();
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const types = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).map((m) => m["type"]);
      expect(types).toContain("stateSnapshot");
    });

    it("WS-07: after reconnect, toolRegistry is sent again", async () => {
      const { client } = makeClient();
      const p1 = client.connect(IDLE_STATE, SAMPLE_TOOLS);
      p1.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerClose(1000, "normal");
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const types = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).map((m) => m["type"]);
      expect(types).toContain("toolRegistry");
    });

    it("WS-07: reconnect uses state from latest sendStateSnapshot, not initial connect state", async () => {
      const { client } = makeClient();
      const updatedState: IDEState = { ...IDLE_STATE, activeFile: "/updated-after-connect.ts" };
      const p1 = client.connect(IDLE_STATE, SAMPLE_TOOLS);
      p1.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      // State changes after initial connect — bridge should use this on reconnect
      client.sendStateSnapshot(updatedState);
      mockWsState.instance?.triggerClose(1000, "normal");
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const sent = (mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>;
      const lastSnapshot = [...sent].reverse().find((m) => m["type"] === "stateSnapshot");
      const sentState = lastSnapshot?.["state"] as Record<string, unknown> | undefined;
      expect(sentState?.["activeFile"]).toBe("/updated-after-connect.ts");
    });
  });

  // ── WS-08: message size guard ─────────────────────────────────────────────

  describe("WS-08: messages > MAX_MESSAGE_SIZE are rejected", () => {
    it("WS-08: oversized invoke message → events.onInvoke is NOT called", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const oversizedArgs = { data: "x".repeat(MAX_MESSAGE_SIZE + 1) };
      mockWsState.instance?.triggerMessage({ type: "invoke", id: "big-1", tool: "ext:t", args: oversizedArgs, timeout: 5000 });
      await Promise.resolve();
      expect(events.onInvoke).not.toHaveBeenCalled();
    });

    it("WS-08: normal-sized invoke IS dispatched via events.onInvoke", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerMessage({ type: "invoke", id: "s-1", tool: "ext:t", args: { x: 1 }, timeout: 5000 });
      await Promise.resolve();
      expect(events.onInvoke).toHaveBeenCalledWith(expect.objectContaining({ id: "s-1" }));
    });
  });

  // ── WS-09: auth failure close 4001 ───────────────────────────────────────

  describe("WS-09: close code 4001 → no reconnect, fire onAuthFailure", () => {
    it("WS-09: close 4001 calls events.onAuthFailure exactly once", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerClose(WS_CLOSE_AUTH_FAILURE, "auth failure");
      await Promise.resolve();
      expect(events.onAuthFailure).toHaveBeenCalledOnce();
    });

    it("WS-09: after 4001, no reconnect timer fires (no new WS constructed)", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      const ws = mockWsState.instance;
      ws?.triggerOpen();
      await Promise.resolve();
      ws?.triggerClose(WS_CLOSE_AUTH_FAILURE);
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(mockWsState.instance).toBe(ws); // instance unchanged = no new WS
    });

    it("WS-09: isConnected() is false after 4001", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerClose(WS_CLOSE_AUTH_FAILURE);
      await Promise.resolve();
      expect(client.isConnected()).toBe(false);
    });
  });

  // ── WS-10: protocol mismatch close 4002 ──────────────────────────────────

  describe("WS-10: close code 4002 → no reconnect, fire onProtocolMismatch", () => {
    it("WS-10: close 4002 calls events.onProtocolMismatch exactly once", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerClose(WS_CLOSE_PROTOCOL_MISMATCH, "Protocol version mismatch");
      await Promise.resolve();
      expect(events.onProtocolMismatch).toHaveBeenCalledOnce();
    });

    it("WS-10: onProtocolMismatch receives the close reason string", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerClose(
        WS_CLOSE_PROTOCOL_MISMATCH,
        "Protocol version mismatch: expected 1, got 2",
      );
      await Promise.resolve();
      expect(events.onProtocolMismatch).toHaveBeenCalledWith(
        expect.stringContaining("mismatch"),
      );
    });

    it("WS-10: after 4002, no reconnect fires", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      const ws = mockWsState.instance;
      ws?.triggerOpen();
      await Promise.resolve();
      ws?.triggerClose(WS_CLOSE_PROTOCOL_MISMATCH);
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(mockWsState.instance).toBe(ws);
    });
  });

  // ── sendResult ────────────────────────────────────────────────────────────

  describe("sendResult()", () => {
    it("sendResult() sends a result message over WS when connected", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      const msg: ResultMessage = { type: "result", id: "r-1", success: true, data: { ok: true } };
      client.sendResult(msg);
      const sent = (mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>;
      expect(sent.some((m) => m["type"] === "result" && m["id"] === "r-1")).toBe(true);
    });

    it("sendResult() preserves error field when success=false", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      const msg: ResultMessage = { type: "result", id: "r-2", success: false, error: "tool crashed" };
      client.sendResult(msg);
      const r = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["id"] === "r-2",
      ) as Record<string, unknown> | undefined;
      expect(r?.["success"]).toBe(false);
      expect(r?.["error"]).toBe("tool crashed");
    });
  });

  // ── incoming message routing ──────────────────────────────────────────────

  describe("incoming message routing", () => {
    it("invoke message is forwarded to events.onInvoke", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerMessage({ type: "invoke", id: "i-1", tool: "ext:t", args: {}, timeout: 5000 });
      await Promise.resolve();
      expect(events.onInvoke).toHaveBeenCalledWith(expect.objectContaining({ type: "invoke", id: "i-1" }));
    });

    it("cancel message is forwarded to events.onCancel", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.triggerMessage({ type: "cancel", id: "i-1" });
      await Promise.resolve();
      expect(events.onCancel).toHaveBeenCalledWith(expect.objectContaining({ type: "cancel", id: "i-1" }));
    });

    it("§6.3: getState message is forwarded to events.onGetState", async () => {
      const { client, events } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      const msg: GetStateMessage = { type: "getState", id: "gs-1" };
      mockWsState.instance?.triggerMessage(msg);
      await Promise.resolve();
      expect(events.onGetState).toHaveBeenCalledWith(expect.objectContaining({ type: "getState", id: "gs-1" }));
    });

    it("§6.3: getState message does NOT trigger a pong or result", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      mockWsState.instance?.triggerMessage({ type: "getState", id: "gs-2" });
      await Promise.resolve();
      const types = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).map((m) => m["type"]);
      expect(types).not.toContain("pong");
      expect(types).not.toContain("result");
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────

  describe("disconnect()", () => {
    it("disconnect() with no active connection resolves cleanly", async () => {
      const { client } = makeClient();
      await expect(client.disconnect()).resolves.toBeUndefined();
    });

    it("disconnect() closes the underlying WebSocket when connected", async () => {
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      await client.disconnect().catch(() => {});
      expect(mockWsState.instance?.lastCloseCode).toBeDefined();
    });
  });

  // ── sendStateUpdate ───────────────────────────────────────────────────────

  describe("sendStateUpdate()", () => {
    it("sendStateUpdate() sends a message with type:'stateUpdate' when connected", async () => {
      // RED on stub: sendStateUpdate() throws 'not implemented'
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      client.sendStateUpdate({ activeFile: "/src/foo.ts" });
      const sent = (mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>;
      expect(sent.find((m) => m["type"] === "stateUpdate")).toBeDefined();
    });

    it("sendStateUpdate() includes the patch fields in the message", async () => {
      // RED on stub: throws
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      const patch = { activeFile: "/src/bar.ts", openFiles: ["/src/bar.ts"] };
      client.sendStateUpdate(patch);
      const msg = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "stateUpdate",
      ) as Record<string, unknown> | undefined;
      expect((msg?.["patch"] as Record<string, unknown> | undefined)?.["activeFile"]).toBe("/src/bar.ts");
    });
  });

  // ── sendCancelled ─────────────────────────────────────────────────────────

  describe("sendCancelled()", () => {
    it("sendCancelled() sends a message with type:'cancelled' when connected", async () => {
      // RED on stub: sendCancelled() throws 'not implemented'
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      client.sendCancelled("inv-77", false);
      const sent = (mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>;
      expect(sent.find((m) => m["type"] === "cancelled")).toBeDefined();
    });

    it("sendCancelled() includes id and late fields in the message", async () => {
      // RED on stub: throws
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      client.sendCancelled("inv-99", true);
      const msg = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "cancelled",
      ) as Record<string, unknown> | undefined;
      expect(msg?.["id"]).toBe("inv-99");
      expect(msg?.["late"]).toBe(true);
    });

    it("sendCancelled() with late=false sets late:false in the message", async () => {
      // RED on stub: throws
      const { client } = makeClient();
      const p = client.connect(IDLE_STATE, []);
      p.catch(() => {});
      mockWsState.instance?.triggerOpen();
      await Promise.resolve();
      mockWsState.instance?.sent.splice(0);
      client.sendCancelled("inv-42", false);
      const msg = ((mockWsState.instance?.parseSent() ?? []) as Array<Record<string, unknown>>).find(
        (m) => m["type"] === "cancelled",
      ) as Record<string, unknown> | undefined;
      expect(msg?.["late"]).toBe(false);
    });
  });

  // ── updateSecret ──────────────────────────────────────────────────────────

  describe("updateSecret()", () => {
    it("updateSecret() does not throw", () => {
      const { client } = makeClient();
      expect(() => client.updateSecret("new-secret")).not.toThrow();
    });
  });
});
