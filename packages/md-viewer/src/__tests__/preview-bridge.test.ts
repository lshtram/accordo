/**
 * PreviewBridge — failing tests (Phase B)
 *
 * Requirements tested:
 *   M41b-PBR-01  Constructor subscribes to CommentStore.onChanged
 *   M41b-PBR-02  loadThreadsForUri() sends comments:load message to webview
 *   M41b-PBR-03  comment:create message → calls store.createThread
 *   M41b-PBR-04  comment:reply message → calls store.reply
 *   M41b-PBR-05  comment:resolve message → calls store.resolve
 *   M41b-PBR-06  comment:delete message → calls store.delete
 *   M41b-PBR-07  Store onChanged triggers a comments:load push for current URI
 *   M41b-PBR-08  dispose() removes store subscription and webview listener
 *   M41b-PBR-09  Unknown message type → silently ignored (no throw)
 *   M41b-PBR-10  toSdkThread() maps CommentThread → SdkThread correctly
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { PreviewBridge, toSdkThread } from "../preview-bridge.js";
import type { CommentThread } from "@accordo/bridge-types";

// ── Mocks ──────────────────────────────────────────────────────────────

function makeStoreMock() {
  const listeners: Array<() => void> = [];
  return {
    createThread: vi.fn().mockResolvedValue({ id: "t1", comments: [] }),
    reply: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getThreadsForUri: vi.fn().mockReturnValue([]),
    getWorkspaceRoot: vi.fn().mockReturnValue("/project"),
    onChanged: vi.fn((listener: () => void) => {
      listeners.push(listener);
      return { dispose: vi.fn() };
    }),
    // Test helper: fire a change event (no URI — store fires globally)
    _fire: () => listeners.forEach(l => l()),
  };
}

type MessageListener = (msg: unknown) => void;

function makeWebviewMock() {
  let msgListener: MessageListener | null = null;
  return {
    postMessage: vi.fn().mockResolvedValue(undefined),
    onDidReceiveMessage: vi.fn((cb: MessageListener) => {
      msgListener = cb;
      return { dispose: vi.fn() };
    }),
    // Test helper: simulate a message from the webview
    _send: (msg: unknown) => { if (msgListener) msgListener(msg); },
  };
}

const DOC_URI = "file:///project/README.md";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("PreviewBridge", () => {
  let store: ReturnType<typeof makeStoreMock>;
  let webview: ReturnType<typeof makeWebviewMock>;

  beforeEach(() => {
    store = makeStoreMock();
    webview = makeWebviewMock();
  });

  // ── M41b-PBR-01: Subscription ─────────────────────────────────────────

  it("M41b-PBR-01: constructor subscribes to CommentStore.onChanged", () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    expect(store.onChanged).toHaveBeenCalledOnce();
  });

  it("M41b-PBR-01: constructor registers a webview message handler", () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    expect(webview.onDidReceiveMessage).toHaveBeenCalledOnce();
  });

  // ── M41b-PBR-02: loadThreadsForUri ─────────────────────────────────────

  it("M41b-PBR-02: loadThreadsForUri sends a comments:load message to the webview", () => {
    const bridge = new PreviewBridge(store as never, webview as never, DOC_URI);
    bridge.loadThreadsForUri();
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comments:load" })
    );
  });

  it("M41b-PBR-02: comments:load payload contains threads array", () => {
    store.getThreadsForUri.mockReturnValue([
      { id: "t1", status: "open", anchor: { kind: "surface", uri: DOC_URI, surfaceType: "markdown-preview", coordinates: { type: "block", blockId: "p:0", blockType: "paragraph" } }, comments: [], createdAt: "2026-03-01T12:00:00Z", lastActivity: "2026-03-01T12:00:00Z" },
    ]);
    const bridge = new PreviewBridge(store as never, webview as never, DOC_URI);
    bridge.loadThreadsForUri();
    const [call] = (webview.postMessage as Mock).mock.calls;
    expect(call[0].threads).toBeDefined();
    expect(Array.isArray(call[0].threads)).toBe(true);
  });

  // ── M41b-PBR-03: comment:create ─────────────────────────────────────────

  it("M41b-PBR-03: comment:create message calls store.createThread", async () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    webview._send({ type: "comment:create", blockId: "p:0", body: "Looks good" });
    await Promise.resolve();
    expect(store.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Looks good" })
    );
  });

  // ── M41b-PBR-04: comment:reply ──────────────────────────────────────────

  it("M41b-PBR-04: comment:reply message calls store.reply", async () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    webview._send({ type: "comment:reply", threadId: "t1", body: "Agreed" });
    await Promise.resolve();
    expect(store.reply).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "t1", body: "Agreed" })
    );
  });

  // ── M41b-PBR-05: comment:resolve ───────────────────────────────────────

  it("M41b-PBR-05: comment:resolve message calls store.resolve", async () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    webview._send({ type: "comment:resolve", threadId: "t2", resolutionNote: "Done" });
    await Promise.resolve();
    expect(store.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "t2" })
    );
  });

  // ── M41b-PBR-06: comment:delete ────────────────────────────────────────

  it("M41b-PBR-06: comment:delete message calls store.delete", async () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    webview._send({ type: "comment:delete", threadId: "t3", commentId: "c9" });
    await Promise.resolve();
    expect(store.delete).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "t3" })
    );
  });

  // ── M41b-PBR-07: onChanged push ─────────────────────────────────────────

  it("M41b-PBR-07: store onChanged event triggers a comments:load push", async () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    store._fire();
    await Promise.resolve();
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comments:load" })
    );
  });

  it("M41b-PBR-07: any store onChanged (incl. other files) pushes threads for this URI", async () => {
    (store.getThreadsForUri as Mock).mockReturnValue([]);
    new PreviewBridge(store as never, webview as never, DOC_URI);
    (webview.postMessage as Mock).mockClear();
    store._fire(); // simulates a change on any file
    await Promise.resolve();
    // Bridge always pushes — correctness preserved via getThreadsForUri scoping
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comments:load" })
    );
  });

  // ── M41b-PBR-08: dispose ───────────────────────────────────────────────

  it("M41b-PBR-08: dispose() calls dispose on the store subscription", () => {
    const bridge = new PreviewBridge(store as never, webview as never, DOC_URI);
    const subscriptionDispose = (store.onChanged as Mock).mock.results[0].value.dispose as Mock;
    bridge.dispose();
    expect(subscriptionDispose).toHaveBeenCalledOnce();
  });

  it("M41b-PBR-08: dispose() calls dispose on the webview message listener", () => {
    const bridge = new PreviewBridge(store as never, webview as never, DOC_URI);
    const listenerDispose = (webview.onDidReceiveMessage as Mock).mock.results[0].value.dispose as Mock;
    bridge.dispose();
    expect(listenerDispose).toHaveBeenCalledOnce();
  });

  // ── M41b-PBR-09: Unknown message ──────────────────────────────────────

  it("M41b-PBR-09: unknown message type is silently ignored without throwing", async () => {
    new PreviewBridge(store as never, webview as never, DOC_URI);
    await expect(async () => {
      webview._send({ type: "unknown:action", data: "some data" });
      await Promise.resolve();
    }).not.toThrow();
  });
});

// ── toSdkThread tests ───────────────────────────────────────────────────────────

/** Build a minimal CommentThread with a block anchor */
function makeThread(
  overrides: Partial<CommentThread> & { blockId?: string } = {}
): CommentThread {
  const { blockId = "p:0", ...rest } = overrides;
  return {
    id: "t1",
    anchor: {
      kind: "surface",
      uri: DOC_URI,
      surfaceType: "markdown-preview",
      coordinates: { type: "block", blockId, blockType: "paragraph" },
    },
    comments: [],
    status: "open",
    createdAt: "2026-03-01T10:00:00Z",
    lastActivity: "2026-03-01T10:00:00Z",
    ...rest,
  } as unknown as CommentThread;
}

describe("toSdkThread", () => {
  const LOADED_AT = "2026-03-01T11:00:00Z";

  it("M41b-PBR-10: maps thread id to SdkThread.id", () => {
    const result = toSdkThread(makeThread({ id: "abc" }), LOADED_AT);
    expect(result.id).toBe("abc");
  });

  it("M41b-PBR-10: extracts blockId from block-anchor coordinates", () => {
    const result = toSdkThread(makeThread({ blockId: "heading:1:intro" }), LOADED_AT);
    expect(result.blockId).toBe("heading:1:intro");
  });

  it("M41b-PBR-10: open thread → status 'open'", () => {
    const result = toSdkThread(makeThread({ status: "open" }), LOADED_AT);
    expect(result.status).toBe("open");
  });

  it("M41b-PBR-10: resolved thread → status 'resolved'", () => {
    const result = toSdkThread(
      makeThread({ status: "resolved" }),
      LOADED_AT
    );
    expect(result.status).toBe("resolved");
  });

  it("M41b-PBR-10: lastActivity after loadedAt → hasUnread true", () => {
    const result = toSdkThread(
      makeThread({ lastActivity: "2026-03-01T12:00:00Z" }), // after LOADED_AT
      LOADED_AT
    );
    expect(result.hasUnread).toBe(true);
  });

  it("M41b-PBR-10: lastActivity before loadedAt → hasUnread false", () => {
    const result = toSdkThread(
      makeThread({ lastActivity: "2026-03-01T09:00:00Z" }), // before LOADED_AT
      LOADED_AT
    );
    expect(result.hasUnread).toBe(false);
  });

  it("M41b-PBR-10: lastActivity equal to loadedAt → hasUnread false", () => {
    const result = toSdkThread(makeThread({ lastActivity: LOADED_AT }), LOADED_AT);
    expect(result.hasUnread).toBe(false);
  });

  it("M41b-PBR-10: comments array is passed through to SdkThread", () => {
    const comments = [{ id: "c1", authorKind: "user", authorName: "Alice", body: "Hi", createdAt: "2026-03-01T10:00:00Z" }];
    const result = toSdkThread(
      makeThread({ comments: comments as never }),
      LOADED_AT
    );
    expect(result.comments).toHaveLength(1);
  });
});

