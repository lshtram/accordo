/**
 * Tests for InvokeMessage sessionId + agentHint (MS-02)
 * Requirements: multi-session-architecture.md §MS-02
 *
 * InvokeMessage gains sessionId: string and agentHint: string | null.
 * BridgeDispatch.sendInvoke sends these from the active MCP session.
 *
 * API checklist:
 *   InvokeMessage type — 2 structural tests
 *   BridgeDispatch.invoke — 4 tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WebSocket as WsSocket } from "ws";
import { BridgeDispatch } from "../bridge-dispatch.js";
import type { BridgeConnectionState } from "../bridge-connection.js";
import type { InvokeMessage } from "@accordo/bridge-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConnectionState(connected = true): BridgeConnectionState {
  return {
    connected,
    ws: { close: () => {} } as unknown as WsSocket,
    pingInterval: null,
    messageCount: 0,
    messageWindowStart: Date.now(),
    graceTimer: null,
    registryUpdateCb: null,
    stateUpdateCb: null,
  };
}

function makeDispatch(connected = true) {
  const log = vi.fn();
  const send = vi.fn();

  const connState = makeConnectionState(connected);

  const dispatch = new BridgeDispatch(connState, { log, send });
  return { dispatch, log, send };
}

// ── MS-02: InvokeMessage type enrichment ──────────────────────────────────────

describe("InvokeMessage type enrichment (MS-02)", () => {
  // MS-02.1: InvokeMessage has sessionId field of type string
  it("MS-02.1: InvokeMessage interface has sessionId field of type string", () => {
    const msg = { type: "invoke", id: "123", tool: "foo", args: {}, timeout: 5000, sessionId: "sess-abc" } as InvokeMessage;
    expect(typeof msg.sessionId).toBe("string");
    expect(msg.sessionId).toBe("sess-abc");
  });

  // MS-02.2: InvokeMessage has agentHint field of type string | null
  it("MS-02.2: InvokeMessage interface has agentHint field of type string | null", () => {
    const msg1 = { type: "invoke", id: "123", tool: "foo", args: {}, timeout: 5000, sessionId: "sess-abc", agentHint: "copilot" } as InvokeMessage;
    expect(msg1.agentHint).toBe("copilot");

    const msg2 = { type: "invoke", id: "456", tool: "bar", args: {}, timeout: 5000, sessionId: "sess-abc", agentHint: null } as InvokeMessage;
    expect(msg2.agentHint).toBeNull();
  });

  // MS-02.3: InvokeMessage.type is "invoke" (unchanged)
  it("MS-02.3: InvokeMessage.type is the string 'invoke'", () => {
    const msg = { type: "invoke", id: "123", tool: "foo", args: {}, timeout: 5000, sessionId: "sess-abc", agentHint: null } as InvokeMessage;
    expect(msg.type).toBe("invoke");
  });

  // MS-02.4: InvokeMessage.id, tool, args, timeout unchanged
  it("MS-02.4: InvokeMessage.id, tool, args, timeout are preserved", () => {
    const msg = { type: "invoke", id: "my-id", tool: "my_tool", args: { x: 1 }, timeout: 9999, sessionId: "s", agentHint: null } as InvokeMessage;
    expect(msg.id).toBe("my-id");
    expect(msg.tool).toBe("my_tool");
    expect(msg.args).toEqual({ x: 1 });
    expect(msg.timeout).toBe(9999);
  });
});

// ── MS-02.5/6: BridgeDispatch sends sessionId and agentHint ───────────────────

describe("BridgeDispatch.invoke sends sessionId + agentHint (MS-02.5, MS-02.6)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    // Clear all pending timers first — prevents timeout callbacks from
    // firing after the test and causing double-rejection unhandled errors.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("MS-02.5: invoke() includes sessionId on the InvokeMessage sent to Bridge", async () => {
    const { dispatch, send } = makeDispatch(true);

    const p = dispatch.invoke("tool_a", { arg: 1 }, 30_000);
    // suppress unhandled rejection from cleanup
    p.catch(() => {});

    // The send is called synchronously inside invoke() before the timer is set.
    const calls = send.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const invokeMsg = calls[0][0] as InvokeMessage;
    expect(invokeMsg.type).toBe("invoke");
    expect(typeof invokeMsg.sessionId).toBe("string");
    expect(invokeMsg.sessionId?.length ?? 0).toBeGreaterThan(0);

    // Clean up — clear timers first so timeout callback doesn't double-reject
    vi.clearAllTimers();
    dispatch.rejectAllPending(new Error("cleanup"));
  });

  it("MS-02.6: invoke() includes agentHint on the InvokeMessage", async () => {
    const { dispatch, send } = makeDispatch(true);

    const p = dispatch.invoke("tool_b", {}, 30_000);
    p.catch(() => {});

    const calls = send.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const invokeMsg = calls[0][0] as InvokeMessage;
    expect("agentHint" in invokeMsg).toBe(true);
    expect(invokeMsg.agentHint === null || typeof invokeMsg.agentHint === "string").toBe(true);

    vi.clearAllTimers();
    dispatch.rejectAllPending(new Error("cleanup"));
  });
});