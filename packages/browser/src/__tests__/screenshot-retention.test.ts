/**
 * screenshot-retention.test.ts
 *
 * Tests for M100-SCREEN — Screenshot Retention Store (browser package)
 *
 * Validates:
 * - ScreenshotRetentionStore: save/getLatest/list/get/resetOnNavigation semantics
 * - 10-slot FIFO eviction per page
 * - handleCaptureRegion wiring: file-ref transport saves ScreenshotRecord
 * - handleCaptureRegion wiring: inline transport does NOT save ScreenshotRecord
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ScreenshotRetentionStore,
  SCREENSHOT_RETENTION_SLOTS,
  type ScreenshotRecord,
} from "../screenshot-retention.js";
import { handleCaptureRegion } from "../page-understanding-tools.js";
import type { SnapshotEnvelopeFields } from "../types.js";

// ── In-memory fs mock (shared across tests) ───────────────────────────────────

const sharedFsState = new Map<string, string>();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    __esModule: true,
    existsSync: vi.fn((filePath: string) => sharedFsState.has(filePath)),
    readFileSync: vi.fn((filePath: string, _encoding: BufferEncoding = "utf-8") => {
      const content = sharedFsState.get(filePath);
      if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return content;
    }),
    writeFileSync: vi.fn((filePath: string, data: string | Buffer) => {
      sharedFsState.set(filePath, String(data));
    }),
    mkdirSync: vi.fn(() => {
      // in-memory: directories always exist
    }),
    unlinkSync: vi.fn((filePath: string) => {
      sharedFsState.delete(filePath);
    }),
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(pageId: string, version: number): SnapshotEnvelopeFields {
  return {
    pageId,
    frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: `2025-01-01T00:00:0${version}.000Z`,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "visual" as const,
  };
}

function makeRecord(pageId: string, screenshotId: string, width = 100, height = 100): ScreenshotRecord {
  return {
    screenshotId,
    pageId,
    filePath: `/tmp/accordo-screenshots/${screenshotId}.jpeg`,
    fileUri: `file:///tmp/accordo-screenshots/${screenshotId}.jpeg`,
    capturedAt: new Date().toISOString(),
    sizeBytes: 1000,
    format: "jpeg",
    width,
    height,
  };
}

function createMockRelay(overrides?: {
  data?: Record<string, unknown>;
  success?: boolean;
}) {
  const defaultData = {
    ...makeEnvelope("page-001", 1),
    pageUrl: "https://example.com",
    success: true,
    dataUrl: "data:image/jpeg;base64,A==",
    width: 100,
    height: 100,
    sizeBytes: 1000,
  };

  return {
    request: vi.fn().mockResolvedValue({
      requestId: "r1",
      success: overrides?.success ?? true,
      data: overrides?.data ?? defaultData,
    }),
    isConnected: vi.fn(() => true),
  };
}

// ── ScreenshotRetentionStore unit tests ─────────────────────────────────────

describe("ScreenshotRetentionStore", () => {
  beforeEach(() => {
    sharedFsState.clear();
  });

  it("GAP-G1: saves and retrieves the latest screenshot record for a page", () => {
    const store = new ScreenshotRetentionStore();
    const rec = makeRecord("p1", "scr-001");
    store.save("p1", rec);
    expect(store.getLatest("p1")).toEqual(rec);
  });

  it("GAP-G1: getLatest returns undefined for unknown pageId", () => {
    const store = new ScreenshotRetentionStore();
    expect(store.getLatest("unknown")).toBeUndefined();
  });

  it("GAP-G1: list returns all saved records oldest-first", () => {
    const store = new ScreenshotRetentionStore();
    const r1 = makeRecord("p1", "scr-001");
    const r2 = makeRecord("p1", "scr-002");
    store.save("p1", r1);
    store.save("p1", r2);
    expect(store.list("p1")).toEqual([r1, r2]);
  });

  it("GAP-G1: list returns empty array for unknown pageId", () => {
    const store = new ScreenshotRetentionStore();
    expect(store.list("unknown")).toEqual([]);
  });

  it("GAP-G1: get retrieves record by screenshotId across pages", () => {
    const store = new ScreenshotRetentionStore();
    const r1 = makeRecord("p1", "scr-p1-001");
    const r2 = makeRecord("p2", "scr-p2-001");
    store.save("p1", r1);
    store.save("p2", r2);
    expect(store.get("scr-p1-001")).toEqual(r1);
    expect(store.get("scr-p2-001")).toEqual(r2);
  });

  it("GAP-G1: get returns undefined for unknown screenshotId", () => {
    const store = new ScreenshotRetentionStore();
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("GAP-G1: resetOnNavigation removes all records for page and does not affect other pages", () => {
    const store = new ScreenshotRetentionStore();
    store.save("p1", makeRecord("p1", "scr-001"));
    store.save("p1", makeRecord("p1", "scr-002"));
    store.save("p2", makeRecord("p2", "scr-003"));
    store.resetOnNavigation("p1");
    expect(store.list("p1")).toEqual([]);
    expect(store.list("p2")).toHaveLength(1);
  });

  it("GAP-G1: clear(pageId) removes all records for that page", () => {
    const store = new ScreenshotRetentionStore();
    store.save("p1", makeRecord("p1", "scr-001"));
    store.save("p1", makeRecord("p1", "scr-002"));
    store.save("p2", makeRecord("p2", "scr-003"));
    store.clear("p1");
    expect(store.list("p1")).toEqual([]);
    expect(store.list("p2")).toHaveLength(1);
  });

  it("GAP-G1: clear() without args removes all records across all pages", () => {
    const store = new ScreenshotRetentionStore();
    store.save("p1", makeRecord("p1", "scr-001"));
    store.save("p2", makeRecord("p2", "scr-002"));
    store.clear();
    expect(store.listAll().size).toBe(0);
  });

  it("GAP-G1: listAll returns all pages and records", () => {
    const store = new ScreenshotRetentionStore();
    store.save("p1", makeRecord("p1", "scr-001"));
    store.save("p2", makeRecord("p2", "scr-002"));
    const all = store.listAll();
    expect(all.size).toBe(2);
    expect(all.get("p1")).toHaveLength(1);
    expect(all.get("p2")).toHaveLength(1);
  });

  it(`GAP-G1: FIFO eviction after ${SCREENSHOT_RETENTION_SLOTS} saves — oldest is evicted`, () => {
    const store = new ScreenshotRetentionStore();
    for (let i = 1; i <= SCREENSHOT_RETENTION_SLOTS + 3; i++) {
      store.save("p1", makeRecord("p1", `scr-${String(i).padStart(3, "0")}`));
    }
    const slots = store.list("p1");
    expect(slots).toHaveLength(SCREENSHOT_RETENTION_SLOTS);
    // Oldest 3 should have been evicted
    expect(slots[0].screenshotId).toBe("scr-004");
    expect(slots[slots.length - 1].screenshotId).toBe("scr-013");
  });

  it("GAP-G1: per-page FIFO — p1 eviction does not affect p2", () => {
    const store = new ScreenshotRetentionStore();
    // Fill p1 past the slot limit
    for (let i = 1; i <= SCREENSHOT_RETENTION_SLOTS + 2; i++) {
      store.save("p1", makeRecord("p1", `p1-scr-${i}`));
    }
    // p2 stays small
    store.save("p2", makeRecord("p2", "p2-scr-001"));
    store.save("p2", makeRecord("p2", "p2-scr-002"));

    expect(store.list("p1")).toHaveLength(SCREENSHOT_RETENTION_SLOTS);
    expect(store.list("p2")).toHaveLength(2);
    // p1's oldest should have been evicted
    expect(store.get("p1-scr-001")).toBeUndefined();
    // p2's records should still exist
    expect(store.get("p2-scr-001")).toBeDefined();
  });
});

// ── handleCaptureRegion screenshotStore wiring ─────────────────────────────────

describe("handleCaptureRegion screenshot retention wiring", () => {
  beforeEach(() => {
    sharedFsState.clear();
  });

  it("GAP-G1: file-ref transport saves ScreenshotRecord to screenshotStore", async () => {
    const relay = createMockRelay();
    const store = new ScreenshotRetentionStore(); // SnapshotRetentionStore
    const screenshotStore = new ScreenshotRetentionStore();

    const result = await handleCaptureRegion(
      relay,
      { transport: "file-ref", format: "jpeg" },
      store,
      undefined,
      screenshotStore,
    ) as Record<string, unknown>;

    expect(result.artifactMode).toBe("file-ref");
    expect(screenshotStore.listAll().size).toBeGreaterThan(0);
    // The record should be for the page in the relay response
    const records = screenshotStore.list("page-001");
    expect(records.length).toBeGreaterThan(0);
    expect(records[records.length - 1]).toMatchObject({
      format: "jpeg",
      width: 100,
      height: 100,
      sizeBytes: 1000,
    });
  });

  it("GAP-G1: inline transport does NOT save ScreenshotRecord", async () => {
    const relay = createMockRelay();
    const store = new ScreenshotRetentionStore();
    const screenshotStore = new ScreenshotRetentionStore();

    const result = await handleCaptureRegion(
      relay,
      { transport: "inline" },
      store,
      undefined,
      screenshotStore,
    ) as Record<string, unknown>;

    expect(result.artifactMode).toBe("inline");
    expect(screenshotStore.listAll().size).toBe(0);
  });

  it("GAP-G1: handleCaptureRegion works when screenshotStore is not provided (backward compat)", async () => {
    const relay = createMockRelay();
    const store = new ScreenshotRetentionStore();

    // Should not throw — screenshotStore is optional
    const result = await handleCaptureRegion(
      relay,
      { transport: "file-ref" },
      store,
      undefined,
      // screenshotStore intentionally omitted
    );

    expect(result).toBeDefined();
  });
});
