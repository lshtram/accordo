/**
 * A18 — DiagramCommentsBridge tests (Phase B — all RED, turn GREEN in Phase C)
 *
 * Tests cover the full public contract of comments/diagram-comments-bridge.ts:
 *   - constructor / getSurfaceAdapter     A18-T01
 *   - handleWebviewMessage routing        A18-T02..T06, T10, T11
 *   - loadThreadsForUri / onChanged       A18-T07, T08, T09
 *   - dispose                             A18-T12
 *
 * Source: requirements-diagram.md §3, diag_workplan.md (A18)
 *
 * API checklist:
 * ✓ constructor          — 1 test  (A18-T01)
 * ✓ comment:create       — 1 test  (A18-T02)
 * ✓ comment:reply        — 1 test  (A18-T03)
 * ✓ comment:resolve      — 1 test  (A18-T04)
 * ✓ comment:reopen       — 1 test  (A18-T05)
 * ✓ comment:delete       — 1 test  (A18-T06)
 * ✓ loadThreadsForUri    — 1 test  (A18-T07)
 * ✓ onChanged reload     — 1 test  (A18-T08)
 * ✓ no double-subscribe  — 1 test  (A18-T09)
 * ✓ unknown message      — 1 test  (A18-T10)
 * ✓ null adapter (inert) — 1 test  (A18-T11)
 * ✓ dispose              — 1 test  (A18-T12)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DiagramCommentsBridge,
} from "../comments/diagram-comments-bridge.js";
import type { SurfaceAdapterLike, WebviewSender } from "../comments/diagram-comments-bridge.js";
import type { CommentThread } from "@accordo/bridge-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MMD_URI = "file:///workspace/arch.mmd";

function makeThread(id = "t1"): CommentThread {
  return {
    id,
    uri: MMD_URI,
    anchor: {
      kind: "surface",
      uri: MMD_URI,
      surfaceType: "diagram",
      coordinates: { type: "diagram-node", nodeId: "node:auth" },
    },
    comments: [],
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeAdapter(threads: CommentThread[] = []): SurfaceAdapterLike {
  return {
    createThread: vi.fn().mockResolvedValue(makeThread()),
    reply: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    reopen: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getThreadsForUri: vi.fn().mockReturnValue(threads),
    onChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
}

function makeSender(): WebviewSender {
  return { postMessage: vi.fn().mockResolvedValue(true) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DiagramCommentsBridge", () => {
  let adapter: SurfaceAdapterLike;
  let sender: WebviewSender;
  let bridge: DiagramCommentsBridge;

  beforeEach(() => {
    adapter = makeAdapter();
    sender = makeSender();
    bridge = new DiagramCommentsBridge(adapter, sender, MMD_URI);
  });

  // ── A18-T01 ──────────────────────────────────────────────────────────────

  it("A18-T01: constructor stores adapter reference (non-null adapter)", () => {
    // If construction threw, the test would not reach here.
    // Verify adapter is held by checking that loadThreadsForUri can use it.
    bridge.loadThreadsForUri();
    expect(vi.mocked(adapter.getThreadsForUri)).toHaveBeenCalledWith(MMD_URI);
  });

  // ── A18-T02 ──────────────────────────────────────────────────────────────

  it("A18-T02: comment:create → adapter.createThread with correct anchor and body", async () => {
    await bridge.handleWebviewMessage({
      type: "comment:create",
      blockId: "node:auth",
      body: "Why is this auth step here?",
    });

    expect(vi.mocked(adapter.createThread)).toHaveBeenCalledOnce();
    expect(vi.mocked(adapter.createThread)).toHaveBeenCalledWith({
      uri: MMD_URI,
      anchor: {
        kind: "surface",
        uri: MMD_URI,
        surfaceType: "diagram",
        coordinates: { type: "diagram-node", nodeId: "node:auth" },
      },
      body: "Why is this auth step here?",
      intent: undefined,
    });
  });

  it("A18-T02: comment:create with edge blockId uses full blockId as nodeId", async () => {
    await bridge.handleWebviewMessage({
      type: "comment:create",
      blockId: "edge:auth->api:0",
      body: "Should this be async?",
    });

    expect(vi.mocked(adapter.createThread)).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: expect.objectContaining({
          coordinates: { type: "diagram-node", nodeId: "edge:auth->api:0" },
        }),
      }),
    );
  });

  it("A18-T02: comment:create forwards optional intent field", async () => {
    await bridge.handleWebviewMessage({
      type: "comment:create",
      blockId: "node:db",
      body: "Security concern",
      intent: "security",
    });

    expect(vi.mocked(adapter.createThread)).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "security" }),
    );
  });

  // ── A18-T03 ──────────────────────────────────────────────────────────────

  it("A18-T03: comment:reply → adapter.reply({ threadId, body })", async () => {
    await bridge.handleWebviewMessage({
      type: "comment:reply",
      threadId: "t1",
      body: "Agreed, let me fix this.",
    });

    expect(vi.mocked(adapter.reply)).toHaveBeenCalledWith({
      threadId: "t1",
      body: "Agreed, let me fix this.",
    });
  });

  // ── A18-T04 ──────────────────────────────────────────────────────────────

  it("A18-T04: comment:resolve → adapter.resolve({ threadId })", async () => {
    await bridge.handleWebviewMessage({
      type: "comment:resolve",
      threadId: "t1",
    });

    expect(vi.mocked(adapter.resolve)).toHaveBeenCalledWith({ threadId: "t1" });
  });

  // ── A18-T05 ──────────────────────────────────────────────────────────────

  it("A18-T05: comment:reopen → adapter.reopen({ threadId })", async () => {
    await bridge.handleWebviewMessage({
      type: "comment:reopen",
      threadId: "t1",
    });

    expect(vi.mocked(adapter.reopen)).toHaveBeenCalledWith({ threadId: "t1" });
  });

  // ── A18-T06 ──────────────────────────────────────────────────────────────

  it("A18-T06: comment:delete → adapter.delete({ threadId })", async () => {
    await bridge.handleWebviewMessage({
      type: "comment:delete",
      threadId: "t1",
    });

    expect(vi.mocked(adapter.delete)).toHaveBeenCalledWith({ threadId: "t1" });
  });

  // ── A18-T07 ──────────────────────────────────────────────────────────────

  it("A18-T07: loadThreadsForUri posts comments:load immediately from getThreadsForUri", () => {
    const threads = [makeThread("t1"), makeThread("t2")];
    vi.mocked(adapter.getThreadsForUri).mockReturnValue(threads);

    bridge.loadThreadsForUri();

    expect(vi.mocked(adapter.getThreadsForUri)).toHaveBeenCalledWith(MMD_URI);
    expect(vi.mocked(sender.postMessage)).toHaveBeenCalledWith({
      type: "comments:load",
      threads,
    });
  });

  // ── A18-T08 ──────────────────────────────────────────────────────────────

  it("A18-T08: adapter.onChanged fires → bridge re-posts comments:load (full reload)", () => {
    const threads = [makeThread()];
    vi.mocked(adapter.getThreadsForUri).mockReturnValue(threads);

    let changeCallback: ((uri: string) => void) | null = null;
    vi.mocked(adapter.onChanged).mockImplementation((cb) => {
      changeCallback = cb;
      return { dispose: vi.fn() };
    });

    bridge.loadThreadsForUri();
    vi.mocked(sender.postMessage).mockClear();

    // Simulate store change
    changeCallback!("some-other-uri");

    expect(vi.mocked(sender.postMessage)).toHaveBeenCalledWith({
      type: "comments:load",
      threads,
    });
  });

  // ── A18-T09 ──────────────────────────────────────────────────────────────

  it("A18-T09: calling loadThreadsForUri twice replaces the prior onChanged subscription", () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();

    vi.mocked(adapter.onChanged)
      .mockReturnValueOnce({ dispose: firstDispose })
      .mockReturnValueOnce({ dispose: secondDispose });

    bridge.loadThreadsForUri();
    bridge.loadThreadsForUri();

    // First subscription must be disposed before second is created
    expect(firstDispose).toHaveBeenCalledOnce();
    // Second subscription still active (not yet disposed)
    expect(secondDispose).not.toHaveBeenCalled();
  });

  // ── A18-T10 ──────────────────────────────────────────────────────────────

  it("A18-T10: unknown message type → no adapter call, no throw", async () => {
    await expect(
      bridge.handleWebviewMessage({ type: "canvas:node-moved", nodeId: "A", x: 0, y: 0 }),
    ).resolves.toBeUndefined();

    expect(vi.mocked(adapter.createThread)).not.toHaveBeenCalled();
    expect(vi.mocked(adapter.reply)).not.toHaveBeenCalled();
  });

  it("A18-T10: null/non-object message → no throw", async () => {
    await expect(bridge.handleWebviewMessage(null)).resolves.toBeUndefined();
    await expect(bridge.handleWebviewMessage("string")).resolves.toBeUndefined();
  });

  // ── A18-T11 ──────────────────────────────────────────────────────────────

  it("A18-T11: null adapter → constructor succeeds, all messages silently ignored", async () => {
    const inertBridge = new DiagramCommentsBridge(null, sender, MMD_URI);

    await expect(
      inertBridge.handleWebviewMessage({ type: "comment:create", blockId: "node:auth", body: "x" }),
    ).resolves.toBeUndefined();

    inertBridge.loadThreadsForUri();

    expect(vi.mocked(sender.postMessage)).not.toHaveBeenCalled();
  });

  // ── A18-T12 ──────────────────────────────────────────────────────────────

  it("A18-T12: dispose() disposes onChanged subscription; no further events forwarded", () => {
    const subDispose = vi.fn();
    let changeCallback: ((uri: string) => void) | null = null;

    vi.mocked(adapter.onChanged).mockImplementation((cb) => {
      changeCallback = cb;
      return { dispose: subDispose };
    });

    bridge.loadThreadsForUri();
    vi.mocked(sender.postMessage).mockClear();

    bridge.dispose();

    expect(subDispose).toHaveBeenCalledOnce();

    // After dispose, a store change must NOT trigger a postMessage
    changeCallback!("any-uri");
    expect(vi.mocked(sender.postMessage)).not.toHaveBeenCalled();
  });

  it("A18-T12: dispose() is safe to call when loadThreadsForUri was never called", () => {
    expect(() => bridge.dispose()).not.toThrow();
  });
});
