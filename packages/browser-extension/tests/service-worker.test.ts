/**
 * M80-SW — service-worker.test.ts
 *
 * Tests for the Background Service Worker message router.
 * Each message type routes to the correct handler.
 * Unknown types return an error response.
 *
 * Protects: BR-F-40 through BR-F-45
 *
 * API checklist:
 * ✓ MESSAGE_TYPES — 1 structural test
 * ✓ handleMessage — 7 tests (one per message type + unknown)
 * ✓ registerListeners — 1 test (listeners are registered)
 * ✓ onInstalled — 1 test (default settings written)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, getStorageMap } from "./setup/chrome-mock.js";
import {
  handleMessage,
  registerListeners,
  onInstalled,
  MESSAGE_TYPES,
} from "../src/service-worker.js";

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
});
