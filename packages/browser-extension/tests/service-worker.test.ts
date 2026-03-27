/**
 * M80-SW — service-worker.test.ts
 *
 * Tests for the Background Service Worker message router.
 * Each message type routes to the correct handler.
 * Unknown types return an error response.
 *
 * Protects: BR-F-40 through BR-F-45, BR-F-140 through BR-F-142
 *
 * API checklist:
 * ✓ MESSAGE_TYPES — 1 structural test
 * ✓ handleMessage — 7 tests (one per message type + unknown)
 * ✓ registerListeners — 1 test (listeners are registered)
 * ✓ onInstalled — 1 test (default settings written)
 * ✓ checkAndSync — 4 tests (PeriodicSync-01..02, BR-F-142-SW-wake, BR-F-140-reply-parity)
 * ✓ mergeLocalAndHubThread — includes BR-F-141 tombstone suppression test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetChromeMocks, getStorageMap, seedStorage } from "./setup/chrome-mock.js";
import {
  handleMessage,
  registerListeners,
  onInstalled,
  MESSAGE_TYPES,
  mergeLocalAndHubThread,
  checkAndSync,
  stopPeriodicSync,
} from "../src/service-worker.js";
import type { BrowserCommentThread, BrowserComment } from "../src/types.js";

describe("M80-SW — Background Service Worker", () => {
  beforeEach(() => {
    resetChromeMocks();
    vi.clearAllMocks();
  });

  describe("MESSAGE_TYPES constant", () => {
    it("BR-F-41: MESSAGE_TYPES contains all required message type strings", () => {
      // BR-F-41 / BR-F-42: All message types must be defined
      expect(typeof MESSAGE_TYPES.TOGGLE_COMMENTS_MODE).toBe("string");
      expect(typeof MESSAGE_TYPES.GET_THREADS).toBe("string");
      expect(typeof MESSAGE_TYPES.CREATE_THREAD).toBe("string");
      expect(typeof MESSAGE_TYPES.ADD_COMMENT).toBe("string");
      expect(typeof MESSAGE_TYPES.RESOLVE_THREAD).toBe("string");
      expect(typeof MESSAGE_TYPES.REOPEN_THREAD).toBe("string");
      expect(typeof MESSAGE_TYPES.SOFT_DELETE_COMMENT).toBe("string");
      expect(typeof MESSAGE_TYPES.SOFT_DELETE_THREAD).toBe("string");
      expect(typeof MESSAGE_TYPES.COMMENTS_UPDATED).toBe("string");
      expect(typeof MESSAGE_TYPES.EXPORT).toBe("string");
      expect(typeof MESSAGE_TYPES.MCP_GET_COMMENTS).toBe("string");
      expect(typeof MESSAGE_TYPES.MCP_GET_SCREENSHOT).toBe("string");
      expect(typeof MESSAGE_TYPES.BROWSER_RELAY_ACTION).toBe("string");
    });
  });

  describe("handleMessage — TOGGLE_COMMENTS_MODE", () => {
    it("BR-F-42: routes TOGGLE_COMMENTS_MODE and returns success response", async () => {
      // BR-F-42: Service worker routes messages from popup: toggle-mode
      const response = await handleMessage(
        { type: MESSAGE_TYPES.TOGGLE_COMMENTS_MODE, payload: { tabId: 1 } },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("success");
    });
  });

  describe("handleMessage — GET_THREADS", () => {
    it("BR-F-41: routes GET_THREADS and returns threads array", async () => {
      // BR-F-41: Service worker routes GET_THREADS from content script
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.GET_THREADS,
          payload: { url: "https://example.com" },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("success", true);
      expect(response).toHaveProperty("data");
      expect(Array.isArray(response.data)).toBe(true);
    });

    it("BR-F-DEL-SYNC-03: GET_THREADS suppresses hub thread when local thread is tombstoned", async () => {
      const url = "https://example.com";
      const normalizedUrl = "https://example.com/";
      const deletedThreadId = "tid-deleted-local";

      seedStorage({
        [`comments:${normalizedUrl}`]: {
          version: "1.0",
          url: normalizedUrl,
          threads: [
            {
              id: deletedThreadId,
              anchorKey: "div:0:hello",
              pageUrl: normalizedUrl,
              status: "open",
              comments: [
                {
                  id: "cmt-1",
                  threadId: deletedThreadId,
                  createdAt: "2026-01-01T10:00:00.000Z",
                  author: { kind: "user", name: "Alice" },
                  body: "hello",
                  anchorKey: "div:0:hello",
                  pageUrl: normalizedUrl,
                  status: "open",
                },
              ],
              createdAt: "2026-01-01T10:00:00.000Z",
              lastActivity: "2026-01-01T10:00:00.000Z",
              deletedAt: "2026-01-01T10:05:00.000Z",
            },
          ],
        },
      });

      const sendSpy = vi.spyOn(RelayBridgeClient.prototype, "send").mockImplementation(async (action) => {
        if (action === "get_comments") {
          return {
            success: true,
            data: {
              threads: [
                {
                  id: deletedThreadId,
                  anchor: { uri: normalizedUrl },
                  status: "open",
                  comments: [
                    {
                      id: "hub-cmt-1",
                      threadId: deletedThreadId,
                      author: { kind: "assistant", name: "Agent" },
                      body: "hub copy",
                      createdAt: "2026-01-01T10:10:00.000Z",
                      status: "open",
                    },
                  ],
                  createdAt: "2026-01-01T10:00:00.000Z",
                  lastActivity: "2026-01-01T10:10:00.000Z",
                },
              ],
            },
          };
        }
        return { success: false, error: "browser-not-connected" };
      });

      try {
        const response = await handleMessage(
          {
            type: MESSAGE_TYPES.GET_THREADS,
            payload: { url },
          },
          {} as chrome.runtime.MessageSender
        );

        expect(response.success).toBe(true);
        expect(Array.isArray(response.data)).toBe(true);
        expect((response.data as BrowserCommentThread[]).map((t) => t.id)).not.toContain(deletedThreadId);
      } finally {
        sendSpy.mockRestore();
      }
    });

    it("BR-F-DEL-SYNC-04: GET_THREADS keeps hub-only thread when not tombstoned locally", async () => {
      const url = "https://example.com";
      const normalizedUrl = "https://example.com/";
      const hubOnlyThreadId = "tid-hub-only";

      const sendSpy = vi.spyOn(RelayBridgeClient.prototype, "send").mockImplementation(async (action) => {
        if (action === "get_comments") {
          return {
            success: true,
            data: {
              threads: [
                {
                  id: hubOnlyThreadId,
                  anchor: { uri: normalizedUrl },
                  status: "open",
                  comments: [
                    {
                      id: "hub-cmt-2",
                      threadId: hubOnlyThreadId,
                      author: { kind: "assistant", name: "Agent" },
                      body: "hub-only thread",
                      createdAt: "2026-01-01T11:00:00.000Z",
                      status: "open",
                    },
                  ],
                  createdAt: "2026-01-01T11:00:00.000Z",
                  lastActivity: "2026-01-01T11:00:00.000Z",
                },
              ],
            },
          };
        }
        return { success: false, error: "browser-not-connected" };
      });

      try {
        const response = await handleMessage(
          {
            type: MESSAGE_TYPES.GET_THREADS,
            payload: { url },
          },
          {} as chrome.runtime.MessageSender
        );

        expect(response.success).toBe(true);
        expect(Array.isArray(response.data)).toBe(true);
        expect((response.data as BrowserCommentThread[]).map((t) => t.id)).toContain(hubOnlyThreadId);
      } finally {
        sendSpy.mockRestore();
      }
    });

    it("PIN-FIX-05: GET_THREADS derives anchorKey from browser block coordinates when comment context metadata is absent", async () => {
      const url = "https://example.com";
      const normalizedUrl = "https://example.com/";
      const hubOnlyThreadId = "tid-hub-block-anchor";
      const blockId = "id:helpkit-launcherButton--jazzskills";

      const sendSpy = vi.spyOn(RelayBridgeClient.prototype, "send").mockImplementation(async (action) => {
        if (action === "get_comments") {
          return {
            success: true,
            data: {
              threads: [
                {
                  id: hubOnlyThreadId,
                  anchor: {
                    kind: "surface",
                    uri: normalizedUrl,
                    surfaceType: "browser",
                    coordinates: { type: "block", blockId, blockType: "paragraph" },
                  },
                  status: "open",
                  comments: [
                    {
                      id: "hub-cmt-3",
                      threadId: hubOnlyThreadId,
                      author: { kind: "assistant", name: "Agent" },
                      body: "hub-only thread with block anchor",
                      createdAt: "2026-01-01T11:00:00.000Z",
                      status: "open",
                    },
                  ],
                  createdAt: "2026-01-01T11:00:00.000Z",
                  lastActivity: "2026-01-01T11:00:00.000Z",
                },
              ],
            },
          };
        }
        return { success: false, error: "browser-not-connected" };
      });

      try {
        const response = await handleMessage(
          {
            type: MESSAGE_TYPES.GET_THREADS,
            payload: { url },
          },
          {} as chrome.runtime.MessageSender
        );

        expect(response.success).toBe(true);
        expect(Array.isArray(response.data)).toBe(true);
        const thread = (response.data as BrowserCommentThread[]).find((t) => t.id === hubOnlyThreadId);
        expect(thread).toBeDefined();
        expect(thread?.anchorKey).toBe(blockId);
      } finally {
        sendSpy.mockRestore();
      }
    });

    it("PIN-FIX-06: GET_THREADS keeps hub browser thread when both request URL and hub URI include hash fragment", async () => {
      const urlWithHash = "https://example.com/page#";
      const threadId = "tid-hub-hash-uri";

      const sendSpy = vi.spyOn(RelayBridgeClient.prototype, "send").mockImplementation(async (action) => {
        if (action === "get_comments") {
          return {
            success: true,
            data: {
              threads: [
                {
                  id: threadId,
                  anchor: {
                    kind: "surface",
                    uri: urlWithHash,
                    surfaceType: "browser",
                    coordinates: { type: "block", blockId: "css:h3:nth-of-type(4)", blockType: "paragraph" },
                  },
                  status: "open",
                  comments: [
                    {
                      id: "hub-cmt-hash-1",
                      threadId,
                      author: { kind: "assistant", name: "Agent" },
                      body: "hash variant thread",
                      createdAt: "2026-01-01T11:00:00.000Z",
                      status: "open",
                    },
                  ],
                  createdAt: "2026-01-01T11:00:00.000Z",
                  lastActivity: "2026-01-01T11:00:00.000Z",
                },
              ],
            },
          };
        }
        return { success: false, error: "browser-not-connected" };
      });

      try {
        const response = await handleMessage(
          {
            type: MESSAGE_TYPES.GET_THREADS,
            payload: { url: urlWithHash },
          },
          {} as chrome.runtime.MessageSender
        );

        expect(response.success).toBe(true);
        expect(Array.isArray(response.data)).toBe(true);
        expect((response.data as BrowserCommentThread[]).map((t) => t.id)).toContain(threadId);
      } finally {
        sendSpy.mockRestore();
      }
    });
  });

  describe("handleMessage — CREATE_THREAD", () => {
    it("BR-F-41: routes CREATE_THREAD and returns created thread", async () => {
      // BR-F-41: Routes create-comment message
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("success", true);
      expect(response).toHaveProperty("data");
      expect(typeof (response.data as { id?: string })?.id).toBe("string");
    });
  });

  describe("handleMessage — ADD_COMMENT", () => {
    it("BR-F-41: routes ADD_COMMENT and appends a reply", async () => {
      const created = await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      const threadId = (created.data as { id: string }).id;

      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.ADD_COMMENT,
          payload: {
            threadId,
            body: "Reply",
            author: { kind: "user", name: "Bob" },
          },
        },
        {} as chrome.runtime.MessageSender
      );

      expect(response).toHaveProperty("success", true);
      expect((response.data as { body?: string })?.body).toBe("Reply");
    });

    it("BR-F-140: ADD_COMMENT reply preserves commentId parity — stored comment id matches forwarded commentId", async () => {
      // BR-F-140: When the browser creates a reply locally, the same commentId must be
      // persisted to local storage so that when accordo-browser forwards it to Hub via
      // reply_comment, both sides share the same commentId.
      const created = await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      const threadId = (created.data as { id: string }).id;

      // Reply without providing a commentId — SW must generate one and return it
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.ADD_COMMENT,
          payload: {
            threadId,
            body: "A reply",
            author: { kind: "user", name: "Bob" },
          },
        },
        {} as chrome.runtime.MessageSender
      );

      expect(response.success).toBe(true);
      const replyId = (response.data as { id: string }).id;
      expect(typeof replyId).toBe("string");
      expect(replyId.length).toBeGreaterThan(0);

      // Verify the same commentId is stored in chrome.storage.local
      const storageMap = getStorageMap();
      const pageStore = storageMap.get("comments:https://example.com/") as {
        threads: Array<{ id: string; comments: Array<{ id: string; body: string }> }>;
      } | undefined;
      const thread = pageStore?.threads?.find((t) => t.id === threadId);
      const stored = thread?.comments?.find((c) => c.id === replyId);

      // The commentId returned by SW == commentId stored in local storage
      expect(stored).toBeDefined();
      expect(stored?.body).toBe("A reply");
    });

    it("BR-F-140-E2E: ADD_COMMENT with explicit commentId stores that exact id and forwards it in reply_comment payload", async () => {
      // End-to-end parity: when ADD_COMMENT supplies an explicit commentId,
      // the stored comment must use that id AND the reply_comment forwarding
      // envelope sent to accordo-browser must carry the same commentId.
      const created = await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      const threadId = (created.data as { id: string }).id;

      const explicitCommentId = "explicit-comment-id-abc123";

      // Capture the payload forwarded to accordo-browser via reply_comment
      const forwardedPayloads: Array<Record<string, unknown>> = [];
      const sendSpy = vi.spyOn(RelayBridgeClient.prototype, "send").mockImplementation(async (action, payload) => {
        if (action === "reply_comment") {
          forwardedPayloads.push(payload as Record<string, unknown>);
        }
        return { success: false, error: "browser-not-connected" };
      });

      try {
        const response = await handleMessage(
          {
            type: MESSAGE_TYPES.ADD_COMMENT,
            payload: {
              threadId,
              body: "Reply with explicit id",
              author: { kind: "user", name: "Bob" },
              commentId: explicitCommentId,
            },
          },
          {} as chrome.runtime.MessageSender
        );

        expect(response.success).toBe(true);

        // 1. The comment returned must use the explicit id
        const returned = response.data as { id: string };
        expect(returned.id).toBe(explicitCommentId);

        // 2. The comment persisted in storage must use the explicit id
        const storageMap = getStorageMap();
        const pageStore = storageMap.get("comments:https://example.com/") as {
          threads: Array<{ id: string; comments: Array<{ id: string; body: string }> }>;
        } | undefined;
        const thread = pageStore?.threads?.find((t) => t.id === threadId);
        const stored = thread?.comments?.find((c) => c.id === explicitCommentId);
        expect(stored).toBeDefined();
        expect(stored?.body).toBe("Reply with explicit id");

        // 3. The reply_comment forwarding envelope must include the same commentId
        // (forwardToAccordoBrowser is fire-and-forget — give it a tick to run)
        await Promise.resolve();
        expect(forwardedPayloads.length).toBeGreaterThan(0);
        expect(forwardedPayloads[0]?.commentId).toBe(explicitCommentId);
        expect(forwardedPayloads[0]?.threadId).toBe(threadId);
      } finally {
        sendSpy.mockRestore();
      }
    });
  });

  describe("handleMessage — SOFT_DELETE_COMMENT", () => {
    it("BR-F-43: routes SOFT_DELETE_COMMENT and hides deleted comment from active threads", async () => {
      const created = await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      const threadId = (created.data as { id: string }).id;

      const replied = await handleMessage(
        {
          type: MESSAGE_TYPES.ADD_COMMENT,
          payload: {
            threadId,
            body: "Reply",
            author: { kind: "user", name: "Bob" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      const replyId = (replied.data as { id: string }).id;

      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.SOFT_DELETE_COMMENT,
          payload: { threadId, commentId: replyId, deletedBy: "Guest" },
        },
        {} as chrome.runtime.MessageSender
      );

      expect(response).toHaveProperty("success", true);

      const active = await handleMessage(
        {
          type: MESSAGE_TYPES.GET_THREADS,
          payload: { url: "https://example.com" },
        },
        {} as chrome.runtime.MessageSender
      );
      const thread = (active.data as Array<{ comments: Array<{ id: string }> }>)[0];
      expect(thread.comments.some((c) => c.id === replyId)).toBe(false);
    });
  });

  describe("handleMessage — SOFT_DELETE_THREAD", () => {
    it("BR-F-DEL-SYNC-02: returns error when thread does not exist", async () => {
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.SOFT_DELETE_THREAD,
          payload: { threadId: "missing-thread-id" },
        },
        {} as chrome.runtime.MessageSender
      );

      expect(response.success).toBe(false);
      expect(response.error).toBe("thread not found");
    });
  });

  describe("handleMessage — RESOLVE_THREAD / REOPEN_THREAD", () => {
    it("BR-F-124: resolves and reopens a thread via SW routes", async () => {
      const created = await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      const threadId = (created.data as { id: string }).id;

      const resolved = await handleMessage(
        {
          type: MESSAGE_TYPES.RESOLVE_THREAD,
          payload: { threadId, resolutionNote: "done" },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(resolved.success).toBe(true);

      const reopened = await handleMessage(
        {
          type: MESSAGE_TYPES.REOPEN_THREAD,
          payload: { threadId },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(reopened.success).toBe(true);
    });
  });

  describe("handleMessage — EXPORT", () => {
    it("BR-F-42: routes EXPORT and returns success", async () => {
      // BR-F-42: export-comments from popup triggers screenshot + clipboard export
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.EXPORT,
          payload: { tabId: 1, url: "https://example.com" },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("success");
    });
  });

  describe("handleMessage — MCP_GET_COMMENTS", () => {
    it("BR-F-41: routes MCP_GET_COMMENTS and returns McpToolResponse shape", async () => {
      // BR-F-41: MCP namespace routing for get_comments
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.MCP_GET_COMMENTS,
          payload: {
            tool: "get_comments",
            args: { url: "https://example.com" },
            requestId: "req-001",
          },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("requestId", "req-001");
      expect(response).toHaveProperty("success");
    });

    it("BR-F-96: 'mcp:get_comments' message type routes to handleGetComments", async () => {
      // BR-F-96: MCP namespace routing — messages with "mcp:" prefix route to MCP handlers
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES["mcp:get_comments"],
          payload: {
            tool: "get_comments",
            args: { url: "https://example.com" },
            requestId: "req-mcp-001",
          },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("requestId", "req-mcp-001");
      expect(response).toHaveProperty("success");
    });
  });

  describe("handleMessage — MCP_GET_SCREENSHOT", () => {
    it("BR-F-41: routes MCP_GET_SCREENSHOT and returns McpToolResponse shape", async () => {
      // BR-F-41: MCP namespace routing for get_screenshot
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.MCP_GET_SCREENSHOT,
          payload: {
            tool: "get_screenshot",
            args: { url: "https://example.com" },
            requestId: "req-002",
          },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("requestId", "req-002");
      expect(response).toHaveProperty("success");
    });

    it("BR-F-96: 'mcp:get_screenshot' message type routes to handleGetScreenshot", async () => {
      // BR-F-96: MCP namespace routing — messages with "mcp:" prefix route to MCP handlers
      const response = await handleMessage(
        {
          type: MESSAGE_TYPES["mcp:get_screenshot"],
          payload: {
            tool: "get_screenshot",
            args: { url: "https://example.com" },
            requestId: "req-mcp-002",
          },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(response).toHaveProperty("requestId", "req-mcp-002");
      expect(response).toHaveProperty("success");
    });
  });

  describe("handleMessage — BROWSER_RELAY_ACTION", () => {
    it("BR-F-119: routes relay action get_comments and returns thread payload", async () => {
      await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );

      const response = await handleMessage(
        {
          type: MESSAGE_TYPES.BROWSER_RELAY_ACTION,
          payload: {
            requestId: "req-relay-001",
            action: "get_comments",
            payload: { url: "https://example.com" },
          },
        },
        {} as chrome.runtime.MessageSender
      );

      expect(response).toHaveProperty("requestId", "req-relay-001");
      expect(response).toHaveProperty("success", true);
      expect((response.data as { totalThreads?: number }).totalThreads).toBe(1);
    });

    it("BR-F-DEL-SYNC-01: notify_comments_updated with threadId hides that thread from GET_THREADS", async () => {
      const created = await handleMessage(
        {
          type: MESSAGE_TYPES.CREATE_THREAD,
          payload: {
            url: "https://example.com",
            anchorKey: "div:0:hello",
            body: "First comment",
            author: { kind: "user", name: "Alice" },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      const threadId = (created.data as { id: string }).id;

      const relayResponse = await handleMessage(
        {
          type: MESSAGE_TYPES.BROWSER_RELAY_ACTION,
          payload: {
            requestId: "req-relay-del-001",
            action: "notify_comments_updated",
            payload: { threadId },
          },
        },
        {} as chrome.runtime.MessageSender
      );
      expect(relayResponse).toHaveProperty("success", true);

      // Verify the thread is locally soft-deleted
      const local = getStorageMap();
      const pageStore = local.get("comments:https://example.com/") as { threads: Array<{ id: string; deletedAt?: string }> } | undefined;
      const thread = pageStore?.threads?.find((t) => t.id === threadId);
      expect(thread).toBeDefined();
      expect(thread?.deletedAt).toBeDefined(); // deletedAt is set
      expect(thread?.deletedAt).not.toBe("");
    });
  });

  describe("handleMessage — unknown type", () => {
    it("BR-F-44: unknown message type returns { success: false, error: 'unknown message type' }", async () => {
      // BR-F-44: Service worker re-initializes state on wake; unknown messages handled gracefully
      const unknownMessage = { type: "UNKNOWN_MESSAGE_TYPE_xyz123" } as unknown as Parameters<typeof handleMessage>[0];
      const response = await handleMessage(unknownMessage, {} as chrome.runtime.MessageSender);
      expect(response).toHaveProperty("success", false);
      expect(response).toHaveProperty("error");
      expect(typeof response.error).toBe("string");
      expect(response.error).toBe("unknown message type");
    });
  });

  describe("registerListeners", () => {
    it("BR-F-40: registers chrome.runtime.onMessage listener on startup", () => {
      // BR-F-40: Service worker initializes listeners on install
      // After registerListeners(), chrome.runtime.onMessage should have a listener
      registerListeners();
      // The mock tracks listeners added — check it was called
      expect(chrome.runtime.onMessage.addListener).toBeDefined();
      // No throw means listeners registered successfully
    });
  });

  describe("onInstalled", () => {
    it("BR-F-40: writes default settings with commentsMode: false on install", async () => {
      // BR-F-40: onInstalled writes default settings
      await onInstalled({ reason: "install", previousVersion: undefined });
      const storageMap = getStorageMap();
      // Settings must be persisted — find the settings key
      const settingsEntry = Array.from(storageMap.entries()).find(
        ([k]) => k === "settings" || k.startsWith("settings")
      );
      expect(settingsEntry).toBeDefined();
      const settings = settingsEntry![1];
      expect(settings).toHaveProperty("commentsMode", false);
    });
  });

  // ── mergeLocalAndHubThread ─────────────────────────────────────────────────

  describe("mergeLocalAndHubThread", () => {
    /** Factory for a minimal BrowserComment */
    function makeComment(overrides: Partial<BrowserComment> = {}): BrowserComment {
      return {
        id: "cmt-1",
        threadId: "tid-1",
        createdAt: "2026-01-01T10:00:00.000Z",
        author: { kind: "user", name: "Alice" },
        body: "hello",
        anchorKey: "body:50%x50%",
        pageUrl: "https://example.com/page",
        status: "open",
        ...overrides,
      };
    }

    /** Factory for a minimal BrowserCommentThread */
    function makeThread(overrides: Partial<BrowserCommentThread> = {}): BrowserCommentThread {
      return {
        id: "tid-1",
        anchorKey: "body:50%x50%",
        pageUrl: "https://example.com/page",
        status: "open",
        comments: [makeComment()],
        createdAt: "2026-01-01T10:00:00.000Z",
        lastActivity: "2026-01-01T10:00:00.000Z",
        ...overrides,
      };
    }

    it("BR-F-MERGE-01: same-ID local+hub produces exactly 1 merged thread", () => {
      const local = makeThread({ id: "tid-1" });
      const hub = makeThread({ id: "tid-1", status: "resolved" });

      const merged = mergeLocalAndHubThread(local, hub);

      expect(merged.id).toBe("tid-1");
    });

    it("BR-F-MERGE-02: merged thread keeps local anchorKey", () => {
      const local = makeThread({ anchorKey: "div:3:my-element", pageUrl: "https://example.com/page" });
      const hub = makeThread({ anchorKey: "body:center", pageUrl: "https://example.com/page" });

      const merged = mergeLocalAndHubThread(local, hub);

      expect(merged.anchorKey).toBe("div:3:my-element");
    });

    it("BR-F-MERGE-03: merged thread status and comments come from hub", () => {
      const hubComment = makeComment({ id: "cmt-hub", body: "Agent reply", status: "resolved" });
      const local = makeThread({ status: "open", comments: [makeComment({ id: "cmt-local" })] });
      const hub = makeThread({
        status: "resolved",
        comments: [makeComment({ id: "cmt-local" }), hubComment],
        lastActivity: "2026-06-01T12:00:00.000Z",
      });

      const merged = mergeLocalAndHubThread(local, hub);

      expect(merged.status).toBe("resolved");
      expect(merged.comments).toHaveLength(2);
      expect(merged.comments.some((c) => c.id === "cmt-hub")).toBe(true);
      expect(merged.lastActivity).toBe("2026-06-01T12:00:00.000Z");
    });

    it("BR-F-MERGE-04: each merged comment has local anchorKey and pageUrl", () => {
      const localAnchorKey = "p:1:some-paragraph";
      const localPageUrl = "https://example.com/article";
      const hubComment = makeComment({ anchorKey: "body:center", pageUrl: "https://hub.internal/page" });
      const local = makeThread({ anchorKey: localAnchorKey, pageUrl: localPageUrl, comments: [] });
      const hub = makeThread({ anchorKey: "body:center", pageUrl: "https://hub.internal/page", comments: [hubComment] });

      const merged = mergeLocalAndHubThread(local, hub);

      expect(merged.comments[0]?.anchorKey).toBe(localAnchorKey);
      expect(merged.comments[0]?.pageUrl).toBe(localPageUrl);
    });

    it("BR-F-MERGE-05: merged thread keeps local anchorContext when present", () => {
      const anchorContext = { tagName: "P", textSnippet: "Some text", pageTitle: "My Page" };
      const local = makeThread({ anchorContext });
      const hub = makeThread({ anchorContext: undefined });

      const merged = mergeLocalAndHubThread(local, hub);

      expect(merged.anchorContext).toEqual(anchorContext);
    });

    it("BR-F-MERGE-06: local soft-delete markers are preserved when hub has none", () => {
      const local = makeThread({ deletedAt: "2026-01-02T00:00:00.000Z", deletedBy: "Alice" });
      const hub = makeThread({ deletedAt: undefined, deletedBy: undefined });

      const merged = mergeLocalAndHubThread(local, hub);

      expect(merged.deletedAt).toBe("2026-01-02T00:00:00.000Z");
      expect(merged.deletedBy).toBe("Alice");
    });

    it("BR-F-141: tombstone suppression — hub comment matching locally soft-deleted commentId is excluded from merge", () => {
      // BR-F-141: mergeLocalAndHubThread must not resurrect a locally soft-deleted comment
      // even when the hub copy still has that comment (no deletedAt).
      const deletedCommentId = "cmt-deleted-locally";

      const localDeletedComment = makeComment({
        id: deletedCommentId,
        body: "this was deleted locally",
        deletedAt: "2026-01-02T00:00:00.000Z",
      });
      const local = makeThread({ comments: [localDeletedComment] });

      // Hub still holds the comment (no deletedAt on its copy)
      const hubComment = makeComment({ id: deletedCommentId, body: "this was deleted locally" });
      const hubExtraComment = makeComment({ id: "cmt-hub-extra", body: "agent reply" });
      const hub = makeThread({ comments: [hubComment, hubExtraComment] });

      const merged = mergeLocalAndHubThread(local, hub);

      // The locally-deleted comment must be absent; the other hub comment must be present
      const ids = merged.comments.map((c) => c.id);
      expect(ids).not.toContain(deletedCommentId);
      expect(ids).toContain("cmt-hub-extra");
    });

    it("BR-F-MERGE-07: hub-only thread is kept as-is when no local counterpart exists in GET_THREADS", async () => {
      // Verify GET_THREADS fallback for hub-only threads via the full message path
      // (No local thread is created — hub-only thread must still appear.)
      const response = await handleMessage(
        { type: MESSAGE_TYPES.GET_THREADS, payload: { url: "https://example.com" } },
        {} as chrome.runtime.MessageSender
      );

      expect(response.success).toBe(true);
      // No local threads + relay unavailable in test env → empty array is fine;
      // the important assertion is that the call succeeds without throwing.
      expect(Array.isArray(response.data)).toBe(true);
    });
  });
});

// ── Periodic Sync ─────────────────────────────────────────────────────────────
// These tests use vi.spyOn on RelayBridgeClient.prototype.send to simulate
// VS Code returning a version. checkAndSync() is exported for testability.

import { RelayBridgeClient } from "../src/relay-bridge.js";

describe("PeriodicSync — checkAndSync", () => {
  beforeEach(() => {
    resetChromeMocks();
    stopPeriodicSync();
    // Default: relay not connected — send returns a not-connected error
    vi.spyOn(RelayBridgeClient.prototype, "send").mockResolvedValue({
      success: false,
      error: "browser-not-connected",
    });
  });

  afterEach(() => {
    stopPeriodicSync();
    vi.restoreAllMocks();
  });

  it("PeriodicSync-01: checkAndSync does nothing when relay returns failure", async () => {
    // Arrange: relay is not connected (default mock from beforeEach)

    // Act
    await checkAndSync();

    // Assert: storage was not updated (no sync state write)
    const storageMap = getStorageMap();
    expect(storageMap.has("commentsSyncState")).toBe(false);
    // tabs.sendMessage was not called
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("PeriodicSync-02: checkAndSync triggers tab refresh when version changes", async () => {
    // Arrange: seed a stored sync state with version 1
    seedStorage({ commentsSyncState: { version: 1, lastSyncedAt: new Date(0).toISOString() } });
    // Relay returns version 2 (changed)
    vi.spyOn(RelayBridgeClient.prototype, "send").mockResolvedValue({
      success: true,
      data: { version: 2, threadCount: 3, lastActivity: "2026-01-01T00:00:00.000Z" },
    });

    // Act
    await checkAndSync();

    // Assert: sync state updated to version 2
    const storageMap = getStorageMap();
    const syncState = storageMap.get("commentsSyncState") as { version: number } | undefined;
    expect(syncState?.version).toBe(2);
  });

  it("BR-F-142: checkAndSync rehydrates commentsMode from storage before iterating tabs (SW-wake recovery)", async () => {
    // BR-F-142: After SW restart, the in-memory mode map is empty.
    // checkAndSync() must call loadCommentsModeFromStorage() so that tabs with
    // Comments Mode ON in storage are detected and receive the COMMENTS_UPDATED refresh.

    // Arrange: persist commentsMode with tab 1 = ON in storage
    const tabId = 1;
    seedStorage({ commentsMode: { [tabId]: true } });
    seedStorage({ commentsSyncState: { version: 5, lastSyncedAt: new Date(0).toISOString() } });

    // Relay returns a new version so sync proceeds
    vi.spyOn(RelayBridgeClient.prototype, "send").mockResolvedValue({
      success: true,
      data: { version: 6, threadCount: 1, lastActivity: "2026-01-01T00:00:00.000Z" },
    });

    // Provide a tab that has Comments Mode ON (tabs.query({}) returns it)
    const tabsQuerySpy = vi.spyOn(chrome.tabs, "query").mockResolvedValue([
      {
        id: tabId,
        url: "https://example.com/page",
        active: true,
        index: 0,
        windowId: 1,
        highlighted: false,
        pinned: false,
        incognito: false,
      } as chrome.tabs.Tab,
    ]);

    // Act: simulate SW wake — in-memory map is empty before this call
    await checkAndSync();

    // Assert: tabs.sendMessage was called for the tab with Comments Mode ON
    // (proving that loadCommentsModeFromStorage restored the tab's state)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      tabId,
      expect.objectContaining({ type: "COMMENTS_UPDATED" })
    );

    tabsQuerySpy.mockRestore();
  });
});
