/**
 * browser-sync-wakeup.test.ts
 *
 * Tests for the browser sync wakeup behavior in comments-bootstrap:
 *   1. Direct store mutation on an HTTPS thread triggers scheduleWakeup
 *      via the central store.onChanged hook (panel/MCP/native command path).
 *   2. Direct store mutation on a file:// URI does NOT trigger scheduleWakeup.
 *   3. applyBrowserCommentSyncState emits for UI refresh but does NOT call
 *      scheduleWakeup (ping-pong prevention via browserSyncApplyDepth guard).
 *
 * Requirement: PING-PONG-01, PING-PONG-02, PING-PONG-03
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetMockState,
  extensions,
  createMockExtensionContext,
} from "./mocks/vscode.js";
import { activate } from "../extension.js";
import type { CommentUINotifier } from "../comment-tools.js";

// ── Bridge mock factory ──────────────────────────────────────────────────────

interface ToolHandler {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function makeBridge() {
  const registeredTools: Array<{ name: string; handler: ToolHandler["handler"] }> = [];
  return {
    bridge: {
      registerTools: vi.fn().mockImplementation(
        (_id: string, tools: Array<{ name: string; handler: ToolHandler["handler"] }>) => {
          for (const t of tools) registeredTools.push({ name: t.name, handler: t.handler });
          return { dispose: vi.fn() };
        },
      ),
      publishState: vi.fn(),
    },
    registeredTools,
  };
}

function setupWithBridge() {
  const m = makeBridge();
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
    (id: string) => {
      if (id === "accordo.accordo-bridge") {
        return { exports: m.bridge, isActive: true };
      }
      return undefined;
    },
  );
  return m;
}

function setupWithoutBridge() {
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(undefined);
}

beforeEach(() => {
  resetMockState();
});

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeBrowserSyncState(pageUrl: string, threadId: string) {
  return {
    schemaVersion: "2.0" as const,
    browserRevision: 1,
    accordoRevision: 0,
    emittedBy: "browser-extension" as const,
    generatedAt: new Date().toISOString(),
    pages: [
      {
        pageUrl,
        threads: [
          {
            id: threadId,
            anchorKey: "body",
            pageUrl,
            status: "open" as const,
            comments: [{ id: "c1", body: "hello", author: { kind: "user" as const, name: "Bob" }, createdAt: new Date().toISOString(), lastActivity: new Date().toISOString() }],
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
          },
        ],
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("browser sync wakeup — central store.onChanged hook", () => {

  describe("PING-PONG-01: direct store mutation on HTTPS thread triggers scheduleWakeup", () => {

    it("EXP-WU-01: store.reply on https thread triggers scheduleWakeup via central hook", async () => {
      const { registeredTools } = setupWithBridge();
      const ctx = createMockExtensionContext();
      const exports = await activate(ctx);

      // Track scheduleWakeup calls on the secondary notifier
      const wakeupCalls: Array<{ action: string; payload?: unknown }> = [];
      const trackingNotifier: CommentUINotifier = {
        addThread: () => {},
        updateThread: () => {},
        removeThread: () => {},
        removeThreads: () => {},
        scheduleWakeup: (action, payload) => wakeupCalls.push({ action, payload }),
      };
      exports.registerBrowserNotifier(trackingNotifier);

      // Seed a browser thread via applyBrowserCommentSyncState so reply has a target
      const state = makeBrowserSyncState("https://example.com/page", "t-browser-1");
      await exports.applyBrowserCommentSyncState(state);

      // Clear wakeup calls from the seed apply (apply increments browserSyncApplyDepth
      // so the seed itself should NOT have triggered wakeup, but defensive clear anyway)
      wakeupCalls.length = 0;

      // Get the comment_reply tool and call it directly (simulates panel submitReply
      // calling store.reply() — we use the tool here because it exercises the same
      // store.reply() -> _emit(affectedUri) -> onChanged -> hook -> scheduleWakeup path)
      const replyTool = registeredTools.find(t => t.name === "comment_reply");
      expect(replyTool).toBeDefined();

      await replyTool!.handler({
        threadId: "t-browser-1",
        body: "Reply via MCP tool",
      });

      // scheduleWakeup must have been called on the secondary notifier
      expect(wakeupCalls.some(c => c.action === "request_comment_state_sync")).toBe(true);
    });

    it("EXP-WU-02: store.reply on https thread triggers scheduleWakeup with correct URI in payload", async () => {
      const { registeredTools } = setupWithBridge();
      const ctx = createMockExtensionContext();
      const exports = await activate(ctx);

      const wakeupCalls: Array<{ action: string; payload?: unknown }> = [];
      const trackingNotifier: CommentUINotifier = {
        addThread: () => {},
        updateThread: () => {},
        removeThread: () => {},
        removeThreads: () => {},
        scheduleWakeup: (action, payload) => wakeupCalls.push({ action, payload }),
      };
      exports.registerBrowserNotifier(trackingNotifier);

      const state = makeBrowserSyncState("https://example.com/my-page", "t-browser-wakeup");
      await exports.applyBrowserCommentSyncState(state);
      wakeupCalls.length = 0; // clear seed

      const replyTool = registeredTools.find(t => t.name === "comment_reply");
      await replyTool!.handler({ threadId: "t-browser-wakeup", body: "test reply" });

      const matching = wakeupCalls.filter(
        c => c.action === "request_comment_state_sync"
          && (c.payload as Record<string, unknown>)?.["url"] === "https://example.com/my-page",
      );
      expect(matching.length).toBe(1);
    });
  });

  describe("PING-PONG-02: direct store mutation on file:// URI does NOT trigger scheduleWakeup", () => {

    it("EXP-WU-03: store.reply on file:// thread does NOT trigger scheduleWakeup", async () => {
      const { registeredTools } = setupWithBridge();
      const ctx = createMockExtensionContext();
      const exports = await activate(ctx);

      const wakeupCalls: Array<{ action: string; payload?: unknown }> = [];
      const trackingNotifier: CommentUINotifier = {
        addThread: () => {},
        updateThread: () => {},
        removeThread: () => {},
        removeThreads: () => {},
        scheduleWakeup: (action, payload) => wakeupCalls.push({ action, payload }),
      };
      exports.registerBrowserNotifier(trackingNotifier);

      // Create a file thread via comment_create (which does not go through
      // applyBrowserCommentSyncState so browserSyncApplyDepth stays 0)
      const createTool = registeredTools.find(t => t.name === "comment_create");
      expect(createTool).toBeDefined();
      const createResult = await createTool!.handler({
        uri: "file:///test/file.ts",
        anchor: { kind: "text", startLine: 1 },
        body: "Initial comment",
      }) as { success: boolean; threadId: string };
      expect(createResult.success).toBe(true);
      const threadId = createResult.threadId;

      wakeupCalls.length = 0; // clear wakeup from create

      // Reply to the file thread
      const replyTool = registeredTools.find(t => t.name === "comment_reply");
      await replyTool!.handler({ threadId, body: "Reply on file thread" });

      // scheduleWakeup must NOT have been called for the file:// URI
      expect(wakeupCalls.some(c => c.action === "request_comment_state_sync")).toBe(false);
    });
  });

  describe("PING-PONG-03: applyBrowserCommentSyncState does NOT trigger scheduleWakeup (ping-pong prevention)", () => {

    it("EXP-WU-04: applyBrowserCommentSyncState does NOT call scheduleWakeup for browser-origin apply", async () => {
      const { registeredTools } = setupWithBridge();
      const ctx = createMockExtensionContext();
      const exports = await activate(ctx);

      const wakeupCalls: Array<{ action: string; payload?: unknown }> = [];
      const trackingNotifier: CommentUINotifier = {
        addThread: () => {},
        updateThread: () => {},
        removeThread: () => {},
        removeThreads: () => {},
        scheduleWakeup: (action, payload) => wakeupCalls.push({ action, payload }),
      };
      exports.registerBrowserNotifier(trackingNotifier);

      const state = makeBrowserSyncState("https://example.com/apply-test", "t-apply-1");

      // applyBrowserCommentSyncState should NOT trigger scheduleWakeup because
      // browserSyncApplyDepth > 0 during the apply, which silences the central hook
      await exports.applyBrowserCommentSyncState(state);

      const wakeupForApply = wakeupCalls.filter(
        c => c.action === "request_comment_state_sync"
          && (c.payload as Record<string, unknown>)?.["url"] === "https://example.com/apply-test",
      );
      expect(wakeupForApply.length).toBe(0);
    });

    it("EXP-WU-05: applyBrowserCommentSyncState calls _emit so onChanged listeners fire", async () => {
      // Verify that applyBrowserCommentSyncState calls _emit by directly testing
      // that the store's onChanged listener fires after apply.
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();

      let listenerFireCount = 0;
      store.onChanged(() => { listenerFireCount++; });

      const state = makeBrowserSyncState("https://example.com/emit-test", "t-emit-1");
      await store.applyBrowserCommentSyncState(state);

      // _emit must have been called once (once per page = 1 page in our state)
      expect(listenerFireCount).toBe(1);
    });

    it("EXP-WU-06: subsequent store.reply after applyBrowserCommentSyncState DOES trigger scheduleWakeup", async () => {
      // Verifies that browserSyncApplyDepth is back to 0 after apply completes,
      // so normal mutations after browser sync are correctly forwarded.
      const { registeredTools } = setupWithBridge();
      const ctx = createMockExtensionContext();
      const exports = await activate(ctx);

      const wakeupCalls: Array<{ action: string; payload?: unknown }> = [];
      const trackingNotifier: CommentUINotifier = {
        addThread: () => {},
        updateThread: () => {},
        removeThread: () => {},
        removeThreads: () => {},
        scheduleWakeup: (action, payload) => wakeupCalls.push({ action, payload }),
      };
      exports.registerBrowserNotifier(trackingNotifier);

      // Apply browser sync state
      const state = makeBrowserSyncState("https://example.com/after-apply", "t-after-apply");
      await exports.applyBrowserCommentSyncState(state);
      wakeupCalls.length = 0; // clear seed

      // Now do a normal store.reply — should trigger scheduleWakeup normally
      const replyTool = registeredTools.find(t => t.name === "comment_reply");
      await replyTool!.handler({ threadId: "t-after-apply", body: "Reply after apply" });

      expect(wakeupCalls.some(c => c.action === "request_comment_state_sync")).toBe(true);
    });
  });

  describe("MERGE-EXPORT-01: comments store exports merged browser sync state", () => {
    it("EXP-MERGE-01: exported state includes Accordo-only reply after browser state apply", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();

      const inbound = makeBrowserSyncState("https://chatgpt.com/codex/cloud/settings/analytics", "6534cbda-94d1-4d9c-bca2-72828b690d98");
      inbound.pages[0].threads[0].comments[0].body = "see how much i was using in this period, can we be more efficient?";
      inbound.pages[0].threads[0].anchorKey = "css:main>section:nth-of-type(2)@38,17";
      inbound.pages[0].threads[0].comments[0].anchorKey = "css:main>section:nth-of-type(2)@38,17";
      inbound.pages[0].threads[0].comments[0].status = "open";
      await store.applyBrowserCommentSyncState(inbound);
      await store.reply({
        threadId: "6534cbda-94d1-4d9c-bca2-72828b690d98",
        body: "this is a reply on analytics comment",
        commentId: "247f8879-1d19-4a61-9cf2-bdbbd7c2e852",
        author: { kind: "user", name: "User" },
      });

      const exported = store.exportBrowserCommentSyncState({ browserRevision: 7, accordoRevision: 3 });
      const analyticsThread = exported.pages
        .find((page) => page.pageUrl === "https://chatgpt.com/codex/cloud/settings/analytics")
        ?.threads.find((thread) => thread.id === "6534cbda-94d1-4d9c-bca2-72828b690d98");

      expect(exported.emittedBy).toBe("vscode-accordo");
      expect(analyticsThread?.anchorKey).toBe("css:main>section:nth-of-type(2)@38,17");
      expect(analyticsThread?.comments.map((comment) => comment.body)).toContain("this is a reply on analytics comment");
      expect(analyticsThread?.comments.map((comment) => comment.id)).toContain("247f8879-1d19-4a61-9cf2-bdbbd7c2e852");
    });

    it("EXP-MERGE-02: Accordo-side browser thread delete exports a tombstone and stale browser state does not resurrect it", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();

      const inbound = makeBrowserSyncState("https://example.com/delete-thread", "t-delete-from-accordo");
      await store.applyBrowserCommentSyncState(inbound);

      await store.delete({ threadId: "t-delete-from-accordo" });

      const exportedAfterDelete = store.exportBrowserCommentSyncState({ browserRevision: 2, accordoRevision: 1 });
      const tombstone = exportedAfterDelete.pages
        .find((page) => page.pageUrl === "https://example.com/delete-thread")
        ?.threads.find((thread) => thread.id === "t-delete-from-accordo");

      expect(tombstone?.deletedAt).toBeDefined();
      expect(store.getAllThreads().map((thread) => thread.id)).not.toContain("t-delete-from-accordo");

      await store.applyBrowserCommentSyncState(inbound);

      expect(store.getAllThreads().map((thread) => thread.id)).not.toContain("t-delete-from-accordo");
      const exportedAfterStaleBrowserState = store.exportBrowserCommentSyncState({ browserRevision: 3, accordoRevision: 2 });
      const stillTombstoned = exportedAfterStaleBrowserState.pages
        .find((page) => page.pageUrl === "https://example.com/delete-thread")
        ?.threads.find((thread) => thread.id === "t-delete-from-accordo");
      expect(stillTombstoned?.deletedAt).toBeDefined();
    });

    it("EXP-MERGE-03: Accordo-side browser comment delete exports a comment tombstone and stale browser comment does not resurrect", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();

      const inbound = makeBrowserSyncState("https://example.com/delete-comment", "t-delete-comment");
      inbound.pages[0].threads[0].comments = [
        { ...inbound.pages[0].threads[0].comments[0], id: "c-keep", threadId: "t-delete-comment", anchorKey: "body", status: "open" },
        { ...inbound.pages[0].threads[0].comments[0], id: "c-delete", threadId: "t-delete-comment", anchorKey: "body", status: "open", body: "delete me" },
      ];
      await store.applyBrowserCommentSyncState(inbound);

      await store.delete({ threadId: "t-delete-comment", commentId: "c-delete" });

      const exportedAfterDelete = store.exportBrowserCommentSyncState({ browserRevision: 2, accordoRevision: 1 });
      const exportedThread = exportedAfterDelete.pages
        .find((page) => page.pageUrl === "https://example.com/delete-comment")
        ?.threads.find((thread) => thread.id === "t-delete-comment");
      expect(exportedThread?.deletedAt).toBeUndefined();
      expect(exportedThread?.comments.find((comment) => comment.id === "c-delete")?.deletedAt).toBeDefined();

      await store.applyBrowserCommentSyncState(inbound);

      const localThread = store.getThread("t-delete-comment");
      expect(localThread?.comments.map((comment) => comment.id)).toEqual(["c-keep"]);
    });

    it("EXP-MERGE-04: bulk Accordo-side browser delete exports tombstones and stale browser state does not resurrect", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const first = makeBrowserSyncState("https://example.com/bulk-a", "t-bulk-a");
      const second = makeBrowserSyncState("https://example.com/bulk-b", "t-bulk-b");
      await store.applyBrowserCommentSyncState({ ...first, pages: [...first.pages, ...second.pages] });

      const result = await store.deleteAllByModality("browser");
      expect(result.deletedIds).toEqual(expect.arrayContaining(["t-bulk-a", "t-bulk-b"]));

      const exported = store.exportBrowserCommentSyncState({ browserRevision: 2, accordoRevision: 1 });
      const exportedThreads = exported.pages.flatMap((page) => page.threads);
      expect(exportedThreads.find((thread) => thread.id === "t-bulk-a")?.deletedAt).toBeDefined();
      expect(exportedThreads.find((thread) => thread.id === "t-bulk-b")?.deletedAt).toBeDefined();

      await store.applyBrowserCommentSyncState({ ...first, pages: [...first.pages, ...second.pages] });
      expect(store.getAllThreads().map((thread) => thread.id)).not.toContain("t-bulk-a");
      expect(store.getAllThreads().map((thread) => thread.id)).not.toContain("t-bulk-b");
    });

    it("EXP-MERGE-05: Accordo-side browser delete tombstone survives comments store reload", async () => {
      const { CommentStore } = await import("../comment-store.js");
      let persisted: unknown = null;
      const adapter = {
        read: async () => persisted as never,
        write: async (file: unknown) => { persisted = file; },
      };
      const store = new CommentStore(adapter);
      await store.load("/workspace");
      const inbound = makeBrowserSyncState("https://example.com/reload-delete", "t-reload-delete");
      await store.applyBrowserCommentSyncState(inbound);
      await store.delete({ threadId: "t-reload-delete" });

      const reloaded = new CommentStore(adapter);
      await reloaded.load("/workspace");
      const exported = reloaded.exportBrowserCommentSyncState({ browserRevision: 3, accordoRevision: 2 });
      const tombstone = exported.pages.flatMap((page) => page.threads).find((thread) => thread.id === "t-reload-delete");
      expect(tombstone?.deletedAt).toBeDefined();

      await reloaded.applyBrowserCommentSyncState(inbound);
      expect(reloaded.getAllThreads().map((thread) => thread.id)).not.toContain("t-reload-delete");
    });

    it("EXP-MERGE-06: browser-origin tombstones survive Accordo apply/export roundtrip", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const inbound = makeBrowserSyncState("https://example.com/browser-tombstone", "t-browser-deleted");
      inbound.pages[0].threads[0].deletedAt = "2026-01-02T00:00:00.000Z";
      inbound.pages[0].threads[0].comments[0].deletedAt = "2026-01-02T00:00:00.000Z";
      await store.applyBrowserCommentSyncState(inbound);

      const exported = store.exportBrowserCommentSyncState({ browserRevision: 3, accordoRevision: 2 });
      const tombstone = exported.pages.flatMap((page) => page.threads).find((thread) => thread.id === "t-browser-deleted");
      expect(tombstone?.deletedAt).toBe("2026-01-02T00:00:00.000Z");
      expect(tombstone?.comments[0]?.deletedAt).toBe("2026-01-02T00:00:00.000Z");
    });

    it("EXP-MERGE-07: browser sync removing the last page thread emits the removed page URI", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const inbound = makeBrowserSyncState("https://example.com/removed-page", "t-removed-page");
      await store.applyBrowserCommentSyncState(inbound);
      const changedUris: string[] = [];
      store.onChanged((uri) => changedUris.push(uri));

      await store.applyBrowserCommentSyncState({ ...inbound, pages: [] });

      expect(changedUris).toContain("https://example.com/removed-page");
    });

    it("EXP-MERGE-08: browser-origin resolved and reopened statuses are imported and exported", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const resolved = makeBrowserSyncState("https://example.com/status", "t-status");
      resolved.pages[0].threads[0].status = "resolved";
      resolved.pages[0].threads[0].comments[0].status = "resolved";
      resolved.pages[0].threads[0].lastActivity = "2026-01-02T00:00:00.000Z";
      await store.applyBrowserCommentSyncState(resolved);
      expect(store.getThread("t-status")?.status).toBe("resolved");

      const reopened = makeBrowserSyncState("https://example.com/status", "t-status");
      reopened.pages[0].threads[0].status = "open";
      reopened.pages[0].threads[0].comments[0].status = "open";
      reopened.pages[0].threads[0].lastActivity = "2026-01-03T00:00:00.000Z";
      await store.applyBrowserCommentSyncState(reopened);

      const local = store.getThread("t-status");
      expect(local?.status).toBe("open");
      expect(local?.lastActivity).toBe("2026-01-03T00:00:00.000Z");
      const exported = store.exportBrowserCommentSyncState({ browserRevision: 4, accordoRevision: 3 });
      const exportedThread = exported.pages.flatMap((page) => page.threads).find((thread) => thread.id === "t-status");
      expect(exportedThread?.status).toBe("open");
      expect(exportedThread?.comments[0]?.status).toBe("open");
    });

    it("EXP-MERGE-09: browser tombstone followed by omitted sync purges hidden data without resurrection", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const store = new CommentStore();
      const active = makeBrowserSyncState("https://example.com/omit-after-delete", "t-omit-delete");
      await store.applyBrowserCommentSyncState(active);

      const deleted = makeBrowserSyncState("https://example.com/omit-after-delete", "t-omit-delete");
      deleted.pages[0].threads[0].deletedAt = "2026-01-02T00:00:00.000Z";
      deleted.pages[0].threads[0].comments[0].deletedAt = "2026-01-02T00:00:00.000Z";
      await store.applyBrowserCommentSyncState(deleted);
      expect(store.getAllThreads().map((thread) => thread.id)).not.toContain("t-omit-delete");

      await store.applyBrowserCommentSyncState({ ...active, pages: [] });
      expect(store.getAllThreads().map((thread) => thread.id)).not.toContain("t-omit-delete");

      await store.applyBrowserCommentSyncState({ ...active, pages: [] });
      expect(store.getAllThreads().map((thread) => thread.id)).not.toContain("t-omit-delete");
      expect(store.exportBrowserCommentSyncState().pages.flatMap((page) => page.threads).map((thread) => thread.id)).not.toContain("t-omit-delete");
    });

    it("EXP-MERGE-10: public get/version/count surfaces hide browser tombstones", async () => {
      const { CommentStore } = await import("../comment-store.js");
      const { buildCommentQueryHandlers } = await import("../comment-tools/query-handlers.js");
      const store = new CommentStore();
      const active = makeBrowserSyncState("https://example.com/public-hide", "t-public-hide");
      await store.applyBrowserCommentSyncState(active);
      const deleted = makeBrowserSyncState("https://example.com/public-hide", "t-public-hide");
      deleted.pages[0].threads[0].deletedAt = "2026-01-02T00:00:00.000Z";
      deleted.pages[0].threads[0].comments[0].deletedAt = "2026-01-02T00:00:00.000Z";
      await store.applyBrowserCommentSyncState(deleted);

      const handlers = buildCommentQueryHandlers(store);
      await expect(handlers.comment_get({ threadId: "t-public-hide" }, {} as never)).rejects.toThrow("Thread not found");
      await expect(handlers.comment_list({ status: "all", limit: 50 }, {} as never)).resolves.toMatchObject({ total: 0, threads: [] });
      await expect(handlers.comment_sync_version({}, {} as never)).resolves.toMatchObject({ success: true, threadCount: 0, lastActivity: null });
      expect(store.getCounts()).toEqual({ open: 0, resolved: 0 });
    });
  });
});
