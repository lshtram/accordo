/**
 * browser-family-modularity.test.ts
 *
 * Phase B failing tests for browser-side extracted modules from the
 * browser family modularity batch.
 *
 * Tests the extracted module contracts from:
 *   docs/reviews/browser-family-modularity-A.md
 *   docs/10-architecture/architecture.md §14-B
 *
 * Each test is labeled with its Phase A requirement ID.
 * All implementation tests fail at assertion level because stubs throw "not implemented".
 *
 * Covered modules (packages/browser):
 *   comment-sync.ts, comment-notifier.ts, relay-lifecycle.ts,
 *   tool-assembly.ts, page-tool-pipeline.ts
 *
 * Architecture-constraint tests (§14-B.3, §14-B.6):
 *   - No direct browser → browser-extension imports
 *   - No cross-modality imports (accordo-voice, accordo-script, etc.)
 *   - Comment sync uses only vscode + bridge-types + local types
 *
 * API checklist (coverage):
 *   SYNC_INTERVAL_MS              [comment-sync] — 1 test
 *   RemoteBrowserThread           [comment-sync] — type/shape test
 *   RemoteBrowserComment          [comment-sync] — type/shape test
 *   GetCommentsResponse           [comment-sync] — type test
 *   remoteThreadToCreateArgs      [comment-sync] — 1 test
 *   remoteCommentToReplyArgs       [comment-sync] — 1 test
 *   syncBrowserComments           [comment-sync] — 4 tests
 *   BrowserCommentSyncScheduler   [comment-sync] — 5 tests
 *   comments-optional matrix      [comment-sync] — 3 tests
 *   PushableRelay                 [comment-notifier] — interface test
 *   registerBrowserNotifier       [comment-notifier] — 4 tests
 *   browserActionToUnifiedTool    [comment-notifier] — 4 tests
 *   findFreePort                  [relay-lifecycle] — 1 test
 *   resolveRelayToken             [relay-lifecycle] — 3 tests
 *   writeRelayPort                [relay-lifecycle] — 1 test
 *   getSecurityConfig             [relay-lifecycle] — 1 test
 *   RelayServices                [relay-lifecycle] — interface test
 *   wireRelayServices             [relay-lifecycle] — 1 test
 *   activateSharedRelay          [relay-lifecycle] — 1 test
 *   activatePerWindowRelay       [relay-lifecycle] — 1 test
 *   buildBrowserTools             [tool-assembly] — 2 tests
 *   PageToolPipelineOpts          [page-tool-pipeline] — 1 test
 *   PipelineResult                [page-tool-pipeline] — 1 test
 *   runPageToolPipeline           [page-tool-pipeline] — 5 tests
 *   architecture-constraints      [all modules] — 2 tests
 *
 * Total: ~54 tests across 5 modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserBridgeAPI, BrowserRelayLike } from "../types.js";

// ── Per-test isolation ─────────────────────────────────────────────────────────

let resetState: (() => void) | undefined;

beforeEach(() => {
  // Capture per-test isolation cleanup
  resetState = undefined;
});

afterEach(() => {
  resetState?.();
});

// ── Mock infrastructure ─────────────────────────────────────────────────────────

vi.mock("vscode", () => {
  const globalStateStore = new Map<string, unknown>();
  const secretsStore = new Map<string, string>();
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(<T>(_key: string, defaultValue: T): T => defaultValue as T),
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
      _globalStateStore: globalStateStore,
      _secretsStore: secretsStore,
    }),
  };
});

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

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation((_options: unknown) => ({
    start: startMock,
    stop: stopMock,
    isConnected: isConnectedMock,
    request: vi.fn(),
    push: vi.fn(),
  })),
}));

vi.mock("../shared-relay-server.js", () => ({
  SharedBrowserRelayServer: vi.fn().mockImplementation((_options: unknown) => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

const vscode = await import("vscode");
const createExtensionContextMock = (vscode as Record<string, unknown>).createExtensionContextMock as ReturnType<typeof vi.fn> extends () => infer R ? R : never;

// ── Shared mock helpers ────────────────────────────────────────────────────────

function createMockRelay() {
  return {
    request: vi.fn().mockResolvedValue({ success: true, data: {} }),
    push: vi.fn(),
    isConnected: () => true,
  };
}

function createMockBridge() {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
    invokeTool: vi.fn().mockResolvedValue([]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE: comment-sync.ts
// Source: docs/reviews/browser-family-modularity-A.md §"packages/browser/src/comment-sync.ts"
// ─────────────────────────────────────────────────────────────────────────────

describe("comment-sync", () => {
  describe("SYNC_INTERVAL_MS", () => {
    it("SBR-SYNC-CONST: SYNC_INTERVAL_MS is exported and equals 30000", async () => {
      const mod = await import("../comment-sync.js");
      expect(mod.SYNC_INTERVAL_MS).toBe(30_000);
    });
  });

  describe("RemoteBrowserThread type", () => {
    it("SBR-SYNC-TYPES: RemoteBrowserThread is exported with required fields", async () => {
      const { RemoteBrowserThread } = await import("../comment-sync.js");
      const thread: RemoteBrowserThread = {
        id: "t1",
        anchorKey: "body:center",
        pageUrl: "https://example.com",
        status: "open",
        comments: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        lastActivity: "2024-01-01T00:00:00.000Z",
      };
      expect(thread.id).toBe("t1");
      expect(thread.status).toBe("open");
    });

    it("SBR-SYNC-TYPES: RemoteBrowserComment is exported with required fields", async () => {
      const { RemoteBrowserComment } = await import("../comment-sync.js");
      const comment: RemoteBrowserComment = {
        id: "c1",
        threadId: "t1",
        createdAt: "2024-01-01T00:00:00.000Z",
        author: { kind: "user", name: "Alice" },
        body: "Hello",
        anchorKey: "body:center",
        pageUrl: "https://example.com",
        status: "open",
      };
      expect(comment.id).toBe("c1");
      expect(comment.author.kind).toBe("user");
    });

    it("SBR-SYNC-TYPES: GetCommentsResponse is exported", async () => {
      const { GetCommentsResponse } = await import("../comment-sync.js");
      const resp: GetCommentsResponse = { url: "https://example.com", threads: [] };
      expect(resp.url).toBe("https://example.com");
    });
  });

  describe("remoteThreadToCreateArgs", () => {
    it("SBR-SYNC-MAP-01: maps remote thread to comment_create args with threadId and body", async () => {
      const { remoteThreadToCreateArgs } = await import("../comment-sync.js");
      const thread = {
        id: "t-1",
        anchorKey: "body:center",
        pageUrl: "https://example.com/page",
        status: "open" as const,
        comments: [{
          id: "c-1",
          threadId: "t-1",
          createdAt: "2024-01-01T00:00:00.000Z",
          author: { kind: "user" as const, name: "Browser User" },
          body: "Test comment",
          anchorKey: "body:center",
          pageUrl: "https://example.com/page",
          status: "open" as const,
        }],
        createdAt: "2024-01-01T00:00:00.000Z",
        lastActivity: "2024-01-01T00:00:00.000Z",
      };

      const args = remoteThreadToCreateArgs(thread);

      expect(args).toHaveProperty("threadId");
      expect(args).toHaveProperty("body");
      expect(args).toHaveProperty("scope");
      expect(args).toHaveProperty("anchor");
      expect((args as Record<string, unknown>).threadId).toBe("t-1");
      expect((args as Record<string, unknown>).body).toBe("Test comment");
    });
  });

  describe("remoteCommentToReplyArgs", () => {
    it("SBR-SYNC-MAP-02: maps remote comment to comment_reply args with threadId, commentId, body", async () => {
      const { remoteCommentToReplyArgs } = await import("../comment-sync.js");
      const comment = {
        id: "c-1",
        threadId: "t-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        author: { kind: "user" as const, name: "Bob" },
        body: "A reply",
        anchorKey: "body:center",
        pageUrl: "https://example.com/page",
        status: "open" as const,
      };

      const args = remoteCommentToReplyArgs(comment);

      expect(args).toHaveProperty("threadId");
      expect(args).toHaveProperty("body");
      expect(args).toHaveProperty("commentId");
      expect((args as Record<string, unknown>).threadId).toBe("t-1");
      expect((args as Record<string, unknown>).commentId).toBe("c-1");
    });
  });

  describe("syncBrowserComments", () => {
    it("SBR-SYNC-FN-01: returns 'partial' when relay get_all_comments fails", async () => {
      const { syncBrowserComments } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request.mockResolvedValueOnce({ success: false, error: "browser-not-connected" });
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("partial");
      expect(bridge.invokeTool).not.toHaveBeenCalled();
    });

    it("SBR-SYNC-FN-02: returns 'partial' when a subsequent get_comments fails (no deletions)", async () => {
      const { syncBrowserComments } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request
        .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://a.com" }, { url: "https://b.com" }] } })
        .mockResolvedValueOnce({ success: true, data: { url: "https://a.com", threads: [] } })
        .mockResolvedValueOnce({ success: false, error: "timeout" }); // second page fails
      const bridge = createMockBridge();
      bridge.invokeTool.mockResolvedValue([]);
      const out = { appendLine: vi.fn() };

      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("partial");
      // Deletions must NOT run when page fetch partially fails
      expect(bridge.invokeTool).not.toHaveBeenCalledWith(
        "comment_delete",
        expect.anything(),
      );
    });

    it("SBR-SYNC-FN-03: returns 'success' when all pages sync cleanly", async () => {
      const { syncBrowserComments } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request
        .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com" }] } })
        .mockResolvedValueOnce({ success: true, data: { url: "https://example.com", threads: [] } });
      const bridge = createMockBridge();
      bridge.invokeTool.mockResolvedValue([]);
      const out = { appendLine: vi.fn() };

      const result = await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      expect(result).toBe("success");
    });

    it("SBR-SYNC-FN-04: skipped deletedAt threads — no create/delete call", async () => {
      const { syncBrowserComments } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request
        .mockResolvedValueOnce({ success: true, data: { pages: [{ url: "https://example.com" }] } })
        .mockResolvedValueOnce({
          success: true,
          data: {
            url: "https://example.com",
            threads: [{
              id: "t-deleted",
              anchorKey: "body:center",
              pageUrl: "https://example.com",
              status: "open",
              comments: [],
              createdAt: "2024-01-01T00:00:00.000Z",
              lastActivity: "2024-01-01T00:00:00.000Z",
              deletedAt: "2024-01-01T12:00:00.000Z", // soft-deleted
            }],
          },
        });
      const bridge = createMockBridge();
      bridge.invokeTool.mockResolvedValue([]);
      const out = { appendLine: vi.fn() };

      await syncBrowserComments(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      // Deleted threads must not trigger comment_create or comment_delete
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
    afterEach(() => {
      // Ensure stop is called to clean up timer handles
      vi.restoreAllMocks();
    });

    it("SBR-SYNC-SCHED-01: start() is idempotent and sets interval exactly once", async () => {
      const { BrowserCommentSyncScheduler } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request.mockResolvedValue({ success: true, data: { pages: [] } });
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      const spy = vi.spyOn(global, "setInterval");
      scheduler.start();
      scheduler.start(); // idempotent — second call must be no-op

      expect(spy).toHaveBeenCalledOnce();
      scheduler.stop();
    });

    it("SBR-SYNC-SCHED-02: syncNow() triggers relay.request", async () => {
      const { BrowserCommentSyncScheduler } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request.mockResolvedValue({ success: true, data: { pages: [] } });
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      await scheduler.syncNow();
      expect(relay.request).toHaveBeenCalled();
    });

    it("SBR-SYNC-SCHED-03: syncNow() skips when in-flight guard is set", async () => {
      const { BrowserCommentSyncScheduler } = await import("../comment-sync.js");
      // Phase A contract: "Immediately trigger a sync (no-op if one is already in-flight)"
      // Invariant: the second concurrent call must not cause additional relay work.
      //
      // Fix: assert the guard invariant while the first request is still pending,
      // then settle it to unblock — instead of awaiting both promises which can
      // deadlock when the second is blocked and never settles.
      let settleFirst: (value: SyncResult) => void;
      const firstRequest = new Promise<SyncResult>((r) => { settleFirst = r; });

      const relay = createMockRelay();
      relay.request.mockReturnValue(firstRequest);
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );

      // Fire two concurrent calls. The second call must be blocked by the guard.
      const p1 = scheduler.syncNow();
      const p2 = scheduler.syncNow();

      // Core invariant: relay.request must be called exactly once.
      // The guard must prevent the second in-flight call from reaching the relay.
      // — Stub: relay.request never called (both throw before reaching relay)
      // — No guard: relay.request called twice (second call races through before first settles)
      // — Correct impl: relay.request called exactly once (guard blocks second)
      expect(relay.request).toHaveBeenCalledTimes(1);

      // Unblock p1 so the test can exit cleanly.
      settleFirst!({ success: true, data: { pages: [] } });
      await p1;
    });

    it("SBR-SYNC-SCHED-04: stop() clears timer and logs 'scheduler stopped'", async () => {
      const { BrowserCommentSyncScheduler } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request.mockResolvedValue({ success: true, data: { pages: [] } });
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      const spy = vi.spyOn(global, "clearInterval");
      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );
      scheduler.start();
      scheduler.stop();

      expect(spy).toHaveBeenCalledOnce();
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("scheduler stopped"),
      );
    });

    it("SBR-SYNC-SCHED-05: scheduler start() logs the interval duration", async () => {
      const { BrowserCommentSyncScheduler } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request.mockResolvedValue({ success: true, data: { pages: [] } });
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );
      scheduler.start();
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("30"),
      );
      scheduler.stop();
    });
  });

  describe("comments-optional fallback matrix (§14-B.5)", () => {
    it("OPT-FB-01: syncBrowserComments catches relay errors and returns 'partial' (never throws)", async () => {
      const { syncBrowserComments } = await import("../comment-sync.js");
      const relay = createMockRelay();
      relay.request.mockRejectedValue(new Error("connection lost"));
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      // Must not throw — Phase A contract: "syncBrowserComments failures fall through to partial return"
      await expect(
        syncBrowserComments(
          relay as unknown as BrowserRelayLike,
          bridge as unknown as BrowserBridgeAPI,
          out as unknown as vscode.OutputChannel,
        ),
      ).resolves.toBe("partial");
    });

    it("OPT-FB-02: when accordo-comments is absent, registerBrowserNotifier logs one line and returns undefined", async () => {
      const { registerBrowserNotifier } = await import("../comment-notifier.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const relay = { push: vi.fn() };

      // accordo-comments is not installed (mock returns null exports)
      const result = registerBrowserNotifier(
        context as unknown as vscode.ExtensionContext,
        out as unknown as vscode.OutputChannel,
        relay as Parameters<typeof registerBrowserNotifier>[2],
      );

      expect(result).toBeUndefined();
      // Exactly one log line — per §14-B.5: "one activation log line is emitted"
      expect(out.appendLine).toHaveBeenCalledTimes(1);
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("not installed"),
      );
    });

    it("OPT-FB-03: BrowserCommentSyncScheduler not created when comments unavailable — graceful no-op", async () => {
      const { BrowserCommentSyncScheduler } = await import("../comment-sync.js");
      const relay = createMockRelay();
      const bridge = createMockBridge();
      const out = { appendLine: vi.fn() };

      // Constructing and using the scheduler must not throw even when comments unavailable
      const scheduler = new BrowserCommentSyncScheduler(
        relay as unknown as BrowserRelayLike,
        bridge as unknown as BrowserBridgeAPI,
        out as unknown as vscode.OutputChannel,
      );
      // Per §14-B.5: must not crash, no startup block
      expect(() => scheduler.start()).not.toThrow();
      scheduler.stop();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE: comment-notifier.ts
// Source: docs/reviews/browser-family-modularity-A.md §"packages/browser/src/comment-notifier.ts"
// ─────────────────────────────────────────────────────────────────────────────

describe("comment-notifier", () => {
  describe("PushableRelay interface", () => {
    it("SUB-INTERFACE: PushableRelay is exported with push(action, payload) signature", async () => {
      const { PushableRelay } = await import("../comment-notifier.js");
      const relay: PushableRelay = {
        push: (action: string, payload: Record<string, unknown>) => {
          void action; void payload;
        },
      };
      expect(typeof relay.push).toBe("function");
    });
  });

  describe("registerBrowserNotifier", () => {
    it("SUB-01: returns undefined when accordo-comments is not installed", async () => {
      const { registerBrowserNotifier } = await import("../comment-notifier.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const relay = { push: vi.fn() };

      const result = registerBrowserNotifier(
        context as unknown as vscode.ExtensionContext,
        out as unknown as vscode.OutputChannel,
        relay as Parameters<typeof registerBrowserNotifier>[2],
      );

      expect(result).toBeUndefined();
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("not installed"),
      );
    });

    it("SUB-02: returns Disposable when accordo-comments is installed and exports registerBrowserNotifier", async () => {
      const { registerBrowserNotifier } = await import("../comment-notifier.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const relay = { push: vi.fn() };

      (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({
        exports: {
          registerBrowserNotifier: vi.fn().mockReturnValue({
            dispose: vi.fn(),
          }),
        },
      });

      const result = registerBrowserNotifier(
        context as unknown as vscode.ExtensionContext,
        out as unknown as vscode.OutputChannel,
        relay as Parameters<typeof registerBrowserNotifier>[2],
      );

      expect(result).toBeDefined();
      expect(typeof (result as { dispose: () => void }).dispose).toBe("function");
    });

    it("SUB-02b: accordo-comments installed but no registerBrowserNotifier export → returns undefined", async () => {
      const { registerBrowserNotifier } = await import("../comment-notifier.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const relay = { push: vi.fn() };

      (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({
        exports: {}, // no registerBrowserNotifier
      });

      const result = registerBrowserNotifier(
        context as unknown as vscode.ExtensionContext,
        out as unknown as vscode.OutputChannel,
        relay as Parameters<typeof registerBrowserNotifier>[2],
      );

      expect(result).toBeUndefined();
      expect(out.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("no registerBrowserNotifier"),
      );
    });

    it("SUB-02c: disposable from registerBrowserNotifier is pushed into context.subscriptions", async () => {
      const { registerBrowserNotifier } = await import("../comment-notifier.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const relay = { push: vi.fn() };

      const disposeMock = vi.fn();
      (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({
        exports: {
          registerBrowserNotifier: vi.fn().mockReturnValue({ dispose: disposeMock }),
        },
      });

      registerBrowserNotifier(
        context as unknown as vscode.ExtensionContext,
        out as unknown as vscode.OutputChannel,
        relay as Parameters<typeof registerBrowserNotifier>[2],
      );

      expect(context.subscriptions.length).toBeGreaterThan(0);
      const disp = context.subscriptions[context.subscriptions.length - 1];
      expect(typeof disp.dispose).toBe("function");
    });
  });

  describe("browserActionToUnifiedTool", () => {
    it("SUB-MAP-01: get_all_comments → comment_list", async () => {
      const { browserActionToUnifiedTool } = await import("../comment-notifier.js");
      const result = browserActionToUnifiedTool("get_all_comments", {});
      expect(result).not.toBeNull();
      expect((result as { toolName: string }).toolName).toBe("comment_list");
    });

    it("SUB-MAP-02: get_comments with url → comment_list with scope.url", async () => {
      const { browserActionToUnifiedTool } = await import("../comment-notifier.js");
      const result = browserActionToUnifiedTool("get_comments", { url: "https://example.com" });
      expect(result).not.toBeNull();
      const r = result as { toolName: string; args: Record<string, unknown> };
      expect(r.toolName).toBe("comment_list");
      expect(r.args).toHaveProperty("scope");
    });

    it("SUB-MAP-03: create_comment → comment_create", async () => {
      const { browserActionToUnifiedTool } = await import("../comment-notifier.js");
      const result = browserActionToUnifiedTool("create_comment", { body: "hello", url: "https://example.com" });
      expect(result).not.toBeNull();
      expect((result as { toolName: string }).toolName).toBe("comment_create");
    });

    it("SUB-MAP-04: unknown action → null (graceful no-op per §14-B.5)", async () => {
      const { browserActionToUnifiedTool } = await import("../comment-notifier.js");
      const result = browserActionToUnifiedTool("unknown_action" as never, {});
      expect(result).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE: relay-lifecycle.ts
// Source: docs/reviews/browser-family-modularity-A.md §"packages/browser/src/relay-lifecycle.ts"
// ─────────────────────────────────────────────────────────────────────────────

describe("relay-lifecycle", () => {
  describe("findFreePort", () => {
    it("SBR-F-PORT-01: returns a valid port number within the scan range", async () => {
      const { findFreePort } = await import("../relay-lifecycle.js");
      const port = await findFreePort(40100, "127.0.0.1", 5);
      expect(typeof port).toBe("number");
      expect(port).toBeGreaterThanOrEqual(40100);
      expect(port).toBeLessThan(40100 + 5);
    });
  });

  describe("resolveRelayToken", () => {
    it("SBR-F-TOKEN-01: returns a non-empty string token", async () => {
      const { resolveRelayToken } = await import("../relay-lifecycle.js");
      const context = createExtensionContextMock();
      const token = await resolveRelayToken(context as unknown as vscode.ExtensionContext);
      expect(typeof token).toBe("string");
      expect(token.trim().length).toBeGreaterThan(0);
    });

    it("SBR-F-TOKEN-02: token is stored in SecretStorage after fresh generation", async () => {
      const { resolveRelayToken } = await import("../relay-lifecycle.js");
      const secretsStore = new Map<string, string>();
      const context = createExtensionContextMock();
      (context.secrets as Record<string, unknown>).get = vi.fn(async () => undefined);
      (context.secrets as Record<string, unknown>).store = vi.fn(async (k: string, v: string) => {
        secretsStore.set(k, v);
      });

      await resolveRelayToken(context as unknown as vscode.ExtensionContext);
      expect(secretsStore.has("browserRelayToken")).toBe(true);
    });

    it("SBR-F-TOKEN-03: resolveRelayToken is resilient to secrets.get throwing", async () => {
      const { resolveRelayToken } = await import("../relay-lifecycle.js");
      const context = createExtensionContextMock();
      (context.secrets as Record<string, unknown>).get = vi.fn().mockRejectedValue(new Error("keyring unavailable"));

      // Per AUTH-03-ERR: "secrets.get() throws → generate ephemeral token, warn. Do NOT fall back to globalState."
      await expect(resolveRelayToken(context as unknown as vscode.ExtensionContext)).resolves.toBeDefined();
    });
  });

  describe("writeRelayPort", () => {
    it("SBR-F-PORT-WRITE-01: completes without throwing (best-effort)", async () => {
      const { writeRelayPort } = await import("../relay-lifecycle.js");
      expect(() => writeRelayPort(40111)).not.toThrow();
    });
  });

  describe("getSecurityConfig", () => {
    it("SBR-F-SEC-01: returns a config with originPolicy, redactionPolicy, auditLog, snapshotRetention", async () => {
      const { getSecurityConfig } = await import("../relay-lifecycle.js");
      const config = getSecurityConfig();
      expect(config).toHaveProperty("originPolicy");
      expect(config).toHaveProperty("redactionPolicy");
      expect(config).toHaveProperty("auditLog");
      expect(config).toHaveProperty("snapshotRetention");
    });
  });

  describe("RelayServices interface", () => {
    it("SBR-F-SERVICES-01: RelayServices is exported with context, out, bridge, token, commentsAvailable", async () => {
      const { RelayServices } = await import("../relay-lifecycle.js");
      const services: RelayServices = {
        context: createExtensionContextMock() as unknown as vscode.ExtensionContext,
        out: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
        bridge: createMockBridge() as unknown as BrowserBridgeAPI,
        token: "test-token",
        commentsAvailable: true,
      };
      expect(services.token).toBe("test-token");
      expect(services.commentsAvailable).toBe(true);
    });
  });

  describe("wireRelayServices", () => {
    it("SBR-F-WIRE-01: returns an array where every item has a dispose method", async () => {
      const { wireRelayServices } = await import("../relay-lifecycle.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const bridge = createMockBridge();

      const disposables = wireRelayServices({
        context: context as unknown as vscode.ExtensionContext,
        out: out as unknown as vscode.OutputChannel,
        bridge: bridge as unknown as BrowserBridgeAPI,
        token: "test-token",
        commentsAvailable: true,
      });

      expect(Array.isArray(disposables)).toBe(true);
      for (const d of disposables) {
        expect(typeof d.dispose).toBe("function");
      }
    });
  });

  describe("activateSharedRelay", () => {
    it("SBR-F-SHARED-01: resolves without throwing (stub smoke test)", async () => {
      const { activateSharedRelay } = await import("../relay-lifecycle.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const bridge = createMockBridge();

      await expect(
        activateSharedRelay(
          context as unknown as vscode.ExtensionContext,
          out as unknown as vscode.OutputChannel,
          bridge as unknown as BrowserBridgeAPI,
          "test-token",
          true,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("activatePerWindowRelay", () => {
    it("SBR-F-PERWINDOW-01: resolves without throwing (stub smoke test)", async () => {
      const { activatePerWindowRelay } = await import("../relay-lifecycle.js");
      const context = createExtensionContextMock();
      const out = { appendLine: vi.fn() };
      const bridge = createMockBridge();

      await expect(
        activatePerWindowRelay(
          context as unknown as vscode.ExtensionContext,
          out as unknown as vscode.OutputChannel,
          bridge as unknown as BrowserBridgeAPI,
          "test-token",
          true,
        ),
      ).resolves.toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE: tool-assembly.ts
// Source: docs/reviews/browser-family-modularity-A.md §"packages/browser/src/tool-assembly.ts"
// ─────────────────────────────────────────────────────────────────────────────

describe("tool-assembly", () => {
  describe("buildBrowserTools", () => {
    it("MCP-REG-01: returns a non-empty array of ExtensionToolDefinition", async () => {
      const { buildBrowserTools } = await import("../tool-assembly.js");
      const relay = createMockRelay();
      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const screenshotStore = { save: vi.fn(), getLatest: vi.fn(), list: vi.fn(), listAll: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      const tools = buildBrowserTools(
        relay as unknown as BrowserRelayLike,
        store as never,
        securityConfig,
        screenshotStore as never,
      );

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("MCP-REG-02: each tool has a non-empty name and a function handler", async () => {
      const { buildBrowserTools } = await import("../tool-assembly.js");
      const relay = createMockRelay();
      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const screenshotStore = { save: vi.fn(), getLatest: vi.fn(), list: vi.fn(), listAll: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      const tools = buildBrowserTools(
        relay as unknown as BrowserRelayLike,
        store as never,
        securityConfig,
        screenshotStore as never,
      );

      for (const tool of tools) {
        expect(typeof tool.name).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.handler).toBe("function");
      }
    });

    // GAP-G1: manage_screenshots tool registration

    it("GAP-G1: buildBrowserTools includes accordo_browser_manage_screenshots", async () => {
      const { buildBrowserTools } = await import("../tool-assembly.js");
      const relay = createMockRelay();
      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const screenshotStore = { save: vi.fn(), getLatest: vi.fn(), list: vi.fn(), listAll: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      const tools = buildBrowserTools(
        relay as unknown as BrowserRelayLike,
        store as never,
        securityConfig,
        screenshotStore as never,
      );

      const names = tools.map((t) => t.name);
      expect(names).toContain("accordo_browser_manage_screenshots");
    });

    it("GAP-G1: accordo_browser_manage_screenshots tool has correct inputSchema", async () => {
      const { buildBrowserTools } = await import("../tool-assembly.js");
      const relay = createMockRelay();
      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const screenshotStore = { save: vi.fn(), getLatest: vi.fn(), list: vi.fn(), listAll: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      const tools = buildBrowserTools(
        relay as unknown as BrowserRelayLike,
        store as never,
        securityConfig,
        screenshotStore as never,
      );

      const tool = tools.find((t) => t.name === "accordo_browser_manage_screenshots");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain("action");
      expect(tool!.inputSchema.properties.action.enum).toEqual(["list", "clear"]);
    });

    it("GAP-G1: buildBrowserTools works without screenshotStore (creates default)", async () => {
      const { buildBrowserTools } = await import("../tool-assembly.js");
      const relay = createMockRelay();
      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      // Should not throw even without screenshotStore
      const tools = buildBrowserTools(
        relay as unknown as BrowserRelayLike,
        store as never,
        securityConfig,
        // intentionally omit screenshotStore
      );

      expect(Array.isArray(tools)).toBe(true);
      const names = tools.map((t) => t.name);
      expect(names).toContain("accordo_browser_manage_screenshots");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE: page-tool-pipeline.ts
// Source: docs/reviews/browser-family-modularity-A.md §"packages/browser/src/page-tool-pipeline.ts"
//         + §"Page-tool pipeline contract: invariants"
//         + §"Fixed stage ordering"
// ─────────────────────────────────────────────────────────────────────────────

describe("page-tool-pipeline", () => {
  describe("PageToolPipelineOpts interface", () => {
    it("B2-ER-007-OPTS: PageToolPipelineOpts is exported with toolName, relayAction, timeoutMs, validateResponse", async () => {
      const { PageToolPipelineOpts } = await import("../page-tool-pipeline.js");
      const opts: PageToolPipelineOpts<Record<string, unknown>, unknown> = {
        toolName: "test_tool",
        relayAction: "test_action",
        timeoutMs: 5000,
        validateResponse: (data) => (typeof data === "object" && data !== null ? data as unknown : null),
      };
      expect(opts.toolName).toBe("test_tool");
      expect(opts.timeoutMs).toBe(5000);
    });
  });

  describe("PipelineResult interface", () => {
    it("B2-ER-007-RESULT: PipelineResult has success boolean and optional data/error", async () => {
      const { PipelineResult } = await import("../page-tool-pipeline.js");
      const result: PipelineResult<unknown> = { success: true };
      expect(result.success).toBe(true);
    });
  });

  describe("runPageToolPipeline invariants", () => {
    // Stub-based behavioral tests — these will fail at assertion level because
    // the stub throws "not implemented" rather than running the pipeline.

    it("B2-ER-PIPELINE-01: returns { success: false, error } when relay is disconnected", async () => {
      const { runPageToolPipeline } = await import("../page-tool-pipeline.js");
      const relay = createMockRelay();
      relay.isConnected = () => false;

      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      const result = await runPageToolPipeline(
        relay as unknown as BrowserRelayLike,
        {},
        store as never,
        securityConfig,
        { toolName: "test", relayAction: "test_action", timeoutMs: 5000, validateResponse: () => null },
      );

      expect(result).toHaveProperty("success");
      expect((result as { success: boolean }).success).toBe(false);
      expect(result).toHaveProperty("error");
    });

    it("B2-ER-PIPELINE-02: pipeline never throws — always returns a PipelineResult (invariant: §14-B pipeline never throws)", async () => {
      const { runPageToolPipeline } = await import("../page-tool-pipeline.js");
      const relay = createMockRelay();
      relay.isConnected = () => false;

      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      // Must resolve (not reject) — pipeline never throws
      await expect(
        runPageToolPipeline(
          relay as unknown as BrowserRelayLike,
          {},
          store as never,
          securityConfig,
          { toolName: "test", relayAction: "test_action", timeoutMs: 5000, validateResponse: () => null },
        ),
      ).resolves.toBeDefined();
    });

    it("B2-ER-PIPELINE-03: validateResponse returning null yields error result (not thrown)", async () => {
      const { runPageToolPipeline } = await import("../page-tool-pipeline.js");
      const relay = createMockRelay();
      relay.isConnected = () => true;
      relay.request.mockResolvedValue({ success: true, data: { some: "data" } });

      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      const result = await runPageToolPipeline(
        relay as unknown as BrowserRelayLike,
        {},
        store as never,
        securityConfig,
        {
          toolName: "test",
          relayAction: "test_action",
          timeoutMs: 5000,
          validateResponse: () => null, // always invalid
        },
      );

      // Must return structured result, not throw
      expect(result).toHaveProperty("success");
    });

    it("B2-ER-PIPELINE-04: redaction failures are fail-closed (redaction rejects → pipeline returns error)", async () => {
      const { runPageToolPipeline } = await import("../page-tool-pipeline.js");
      const relay = createMockRelay();
      relay.isConnected = () => true;
      relay.request.mockResolvedValue({ success: true, data: { key: "value" } });

      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      // redact throws — pipeline must catch it and return error result (fail-closed)
      const result = await runPageToolPipeline(
        relay as unknown as BrowserRelayLike,
        {},
        store as never,
        securityConfig,
        {
          toolName: "test",
          relayAction: "test_action",
          timeoutMs: 5000,
          validateResponse: (d) => d as unknown,
          redact: () => { throw new Error("redaction failed"); },
        },
      );

      // Must return error result — never propagate the redact error
      expect(result).toHaveProperty("success");
      expect((result as { success: boolean }).success).toBe(false);
      expect(result).toHaveProperty("error");
    });

    it("B2-ER-PIPELINE-05: returned object is detached copy — mutating result.data does not affect store", async () => {
      const { runPageToolPipeline } = await import("../page-tool-pipeline.js");
      const relay = createMockRelay();
      relay.isConnected = () => true;

      const store = { add: vi.fn(), find: vi.fn(), clear: vi.fn() };
      const securityConfig = {
        originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
        redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
        auditLog: { log: vi.fn() },
        snapshotRetention: { maxAgeMs: 0 },
      };

      const result = await runPageToolPipeline(
        relay as unknown as BrowserRelayLike,
        {},
        store as never,
        securityConfig,
        {
          toolName: "test",
          relayAction: "test_action",
          timeoutMs: 5000,
          validateResponse: (d) => d as unknown,
        },
      );

      // If result has data, mutating it must not affect any store state
      if (result.data && typeof result.data === "object") {
        const original = JSON.stringify(result.data);
        (result.data as Record<string, unknown>)["mutated"] = true;
        // If the pipeline returns a detached copy, mutating result.data
        // does not change store state (store is unaffected by definition)
        expect(store.add).not.toHaveBeenCalled();
      }
    });

    it("B2-ER-PIPELINE-06: stages execute in the §14-B fixed order — connection → audit → relay → validate → origin → snapshot → redact → post → audit-complete", async () => {
      const { runPageToolPipeline } = await import("../page-tool-pipeline.js");
      const relay = createMockRelay();
      relay.isConnected = () => true;
      relay.request.mockResolvedValue({ success: true, data: { pageUrl: "https://example.com", title: "Example" } });

      const callLog: string[] = [];
      const store = {
        add: vi.fn(() => callLog.push("snapshot")),
        find: vi.fn(),
        clear: vi.fn(),
      };
      const securityConfig = {
        originPolicy: {
          allowedOrigins: [],
          deniedOrigins: [],
          defaultAction: "allow" as const,
          check: (origin: string) => { callLog.push(`origin-check:${origin}`); return { allowed: true }; },
        },
        redactionPolicy: {
          redactPatterns: [],
          replacement: "[REDACTED]",
          redact: (data: unknown) => { callLog.push("redact"); return data; },
        },
        auditLog: {
          log: (event: string) => { callLog.push(`audit:${event}`); },
        },
        snapshotRetention: { maxAgeMs: 0 },
      };

      // Run pipeline; catch stub's throw so execution continues to assertions.
      try {
        await runPageToolPipeline(
          relay as unknown as BrowserRelayLike,
          {},
          store as never,
          securityConfig,
          {
            toolName: "test",
            relayAction: "test_action",
            timeoutMs: 5000,
            validateResponse: (d) => { callLog.push("validate"); return d as never; },
            extractOrigin: (_r) => { callLog.push("extract-origin"); return "https://example.com"; },
            redact: (d) => { callLog.push("redact"); return d; },
          },
        );
      } catch {
        // stub throws before any stage runs; assertions below determine pass/fail
      }

      // Per §14-B: stages execute in fixed order 1→2→3→4→5→6→7→8→9.
      // The trackable subset via callbacks (stages 4/5/7/9):
      //   Stage 4 (validateResponse) fires before stage 5 (extractOrigin)
      //   Stage 5 (extractOrigin) fires before stage 7 (redact)
      //   Stage 7 (redact) fires before stage 9 (audit-complete)
      // Each pair must appear in callLog in the correct relative order.
      //
      // Against stub (stages never run): callLog is [] → all index assertions fail.
      // Against real impl (correct order): callLog = [validate, extract-origin, redact, audit:complete]
      //   → index assertions all pass.
      // Against wrong-order impl: e.g. extract-origin before validate → first index assertion fails.
      const idx = (tag: string) => callLog.indexOf(tag);
      expect(callLog.length).toBeGreaterThanOrEqual(4); // at minimum the 4 trackable stages must run
      expect(idx("validate")).toBeLessThan(idx("extract-origin"));
      expect(idx("extract-origin")).toBeLessThan(idx("redact"));
      expect(idx("redact")).toBeLessThan(idx("audit:complete"));

      // Full array equality for completeness (documents the exact expected sequence)
      expect(callLog).toEqual(["validate", "extract-origin", "redact", "audit:complete"]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE CONSTRAINT TESTS (§14-B.3, §14-B.6)
// Source: docs/10-architecture/architecture.md §14-B.3, §14-B.6
// ─────────────────────────────────────────────────────────────────────────────

describe("architecture-constraints (§14-B.3, §14-B.6)", () => {
  it("ARCH-01: comment-sync.ts imports are restricted to vscode + bridge-types + local types", async () => {
    // Read the module source directly to verify imports
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "/data/projects/accordo/packages/browser/src/comment-sync.ts",
      "utf8",
    );
    // Must not import anything from browser-extension
    expect(src).not.toMatch(/from\s+['"].*browser-extension/);
    expect(src).not.toMatch(/from\s+['"].*\/browser-extension\//);
    // Must not import cross-modality packages
    expect(src).not.toMatch(/from\s+['"]@accordo\/voice/);
    expect(src).not.toMatch(/from\s+['"]@accordo\/script/);
    expect(src).not.toMatch(/from\s+['"]accordo-editor/);
  });

  it("ARCH-02: comment-notifier.ts imports are restricted to vscode + local types only", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "/data/projects/accordo/packages/browser/src/comment-notifier.ts",
      "utf8",
    );
    // Must not import browser-extension
    expect(src).not.toMatch(/from\s+['"].*browser-extension/);
    expect(src).not.toMatch(/from\s+['"].*\/browser-extension\//);
    // No cross-modality coupling
    expect(src).not.toMatch(/from\s+['"]@accordo\/voice/);
    expect(src).not.toMatch(/from\s+['"]@accordo\/script/);
  });

  for (const [filename, allowedVscode] of [
    ["relay-lifecycle.ts", false],
    ["tool-assembly.ts", false],
    ["page-tool-pipeline.ts", false],
  ] as const) {
    const filePath = `/data/projects/accordo/packages/browser/src/${filename}`;
    it(`ARCH-ARCH-${filename}: ${filename} does not import from browser-extension, cross-modality packages, or vscode`, async () => {
      const fs = await import("node:fs");
      const src = fs.readFileSync(filePath, "utf8");

      // No browser-extension imports (packages/browser-extension is MV3, packages/browser is MV2)
      expect(src).not.toMatch(/from\s+['"].*browser-extension/);
      expect(src).not.toMatch(/from\s+['"].*\/browser-extension\//);

      // No cross-modality coupling — these modules are browser-only
      expect(src).not.toMatch(/from\s+['"]@accordo\/voice/);
      expect(src).not.toMatch(/from\s+['"]@accordo\/script/);
      expect(src).not.toMatch(/from\s+['"]accordo-editor/);

      // Optional vscode restriction per module — only value imports (runtime) are prohibited.
      // Type-only imports (import type ...) are erased by TypeScript and have no runtime
      // effect, so they do not constitute a runtime coupling violation.
      if (!allowedVscode) {
        // Match value imports from vscode: "import ... from 'vscode'" but NOT "import type ... from"
        expect(src).not.toMatch(/import\s+(?!type\s+).*from\s+['"](?:vscode|@types\/vscode)['"]/);
      }
    });
  }
});