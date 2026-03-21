/**
 * M80-EXPORT — exporter.test.ts
 *
 * Tests for the Export Layer: ClipboardExporter and formatAsMarkdown.
 * Uses a mock navigator.clipboard to verify clipboard writes.
 *
 * Protects: BR-F-70 through BR-F-75
 *
 * API checklist:
 * ✓ ClipboardExporter (implements Exporter) — 1 structural test (may pass on stub)
 * ✓ ClipboardExporter.export — 7 tests
 * ✓ formatAsMarkdown — 3 tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import type {
  BrowserCommentThread,
  BrowserComment,
  ExportPayload,
  Exporter,
} from "../src/types.js";
import { ClipboardExporter, formatAsMarkdown } from "../src/exporter.js";

// ── Mock navigator.clipboard ─────────────────────────────────────────────────

const writeTextMock = vi.fn((_text: string): Promise<void> => Promise.resolve());

Object.defineProperty(globalThis, "navigator", {
  value: {
    clipboard: {
      writeText: writeTextMock,
    },
  },
  writable: true,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeComment(
  id: string,
  threadId: string,
  overrides: Partial<BrowserComment> = {}
): BrowserComment {
  return {
    id,
    threadId,
    createdAt: "2026-01-01T12:00:00Z",
    author: { kind: "user", name: "Alice" },
    body: `Comment ${id}`,
    anchorKey: "div:0:hello",
    pageUrl: "https://example.com/page",
    status: "open",
    ...overrides,
  };
}

function makeThread(
  id: string,
  commentCount = 1,
  overrides: Partial<BrowserCommentThread> = {}
): BrowserCommentThread {
  const comments: BrowserComment[] = [];
  for (let i = 0; i < commentCount; i++) {
    comments.push(makeComment(`${id}-c${i}`, id));
  }
  return {
    id,
    anchorKey: "div:0:hello",
    pageUrl: "https://example.com/page",
    status: "open",
    comments,
    createdAt: "2026-01-01T10:00:00Z",
    lastActivity: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

function makePayload(
  threads: BrowserCommentThread[],
  url = "https://example.com/page"
): ExportPayload {
  return {
    url,
    exportedAt: "2026-01-01T12:00:00Z",
    threads,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M80-EXPORT — Export Layer", () => {
  beforeEach(() => {
    resetChromeMocks();
    writeTextMock.mockClear();
  });

  describe("ClipboardExporter structural contract", () => {
    it("BR-F-70: ClipboardExporter implements Exporter interface", () => {
      // Structural contract — may pass on stub
      const exporter = new ClipboardExporter();
      expect(exporter.name).toBe("clipboard");
      expect(typeof exporter.export).toBe("function");
      const asInterface: Exporter = exporter;
      expect(asInterface.name).toBe("clipboard");
    });
  });

  describe("ClipboardExporter.export", () => {
    it("BR-F-71: export([]) calls clipboard.writeText with a URL header", async () => {
      // BR-F-71: Empty export still includes URL header in clipboard content
      const exporter = new ClipboardExporter();
      await exporter.export(makePayload([]));
      expect(writeTextMock).toHaveBeenCalledOnce();
      const written = writeTextMock.mock.calls[0][0] as string;
      expect(written).toContain("https://example.com/page");
    });

    it("BR-F-71: export(threads) produces Markdown with each comment body", async () => {
      // BR-F-71: Markdown format includes comment bodies
      const exporter = new ClipboardExporter();
      const threads = [makeThread("t001", 2)];
      await exporter.export(makePayload(threads));
      const written = writeTextMock.mock.calls[0][0] as string;
      expect(written).toContain("Comment t001-c0");
      expect(written).toContain("Comment t001-c1");
    });

    it("BR-F-71: output includes page URL", async () => {
      // BR-F-71: Markdown format includes page URL
      const exporter = new ClipboardExporter();
      await exporter.export(makePayload([], "https://example.com/page"));
      const written = writeTextMock.mock.calls[0][0] as string;
      expect(written).toContain("https://example.com/page");
    });

    it("BR-F-71: output includes each comment author", async () => {
      // BR-F-71: Each comment shows author
      const exporter = new ClipboardExporter();
      const threads = [makeThread("t002", 1)];
      await exporter.export(makePayload(threads));
      const written = writeTextMock.mock.calls[0][0] as string;
      expect(written).toContain("Alice");
    });

    it("BR-F-73: soft-deleted threads are excluded from export", async () => {
      // BR-F-73: Export excludes soft-deleted threads by default
      const exporter = new ClipboardExporter();
      const threads = [
        makeThread("t003"),
        makeThread("t004", 1, { deletedAt: "2026-01-01T11:00:00Z" }),
      ];
      await exporter.export(makePayload(threads));
      const written = writeTextMock.mock.calls[0][0] as string;
      // t003 should appear, t004 (deleted) should NOT
      expect(written).toContain("Comment t003-c0");
      expect(written).not.toContain("Comment t004-c0");
    });

    it("BR-F-73: soft-deleted comments within active threads are excluded", async () => {
      // BR-F-73: Deleted comments excluded from export payload
      const exporter = new ClipboardExporter();
      const thread = makeThread("t005");
      thread.comments.push(
        makeComment("t005-deleted", "t005", {
          deletedAt: "2026-01-01T11:00:00Z",
        })
      );
      await exporter.export(makePayload([thread]));
      const written = writeTextMock.mock.calls[0][0] as string;
      // Active comment appears, deleted comment does not
      expect(written).toContain("Comment t005-c0");
      expect(written).not.toContain("Comment t005-deleted");
    });

    it("BR-F-70: export calls navigator.clipboard.writeText exactly once", async () => {
      // BR-F-70: ClipboardExporter uses navigator.clipboard.writeText
      const exporter = new ClipboardExporter();
      await exporter.export(makePayload([makeThread("t006")]));
      expect(writeTextMock).toHaveBeenCalledOnce();
    });
  });

  describe("formatAsMarkdown", () => {
    it("BR-F-71: includes page URL in output", () => {
      // BR-F-71: Markdown header includes URL
      const md = formatAsMarkdown(makePayload([]));
      expect(md).toContain("https://example.com/page");
    });

    it("BR-F-71: includes thread anchor key as section heading", () => {
      // BR-F-71: Thread anchor description visible in Markdown
      const md = formatAsMarkdown(makePayload([makeThread("t007")]));
      expect(md).toContain("div:0:hello");
    });

    it("BR-F-73: does not include soft-deleted threads in output", () => {
      // BR-F-73: formatAsMarkdown respects soft-delete filter
      const deleted = makeThread("t008", 1, {
        deletedAt: "2026-01-01T00:00:00Z",
      });
      const md = formatAsMarkdown(makePayload([deleted]));
      expect(md).not.toContain("Comment t008-c0");
    });
  });

  describe("JSON export (BR-F-72)", () => {
    it("BR-F-72: clipboard export produces valid JSON when format is explicitly 'json'", async () => {
      // BR-F-72: JSON export option copies ExportPayload as JSON string to clipboard
      const exporter = new ClipboardExporter();
      const threads = [makeThread("t-json")];
      // Explicitly pass "json" format to exercise the JSON code path
      await exporter.export(makePayload(threads), "json");
      const written = writeTextMock.mock.calls[0][0] as string;
      // Must be valid JSON that round-trips through JSON.parse
      expect(() => JSON.parse(written)).not.toThrow();
      const parsed = JSON.parse(written);
      // JSON output must structurally match ExportPayload
      expect(parsed).toHaveProperty("url");
      expect(parsed).toHaveProperty("threads");
      expect(Array.isArray(parsed.threads)).toBe(true);
    });

    it("BR-F-72: JSON format output is different from default Markdown output", async () => {
      // BR-F-72: JSON and Markdown formats produce different clipboard content
      const exporter = new ClipboardExporter();
      const threads = [makeThread("t-diff")];
      await exporter.export(makePayload(threads), "markdown");
      await exporter.export(makePayload(threads), "json");
      const markdownCall = writeTextMock.mock.calls[0][0] as string;
      const jsonCall = writeTextMock.mock.calls[1][0] as string;
      // JSON output starts with "{" (object), Markdown starts with "## " (heading)
      expect(jsonCall.trim().startsWith("{")).toBe(true);
      expect(markdownCall.trim().startsWith("##")).toBe(true);
      expect(jsonCall).not.toBe(markdownCall);
    });
  });
});
