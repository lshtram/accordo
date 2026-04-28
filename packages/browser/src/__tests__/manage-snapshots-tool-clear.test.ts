/**
 * manage-snapshots-tool-clear.test.ts
 *
 * Tests for the "clear" action:
 * - clear(pageId) removes only that page
 * - clear() without pageId removes all
 * - clear on non-existent page → clearedCount 0
 * - pageId "" / whitespace → treated as omitted (clear all)
 */

import { describe, it, expect, vi } from "vitest";
import { buildManageSnapshotsTool } from "../manage-snapshots-tool.js";
import { SnapshotRetentionStore as ConcreteStore } from "../snapshot-retention.js";
import type { BrowserRelayLike } from "../types.js";
import type { SnapshotEnvelopeFields } from "../types.js";

function makeEnvelope(pageId: string, version: number): SnapshotEnvelopeFields {
  return {
    pageId, frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: `2025-01-01T00:00:0${version}.000Z`,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom" as const,
  };
}

const mockRelay = {
  request: vi.fn(),
  isConnected: vi.fn(() => false),
} as unknown as BrowserRelayLike;

async function invoke(store: ConcreteStore, args: { action: "clear"; pageId?: string }) {
  const tool = buildManageSnapshotsTool(mockRelay, store);
  return (tool.handler as (a: unknown) => Promise<unknown>)(args);
}

describe("manage-snapshots-tool clear", () => {
  it("GAP-G1: clear(pageId) removes only that page", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p1", makeEnvelope("p1", 2));
    store.save("p2", makeEnvelope("p2", 1));
    const r = await invoke(store, { action: "clear", pageId: "p1" }) as { success: true; clearedPageId: string; clearedCount: number };
    expect(r.success).toBe(true);
    expect(r.clearedPageId).toBe("p1");
    expect(r.clearedCount).toBe(2);
    expect(store.list("p1")).toEqual([]);
    expect(store.list("p2")).toHaveLength(1);
  });

  it("GAP-G1: clear() removes all records", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p2", makeEnvelope("p2", 1));
    const r = await invoke(store, { action: "clear" }) as { success: true; clearedCount: number };
    expect(r.success).toBe(true);
    expect(r.clearedCount).toBe(2);
    expect(store.listAll().size).toBe(0);
  });

  it("GAP-G1: clear(non-existent) → clearedCount 0", async () => {
    const store = new ConcreteStore();
    const r = await invoke(store, { action: "clear", pageId: "nonexistent" }) as { success: true; clearedPageId: string; clearedCount: number };
    expect(r.success).toBe(true);
    expect(r.clearedCount).toBe(0);
    expect(r.clearedPageId).toBe("nonexistent");
  });

  it("GAP-G1: pageId '' behaves as omitted — clears all", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p2", makeEnvelope("p2", 1));
    const r = await invoke(store, { action: "clear", pageId: "" }) as { success: true; clearedCount: number };
    expect(r.success).toBe(true);
    expect(r.clearedCount).toBe(2);
    expect(store.listAll().size).toBe(0);
  });

  it("GAP-G1: pageId whitespace behaves as omitted — clears all", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    const r = await invoke(store, { action: "clear", pageId: "  " }) as { success: true; clearedCount: number };
    expect(r.success).toBe(true);
    expect(r.clearedCount).toBe(1);
  });
});