/**
 * spatial-snapshot-registry.test.ts
 *
 * GAP-D1 — Spatial Relations Snapshot Registry Tests
 *
 * Tests validate:
 * - Registry stores snapshotId -> frameId mapping atomically
 * - getOwnerFrameIdForSnapshot returns exact frame for known snapshot
 * - getOwnerFrameIdForSnapshot returns undefined for stale/unknown snapshots
 * - get_spatial_relations does NOT register or advance owner state
 * - resetSnapshotRegistry clears all state including per-snapshot frame registry
 * - registerPageMapOwner atomically updates: registry set + current owner + frame map
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPageMapOwner,
  isCurrentOwner,
  isKnownPageMapOwner,
  getOwnerFrameIdForSnapshot,
  classifySnapshotId,
  resetSnapshotRegistry,
  getOwnerSnapshotId,
} from "../src/content/spatial-snapshot-registry.js";

describe("GAP-D1 — snapshot registry invariants", () => {
  beforeEach(() => {
    resetSnapshotRegistry();
  });

  // ── Atomic registration ─────────────────────────────────────────────────────

  it("registerPageMapOwner atomically records snapshotId + frameId", () => {
    registerPageMapOwner("page-001:1", "main");
    expect(isKnownPageMapOwner("page-001:1")).toBe(true);
    expect(isCurrentOwner("page-001:1")).toBe(true);
    expect(getOwnerFrameIdForSnapshot("page-001:1")).toBe("main");
  });

  it("registerPageMapOwner with iframe frameId stores exact value", () => {
    registerPageMapOwner("page-001:2", "iframe-embedded-0");
    expect(getOwnerFrameIdForSnapshot("page-001:2")).toBe("iframe-embedded-0");
    expect(isCurrentOwner("page-001:2")).toBe(true);
  });

  it("second registration advances current owner and retains prior in registry", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "iframe-embedded-0");
    expect(isCurrentOwner("page-001:2")).toBe(true);
    expect(isCurrentOwner("page-001:1")).toBe(false);
    expect(isKnownPageMapOwner("page-001:1")).toBe(true); // still tracked as stale
    expect(getOwnerFrameIdForSnapshot("page-001:1")).toBe("main"); // prior frame preserved
  });

  // ── getOwnerFrameIdForSnapshot exact lookup ─────────────────────────────────

  it("getOwnerFrameIdForSnapshot returns exact frame for current owner", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    expect(getOwnerFrameIdForSnapshot("page-001:1")).toBe("iframe-embedded-0");
  });

  it("getOwnerFrameIdForSnapshot returns exact frame for stale owner", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    registerPageMapOwner("page-001:2", "main");
    // page-001:1 is now stale but frame is preserved
    expect(getOwnerFrameIdForSnapshot("page-001:1")).toBe("iframe-embedded-0");
  });

  it("getOwnerFrameIdForSnapshot returns undefined for unknown snapshot", () => {
    registerPageMapOwner("page-001:1", "main");
    expect(getOwnerFrameIdForSnapshot("page-001:999")).toBeUndefined();
  });

  it("getOwnerFrameIdForSnapshot returns undefined when registry is empty", () => {
    expect(getOwnerFrameIdForSnapshot("page-001:1")).toBeUndefined();
  });

  // ── classifySnapshotId ────────────────────────────────────────────────────────

  it("classifySnapshotId: current owner -> 'current'", () => {
    registerPageMapOwner("page-001:1", "main");
    expect(classifySnapshotId("page-001:1")).toBe("current");
  });

  it("classifySnapshotId: prior owner -> 'stale'", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "main");
    expect(classifySnapshotId("page-001:1")).toBe("stale");
  });

  it("classifySnapshotId: unknown snapshot -> 'not-found'", () => {
    expect(classifySnapshotId("page-001:999")).toBe("not-found");
  });

  // ── get_spatial_relations does NOT register snapshots ────────────────────────

  it("getOwnerSnapshotId is undefined after reset without any registration", () => {
    expect(getOwnerSnapshotId()).toBeUndefined();
  });

  it("getOwnerSnapshotId returns latest owner after multiple registrations", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "iframe-embedded-0");
    expect(getOwnerSnapshotId()).toBe("page-001:2");
  });

  // ── resetSnapshotRegistry ─────────────────────────────────────────────────────

  it("resetSnapshotRegistry clears current owner, known set, and frame map", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    registerPageMapOwner("page-001:2", "main");
    resetSnapshotRegistry();
    expect(isCurrentOwner("page-001:2")).toBe(false);
    expect(isKnownPageMapOwner("page-001:1")).toBe(false);
    expect(getOwnerFrameIdForSnapshot("page-001:1")).toBeUndefined();
    expect(getOwnerFrameIdForSnapshot("page-001:2")).toBeUndefined();
    expect(getOwnerSnapshotId()).toBeUndefined();
  });
});
