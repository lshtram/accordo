/**
 * manage-screenshots-tool.test.ts
 *
 * Tests for GAP-G1 — manage_screenshots MCP Tool (browser package)
 *
 * Validates:
 * - buildManageScreenshotsTool: correct tool name, inputSchema, handler
 * - "list" action: returns all pages with screenshot metadata
 * - "clear" action: removes records and returns clearedCount
 * - clear with pageId: only clears that page
 * - clear without pageId: clears all pages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildManageScreenshotsTool,
  type ManageScreenshotsArgs,
  type ManageScreenshotsListResponse,
  type ManageScreenshotsClearResponse,
} from "../manage-screenshots-tool.js";
import type { ScreenshotRetentionStore } from "../screenshot-retention.js";
import { ScreenshotRetentionStore as ConcreteStore } from "../screenshot-retention.js";
import type { BrowserRelayLike } from "../types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRecord(pageId: string, screenshotId: string, format = "jpeg"): {
  screenshotId: string;
  pageId: string;
  filePath: string;
  fileUri: string;
  capturedAt: string;
  sizeBytes: number;
  format: string;
  width: number;
  height: number;
} {
  return {
    screenshotId,
    pageId,
    filePath: `/tmp/accordo-screenshots/${screenshotId}.${format}`,
    fileUri: `file:///tmp/accordo-screenshots/${screenshotId}.${format}`,
    capturedAt: new Date().toISOString(),
    sizeBytes: 1000,
    format,
    width: 100,
    height: 100,
  };
}

function createMockRelay() {
  return {
    request: vi.fn(),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

async function invokeTool(
  relay: BrowserRelayLike,
  store: ScreenshotRetentionStore,
  args: ManageScreenshotsArgs,
) {
  const tool = buildManageScreenshotsTool(relay, store);
  return (tool.handler as (args: ManageScreenshotsArgs) => Promise<unknown>)(args);
}

// ── Tool Registration ──────────────────────────────────────────────────────────

describe("manage-screenshots-tool registration", () => {
  it("GAP-G1: tool has correct name", () => {
    const store = new ConcreteStore();
    const tool = buildManageScreenshotsTool(createMockRelay(), store);
    expect(tool.name).toBe("accordo_browser_manage_screenshots");
  });

  it("GAP-G1: tool description mentions list and clear actions", () => {
    const store = new ConcreteStore();
    const tool = buildManageScreenshotsTool(createMockRelay(), store);
    expect(tool.description).toContain("list");
    expect(tool.description).toContain("clear");
  });

  it("GAP-G1: tool inputSchema requires action", () => {
    const store = new ConcreteStore();
    const tool = buildManageScreenshotsTool(createMockRelay(), store);
    expect(tool.inputSchema.required).toContain("action");
  });

  it("GAP-G1: tool inputSchema.action is enum [list, clear]", () => {
    const store = new ConcreteStore();
    const tool = buildManageScreenshotsTool(createMockRelay(), store);
    expect(tool.inputSchema.properties.action.enum).toEqual(["list", "clear"]);
  });

  it("GAP-G1: tool inputSchema.pageId is optional string", () => {
    const store = new ConcreteStore();
    const tool = buildManageScreenshotsTool(createMockRelay(), store);
    expect(tool.inputSchema.properties.pageId.type).toBe("string");
    expect(tool.inputSchema.required).not.toContain("pageId");
  });

  it("GAP-G1: dangerLevel is safe", () => {
    const store = new ConcreteStore();
    const tool = buildManageScreenshotsTool(createMockRelay(), store);
    expect(tool.dangerLevel).toBe("safe");
  });

  it("GAP-G1: idempotent is false (clear is destructive)", () => {
    const store = new ConcreteStore();
    const tool = buildManageScreenshotsTool(createMockRelay(), store);
    expect(tool.idempotent).toBe(false);
  });
});

// ── list action ───────────────────────────────────────────────────────────────

describe("manage-screenshots-tool list action", () => {
  it("GAP-G1: list returns empty pages array when store is empty", async () => {
    const store = new ConcreteStore();
    const relay = createMockRelay();
    const result = await invokeTool(relay, store, { action: "list" }) as ManageScreenshotsListResponse;
    expect(result.pages).toEqual([]);
  });

  it("GAP-G1: list returns all pages and screenshot metadata", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeRecord("p1", "scr-p1-001"));
    store.save("p1", makeRecord("p1", "scr-p1-002"));
    store.save("p2", makeRecord("p2", "scr-p2-001"));

    const relay = createMockRelay();
    const result = await invokeTool(relay, store, { action: "list" }) as ManageScreenshotsListResponse;

    expect(result.pages.length).toBe(2);

    const p1Page = result.pages.find((p) => p.pageId === "p1")!;
    expect(p1Page.screenshotCount).toBe(2);
    expect(p1Page.screenshots[0].screenshotId).toBe("scr-p1-001");
    expect(p1Page.screenshots[1].screenshotId).toBe("scr-p1-002");

    const p2Page = result.pages.find((p) => p.pageId === "p2")!;
    expect(p2Page.screenshotCount).toBe(1);
  });

  it("GAP-G1: list returns screenshot metadata fields", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeRecord("p1", "scr-001", "png"));

    const relay = createMockRelay();
    const result = await invokeTool(relay, store, { action: "list" }) as ManageScreenshotsListResponse;

    const screenshot = result.pages[0].screenshots[0];
    expect(screenshot).toMatchObject({
      screenshotId: "scr-001",
      format: "png",
      width: 100,
      height: 100,
      sizeBytes: 1000,
    });
    expect(typeof screenshot.filePath).toBe("string");
    expect(typeof screenshot.capturedAt).toBe("string");
  });
});

// ── clear action ─────────────────────────────────────────────────────────────

describe("manage-screenshots-tool clear action", () => {
  it("GAP-G1: clear(pageId) removes records for that page only", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeRecord("p1", "scr-001"));
    store.save("p1", makeRecord("p1", "scr-002"));
    store.save("p2", makeRecord("p2", "scr-003"));

    const relay = createMockRelay();
    const result = await invokeTool(relay, store, { action: "clear", pageId: "p1" }) as ManageScreenshotsClearResponse;

    expect(result.success).toBe(true);
    expect(result.clearedPageId).toBe("p1");
    expect(result.clearedCount).toBe(2);
    expect(store.list("p1")).toEqual([]);
    expect(store.list("p2")).toHaveLength(1);
  });

  it("GAP-G1: clear() without pageId removes all records", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeRecord("p1", "scr-001"));
    store.save("p2", makeRecord("p2", "scr-002"));

    const relay = createMockRelay();
    const result = await invokeTool(relay, store, { action: "clear" }) as ManageScreenshotsClearResponse;

    expect(result.success).toBe(true);
    expect(result.clearedCount).toBe(2);
    expect(store.listAll().size).toBe(0);
  });

  it("GAP-G1: clear(pageId) on empty/empty page returns clearedCount 0", async () => {
    const store = new ConcreteStore();

    const relay = createMockRelay();
    const result = await invokeTool(relay, store, { action: "clear", pageId: "nonexistent" }) as ManageScreenshotsClearResponse;

    expect(result.success).toBe(true);
    expect(result.clearedCount).toBe(0);
  });
});
