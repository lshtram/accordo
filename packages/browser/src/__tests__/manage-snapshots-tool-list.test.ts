/**
 * manage-snapshots-tool-list.test.ts
 *
 * Tests for the "list" action:
 * - empty store → pages: []
 * - returns all pages with snapshot metadata (no heavy payload fields)
 * - with pageId filter → only that page; non-existent → pages: []
 * - pageId "" / whitespace → treated as omitted (all pages)
 */

import { describe, it, expect, vi } from "vitest";
import { buildManageSnapshotsTool } from "../manage-snapshots-tool.js";
import { SnapshotRetentionStore as ConcreteStore } from "../snapshot-retention.js";
import type { BrowserRelayLike } from "../types.js";
import type { SnapshotEnvelopeFields } from "../types.js";

function makeEnvelope(pageId: string, version: number, frameId = "main"): SnapshotEnvelopeFields {
  return {
    pageId, frameId,
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

async function invoke(store: ConcreteStore, args: { action: "list"; pageId?: string }) {
  const tool = buildManageSnapshotsTool(mockRelay, store);
  return (tool.handler as (a: unknown) => Promise<unknown>)(args);
}

describe("manage-snapshots-tool list", () => {
  it("GAP-G1: empty store → pages: []", async () => {
    const r = await invoke(new ConcreteStore(), { action: "list" }) as { pages: unknown[] };
    expect(r.pages).toEqual([]);
  });

  it("GAP-G1: returns all pages and snapshot metadata", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p1", makeEnvelope("p1", 2));
    store.save("p2", makeEnvelope("p2", 1));
    const r = await invoke(store, { action: "list" }) as { pages: { pageId: string; snapshotCount: number }[] };
    expect(r.pages).toHaveLength(2);
    expect(r.pages.find((p) => p.pageId === "p1")?.snapshotCount).toBe(2);
    expect(r.pages.find((p) => p.pageId === "p2")?.snapshotCount).toBe(1);
  });

  it("GAP-G1: returns metadata only — no nodes/viewport heavy fields", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    const r = await invoke(store, { action: "list" }) as { pages: { snapshots: Record<string, unknown>[] }[] };
    const snap = r.pages[0].snapshots[0];
    expect(snap).toMatchObject({ snapshotId: "p1:1", source: "dom", frameId: "main" });
    expect(snap.nodes).toBeUndefined();
    expect(snap.viewport).toBeUndefined();
  });

  it("GAP-G1: list with pageId returns only that page", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p1", makeEnvelope("p1", 2));
    store.save("p2", makeEnvelope("p2", 1));
    const r = await invoke(store, { action: "list", pageId: "p1" }) as { pages: { pageId: string; snapshotCount: number }[] };
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].pageId).toBe("p1");
    expect(r.pages[0].snapshotCount).toBe(2);
  });

  it("GAP-G1: list with non-existent pageId → pages: []", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    const r = await invoke(store, { action: "list", pageId: "nonexistent" }) as { pages: unknown[] };
    expect(r.pages).toEqual([]);
  });

  it("GAP-G1: pageId '' behaves as omitted", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p2", makeEnvelope("p2", 1));
    const r = await invoke(store, { action: "list", pageId: "" }) as { pages: { pageId: string }[] };
    expect(r.pages).toHaveLength(2);
  });

  it("GAP-G1: pageId whitespace behaves as omitted", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    const r = await invoke(store, { action: "list", pageId: "   " }) as { pages: { pageId: string }[] };
    expect(r.pages).toHaveLength(1);
  });
});