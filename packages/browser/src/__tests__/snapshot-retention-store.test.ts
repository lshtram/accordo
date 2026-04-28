/**
 * snapshot-retention-store.test.ts
 *
 * Tests for SnapshotRetentionStore semantics:
 * - save/getLatest/list/get/resetOnNavigation
 * - RETENTION_SLOTS FIFO eviction per page
 * - listAll / clear overloads (GAP-G1)
 */

import { describe, it, expect } from "vitest";
import { SnapshotRetentionStore, RETENTION_SLOTS } from "../snapshot-retention.js";
import type { SnapshotEnvelopeFields } from "../types.js";

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

describe("SnapshotRetentionStore", () => {
  it("B2-SV-004: saves and retrieves the latest envelope for a page", () => {
    const store = new SnapshotRetentionStore();
    store.save("p1", makeEnvelope("p1", 1));
    expect(store.getLatest("p1")).toEqual(makeEnvelope("p1", 1));
  });

  it("B2-SV-004: getLatest returns undefined for unknown pageId", () => {
    expect(new SnapshotRetentionStore().getLatest("unknown")).toBeUndefined();
  });

  it("B2-SV-004: list returns all saved envelopes oldest-first", () => {
    const store = new SnapshotRetentionStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p1", makeEnvelope("p1", 2));
    expect(store.list("p1")).toEqual([makeEnvelope("p1", 1), makeEnvelope("p1", 2)]);
  });

  it("B2-SV-004: list returns empty array for unknown pageId", () => {
    expect(new SnapshotRetentionStore().list("unknown")).toEqual([]);
  });

  it("B2-SV-004: get retrieves envelope by snapshotId across pages", () => {
    const store = new SnapshotRetentionStore();
    store.save("p1", makeEnvelope("p1", 1));
    store.save("p2", makeEnvelope("p2", 1));
    expect(store.get("p1:1")).toEqual(makeEnvelope("p1", 1));
    expect(store.get("p2:1")).toEqual(makeEnvelope("p2", 1));
  });

  it("B2-SV-004: get returns undefined for unknown snapshotId", () => {
    expect(new SnapshotRetentionStore().get("nope:9")).toBeUndefined();
  });

  it(`B2-SV-004: FIFO eviction — retains exactly ${RETENTION_SLOTS} slots per page`, () => {
    const store = new SnapshotRetentionStore();
    for (let i = 1; i <= RETENTION_SLOTS + 1; i++) {
      store.save("p1", makeEnvelope("p1", i));
    }
    const retained = store.list("p1");
    expect(retained).toHaveLength(RETENTION_SLOTS);
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
    expect(new SnapshotRetentionStore().listAll().size).toBe(0);
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