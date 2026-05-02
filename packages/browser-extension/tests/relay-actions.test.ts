import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import { createThread, softDeleteComment } from "../src/store.js";
import { handleRelayAction } from "../src/relay-actions.js";
import { defaultStore } from "../src/relay-definitions.js";
import { setRelayClient } from "../src/relay-comment-runtime.js";

describe("M82-RELAY — browser-extension relay actions", () => {
  beforeEach(() => {
    resetChromeMocks();
    defaultStore.clear();
    setRelayClient(null);
  });

  it("BR-F-119: get_comments returns active thread data envelope", async () => {
    await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });

    const response = await handleRelayAction({
      requestId: "req-1",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });

    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("requestId", "req-1");
    expect((response.data as { totalThreads: number }).totalThreads).toBe(1);
  });

  it("BR-F-119: get_comments can include deleted comments for sync", async () => {
    const thread = await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });
    await handleRelayAction({
      requestId: "req-reply",
      action: "reply_comment",
      payload: { threadId: thread.id, body: "deleted reply", commentId: "reply-deleted" },
    });
    await softDeleteComment(thread.id, "reply-deleted");

    const activeOnly = await handleRelayAction({
      requestId: "req-active",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });
    const withDeleted = await handleRelayAction({
      requestId: "req-deleted",
      action: "get_comments",
      payload: { url: "https://example.com", includeDeleted: true },
    });

    const activeComments = (activeOnly.data as { threads: Array<{ comments: Array<{ id: string }> }> }).threads[0]?.comments ?? [];
    const deletedData = withDeleted.data as { includesDeleted?: boolean; threads: Array<{ comments: Array<{ id: string; deletedAt?: string }> }> };
    const allComments = deletedData.threads[0]?.comments ?? [];
    expect(activeComments.some((comment) => comment.id === "reply-deleted")).toBe(false);
    expect(deletedData.includesDeleted).toBe(true);
    expect(allComments.find((comment) => comment.id === "reply-deleted")?.deletedAt).toBeDefined();
  });

  it("BR-F-124: create_comment creates a new thread on active page by default", async () => {
    setMockTabUrl(1, "https://example.com/created?page=1");
    const response = await handleRelayAction({
      requestId: "req-create",
      action: "create_comment",
      payload: { body: "Created by agent" },
    });

    expect(response.success).toBe(true);
    const created = response.data as { pageUrl: string; comments: Array<{ body: string }> };
    expect(created.pageUrl).toBe("https://example.com/created");
    expect(created.comments[0]?.body).toBe("Created by agent");
  });

  it("BR-F-119: get_comments defaults to active tab URL when url is omitted", async () => {
    setMockTabUrl(1, "https://example.com/active?page=1#top");
    await createThread("https://example.com/active", "div:0:test", {
      body: "from active page",
      author: { kind: "user", name: "Alice" },
    });

    const response = await handleRelayAction({
      requestId: "req-active",
      action: "get_comments",
      payload: {},
    });

    expect(response.success).toBe(true);
    const data = response.data as { url: string; totalThreads: number };
    expect(data.url).toBe("https://example.com/active");
    expect(data.totalThreads).toBe(1);
  });

  it("BR-F-119: get_all_comments returns all URLs sorted by lastActivity desc", async () => {
    const first = await createThread("https://example.com/older", "div:0:a", {
      body: "older",
      author: { kind: "user", name: "Alice" },
    });
    await createThread("https://example.com/newer", "div:0:b", {
      body: "newer",
      author: { kind: "user", name: "Bob" },
    });

    await handleRelayAction({
      requestId: "req-reply",
      action: "reply_comment",
      payload: { threadId: first.id, body: "fresh activity", authorName: "Agent" },
    });

    const response = await handleRelayAction({
      requestId: "req-all",
      action: "get_all_comments",
      payload: {},
    });

    expect(response.success).toBe(true);
    const pages = (response.data as { pages: Array<{ url: string }> }).pages;
    expect(pages).toHaveLength(2);
    expect(pages[0]?.url).toBe("https://example.com/older");
    expect(pages[1]?.url).toBe("https://example.com/newer");
  });

  it("BR-F-119: reply_comment appends a comment", async () => {
    const thread = await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });

    const response = await handleRelayAction({
      requestId: "req-2",
      action: "reply_comment",
      payload: { threadId: thread.id, body: "reply", authorName: "Agent" },
    });

    expect(response.success).toBe(true);
    expect((response.data as { body?: string }).body).toBe("reply");
  });

  it("BR-F-119b: accordo notifier reply persists locally even while relay adapter is connected", async () => {
    const thread = await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });
    setRelayClient({
      isConnected: () => true,
      send: vi.fn().mockRejectedValue(new Error("should not bounce notifier mutations to VS Code")),
      start: vi.fn(),
      stop: vi.fn(),
    } as never);

    const response = await handleRelayAction({
      requestId: "req-local-reply",
      action: "reply_comment",
      payload: {
        source: "accordo-browser-notifier",
        threadId: thread.id,
        body: "agent reply",
        commentId: "agent-comment-1",
        authorName: "agent",
      },
    });

    expect(response.success).toBe(true);
    const comments = (await handleRelayAction({
      requestId: "req-read-after-local-reply",
      action: "get_comments",
      payload: { url: "https://example.com" },
    })).data as { threads: Array<{ comments: Array<{ id: string; body: string }> }> };
    expect(comments.threads[0]?.comments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "agent-comment-1", body: "agent reply" })]),
    );
  });

  it("BR-F-124: resolve_thread then reopen_thread toggles thread status", async () => {
    const thread = await createThread("https://example.com", "div:0:test", {
      body: "hello",
      author: { kind: "user", name: "Alice" },
    });

    const resolved = await handleRelayAction({
      requestId: "req-r1",
      action: "resolve_thread",
      payload: { threadId: thread.id, resolutionNote: "done" },
    });
    expect(resolved.success).toBe(true);

    const afterResolve = await handleRelayAction({
      requestId: "req-r2",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });
    const status1 = (afterResolve.data as { threads: Array<{ status: string }> }).threads[0]?.status;
    expect(status1).toBe("resolved");

    const reopened = await handleRelayAction({
      requestId: "req-r3",
      action: "reopen_thread",
      payload: { threadId: thread.id },
    });
    expect(reopened.success).toBe(true);

    const afterReopen = await handleRelayAction({
      requestId: "req-r4",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });
    const status2 = (afterReopen.data as { threads: Array<{ status: string }> }).threads[0]?.status;
    expect(status2).toBe("open");
  });

  it("BR-F-125: unknown action returns unsupported-action", async () => {
    const response = await handleRelayAction({
      requestId: "req-3",
      action: "get_comments",
      payload: { url: "https://example.com" },
    });
    expect(response.error).toBeUndefined();

    const bad = await handleRelayAction({
      requestId: "req-4",
      action: "invalid_action" as never,
      payload: {},
    });
    expect(bad.success).toBe(false);
    expect(bad.error).toBe("unsupported-action");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// B2-CTX-001: Multi-tab support — list_pages + select_page relay actions
// Tests for handleRelayAction with new multi-tab actions.
// ════════════════════════════════════════════════════════════════════════════════

describe("B2-CTX-001: multi-tab support", () => {
  beforeEach(() => {
    resetChromeMocks();
    // Seed mockTabUrls for tests that need specific URLs
    setMockTabUrl(1, "https://example.com/page1");
    setMockTabUrl(2, "https://example.com/page2");
    setMockTabUrl(3, "https://example.com/page3");
  });

  // ── list_pages ──────────────────────────────────────────────────────────────

  describe('"list_pages" action', () => {
    it("B2-CTX-001: returns { pages: [{ tabId, url, title, active }] } on success", async () => {
      chrome.storage.local.get = vi.fn().mockResolvedValue({ controlGrantedTabs: [2] });
      // Override tabs.query to return full tab objects with title/active
      globalThis.chrome.tabs.query = vi.fn().mockResolvedValue([
        { id: 1, url: "https://example.com/page1", title: "Example Page 1", active: true, windowId: 1, index: 0, highlighted: false, pinned: false, incognito: false },
        { id: 2, url: "https://example.com/page2", title: "Example Page 2", active: false, windowId: 1, index: 1, highlighted: false, pinned: false, incognito: false },
        { id: 3, url: "https://example.com/page3", title: "Example Page 3", active: false, windowId: 1, index: 2, highlighted: false, pinned: false, incognito: false },
      ]);

      const result = await handleRelayAction({
        requestId: "req-1",
        action: "list_pages",
        payload: {},
      });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("data");
      expect(Array.isArray((result as { data: { pages: unknown[] } }).data.pages)).toBe(true);

      const pages = (result as { data: { pages: { tabId: number; url: string; title: string; active: boolean; controlGranted: boolean }[] } }).data.pages;
      expect(pages).toHaveLength(3);
      expect(pages[0]).toHaveProperty("tabId", 1);
      expect(pages[0]).toHaveProperty("url", "https://example.com/page1");
      expect(pages[0]).toHaveProperty("title", "Example Page 1");
      expect(pages[0]).toHaveProperty("active", true);
      expect(pages[0]).toHaveProperty("controlGranted", false);
      expect(pages[1]).toHaveProperty("tabId", 2);
      expect(pages[1]).toHaveProperty("active", false);
      expect(pages[1]).toHaveProperty("controlGranted", true);
    });

    it("GAP-G1: manage_snapshots list returns extension snapshot metadata from the authoritative store", async () => {
      await defaultStore.save("page-a", {
        pageId: "page-a",
        frameId: "main",
        snapshotId: "page-a:1",
        capturedAt: "2025-01-01T00:00:00.000Z",
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        nodes: [],
        totalElements: 0,
      });

      const result = await handleRelayAction({
        requestId: "req-manage-list",
        action: "manage_snapshots",
        payload: { action: "list" },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        pages: [
          {
            pageId: "page-a",
            snapshotCount: 1,
            snapshots: [{ snapshotId: "page-a:1", capturedAt: "2025-01-01T00:00:00.000Z", source: "dom" }],
          },
        ],
      });
    });

    it("GAP-G1: manage_snapshots clear removes extension snapshots used by diff_snapshots", async () => {
      await defaultStore.save("page-clear", {
        pageId: "page-clear",
        frameId: "main",
        snapshotId: "page-clear:1",
        capturedAt: "2025-01-01T00:00:00.000Z",
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        nodes: [],
        totalElements: 0,
      });

      const cleared = await handleRelayAction({
        requestId: "req-manage-clear",
        action: "manage_snapshots",
        payload: { action: "clear", pageId: "page-clear" },
      });

      expect(cleared.success).toBe(true);
      expect(cleared.data).toEqual({ success: true, clearedPageId: "page-clear", clearedCount: 1 });

      const listed = await handleRelayAction({
        requestId: "req-manage-list-after-clear",
        action: "manage_snapshots",
        payload: { action: "list" },
      });
      expect(listed.success).toBe(true);
      const pages = (listed.data as { pages: Array<{ pageId: string }> }).pages;
      expect(pages.find((page) => page.pageId === "page-clear")).toBeUndefined();
    });

    it("B2-CTX-001: chrome.tabs.query is called with empty object (all tabs)", async () => {
      globalThis.chrome.tabs.query = vi.fn().mockResolvedValue([
        { id: 1, url: "https://example.com/page1", title: "Page 1", active: true, windowId: 1, index: 0, highlighted: false, pinned: false, incognito: false },
      ]);

      await handleRelayAction({
        requestId: "req-1",
        action: "list_pages",
        payload: {},
      });

      expect(globalThis.chrome.tabs.query).toHaveBeenCalledWith({});
    });

    it("B2-CTX-001: returns error when chrome.tabs.query fails", async () => {
      globalThis.chrome.tabs.query = vi.fn().mockRejectedValue(new Error("tabs.query failed"));

      const result = await handleRelayAction({
        requestId: "req-1",
        action: "list_pages",
        payload: {},
      });

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "action-failed");
    });
  });

  // ── select_page ─────────────────────────────────────────────────────────────

  describe('"select_page" action', () => {
    it("B2-CTX-001: with valid tabId → calls chrome.tabs.update and returns success", async () => {
      globalThis.chrome.tabs.update = vi.fn().mockResolvedValue({
        id: 2, url: "https://example.com/page2", status: "complete", active: true, windowId: 10,
      } as chrome.tabs.Tab);
      globalThis.chrome.windows.update = vi.fn().mockResolvedValue({
        id: 10, focused: true,
      } as chrome.windows.Window);

      const result = await handleRelayAction({
        requestId: "req-1",
        action: "select_page",
        payload: { tabId: 2 },
      });

      expect(globalThis.chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });
      expect(result).toHaveProperty("success", true);
    });

    it("B2-CTX-001: with valid tabId → forwards the exact tabId to chrome.tabs.update", async () => {
      globalThis.chrome.tabs.update = vi.fn().mockResolvedValue({
        id: 99, url: "https://example.com/page99", status: "complete", active: true,
      } as chrome.tabs.Tab);

      await handleRelayAction({
        requestId: "req-1",
        action: "select_page",
        payload: { tabId: 99 },
      });

      expect(globalThis.chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
    });

    it("B2-CTX-001: with invalid tabId → returns error when chrome.tabs.update rejects", async () => {
      globalThis.chrome.tabs.update = vi.fn().mockRejectedValue(new Error("tab not found"));

      const result = await handleRelayAction({
        requestId: "req-1",
        action: "select_page",
        payload: { tabId: 999 },
      });

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "action-failed");
    });

    it("B2-CTX-001: without tabId in payload → returns invalid-request (not action-failed)", async () => {
      globalThis.chrome.tabs.update = vi.fn();

      const result = await handleRelayAction({
        requestId: "req-1",
        action: "select_page",
        payload: {},
      });

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "invalid-request");
      expect(globalThis.chrome.tabs.update).not.toHaveBeenCalled();
    });
  });

  // ── tabId forwarding in existing tools ─────────────────────────────────────

  describe("B2-CTX-001: get_page_map with explicit tabId → forwards to that tab", () => {
    it("B2-CTX-001: tabId from payload is forwarded to chrome.tabs.sendMessage (not active tab query)", async () => {
      // Simulate service worker context (document is undefined)
      const originalDocument = globalThis.document;
      Object.defineProperty(globalThis, "document", { value: undefined, writable: true });

      try {
        globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({
          data: { pageId: "test", pageUrl: "https://example.com/page1", title: "Test", nodes: [], totalElements: 0, depth: 0, truncated: false },
        });

        await handleRelayAction({
          requestId: "req-1",
          action: "get_page_map",
          payload: { tabId: 42, maxDepth: 4 },
        });

        // Key assertion: chrome.tabs.query should NOT be called to find active tab
        // because tabId was explicitly provided in payload
        expect(globalThis.chrome.tabs.query).not.toHaveBeenCalled();

        // Key assertion: chrome.tabs.sendMessage must be called with the explicit tabId from payload
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          42, // the explicit tabId from payload, NOT the result of a query
          expect.objectContaining({
            type: "PAGE_UNDERSTANDING_ACTION",
            action: "get_page_map",
            payload: expect.objectContaining({ tabId: 42 }),
          }),
          { frameId: 0 },
        );
      } finally {
        Object.defineProperty(globalThis, "document", { value: originalDocument, writable: true });
      }
    });
  });

  describe("B2-CTX-001: get_page_map without tabId → targets active tab (backward compat)", () => {
    it("B2-CTX-001: when tabId is absent, queries active tab and forwards to it", async () => {
      // Simulate service worker context (document is undefined)
      const originalDocument = globalThis.document;
      Object.defineProperty(globalThis, "document", { value: undefined, writable: true });

      try {
        globalThis.chrome.tabs.query = vi.fn().mockResolvedValue([
          { id: 1, url: "https://example.com/page1", title: "Page 1", active: true, windowId: 1, index: 0, highlighted: false, pinned: false, incognito: false },
        ]);
        globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({
          data: { pageId: "test", pageUrl: "https://example.com/page1", title: "Test", nodes: [], totalElements: 0, depth: 0, truncated: false },
        });

        await handleRelayAction({
          requestId: "req-1",
          action: "get_page_map",
          payload: { maxDepth: 4 },
        });

        // chrome.tabs.query must be called to find the active tab
        expect(globalThis.chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });

        // chrome.tabs.sendMessage is called with the tab returned by the query
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          1, // MOCK_TABS[0].id — the active tab from the query
          expect.objectContaining({
            type: "PAGE_UNDERSTANDING_ACTION",
            action: "get_page_map",
            payload: expect.objectContaining({ maxDepth: 4 }),
          }),
          { frameId: 0 },
        );
      } finally {
        Object.defineProperty(globalThis, "document", { value: originalDocument, writable: true });
      }
    });
  });

  describe("B2-CTX-001: wait_for with explicit tabId → sends to specified tab", () => {
    it("B2-CTX-001: tabId from payload is forwarded (not active tab query)", async () => {
      // Simulate service worker context (document is undefined)
      const originalDocument = globalThis.document;
      Object.defineProperty(globalThis, "document", { value: undefined, writable: true });

      try {
        globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await handleRelayAction({
          requestId: "req-1",
          action: "wait_for",
          payload: { tabId: 77, texts: ["Done"] },
        });

        // chrome.tabs.query should NOT be called
        expect(globalThis.chrome.tabs.query).not.toHaveBeenCalled();

        // chrome.tabs.sendMessage must be called with the explicit tabId from payload
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          77, // the explicit tabId from payload
          expect.objectContaining({
            type: "PAGE_UNDERSTANDING_ACTION",
            action: "wait_for",
            payload: expect.objectContaining({ tabId: 77, texts: ["Done"] }),
          }),
          { frameId: 0 },
        );
      } finally {
        Object.defineProperty(globalThis, "document", { value: originalDocument, writable: true });
      }
    });
  });

  describe("B2-CTX-001: wait_for without tabId → targets active tab (backward compat)", () => {
    it("B2-CTX-001: when tabId absent, queries active tab", async () => {
      // Simulate service worker context (document is undefined)
      const originalDocument = globalThis.document;
      Object.defineProperty(globalThis, "document", { value: undefined, writable: true });

      try {
        globalThis.chrome.tabs.query = vi.fn().mockResolvedValue([
          { id: 1, url: "https://example.com/page1", title: "Page 1", active: true, windowId: 1, index: 0, highlighted: false, pinned: false, incognito: false },
        ]);
        globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await handleRelayAction({
          requestId: "req-1",
          action: "wait_for",
          payload: { texts: ["Done"] },
        });

        expect(globalThis.chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          1, // active tab id
          expect.objectContaining({ action: "wait_for" }),
          { frameId: 0 },
        );
      } finally {
        Object.defineProperty(globalThis, "document", { value: originalDocument, writable: true });
      }
    });
  });
});
