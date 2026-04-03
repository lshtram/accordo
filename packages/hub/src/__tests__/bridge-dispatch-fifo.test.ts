/**
 * Tests for BridgeDispatch FIFO queue
 * Requirements: requirements-hub.md CONC-03 (simple FIFO, global 16 cap)
 * 
 * All opencode↔VSCode calls are user-driven presentation/context messages.
 * Simple FIFO is sufficient — the global 16-slot cap prevents flooding.
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

/**
 * Creates a BridgeDispatch with a send mock that CAPTURES invoke messages
 * but does NOT call routeMessage (so promises don't resolve).
 */
function makeDispatch(
  connected = true,
  opts: { maxConcurrent?: number; maxQueueDepth?: number } = {},
) {
  const log = vi.fn();
  const connState = makeConnectionState(connected);

  const dispatch = new BridgeDispatch(connState, {
    log,
    send: () => {},
    ...opts,
  });

  const sentMessages: InvokeMessage[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dispatch as any).send = (msg: Record<string, unknown>) => {
    if (msg["type"] === "invoke") {
      sentMessages.push(msg as unknown as InvokeMessage);
    }
  };

  return { dispatch, log, sentMessages };
}

function collectInvokeMessages(sentMessages: InvokeMessage[]): InvokeMessage[] {
  return sentMessages.filter((m) => m["type"] === "invoke");
}

// ── FIFO Tests ─────────────────────────────────────────────────────────────────

describe("BridgeDispatch — FIFO Queue (CONC-03)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // FIFO-1: Calls dispatched in order of arrival (first submitted, first dispatched)
  it("FIFO-1: dispatch order matches submission order", async () => {
    const { dispatch, sentMessages } = makeDispatch(true, { maxConcurrent: 16 });

    dispatch.invoke("tool_A", { sessionId: "A" }, 60_000);
    dispatch.invoke("tool_B", { sessionId: "B" }, 60_000);
    dispatch.invoke("tool_C", { sessionId: "C" }, 60_000);
    dispatch.invoke("tool_D", { sessionId: "D" }, 60_000);

    vi.advanceTimersByTime(1);

    const messages = collectInvokeMessages(sentMessages);
    expect(messages.length).toBe(4);

    const toolNames = messages.map((m) => m["tool"] as string);
    expect(toolNames).toEqual(["tool_A", "tool_B", "tool_C", "tool_D"]);
  });

  // FIFO-2: When 16 slots are full, subsequent calls queue FIFO
  it("FIFO-2: calls queue FIFO when 16 slots are full", async () => {
    const { dispatch, sentMessages } = makeDispatch(true, { maxConcurrent: 16, maxQueueDepth: 64 });

    // Submit 20 calls — only 16 should dispatch immediately
    for (let i = 0; i < 20; i++) {
      dispatch.invoke(`tool_${i}`, { order: i }, 60_000);
    }

    vi.advanceTimersByTime(1);

    const messages = collectInvokeMessages(sentMessages);
    expect(messages.length).toBe(16); // First 16 fill the slots

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((dispatch as any).queue.length).toBe(4); // 4 queued behind
  });

  // FIFO-3: Queue depth of 64 is enforced — 65th call throws -32004
  it("FIFO-3: 65th call throws queue-full error -32004", async () => {
    const { dispatch } = makeDispatch(true, { maxConcurrent: 1, maxQueueDepth: 64 });

    // Submit 65 calls - catch all rejections to avoid unhandled
    for (let i = 0; i < 65; i++) {
      dispatch.invoke(`tool_${i}`, { order: i }, 60_000).catch(() => {});
    }

    // Queue holds 64 (1 in flight + 63 queued), 65th call was rejected
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((dispatch as any).queue.length).toBe(64);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((dispatch as any).inflight).toBe(1);
  });

  // FIFO-4: When a call completes, the next queued call is dispatched (FIFO order preserved)
  it("FIFO-4: result frees slot and next queued call is dispatched in FIFO order", async () => {
    const { dispatch, sentMessages } = makeDispatch(true, { maxConcurrent: 1, maxQueueDepth: 64 });

    let capturedId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dispatch as any).send = (msg: Record<string, unknown>) => {
      if (msg["type"] === "invoke") {
        if (!capturedId) capturedId = msg["id"] as string;
        sentMessages.push(msg as unknown as InvokeMessage);
      }
    };

    dispatch.invoke("tool_first", { order: 1 }, 60_000);
    dispatch.invoke("tool_second", { order: 2 }, 60_000);

    vi.advanceTimersByTime(1);

    expect(collectInvokeMessages(sentMessages).length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((dispatch as any).queue.length).toBe(1);

    // Simulate result for first invoke
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatch.routeMessage(JSON.stringify({ type: "result", id: capturedId, success: true, data: "ok" }));

    vi.advanceTimersByTime(1);

    const messages = collectInvokeMessages(sentMessages);
    expect(messages.length).toBe(2);

    const orders = messages.map((m) => ((m as InvokeMessage & { args: { order: number } }).args as { order: number }).order);
    expect(orders).toEqual([1, 2]); // FIFO order preserved
  });

  // FIFO-5: Cancellation removes a pending invoke and its timer
  it("FIFO-5: cancellation removes pending invoke and timer", async () => {
    const { dispatch, sentMessages } = makeDispatch(true, { maxConcurrent: 1, maxQueueDepth: 64 });

    let capturedId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dispatch as any).send = (msg: Record<string, unknown>) => {
      if (msg["type"] === "invoke") {
        if (!capturedId) capturedId = msg["id"] as string;
        sentMessages.push(msg as unknown as InvokeMessage);
      }
    };

    // Catch rejection from the cancelled invoke
    const firstInvoke = dispatch.invoke("tool_first", { order: 1 }, 60_000);
    firstInvoke.catch(() => {}); // Suppress unhandled rejection

    dispatch.invoke("tool_second", { order: 2 }, 60_000);

    vi.advanceTimersByTime(1);

    expect(collectInvokeMessages(sentMessages).length).toBe(1);

    // Simulate cancellation of first invoke
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatch.routeMessage(JSON.stringify({ type: "cancelled", id: capturedId, late: false }));

    vi.advanceTimersByTime(1);

    const messages = collectInvokeMessages(sentMessages);
    expect(messages.length).toBe(2);

    const orders = messages.map((m) => ((m as InvokeMessage & { args: { order: number } }).args as { order: number }).order);
    expect(orders).toEqual([1, 2]);
  });

  // FIFO-6: Concurrent calls up to 16 work without queuing
  it("FIFO-6: up to 16 concurrent calls dispatch immediately without queuing", async () => {
    const { dispatch, sentMessages } = makeDispatch(true, { maxConcurrent: 16, maxQueueDepth: 64 });

    // Submit exactly 16 calls — all should dispatch immediately
    for (let i = 0; i < 16; i++) {
      dispatch.invoke(`tool_${i}`, { order: i }, 60_000);
    }

    vi.advanceTimersByTime(1);

    const messages = collectInvokeMessages(sentMessages);
    expect(messages.length).toBe(16);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((dispatch as any).queue.length).toBe(0); // No queuing needed
  });

  // FIFO-7: Timed-out calls are rejected and next in queue is dispatched
  it("FIFO-7: timed-out call is rejected and next queued call is dispatched", async () => {
    const { dispatch, sentMessages } = makeDispatch(true, { maxConcurrent: 1, maxQueueDepth: 64 });

    let capturedId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dispatch as any).send = (msg: Record<string, unknown>) => {
      if (msg["type"] === "invoke") {
        if (!capturedId) capturedId = msg["id"] as string;
        sentMessages.push(msg as unknown as InvokeMessage);
      }
    };

    // First call with very short timeout — catch its rejection
    const firstInvoke = dispatch.invoke("tool_first", { order: 1 }, 1); // 1ms timeout
    firstInvoke.catch(() => {}); // Suppress unhandled rejection

    dispatch.invoke("tool_second", { order: 2 }, 60_000);

    // At this point first invoke is in flight with 1ms timeout, second is queued
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((dispatch as any).queue.length).toBe(1);
    expect(collectInvokeMessages(sentMessages).length).toBe(1);

    // Advance past the 1ms timeout — first times out, second is dispatched
    vi.advanceTimersByTime(10);

    const messages = collectInvokeMessages(sentMessages);
    expect(messages.length).toBe(2);

    const orders = messages.map((m) => ((m as InvokeMessage & { args: { order: number } }).args as { order: number }).order);
    expect(orders).toEqual([1, 2]);
  });
});
