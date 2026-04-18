import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserBridgeAPI, BrowserRelayLike } from "../types.js";

// Mock vscode at the top so sharedRelay=false before extension evaluates getConfiguration.
vi.mock("vscode", () => {
  const globalStateStore = new Map<string, unknown>();
  const secretsStore = new Map<string, string>();
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(<T>(_key: string, defaultValue: T): T => {
          if (_key === "sharedRelay") return false as unknown as T;
          return defaultValue;
        }),
      })),
    },
    extensions: {
      getExtension: vi.fn(() => ({ exports: null })),
    },
    window: {
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    Disposable: class Disposable {
      constructor(private readonly fn: () => void) {}
      dispose(): void { this.fn(); }
    },
    createExtensionContextMock: () => ({
      subscriptions: [] as Array<{ dispose(): void }>,
      globalState: {
        get: vi.fn((k: string) => globalStateStore.get(k)),
        update: vi.fn(async (k: string, v: unknown) => { globalStateStore.set(k, v); }),
      },
      secrets: {
        get: vi.fn(async (k: string) => secretsStore.get(k) ?? undefined),
        store: vi.fn(async (k: string, v: string) => { secretsStore.set(k, v); }),
      },
      _secretsStore: secretsStore,
    }),
  };
});

const vscode = await import("vscode");
const createExtensionContextMock = (vscode as Record<string, unknown>).createExtensionContextMock as ReturnType<typeof vi.fn> extends () => infer R ? R : never;

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    createServer: vi.fn(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const server = {
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(cb);
          return server;
        }),
        listen: vi.fn((_port: number, _host: string) => {
          Promise.resolve().then(() => {
            const l = listeners["listening"] ?? [];
            l.forEach((cb) => cb());
          });
          return server;
        }),
        close: vi.fn((cb?: () => void) => { if (cb) cb(); return server; }),
        address: vi.fn(() => ({ port: 40111 })),
      };
      return server;
    }),
  };
});

// ── Mock relay server (BrowserRelayServer) ─────────────────────────────────────

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation((_options: unknown) => {
    const instance = {
      start: startMock,
      stop: stopMock,
      isConnected: isConnectedMock,
      request: vi.fn(),
    };
    return instance;
  }),
}));

// ── Import types ───────────────────────────────────────────────────────────────

import type { CommentThread } from "@accordo/bridge-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRemoteThread(id: string, pageUrl: string, status: "open" | "resolved" = "open"): {
  id: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  comments: Array<{
    id: string;
    threadId: string;
    createdAt: string;
    author: { kind: "user"; name: string };
    body: string;
    anchorKey: string;
    pageUrl: string;
    status: "open" | "resolved";
  }>;
  createdAt: string;
  lastActivity: string;
} {
  const commentId = `${id}-c1`;
  return {
    id,
    anchorKey: "body:center",
    pageUrl,
    status,
    comments: [{
      id: commentId,
      threadId: id,
      createdAt: "2024-01-01T00:00:00.000Z",
      author: { kind: "user", name: "Browser User" },
      body: `Comment on ${id}`,
      anchorKey: "body:center",
      pageUrl,
      status,
    }],
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActivity: "2024-01-01T00:00:00.000Z",
  };
}

function makeLocalThread(id: string, uri: string, status: "open" | "resolved" = "open"): CommentThread {
  return {
    id,
    anchor: { kind: "surface", uri, surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } },
    comments: [{
      id: `${id}-c1`,
      threadId: id,
      createdAt: "2024-01-01T00:00:00.000Z",
      author: { kind: "user", name: "VSCode User" },
      body: `Comment ${id}`,
      anchor: { kind: "surface", uri, surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } },
      status,
    }],
    status,
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActivity: "2024-01-01T00:00:00.000Z",
    retention: "volatile-browser",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BrowserCommentSyncScheduler", () => {
  describe("syncBrowserComments", () => {
    it("SBR-SYNC-01: calls relay.request with get_all_comments first", async () => {
      const relay = {
        request: vi.fn().mockResolvedValue({ success: true, data: { pages: [] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn().mockResolvedValue([]),
      };
      const out = { appendLine: vi.fn() };

      // Import and call the sync function directly
      const { syncBrowserComments } = await import("../extension.js");
      await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(relay.request).toHaveBeenCalledWith("get_all_comments", {}, 5000);
    });

    it("SBR-SYNC-02: returns partial when get_all_comments fails", async () => {
      const relay = {
        request: vi.fn().mockResolvedValue({ success: false, error: "browser-not-connected" }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = { invokeTool: vi.fn() };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("partial");
      expect(bridge.invokeTool).not.toHaveBeenCalled();
    });

    it("SBR-SYNC-03: creates missing threads via comment_create", async () => {
      const remoteThread = makeRemoteThread("t-remote-1", "https://example.com/page");
      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [remoteThread] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn()
          .mockResolvedValueOnce([])  // comment_list returns empty
          .mockResolvedValueOnce({ success: true, created: true, threadId: "t-remote-1", commentId: `${remoteThread.id}-c1` }),
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("success");
      // comment_create is called with threadId preserved
      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_create",
        expect.objectContaining({ threadId: "t-remote-1" }),
      );
    });

    it("SBR-SYNC-03b: newly created resolved thread is resolved and missing replies are added", async () => {
      const remoteThread = {
        ...makeRemoteThread("t-remote-2", "https://example.com/page", "resolved"),
        comments: [
          {
            id: "t-remote-2-c1",
            threadId: "t-remote-2",
            createdAt: "2024-01-01T00:00:00.000Z",
            author: { kind: "user" as const, name: "Browser User" },
            body: "first",
            anchorKey: "body:center",
            pageUrl: "https://example.com/page",
            status: "resolved" as const,
          },
          {
            id: "t-remote-2-c2",
            threadId: "t-remote-2",
            createdAt: "2024-01-01T00:01:00.000Z",
            author: { kind: "user" as const, name: "Browser User" },
            body: "second",
            anchorKey: "body:center",
            pageUrl: "https://example.com/page",
            status: "resolved" as const,
          },
        ],
      };
      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [remoteThread] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn()
          .mockResolvedValueOnce([]) // comment_list
          .mockResolvedValueOnce({ success: true, created: true, threadId: "t-remote-2", commentId: "t-remote-2-c1" }) // comment_create
          .mockResolvedValueOnce({ success: true, resolved: true }) // comment_resolve
          .mockResolvedValueOnce({ success: true, replied: true, commentId: "t-remote-2-c2" }), // comment_reply
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("success");
      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_resolve",
        expect.objectContaining({ threadId: "t-remote-2" }),
      );
      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_reply",
        expect.objectContaining({ threadId: "t-remote-2", commentId: "t-remote-2-c2" }),
      );
    });

    it("SBR-SYNC-04: resolves remote-resolved threads via comment_resolve", async () => {
      const remoteThread = makeRemoteThread("t-1", "https://example.com/page", "resolved");
      const localThread = makeLocalThread("t-1", "https://example.com/page", "open");
      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [remoteThread] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn()
          .mockResolvedValueOnce([localThread])  // comment_list
          .mockResolvedValueOnce({ success: true, resolved: true }), // comment_resolve
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_resolve",
        expect.objectContaining({ threadId: "t-1" }),
      );
    });

    it("SBR-SYNC-05: reopens remote-open threads via comment_reopen", async () => {
      const remoteThread = makeRemoteThread("t-1", "https://example.com/page", "open");
      const localThread = makeLocalThread("t-1", "https://example.com/page", "resolved");
      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [remoteThread] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn()
          .mockResolvedValueOnce([localThread])
          .mockResolvedValueOnce({ success: true, reopened: true }),
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_reopen",
        expect.objectContaining({ threadId: "t-1" }),
      );
    });

    it("SBR-SYNC-06: adds missing replies via comment_reply", async () => {
      const remoteThread = makeRemoteThread("t-1", "https://example.com/page", "open");
      // Add a second comment to the remote thread
      remoteThread.comments.push({
        id: "c-extra",
        threadId: "t-1",
        createdAt: "2024-01-02T00:00:00.000Z",
        author: { kind: "user", name: "Browser User" },
        body: "Second comment",
        anchorKey: "body:center",
        pageUrl: "https://example.com/page",
        status: "open",
      });

      const localThread = makeLocalThread("t-1", "https://example.com/page", "open");

      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [remoteThread] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn()
          .mockResolvedValueOnce([localThread])  // comment_list
          .mockResolvedValueOnce({ success: true, replied: true, commentId: "c-extra" }),
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_reply",
        expect.objectContaining({ threadId: "t-1", body: "Second comment", commentId: "c-extra" }),
      );
    });

    it("SBR-SYNC-07: deletes local-only threads when full remote fetch succeeds", async () => {
      const localThread = makeLocalThread("t-local-only", "https://example.com/other");
      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn()
          .mockResolvedValueOnce([localThread])
          .mockResolvedValueOnce({ success: true, deleted: true }),
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("success");
      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_delete",
        expect.objectContaining({ threadId: "t-local-only" }),
      );
    });

    it("SBR-SYNC-07b: deletes all local browser threads when remote snapshot is empty", async () => {
      const localThread = makeLocalThread("t-local-only", "https://example.com/page", "open");
      const relay = {
        request: vi.fn().mockResolvedValueOnce({ success: true, data: { pages: [] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn()
          .mockResolvedValueOnce([localThread])
          .mockResolvedValueOnce({ success: true, deleted: true }),
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("success");
      expect(bridge.invokeTool).toHaveBeenCalledWith(
        "comment_delete",
        expect.objectContaining({ threadId: "t-local-only" }),
      );
    });

    it("SBR-SYNC-08: does NOT delete local-only threads when get_comments fails for one page", async () => {
      const localThread = makeLocalThread("t-local-only", "https://example.com/other");
      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page1" }, { url: "https://example.com/page2" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page1", threads: [] } })
          .mockResolvedValueOnce({ success: false, error: "timeout" }), // second page fails
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn().mockResolvedValue([localThread]),
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("partial");
      // comment_delete should NOT have been called
      expect(bridge.invokeTool).not.toHaveBeenCalledWith(
        "comment_delete",
        expect.anything(),
      );
    });

    it("SBR-SYNC-09: skips deletedAt threads from upsert and delete", async () => {
      const deletedThread = makeRemoteThread("t-deleted", "https://example.com/page", "open");
      deletedThread.deletedAt = "2024-01-01T12:00:00.000Z";

      const relay = {
        request: vi.fn()
          .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com/page" }] } })
          .mockResolvedValueOnce({ success: true, data: { url: "https://example.com/page", threads: [deletedThread] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = {
        invokeTool: vi.fn().mockResolvedValue([]),
      };
      const out = { appendLine: vi.fn() };

      const { syncBrowserComments } = await import("../extension.js");
      await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      // Should not try to create, resolve, reply, or delete
      expect(bridge.invokeTool).not.toHaveBeenCalledWith(
        "comment_create",
        expect.anything(),
      );
      expect(bridge.invokeTool).not.toHaveBeenCalledWith(
        "comment_delete",
        expect.anything(),
      );
    });
  });

  describe("BrowserCommentSyncScheduler", () => {
    it("SBR-SYNC-10: scheduler starts and logs to output channel", async () => {
      const relay = {
        request: vi.fn().mockResolvedValue({ success: true, data: { pages: [] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = { invokeTool: vi.fn().mockResolvedValue([]) };
      const out = { appendLine: vi.fn() };

      const { BrowserCommentSyncScheduler } = await import("../extension.js");

      // Spy on setInterval to verify it's called
      const originalSetInterval = global.setInterval;
      const spySetInterval = vi.spyOn(global, "setInterval");

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );
      scheduler.start();

      expect(spySetInterval).toHaveBeenCalledOnce();
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("starting periodic sync"),
      );

      scheduler.stop();
      spySetInterval.mockRestore();
    });

    it("SBR-SYNC-11: syncNow triggers immediate sync", async () => {
      const relay = {
        request: vi.fn().mockResolvedValue({ success: true, data: { pages: [] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = { invokeTool: vi.fn().mockResolvedValue([]) };
      const out = { appendLine: vi.fn() };

      const { BrowserCommentSyncScheduler } = await import("../extension.js");

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      await scheduler.syncNow();

      expect(relay.request).toHaveBeenCalled();
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("sync complete"),
      );
    });

    it("SBR-SYNC-12: prevents overlapping sync runs via in-flight guard", async () => {
      let resolveRequest: (value: unknown) => void;
      const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });

      const relay = {
        request: vi.fn().mockReturnValue(requestPromise),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = { invokeTool: vi.fn().mockResolvedValue([]) };
      const out = { appendLine: vi.fn() };

      const { BrowserCommentSyncScheduler } = await import("../extension.js");

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      // Start first sync (won't resolve immediately)
      const sync1 = scheduler.syncNow();

      // Second syncNow should be skipped
      await scheduler.syncNow();

      // Complete the first sync
      resolveRequest!({ success: true, data: { pages: [] } });
      await sync1;

      // Only one relay.request call should have been made (the first one)
      expect(relay.request).toHaveBeenCalledTimes(1);
    });

    it("SBR-SYNC-13: stop clears the timer", async () => {
      const relay = {
        request: vi.fn().mockResolvedValue({ success: true, data: { pages: [] } }),
        push: vi.fn(),
        isConnected: () => true,
      };
      const bridge = { invokeTool: vi.fn().mockResolvedValue([]) };
      const out = { appendLine: vi.fn() };

      const { BrowserCommentSyncScheduler } = await import("../extension.js");

      const spyClearInterval = vi.spyOn(global, "clearInterval");

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );
      scheduler.start();
      scheduler.stop();

      expect(spyClearInterval).toHaveBeenCalledOnce();
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("scheduler stopped"),
      );
      spyClearInterval.mockRestore();
    });
  });

  describe("activation integration", () => {
    it("SBR-SYNC-14: per-window activation path creates sync scheduler and disposes it", async () => {
      const invokeToolMock = vi.fn().mockResolvedValue([]);
      const capturedSubscriptions: Array<{ dispose(): void }> = [];

      const bridge = {
        registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        publishState: vi.fn(),
        invokeTool: invokeToolMock,
      };

      (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
      (vscode.workspace as Record<string, unknown>).getConfiguration = vi.fn().mockReturnValue({
        get: vi.fn(<T>(_key: string, defaultValue: T): T => {
          if (_key === "sharedRelay") return false as unknown as T;
          return defaultValue;
        }),
      });

      // Capture subscriptions passed to context
      vi.mock("vscode", async (importOriginal) => {
        const actual = await importOriginal<typeof import("vscode")>();
        return {
          ...actual,
          window: {
            createOutputChannel: vi.fn(() => ({
              appendLine: vi.fn(),
              dispose: vi.fn(),
            })),
          },
        };
      });

      // Re-import vscode with new mock
      const vscode2 = await import("vscode");
      const createCtx = (vscode2 as Record<string, unknown>).createExtensionContextMock as () => ReturnType<typeof vi.fn>;
      const context = createCtx();

      const { activate } = await import("../extension.js");
      await activate(context as never);

      // Find the sync scheduler disposable (last one added after the relay)
      const syncDisposable = context.subscriptions[context.subscriptions.length - 1];
      expect(syncDisposable).toBeDefined();
      expect(typeof syncDisposable.dispose).toBe("function");

      // Calling dispose should not throw
      syncDisposable.dispose();
    });
  });
});
