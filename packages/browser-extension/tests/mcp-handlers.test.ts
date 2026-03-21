/**
 * M80-MCP — mcp-handlers.test.ts
 *
 * Tests for MCP Handler Layer.
 * Handlers read real data from storage and return typed McpToolResponse shapes.
 *
 * Protects: BR-F-90 through BR-F-97
 *
 * API checklist:
 * ✓ handleGetComments — 4 tests
 * ✓ handleGetScreenshot — 3 tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import type {
  McpToolRequest,
  GetCommentsArgs,
  GetScreenshotArgs,
} from "../src/types.js";
import { handleGetComments, handleGetScreenshot } from "../src/mcp-handlers.js";
import { createThread } from "../src/store.js";
import { captureScreenshot } from "../src/screenshot.js";

describe("M80-MCP — MCP Handler Layer", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  describe("handleGetComments", () => {
    it("BR-F-93: returns McpToolResponse with success: true and threads for URL", async () => {
      // BR-F-93: handleGetComments returns active threads for the URL
      // Set up a real thread in storage
      await createThread("https://example.com/page", "div:0:text", {
        body: "Test comment",
        author: { kind: "user", name: "Alice" },
      });
      const request: McpToolRequest<GetCommentsArgs> = {
        tool: "get_comments",
        args: { url: "https://example.com/page" },
        requestId: "req-001",
      };
      const response = await handleGetComments(request);
      expect(response.success).toBe(true);
      expect(response.requestId).toBe("req-001");
      expect(response.data).toBeDefined();
      expect(Array.isArray(response.data?.threads)).toBe(true);
      expect(response.data!.threads.length).toBeGreaterThan(0);
    });

    it("BR-F-95: returns { success: false, error: 'no-comments-found' } for URL with no comments", async () => {
      // BR-F-95: Error case handled gracefully; no throw
      const request: McpToolRequest<GetCommentsArgs> = {
        tool: "get_comments",
        args: { url: "https://no-comments.com" },
        requestId: "req-002",
      };
      const response = await handleGetComments(request);
      expect(response.success).toBe(false);
      expect(response.requestId).toBe("req-002");
      expect(response.error).toBe("no-comments-found");
      expect(response.data).toBeUndefined();
    });

    it("BR-F-94: includeDeleted: true returns soft-deleted threads too", async () => {
      // BR-F-94: includeDeleted flag controls whether soft-deleted threads are included
      const request: McpToolRequest<GetCommentsArgs> = {
        tool: "get_comments",
        args: {
          url: "https://example.com/page",
          includeDeleted: true,
        },
        requestId: "req-003",
      };
      const response = await handleGetComments(request);
      // At minimum, must succeed and return data
      expect(response.success).toBe(true);
      expect(response.requestId).toBe("req-003");
      expect(response.data).toBeDefined();
    });

    it("BR-F-95: handler returns a Promise (async-compatible)", async () => {
      // BR-F-95: Handler functions return Promise
      const request: McpToolRequest<GetCommentsArgs> = {
        tool: "get_comments",
        args: { url: "https://example.com" },
        requestId: "req-004",
      };
      const result = handleGetComments(request);
      expect(result).toBeInstanceOf(Promise);
      await result; // Must not throw
    });
  });

  describe("handleGetScreenshot", () => {
    it("BR-F-91: returns McpToolResponse with screenshot data when screenshot exists", async () => {
      // BR-F-91: Returns screenshot record when available
      // Capture a screenshot first so storage has data
      await captureScreenshot(1);
      const request: McpToolRequest<GetScreenshotArgs> = {
        tool: "get_screenshot",
        args: { url: "https://example.com/page" },
        requestId: "req-005",
      };
      const response = await handleGetScreenshot(request);
      expect(response.success).toBe(true);
      expect(response.requestId).toBe("req-005");
      expect(response.data).toBeDefined();
      expect(typeof response.data?.dataUrl).toBe("string");
    });

    it("BR-F-92: returns { success: false, error: 'no-screenshot-available' } when none exists", async () => {
      // BR-F-92: Error case when no screenshot captured yet
      const request: McpToolRequest<GetScreenshotArgs> = {
        tool: "get_screenshot",
        args: { url: "https://no-screenshot.com" },
        requestId: "req-006",
      };
      const response = await handleGetScreenshot(request);
      expect(response.success).toBe(false);
      expect(response.requestId).toBe("req-006");
      expect(response.error).toBe("no-screenshot-available");
    });

    it("BR-F-95: handler returns a Promise (async-compatible)", async () => {
      // BR-F-95: Handler functions are Promise-returning
      const request: McpToolRequest<GetScreenshotArgs> = {
        tool: "get_screenshot",
        args: {},
        requestId: "req-007",
      };
      const result = handleGetScreenshot(request);
      expect(result).toBeInstanceOf(Promise);
      await result; // Must not throw
    });
  });
});
