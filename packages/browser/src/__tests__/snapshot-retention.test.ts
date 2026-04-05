/**
 * snapshot-retention.test.ts
 *
 * Tests for M100-SNAP — B2-SV-004 snapshot retention wiring.
 *
 * Validates:
 * - SnapshotRetentionStore: save/getLatest/list/get/resetOnNavigation semantics
 * - 5-slot FIFO eviction per page
 * - All 4 data-producing handlers (handleGetPageMap, handleInspectElement,
 *   handleGetDomExcerpt, handleCaptureRegion) persist envelopes into the store
 *   on success
 * - Error responses are NOT persisted
 * - All 4 paths share the same store instance (coherent wiring)
 */

import { describe, it, expect, vi } from "vitest";
import { SnapshotRetentionStore, RETENTION_SLOTS } from "../snapshot-retention.js";
import {
  handleGetPageMap,
  handleInspectElement,
  handleGetDomExcerpt,
  handleCaptureRegion,
} from "../page-understanding-tools.js";
import type { SnapshotEnvelopeFields } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnvelope(pageId: string, version: number): SnapshotEnvelopeFields {
  return {
    pageId,
    frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: `2025-01-01T00:00:0${version}.000Z`,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom" as const,
  };
}

function createMockRelay(overrides?: {
  action?: string;
  data?: Record<string, unknown>;
  success?: boolean;
}) {
  const defaultData = {
    ...makeEnvelope("page-001", 1),
    pageUrl: "https://example.com",
    title: "Test",
    nodes: [],
    totalElements: 0,
    depth: 0,
    truncated: false,
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

// ── SnapshotRetentionStore unit tests ─────────────────────────────────────────

describe("SnapshotRetentionStore", () => {
  it("B2-SV-004: saves and retrieves the latest envelope for a page", () => {
    const store = new SnapshotRetentionStore();
    const env = makeEnvelope("p1", 1);
    store.save("p1", env);
    expect(store.getLatest("p1")).toEqual(env);
  });

  it("B2-SV-004: getLatest returns undefined for unknown pageId", () => {
    const store = new SnapshotRetentionStore();
    expect(store.getLatest("unknown")).toBeUndefined();
  });

  it("B2-SV-004: list returns all saved envelopes oldest-first", () => {
    const store = new SnapshotRetentionStore();
    const e1 = makeEnvelope("p1", 1);
    const e2 = makeEnvelope("p1", 2);
    store.save("p1", e1);
    store.save("p1", e2);
    expect(store.list("p1")).toEqual([e1, e2]);
  });

  it("B2-SV-004: list returns empty array for unknown pageId", () => {
    const store = new SnapshotRetentionStore();
    expect(store.list("unknown")).toEqual([]);
  });

  it("B2-SV-004: get retrieves envelope by snapshotId across pages", () => {
    const store = new SnapshotRetentionStore();
    const e1 = makeEnvelope("p1", 1);
    const e2 = makeEnvelope("p2", 1);
    store.save("p1", e1);
    store.save("p2", e2);
    expect(store.get("p1:1")).toEqual(e1);
    expect(store.get("p2:1")).toEqual(e2);
  });

  it("B2-SV-004: get returns undefined for unknown snapshotId", () => {
    const store = new SnapshotRetentionStore();
    expect(store.get("nope:9")).toBeUndefined();
  });

  it(`B2-SV-004: FIFO eviction — retains exactly ${RETENTION_SLOTS} slots per page`, () => {
    const store = new SnapshotRetentionStore();
    for (let i = 1; i <= RETENTION_SLOTS + 1; i++) {
      store.save("p1", makeEnvelope("p1", i));
    }
    const retained = store.list("p1");
    expect(retained).toHaveLength(RETENTION_SLOTS);
    // Oldest (version 1) was evicted; newest (version RETENTION_SLOTS+1) is present
    expect(retained[0].snapshotId).toBe("p1:2");
    expect(retained[RETENTION_SLOTS - 1].snapshotId).toBe(`p1:${RETENTION_SLOTS + 1}`);
  });

  it("B2-SV-004: eviction is per-page — does not affect other pages", () => {
    const store = new SnapshotRetentionStore();
    for (let i = 1; i <= RETENTION_SLOTS + 2; i++) {
      store.save("p1", makeEnvelope("p1", i));
    }
    store.save("p2", makeEnvelope("p2", 1));
    expect(store.list("p2")).toHaveLength(1);
    expect(store.list("p1")).toHaveLength(RETENTION_SLOTS);
  });

  it("B2-SV-004: resetOnNavigation clears all slots for that page only", () => {
    const store = new SnapshotRetentionStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p2", makeEnvelope("p2", 1));
    store.resetOnNavigation("p1");
    expect(store.list("p1")).toEqual([]);
    expect(store.list("p2")).toHaveLength(1);
  });

  it("B2-SV-004: clear removes all pages", () => {
    const store = new SnapshotRetentionStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p2", makeEnvelope("p2", 1));
    store.clear();
    expect(store.list("p1")).toEqual([]);
    expect(store.list("p2")).toEqual([]);
  });
});

// ── GAP-G1: Retention control — increased slots + listAll + clear overload ────

describe("GAP-G1: SnapshotRetentionStore retention control", () => {
  it("GAP-G1: RETENTION_SLOTS equals 10", () => {
    expect(RETENTION_SLOTS).toBe(10);
  });

  it("GAP-G1: listAll returns all pages with their snapshots", () => {
    const store = new SnapshotRetentionStore();
    store.save("page-a", makeEnvelope("page-a", 1));
    store.save("page-a", makeEnvelope("page-a", 2));
    store.save("page-b", makeEnvelope("page-b", 1));

    const all = store.listAll();
    expect(all.size).toBe(2);
    expect(all.get("page-a")?.length).toBe(2);
    expect(all.get("page-b")?.length).toBe(1);
  });

  it("GAP-G1: listAll returns empty Map when store is empty", () => {
    const store = new SnapshotRetentionStore();
    const all = store.listAll();
    expect(all.size).toBe(0);
  });

  it("GAP-G1: clear(pageId) removes only that page", () => {
    const store = new SnapshotRetentionStore();
    store.save("page-a", makeEnvelope("page-a", 1));
    store.save("page-b", makeEnvelope("page-b", 1));

    store.clear("page-a");

    expect(store.list("page-a")).toEqual([]);
    expect(store.list("page-b")).toHaveLength(1);
  });

  it("GAP-G1: clear() without pageId removes all pages", () => {
    const store = new SnapshotRetentionStore();
    store.save("page-a", makeEnvelope("page-a", 1));
    store.save("page-b", makeEnvelope("page-b", 1));

    store.clear();

    expect(store.list("page-a")).toEqual([]);
    expect(store.list("page-b")).toEqual([]);
  });

  it("GAP-G1: clear(pageId) on non-existent page is a no-op", () => {
    const store = new SnapshotRetentionStore();
    store.save("page-a", makeEnvelope("page-a", 1));

    store.clear("page-nonexistent");

    expect(store.list("page-a")).toHaveLength(1);
  });
});

// ── GAP-G1: buildManageSnapshotsTool ─────────────────────────────────────────

describe("GAP-G1: buildManageSnapshotsTool", () => {
  it("GAP-G1: tool name is browser_manage_snapshots", async () => {
    const { buildManageSnapshotsTool } = await import("../manage-snapshots-tool.js");
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: vi.fn(() => true) };
    const tool = buildManageSnapshotsTool(relay as never, store);
    expect(tool.name).toBe("browser_manage_snapshots");
  });

  it("GAP-G1: tool has action and pageId in inputSchema", async () => {
    const { buildManageSnapshotsTool } = await import("../manage-snapshots-tool.js");
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: vi.fn(() => true) };
    const tool = buildManageSnapshotsTool(relay as never, store);
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties).toHaveProperty("action");
    expect(schema.properties).toHaveProperty("pageId");
    expect(schema.required).toContain("action");
  });

  it("GAP-G1: list action returns all snapshot metadata per page", async () => {
    const { buildManageSnapshotsTool } = await import("../manage-snapshots-tool.js");
    const store = new SnapshotRetentionStore();
    store.save("page-a", makeEnvelope("page-a", 1));
    store.save("page-a", makeEnvelope("page-a", 2));
    store.save("page-b", makeEnvelope("page-b", 1));

    const relay = { request: vi.fn(), isConnected: vi.fn(() => true) };
    const tool = buildManageSnapshotsTool(relay as never, store);
    const handler = tool.handler as (args: unknown) => Promise<unknown>;

    const result = await handler({ action: "list" });
    const r = result as { pages: { pageId: string; snapshotCount: number }[] };
    expect(r.pages).toHaveLength(2);
    const pageA = r.pages.find((p) => p.pageId === "page-a");
    expect(pageA?.snapshotCount).toBe(2);
    const pageB = r.pages.find((p) => p.pageId === "page-b");
    expect(pageB?.snapshotCount).toBe(1);
  });

  it("GAP-G1: clear action without pageId empties the entire store", async () => {
    const { buildManageSnapshotsTool } = await import("../manage-snapshots-tool.js");
    const store = new SnapshotRetentionStore();
    store.save("page-a", makeEnvelope("page-a", 1));
    store.save("page-b", makeEnvelope("page-b", 1));

    const relay = { request: vi.fn(), isConnected: vi.fn(() => true) };
    const tool = buildManageSnapshotsTool(relay as never, store);
    const handler = tool.handler as (args: unknown) => Promise<unknown>;

    const result = await handler({ action: "clear" });
    const r = result as { success: boolean; clearedCount: number };
    expect(r.success).toBe(true);
    expect(r.clearedCount).toBe(2);
    expect(store.list("page-a")).toEqual([]);
    expect(store.list("page-b")).toEqual([]);
  });

  it("GAP-G1: clear action with pageId removes only that page", async () => {
    const { buildManageSnapshotsTool } = await import("../manage-snapshots-tool.js");
    const store = new SnapshotRetentionStore();
    store.save("page-a", makeEnvelope("page-a", 1));
    store.save("page-b", makeEnvelope("page-b", 1));

    const relay = { request: vi.fn(), isConnected: vi.fn(() => true) };
    const tool = buildManageSnapshotsTool(relay as never, store);
    const handler = tool.handler as (args: unknown) => Promise<unknown>;

    const result = await handler({ action: "clear", pageId: "page-a" });
    const r = result as { success: boolean; clearedPageId: string; clearedCount: number };
    expect(r.success).toBe(true);
    expect(r.clearedPageId).toBe("page-a");
    expect(r.clearedCount).toBe(1);
    expect(store.list("page-a")).toEqual([]);
    expect(store.list("page-b")).toHaveLength(1);
  });

  it("GAP-G1: tool is registered with dangerLevel 'safe' and non-idempotent", async () => {
    const { buildManageSnapshotsTool } = await import("../manage-snapshots-tool.js");
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: vi.fn(() => true) };
    const tool = buildManageSnapshotsTool(relay as never, store);
    expect(tool.dangerLevel).toBe("safe");
    expect(tool.idempotent).toBe(false);
  });
});

// ── Handler wiring tests ──────────────────────────────────────────────────────

describe("B2-SV-004: handleGetPageMap persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    const relay = createMockRelay();
    await handleGetPageMap(relay, {}, store);
    expect(store.getLatest("page-001")).toBeDefined();
    expect(store.getLatest("page-001")?.pageId).toBe("page-001");
  });

  it("does NOT save to store on relay failure (success=false)", async () => {
    const store = new SnapshotRetentionStore();
    const relay = createMockRelay({ success: false, data: {} });
    await handleGetPageMap(relay, {}, store);
    expect(store.list("page-001")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn(),
      isConnected: vi.fn(() => false),
    };
    await handleGetPageMap(relay, {}, store);
    expect(store.list("page-001")).toHaveLength(0);
  });

  it("does NOT save to store on relay exception", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn().mockRejectedValue(new Error("timeout")),
      isConnected: vi.fn(() => true),
    };
    await handleGetPageMap(relay, {}, store);
    expect(store.list("page-001")).toHaveLength(0);
  });
});

describe("B2-SV-004: handleInspectElement persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn().mockResolvedValue({
        requestId: "r1",
        success: true,
        data: {
          ...makeEnvelope("page-002", 1),
          found: true,
          anchorKey: "id:main",
          anchorStrategy: "id",
          anchorConfidence: "high",
        },
      }),
      isConnected: vi.fn(() => true),
    };
    await handleInspectElement(relay, { selector: "#main" }, store);
    expect(store.getLatest("page-002")?.pageId).toBe("page-002");
  });

  it("does NOT save to store on relay failure", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn().mockResolvedValue({ requestId: "r1", success: false, data: {} }),
      isConnected: vi.fn(() => true),
    };
    await handleInspectElement(relay, { selector: "#main" }, store);
    expect(store.list("page-002")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: vi.fn(() => false) };
    await handleInspectElement(relay, { selector: "#main" }, store);
    expect(store.list("page-002")).toHaveLength(0);
  });
});

describe("B2-SV-004: handleGetDomExcerpt persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn().mockResolvedValue({
        requestId: "r1",
        success: true,
        data: {
          ...makeEnvelope("page-003", 1),
          found: true,
          html: "<div>Hello</div>",
          text: "Hello",
          nodeCount: 1,
          truncated: false,
        },
      }),
      isConnected: vi.fn(() => true),
    };
    await handleGetDomExcerpt(relay, { selector: "div" }, store);
    expect(store.getLatest("page-003")?.pageId).toBe("page-003");
  });

  it("does NOT save to store on relay failure", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn().mockResolvedValue({ requestId: "r1", success: false, data: {} }),
      isConnected: vi.fn(() => true),
    };
    await handleGetDomExcerpt(relay, { selector: "div" }, store);
    expect(store.list("page-003")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: vi.fn(() => false) };
    await handleGetDomExcerpt(relay, { selector: "div" }, store);
    expect(store.list("page-003")).toHaveLength(0);
  });
});

describe("B2-SV-004: handleCaptureRegion persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn().mockResolvedValue({
        requestId: "r1",
        success: true,
        data: {
          ...makeEnvelope("page-004", 1),
          source: "visual" as const,
          success: true,
          dataUrl: "data:image/jpeg;base64,/9j/4A==",
          width: 200,
          height: 150,
          sizeBytes: 4096,
        },
      }),
      isConnected: vi.fn(() => true),
    };
    await handleCaptureRegion(relay, { anchorKey: "id:btn" }, store);
    expect(store.getLatest("page-004")?.pageId).toBe("page-004");
  });

  it("does NOT save to store on relay failure", async () => {
    const store = new SnapshotRetentionStore();
    const relay = {
      request: vi.fn().mockResolvedValue({ requestId: "r1", success: false, data: {} }),
      isConnected: vi.fn(() => true),
    };
    await handleCaptureRegion(relay, { anchorKey: "id:btn" }, store);
    expect(store.list("page-004")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: vi.fn(() => false) };
    await handleCaptureRegion(relay, { anchorKey: "id:btn" }, store);
    expect(store.list("page-004")).toHaveLength(0);
  });
});

describe("B2-SV-004: shared store — all 4 paths use coherent per-page retention", () => {
  it("all 4 handlers write to the same store instance", async () => {
    const store = new SnapshotRetentionStore();

    const pageMapRelay = {
      request: vi.fn().mockResolvedValue({
        requestId: "r1", success: true,
        data: { ...makeEnvelope("shared-page", 1), pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, depth: 0, truncated: false },
      }),
      isConnected: vi.fn(() => true),
    };
    const inspectRelay = {
      request: vi.fn().mockResolvedValue({
        requestId: "r2", success: true,
        data: { ...makeEnvelope("shared-page", 2), found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" },
      }),
      isConnected: vi.fn(() => true),
    };
    const excerptRelay = {
      request: vi.fn().mockResolvedValue({
        requestId: "r3", success: true,
        data: { ...makeEnvelope("shared-page", 3), found: true, html: "<div/>", text: "", nodeCount: 1, truncated: false },
      }),
      isConnected: vi.fn(() => true),
    };
    const captureRelay = {
      request: vi.fn().mockResolvedValue({
        requestId: "r4", success: true,
        data: { ...makeEnvelope("shared-page", 4), source: "visual" as const, success: true, dataUrl: "data:image/jpeg;base64,A==", width: 10, height: 10, sizeBytes: 100 },
      }),
      isConnected: vi.fn(() => true),
    };

    await handleGetPageMap(pageMapRelay, {}, store);
    await handleInspectElement(inspectRelay, { selector: "#x" }, store);
    await handleGetDomExcerpt(excerptRelay, { selector: "div" }, store);
    await handleCaptureRegion(captureRelay, { anchorKey: "id:x" }, store);

    // All 4 envelopes should be in the store for "shared-page"
    const retained = store.list("shared-page");
    expect(retained).toHaveLength(4);
    expect(retained.map((e) => e.snapshotId)).toEqual([
      "shared-page:1",
      "shared-page:2",
      "shared-page:3",
      "shared-page:4",
    ]);
  });

  it("5-slot FIFO eviction applies across all 4 handler paths on the same page", async () => {
    const store = new SnapshotRetentionStore();
    const pageId = "eviction-page";

    // Helper to build a relay that returns a given version's envelope.
    const makeVersionRelay = (version: number, extraFields: Record<string, unknown>) => ({
      request: vi.fn().mockResolvedValue({
        requestId: `r${version}`, success: true,
        data: { ...makeEnvelope(pageId, version), ...extraFields },
      }),
      isConnected: vi.fn(() => true),
    });

    // Call 11 times across the 4 paths — version 1 must be evicted (FIFO with 10 slots)
    await handleGetPageMap(makeVersionRelay(1, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, depth: 0, truncated: false }), {}, store);
    await handleInspectElement(makeVersionRelay(2, { found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" }), {}, store);
    await handleGetDomExcerpt(makeVersionRelay(3, { found: true, html: "<div/>", text: "", nodeCount: 1, truncated: false }), { selector: "div" }, store);
    await handleCaptureRegion(makeVersionRelay(4, { source: "visual" as const, success: true, dataUrl: "data:image/jpeg;base64,A==", width: 10, height: 10, sizeBytes: 100 }), {}, store);
    await handleGetPageMap(makeVersionRelay(5, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, depth: 0, truncated: false }), {}, store);
    await handleInspectElement(makeVersionRelay(6, { found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" }), {}, store);
    await handleGetDomExcerpt(makeVersionRelay(7, { found: true, html: "<div/>", text: "", nodeCount: 1, truncated: false }), { selector: "div" }, store);
    await handleCaptureRegion(makeVersionRelay(8, { source: "visual" as const, success: true, dataUrl: "data:image/jpeg;base64,A==", width: 10, height: 10, sizeBytes: 100 }), {}, store);
    await handleGetPageMap(makeVersionRelay(9, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, depth: 0, truncated: false }), {}, store);
    await handleInspectElement(makeVersionRelay(10, { found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" }), {}, store);
    await handleGetPageMap(makeVersionRelay(11, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, depth: 0, truncated: false }), {}, store);

    const retained = store.list(pageId);
    expect(retained).toHaveLength(RETENTION_SLOTS); // exactly 10 (GAP-G1)
    // version 1 evicted; versions 2–11 retained
    expect(retained[0].snapshotId).toBe(`${pageId}:2`);
    expect(retained[RETENTION_SLOTS - 1].snapshotId).toBe(`${pageId}:11`);
    // version 1 is gone
    expect(store.get(`${pageId}:1`)).toBeUndefined();
  });
});
