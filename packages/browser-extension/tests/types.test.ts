/**
 * M80-TYP — types.test.ts
 *
 * Tests for shared TypeScript type definitions.
 * These are compile-time structural tests: they use TypeScript assignability
 * and the `satisfies` operator to verify that the declared types match the
 * architecture specification (§5.1, §6.1, §7.1).
 *
 * All tests pass at Phase B because they test structural contracts
 * (interface shape), NOT runtime behavior. Per dev-process.md:
 * "structural contract tests MAY pass on stubs".
 *
 * Protects: BR-F-01, BR-F-02, BR-F-03, BR-F-04, BR-F-05, BR-F-06
 *
 * API checklist:
 * ✓ BrowserComment — 1 test (field completeness)
 * ✓ BrowserCommentThread — 1 test (field completeness)
 * ✓ PageCommentStore — 1 test (version literal + fields)
 * ✓ ScreenshotRecord — 1 test (field completeness)
 * ✓ McpToolRequest — 1 test (generic shape)
 * ✓ McpToolResponse — 1 test (generic shape)
 * ✓ GetScreenshotArgs/Result — 1 test
 * ✓ GetCommentsArgs/Result — 1 test
 * ✓ ExportPayload/ExportResult/Exporter — 1 test
 * ✓ Module is runtime-free — 1 test
 */

import { describe, it, expect } from "vitest";
import type {
  BrowserComment,
  BrowserCommentThread,
  PageCommentStore,
  ScreenshotRecord,
  McpToolRequest,
  McpToolResponse,
  GetScreenshotArgs,
  GetScreenshotResult,
  GetCommentsArgs,
  GetCommentsResult,
  ExportPayload,
  ExportResult,
  Exporter,
} from "../src/types.js";

describe("M80-TYP — Shared Types", () => {
  describe("BrowserComment", () => {
    it("BR-F-01: has all required fields with correct types", () => {
      // TypeScript compile-time check via assignability
      const comment: BrowserComment = {
        id: "uuid-001",
        threadId: "uuid-001",
        createdAt: new Date().toISOString(),
        author: { kind: "user", name: "Alice" },
        body: "This is a comment",
        anchorKey: "div:0:hello",
        pageUrl: "https://example.com/page",
        status: "open",
      };

      expect(comment.id).toBe("uuid-001");
      expect(comment.threadId).toBe("uuid-001");
      expect(comment.author.kind).toBe("user");
      expect(comment.status).toBe("open");
    });

    it("BR-F-01: optional fields deletedAt and deletedBy are undefined by default", () => {
      // BR-F-01
      const comment: BrowserComment = {
        id: "uuid-001",
        threadId: "uuid-001",
        createdAt: new Date().toISOString(),
        author: { kind: "user", name: "Alice" },
        body: "body",
        anchorKey: "div:0:hello",
        pageUrl: "https://example.com",
        status: "open",
      };

      expect(comment.deletedAt).toBeUndefined();
      expect(comment.deletedBy).toBeUndefined();
      expect(comment.resolutionNote).toBeUndefined();
    });

    it("BR-F-01: accepts resolved status and resolutionNote", () => {
      // BR-F-01
      const comment: BrowserComment = {
        id: "uuid-002",
        threadId: "uuid-001",
        createdAt: new Date().toISOString(),
        author: { kind: "user", name: "Bob" },
        body: "Fixed it",
        anchorKey: "p:1:text",
        pageUrl: "https://example.com",
        status: "resolved",
        resolutionNote: "All good now",
        deletedAt: "2026-01-01T00:00:00Z",
        deletedBy: "Bob",
      };

      expect(comment.status).toBe("resolved");
      expect(comment.resolutionNote).toBe("All good now");
      expect(comment.deletedAt).toBeDefined();
    });
  });

  describe("BrowserCommentThread", () => {
    it("BR-F-02: has all required fields including comments array", () => {
      // BR-F-02
      const thread: BrowserCommentThread = {
        id: "thread-001",
        anchorKey: "h1:0:title",
        pageUrl: "https://example.com/page",
        status: "open",
        comments: [],
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };

      expect(thread.id).toBe("thread-001");
      expect(thread.status).toBe("open");
      expect(Array.isArray(thread.comments)).toBe(true);
    });

    it("BR-F-02: optional deletedAt and deletedBy for soft-delete", () => {
      // BR-F-02
      const thread: BrowserCommentThread = {
        id: "thread-002",
        anchorKey: "p:0:text",
        pageUrl: "https://example.com",
        status: "resolved",
        comments: [],
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        deletedAt: "2026-01-02T00:00:00Z",
        deletedBy: "Alice",
      };

      expect(thread.deletedAt).toBeDefined();
      expect(thread.deletedBy).toBe("Alice");
    });
  });

  describe("PageCommentStore", () => {
    it("BR-F-03: version field is literal string '1.0'", () => {
      // BR-F-03
      const store: PageCommentStore = {
        version: "1.0",
        url: "https://example.com/page",
        threads: [],
      };

      // TypeScript ensures version can only be "1.0"
      expect(store.version).toBe("1.0");
    });

    it("BR-F-03: lastScreenshot is optional", () => {
      // BR-F-03
      const store: PageCommentStore = {
        version: "1.0",
        url: "https://example.com",
        threads: [],
      };

      expect(store.lastScreenshot).toBeUndefined();
    });
  });

  describe("ScreenshotRecord", () => {
    it("BR-F-03: has dataUrl, capturedAt (number), width, height", () => {
      // BR-F-03 (ScreenshotRecord is part of PageCommentStore)
      const screenshot: ScreenshotRecord = {
        dataUrl: "data:image/jpeg;base64,abc",
        capturedAt: Date.now(),
        width: 1920,
        height: 1080,
      };

      expect(typeof screenshot.capturedAt).toBe("number");
      expect(screenshot.width).toBe(1920);
      expect(screenshot.height).toBe(1080);
    });
  });

  describe("MCP types", () => {
    it("BR-F-04: McpToolRequest is generic with tool, args, requestId", () => {
      // BR-F-04
      const req: McpToolRequest<{ url: string }> = {
        tool: "get_comments",
        args: { url: "https://example.com" },
        requestId: "req-001",
      };

      expect(req.tool).toBe("get_comments");
      expect(req.args.url).toBe("https://example.com");
    });

    it("BR-F-04: McpToolResponse is generic with requestId, success, optional data/error", () => {
      // BR-F-04
      const successResponse: McpToolResponse<string> = {
        requestId: "req-001",
        success: true,
        data: "some data",
      };

      const errorResponse: McpToolResponse = {
        requestId: "req-002",
        success: false,
        error: "not-found",
      };

      expect(successResponse.success).toBe(true);
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toBe("not-found");
    });

    it("BR-F-04: GetScreenshotArgs has optional url field", () => {
      // BR-F-04
      const argsWithUrl: GetScreenshotArgs = { url: "https://example.com" };
      const argsWithoutUrl: GetScreenshotArgs = {};

      expect(argsWithUrl.url).toBe("https://example.com");
      expect(argsWithoutUrl.url).toBeUndefined();
    });

    it("BR-F-04: GetScreenshotResult has dataUrl, capturedAt, pageUrl, viewport", () => {
      // BR-F-04
      const result: GetScreenshotResult = {
        dataUrl: "data:image/jpeg;base64,abc",
        capturedAt: 1234567890,
        pageUrl: "https://example.com",
        viewport: { width: 1920, height: 1080 },
      };

      expect(result.viewport.width).toBe(1920);
      expect(result.viewport.height).toBe(1080);
    });

    it("BR-F-04: GetCommentsArgs has required url and optional status/includeDeleted", () => {
      // BR-F-04
      const args: GetCommentsArgs = {
        url: "https://example.com",
        status: "open",
        includeDeleted: false,
      };

      expect(args.url).toBe("https://example.com");
      expect(args.status).toBe("open");
    });

    it("BR-F-04: GetCommentsResult has url, threads, totalThreads, openThreads", () => {
      // BR-F-04
      const result: GetCommentsResult = {
        url: "https://example.com",
        threads: [],
        totalThreads: 0,
        openThreads: 0,
      };

      expect(result.url).toBe("https://example.com");
      expect(Array.isArray(result.threads)).toBe(true);
    });
  });

  describe("Export types", () => {
    it("BR-F-05: ExportPayload has url, exportedAt, threads, optional screenshot", () => {
      // BR-F-05
      const payload: ExportPayload = {
        url: "https://example.com",
        exportedAt: new Date().toISOString(),
        threads: [],
      };

      expect(payload.url).toBe("https://example.com");
      expect(payload.screenshot).toBeUndefined();
    });

    it("BR-F-05: ExportResult has success, optional error, summary string", () => {
      // BR-F-05
      const result: ExportResult = {
        success: true,
        summary: "Copied 3 threads to clipboard",
      };

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(typeof result.summary).toBe("string");
    });

    it("BR-F-05: Exporter interface has readonly name and export method", () => {
      // BR-F-05
      // Verify the interface structure via a conformant object
      const exporter: Exporter = {
        name: "test-exporter",
        export: async (_payload: ExportPayload): Promise<ExportResult> => ({
          success: true,
          summary: "done",
        }),
      };

      expect(exporter.name).toBe("test-exporter");
      expect(typeof exporter.export).toBe("function");
    });
  });

  describe("Module runtime-free check", () => {
    it("BR-F-06: types module exports zero functions or classes (only types/interfaces)", async () => {
      // BR-F-06: The types.ts module should have no runtime exports
      // We verify this by importing the module and checking that
      // no values (only types) are exported at runtime.
      const typesModule = await import("../src/types.js");

      // All exports from types.ts should be undefined at runtime
      // because interfaces and type aliases have no runtime representation
      const runtimeExports = Object.keys(typesModule).filter(
        (key) => typesModule[key as keyof typeof typesModule] !== undefined
      );

      expect(runtimeExports).toHaveLength(0);
    });
  });
});
