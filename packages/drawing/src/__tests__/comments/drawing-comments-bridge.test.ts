/**
 * DRW-CI02 — Host integration tests for DrawingCommentsBridge.
 *
 * Tests the full host-side bridge: mutation routing, thread conversion,
 * onChanged reload forwarding, dispose behavior, and null adapter inert pass-through.
 *
 * Proof surface: DRW-CI02 (package integration)
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.6 (DRW-C05, DRW-C06, DRW-C08)
 * Source: docs/10-architecture/drawing-architecture.md §9.6, §9.9
 * Requirements: DRW-C05, DRW-C06, DRW-C08
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommentThread, CommentAnchor } from "@accordo/bridge-types";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import type { SdkThread, HostMessage } from "@accordo/comment-sdk";
import {
  DrawingCommentsBridge,
  type DrawingCommentAnchorTarget,
} from "../../comments/drawing-comments-bridge.js";

/** Minimal CommentAnchorSurface for drawing modality */
function makeDrawingAnchor(target: DrawingCommentAnchorTarget): CommentAnchor {
  return {
    kind: "surface",
    uri: "file:///test/foo.mmd",
    surfaceType: "diagram",
    coordinates: {
      type: "diagram-node",
      nodeId: target.nodeId,
    },
  };
}

/** Stub SurfaceCommentAdapter that records all calls */
function createStubAdapter() {
  const adapter = {
    createThread: vi.fn<SurfaceCommentAdapter["createThread"]>(),
    reply: vi.fn<SurfaceCommentAdapter["reply"]>(),
    resolve: vi.fn<SurfaceCommentAdapter["resolve"]>(),
    reopen: vi.fn<SurfaceCommentAdapter["reopen"]>(),
    delete: vi.fn<SurfaceCommentAdapter["delete"]>(),
    getThreadsForUri: vi.fn<SurfaceCommentAdapter["getThreadsForUri"]>(() => []),
    onChanged: vi.fn<SurfaceCommentAdapter["onChanged"]>(),
  };
  return adapter;
}

/** Stub sender that records posted messages */
function createStubSender() {
  return {
    postMessage: vi.fn<{ postMessage(msg: HostMessage): Promise<boolean> }["postMessage"]>(),
  };
}

/** Helper: CommentThread from the store (pre-conversion) */
function storeThread(id: string, anchor: CommentAnchor): CommentThread {
  return {
    id,
    anchor,
    status: "open",
    comments: [
      {
        id: `${id}-c1`,
        author: { kind: "user", name: "Alice" },
        body: "Test comment",
        createdAt: "2026-05-06T00:00:00Z",
      },
    ],
    context: {},
  };
}

describe("comments/drawing-comments-bridge", () => {
  describe("DRW-C05: full lifecycle through SurfaceCommentAdapter", () => {
    it("DRW-CI02: createThread routes to adapter with correct anchor", async () => {
      const adapter = createStubAdapter();
      adapter.createThread.mockResolvedValue({
        id: "thread-1",
        anchor: makeDrawingAnchor({ prefix: "node", identity: "A", nodeId: "node:A" }),
        status: "open",
        comments: [],
        context: {},
      });

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      await bridge.handleWebviewMessage({
        type: "comment:create",
        blockId: "node:A",
        body: "Hello",
      });

      expect(adapter.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          uri: "file:///test/foo.mmd",
          body: "Hello",
        })
      );
      const createArgs = adapter.createThread.mock.calls[0]![0] as Parameters<SurfaceCommentAdapter["createThread"]>[0];
      expect(createArgs.anchor.surfaceType).toBe("diagram");
      expect(createArgs.anchor.coordinates).toMatchObject({
        type: "diagram-node",
        nodeId: "node:A",
      });
    });

    it("DRW-CI02: reply routes to adapter with threadId", async () => {
      const adapter = createStubAdapter();
      adapter.reply.mockResolvedValue(undefined);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      await bridge.handleWebviewMessage({
        type: "comment:reply",
        threadId: "thread-1",
        body: "Reply content",
      });

      expect(adapter.reply).toHaveBeenCalledWith({
        threadId: "thread-1",
        body: "Reply content",
      });
    });

    it("DRW-CI02: resolve routes to adapter with threadId and resolutionNote", async () => {
      const adapter = createStubAdapter();
      adapter.resolve.mockResolvedValue(undefined);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      await bridge.handleWebviewMessage({
        type: "comment:resolve",
        threadId: "thread-1",
        resolutionNote: "Fixed in latest patch",
      });

      expect(adapter.resolve).toHaveBeenCalledWith({
        threadId: "thread-1",
        resolutionNote: "Fixed in latest patch",
      });
    });

    it("DRW-CI02: reopen routes to adapter with threadId", async () => {
      const adapter = createStubAdapter();
      adapter.reopen.mockResolvedValue(undefined);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      await bridge.handleWebviewMessage({
        type: "comment:reopen",
        threadId: "thread-1",
      });

      expect(adapter.reopen).toHaveBeenCalledWith({ threadId: "thread-1" });
    });

    it("DRW-CI02: delete routes to adapter with threadId and optional commentId", async () => {
      const adapter = createStubAdapter();
      adapter.delete.mockResolvedValue(undefined);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      await bridge.handleWebviewMessage({
        type: "comment:delete",
        threadId: "thread-1",
      });
      expect(adapter.delete).toHaveBeenCalledWith({ threadId: "thread-1" });

      adapter.delete.mockClear();

      await bridge.handleWebviewMessage({
        type: "comment:delete",
        threadId: "thread-1",
        commentId: "comment-abc",
      });
      expect(adapter.delete).toHaveBeenCalledWith({
        threadId: "thread-1",
        commentId: "comment-abc",
      });
    });
  });

  describe("DRW-C06: store sync triggers full reload via comments:load", () => {
    it("DRW-CI02: loadThreadsForUri posts canonical SdkThread[] as comments:load", () => {
      const adapter = createStubAdapter();
      const nodeAnchor = makeDrawingAnchor({ prefix: "node", identity: "A", nodeId: "node:A" });
      const edgeAnchor = makeDrawingAnchor({ prefix: "edge", identity: "A->B:0", nodeId: "edge:A->B:0" });
      adapter.getThreadsForUri.mockReturnValue([
        storeThread("thread-1", nodeAnchor),
        storeThread("thread-2", edgeAnchor),
      ]);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      bridge.loadThreadsForUri();

      expect(adapter.getThreadsForUri).toHaveBeenCalledWith("file:///test/foo.mmd");
      expect(sender.postMessage).toHaveBeenCalled();
      const posted = sender.postMessage.mock.calls[0]![0] as HostMessage;
      expect(posted.type).toBe("comments:load");
      expect(posted.threads).toHaveLength(2);
      expect(posted.threads[0]!.blockId).toBe("node:A");
      expect(posted.threads[1]!.blockId).toBe("edge:A->B:0");
    });

    it("DRW-CI02: onChanged listener triggers full reload when store changes — listener must be registered before bridge", () => {
      // Arrange: set up listener capture BEFORE constructing the bridge
      // so the bridge's constructor can register the listener with the adapter
      const adapter = createStubAdapter();
      adapter.getThreadsForUri.mockReturnValue([]);

      // Pre-register the listener capture so the bridge's constructor registers
      // the listener into our captured list
      const listeners: Array<(uri: string) => void> = [];
      adapter.onChanged.mockImplementation((listener: (uri: string) => void) => {
        listeners.push(listener);
        return { dispose: vi.fn() };
      });

      const sender = createStubSender();
      // Act: construct the bridge — this must register the onChanged listener
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      // Assert: at least one listener was registered
      expect(listeners.length).toBeGreaterThan(0);

      // Simulate store change notification for the matching URI
      const listener = listeners[0]!;
      listener("file:///test/foo.mmd");

      // A full reload must have been triggered via getThreadsForUri
      expect(adapter.getThreadsForUri).toHaveBeenCalledWith("file:///test/foo.mmd");
      // And postMessage must have been called with comments:load
      expect(sender.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "comments:load" })
      );
    });

    it("DRW-CI02: onChanged listener does NOT trigger reload for different URI", () => {
      const adapter = createStubAdapter();
      adapter.getThreadsForUri.mockReturnValue([]);

      const listeners: Array<(uri: string) => void> = [];
      adapter.onChanged.mockImplementation((listener: (uri: string) => void) => {
        listeners.push(listener);
        return { dispose: vi.fn() };
      });

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      // Phase B: The constructor must call adapter.onChanged() to register a listener.
      // If it doesn't, listeners is empty and this assertion fails at the right level.
      expect(listeners.length).toBeGreaterThan(0);

      // Notify for a different URI — no reload should trigger
      const listener = listeners[0]!;
      listener("file:///test/completely-different.mmd");

      expect(adapter.getThreadsForUri).not.toHaveBeenCalled();
    });

    it("DRW-CI02: null adapter is inert — no crash on loadThreadsForUri", () => {
      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(null, sender, "file:///test/foo.mmd");

      expect(() => bridge.loadThreadsForUri()).not.toThrow();
    });

    it("DRW-CI02: null adapter is inert — no crash on handleWebviewMessage", async () => {
      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(null, sender, "file:///test/foo.mmd");

      await expect(
        bridge.handleWebviewMessage({ type: "comment:reply", threadId: "t1", body: "hi" })
      ).resolves.not.toThrow();
      await expect(
        bridge.handleWebviewMessage({ type: "comment:resolve", threadId: "t1", resolutionNote: "done" })
      ).resolves.not.toThrow();
      await expect(
        bridge.handleWebviewMessage({ type: "comment:delete", threadId: "t1" })
      ).resolves.not.toThrow();
    });
  });

  describe("DRW-C08: dispose stops forwarding", () => {
    it("DRW-CI02: dispose is callable and does not throw", () => {
      const adapter = createStubAdapter();
      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      expect(() => bridge.dispose()).not.toThrow();
    });

    it("DRW-CI02: dispose unsubscribes the onChanged listener preventing future reloads", () => {
      const adapter = createStubAdapter();
      adapter.getThreadsForUri.mockReturnValue([]);

      const listeners: Array<(uri: string) => void> = [];
      let disposeFn: () => void = vi.fn();
      adapter.onChanged.mockImplementation((listener: (uri: string) => void) => {
        listeners.push(listener);
        return { dispose: disposeFn };
      });

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      // Dispose the bridge — this must call the listener's dispose function
      bridge.dispose();

      // The dispose function must have been called (subscription cleaned up)
      expect(disposeFn).toHaveBeenCalled();
    });

    it("DRW-CI02: after dispose, messages are not forwarded to adapter", async () => {
      const adapter = createStubAdapter();
      adapter.reply.mockResolvedValue(undefined);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      bridge.dispose();

      // After dispose, messages must NOT reach the adapter
      await bridge.handleWebviewMessage({
        type: "comment:reply",
        threadId: "thread-1",
        body: "Should not reach adapter",
      });

      expect(adapter.reply).not.toHaveBeenCalled();
    });

    it("DRW-CI02: multiple dispose calls are safe", () => {
      const adapter = createStubAdapter();
      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      bridge.dispose();
      bridge.dispose();
      bridge.dispose();

      expect(true).toBe(true);
    });
  });

  describe("DRW-C01: buildAnchor produces diagram-node anchor", () => {
    it("DRW-CI02: buildAnchor returns surface anchor with surfaceType=diagram and diagram-node coordinates", () => {
      const adapter = createStubAdapter();
      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      const anchor = bridge.buildAnchor("node:A");

      expect(anchor.kind).toBe("surface");
      expect(anchor.surfaceType).toBe("diagram");
      expect(anchor.coordinates).toMatchObject({
        type: "diagram-node",
        nodeId: "node:A",
      });
    });

    it("DRW-CI02: buildAnchor preserves edge prefix", () => {
      const adapter = createStubAdapter();
      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      const anchor = bridge.buildAnchor("edge:A->B:0");
      expect(anchor.coordinates).toMatchObject({
        type: "diagram-node",
        nodeId: "edge:A->B:0",
      });
    });

    it("DRW-CI02: buildAnchor preserves cluster prefix", () => {
      const adapter = createStubAdapter();
      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      const anchor = bridge.buildAnchor("cluster:group1");
      expect(anchor.coordinates).toMatchObject({
        type: "diagram-node",
        nodeId: "cluster:group1",
      });
    });
  });

  describe("DRW-C06: SdkThread conversion contract", () => {
    it("DRW-CI02: store CommentThread is converted to canonical SdkThread with correct blockId", () => {
      const adapter = createStubAdapter();
      const nodeAnchor = makeDrawingAnchor({ prefix: "node", identity: "auth", nodeId: "node:auth" });
      adapter.getThreadsForUri.mockReturnValue([
        storeThread("thread-abc", nodeAnchor),
      ]);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      bridge.loadThreadsForUri();

      const posted = sender.postMessage.mock.calls[0]![0] as HostMessage;
      expect(posted.type).toBe("comments:load");
      expect(posted.threads).toHaveLength(1);
      expect(posted.threads[0]!.blockId).toBe("node:auth");
      expect(posted.threads[0]!.id).toBe("thread-abc");
    });

    it("DRW-CI02: SdkThread must NOT contain raw CommentThread shape", () => {
      const adapter = createStubAdapter();
      const nodeAnchor = makeDrawingAnchor({ prefix: "node", identity: "B", nodeId: "node:B" });
      adapter.getThreadsForUri.mockReturnValue([
        storeThread("thread-xyz", nodeAnchor),
      ]);

      const sender = createStubSender();
      const bridge = new DrawingCommentsBridge(adapter, sender, "file:///test/foo.mmd");

      bridge.loadThreadsForUri();

      const posted = sender.postMessage.mock.calls[0]![0] as HostMessage & { threads: SdkThread[] };
      expect(posted.threads[0]).toHaveProperty("id");
      expect(posted.threads[0]).toHaveProperty("blockId");
      expect(posted.threads[0]).toHaveProperty("status");
      expect(posted.threads[0]).toHaveProperty("hasUnread");
      expect(posted.threads[0]).toHaveProperty("comments");
      expect(posted.threads[0]!.comments[0]).toHaveProperty("author");
      expect(posted.threads[0]!.comments[0]!.author).toHaveProperty("kind");
    });
  });
});