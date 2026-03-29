/**
 * M100-SNAP — snapshot-versioning.test.ts
 *
 * Tests for Snapshot Versioning (B2-SV-001..B2-SV-007).
 *
 * These tests validate:
 * - B2-SV-001: snapshotId field in all data-producing responses (format {pageId}:{version})
 * - B2-SV-002: monotonically increasing snapshot version within a page session
 * - B2-SV-003: SnapshotEnvelope with pageId, frameId, snapshotId, capturedAt, viewport, source
 * - B2-SV-004: SnapshotStore with 5-slot retention and correct eviction semantics
 * - B2-SV-005: navigation resets version counter and discards stored snapshots
 * - B2-SV-006: stable nodeId within a snapshot (runtime tool-level: inspectElement)
 * - B2-SV-007: experimental persistentId across snapshots (≥90% stability)
 *
 * API checklist (SnapshotManager):
 * - createSnapshot   → 1 test (B2-SV-001 format)
 * - getSnapshot      → 2 tests (B2-SV-001, B2-SV-003)
 * - listSnapshots    → 1 test (B2-SV-004)
 * - pruneSnapshots   → 2 tests (B2-SV-004 eviction)
 * - resetOnNavigation → 2 tests (B2-SV-005)
 * - getSnapshotId    → 2 tests (B2-SV-001, B2-SV-002)
 *
 * API checklist (SnapshotEnvelope):
 * - pageId           → 8 tests (B2-SV-003: manager + 4 runtime paths + schema)
 * - frameId          → 8 tests (B2-SV-003: manager + 4 runtime paths + schema)
 * - snapshotId       → 8 tests (B2-SV-003: manager + 4 runtime paths + schema)
 * - capturedAt       → 8 tests (B2-SV-003: manager + 4 runtime paths + schema)
 * - viewport         → 8 tests (B2-SV-003: manager + 4 runtime paths + schema)
 * - source           → 8 tests (B2-SV-003: manager + 4 runtime paths + schema)
 *
 * API checklist (SnapshotStore):
 * - save             → 2 tests (B2-SV-004)
 * - get              → 1 test (B2-SV-004)
 * - getLatest        → 1 test (B2-SV-004)
 * - list             → 1 test (B2-SV-004)
 * - prune            → 2 tests (B2-SV-004)
 *
 * API checklist (NodeIdentity):
 * - nodeId stability → 3 tests (B2-SV-006: manager helper + runtime tool-level inspectElement)
 * - persistentId     → 4 tests (B2-SV-007: optionality, unchanged, changed, 90% stability)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { handleRelayAction } from "../src/relay-actions.js";

// These imports will fail until M100-SNAP is implemented.
// The tests are written to expect the API described in the architecture doc.
import {
  SnapshotManager,
  SnapshotStore,
  SnapshotEnvelope,
  VersionedSnapshot,
  PageMapSnapshot,
  NodeIdentity,
  DEFAULT_RETENTION_SIZE,
} from "../src/snapshot-versioning.js";

// Real implementations for gap-testing (P1-5)
import { collectPageMap } from "../src/content/page-map-collector.js";
import { inspectElement } from "../src/content/element-inspector.js";
import { getDomExcerpt } from "../src/content/element-inspector.js";

describe("M100-SNAP — Snapshot Versioning", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-001: Snapshot ID in all data-producing responses
  // Format: {pageId}:{version}
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-001: snapshotId format", () => {
    it("B2-SV-001: createSnapshot returns snapshotId matching {pageId}:{version} format", async () => {
      const manager = new SnapshotManager("page-1");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page",
        title: "Example Page",
        nodes: [],
        totalElements: 0,
      });

      // B2-SV-001: snapshotId must match format {pageId}:{version}
      expect(snapshot.snapshotId).toMatch(/^page-1:\d+$/);
    });

    it("B2-SV-001: snapshotId is non-empty string", async () => {
      const manager = new SnapshotManager("page-2");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page",
        title: "Example Page",
        nodes: [],
        totalElements: 0,
      });

      expect(typeof snapshot.snapshotId).toBe("string");
      expect(snapshot.snapshotId.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-002: Monotonically increasing snapshot version
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-002: monotonic snapshot version", () => {
    it("B2-SV-002: consecutive snapshots have strictly increasing version numbers", async () => {
      const manager = new SnapshotManager("page-3");

      const snap1 = await manager.createSnapshot({ pageUrl: "https://a.com", title: "A", nodes: [], totalElements: 0 });
      const snap2 = await manager.createSnapshot({ pageUrl: "https://a.com", title: "A", nodes: [], totalElements: 0 });
      const snap3 = await manager.createSnapshot({ pageUrl: "https://a.com", title: "A", nodes: [], totalElements: 0 });

      // P2-6 fix: Compare parsed numeric versions, not lexicographic strings
      // snapshotId format is {pageId}:{version} - extracting version as integer
      const parseVersion = (id: string) => parseInt(id.split(":")[1]!, 10);
      expect(parseVersion(snap2.snapshotId)).toBeGreaterThan(parseVersion(snap1.snapshotId));
      expect(parseVersion(snap3.snapshotId)).toBeGreaterThan(parseVersion(snap2.snapshotId));
    });

    it("B2-SV-002: version increments by exactly 1 on each call without navigation", async () => {
      const manager = new SnapshotManager("page-4");

      const snap1 = await manager.createSnapshot({ pageUrl: "https://b.com", title: "B", nodes: [], totalElements: 0 });
      const snap2 = await manager.createSnapshot({ pageUrl: "https://b.com", title: "B", nodes: [], totalElements: 0 });
      const snap3 = await manager.createSnapshot({ pageUrl: "https://b.com", title: "B", nodes: [], totalElements: 0 });

      // P2-6 fix: Compare parsed numeric versions, not lexicographic strings
      const parseVersion = (id: string) => parseInt(id.split(":")[1]!, 10);
      expect(parseVersion(snap2.snapshotId) - parseVersion(snap1.snapshotId)).toBe(1);
      expect(parseVersion(snap3.snapshotId) - parseVersion(snap2.snapshotId)).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-003: Canonical metadata envelope
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-003: SnapshotEnvelope fields", () => {
    it("B2-SV-003: snapshot includes pageId field", async () => {
      const manager = new SnapshotManager("page-5");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page5",
        title: "Page 5",
        nodes: [],
        totalElements: 0,
      });

      expect(snapshot).toHaveProperty("pageId", "page-5");
    });

    it("B2-SV-003: snapshot includes frameId field (top-level = 'main')", async () => {
      const manager = new SnapshotManager("page-6");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page6",
        title: "Page 6",
        nodes: [],
        totalElements: 0,
      });

      expect(snapshot).toHaveProperty("frameId");
      expect(typeof snapshot.frameId).toBe("string");
      expect(snapshot.frameId).toBe("main");
    });

    it("B2-SV-003: snapshot includes snapshotId field", async () => {
      const manager = new SnapshotManager("page-7");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page7",
        title: "Page 7",
        nodes: [],
        totalElements: 0,
      });

      expect(snapshot).toHaveProperty("snapshotId");
      expect(typeof snapshot.snapshotId).toBe("string");
      // FIX: Empty string passes type check but is not valid per B2-SV-001.
      // Require non-empty snapshotId so test fails correctly with scaffold.
      expect(snapshot.snapshotId.length).toBeGreaterThan(0);
    });

    it("B2-SV-003: snapshot includes capturedAt as valid ISO 8601 timestamp", async () => {
      const manager = new SnapshotManager("page-8");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page8",
        title: "Page 8",
        nodes: [],
        totalElements: 0,
      });

      expect(snapshot).toHaveProperty("capturedAt");
      expect(typeof snapshot.capturedAt).toBe("string");
      const parsed = new Date(snapshot.capturedAt);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    });

    it("B2-SV-003: snapshot includes viewport with width, height, scrollX, scrollY, devicePixelRatio", async () => {
      const manager = new SnapshotManager("page-9");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page9",
        title: "Page 9",
        nodes: [],
        totalElements: 0,
      });

      expect(snapshot).toHaveProperty("viewport");
      // FIX B: Property existence alone is not enough — scaffold returns all zeros,
      // which passes existence checks but is not a valid viewport.
      // Assert realistic non-zero values so the test fails correctly.
      expect(snapshot.viewport.width).toBeGreaterThan(0);
      expect(snapshot.viewport.height).toBeGreaterThan(0);
      expect(snapshot.viewport.devicePixelRatio).toBeGreaterThanOrEqual(1);
      expect(typeof snapshot.viewport.scrollX).toBe("number");
      expect(typeof snapshot.viewport.scrollY).toBe("number");
    });

    it("B2-SV-003: snapshot includes source field with valid source type", async () => {
      const manager = new SnapshotManager("page-10");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page10",
        title: "Page 10",
        nodes: [],
        totalElements: 0,
      });

      expect(snapshot).toHaveProperty("source");
      const validSources = ["dom", "a11y", "visual", "layout", "network"];
      expect(validSources).toContain(snapshot.source);
    });

    /**
     * P0-2: Schema-level SnapshotEnvelope validation
     * Validates the complete required shape with all fields present and correctly typed.
     * This is NOT just field presence checks - it validates the full structure.
     */
    it("B2-SV-003: SnapshotEnvelope schema-level validation - complete shape", async () => {
      const manager = new SnapshotManager("page-schema");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/schema",
        title: "Schema Test",
        nodes: [],
        totalElements: 0,
      });

      // P0-2: Full schema validation - check complete structure
      expect(snapshot).toMatchObject({
        pageId: expect.stringMatching(/^page-schema$/),
        frameId: "main",
        snapshotId: expect.stringMatching(/^page-schema:\d+$/),
        capturedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        source: expect.stringMatching(/^(dom|a11y|visual|layout|network)$/),
      });

      // Validate viewport structure completely
      expect(snapshot.viewport).toMatchObject({
        width: expect.any(Number),
        height: expect.any(Number),
        scrollX: expect.any(Number),
        scrollY: expect.any(Number),
        devicePixelRatio: expect.any(Number),
      });

      // Validate node structure
      expect(snapshot).toMatchObject({
        nodes: expect.any(Array),
        totalElements: expect.any(Number),
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-003: Full SnapshotEnvelope runtime assertions on ALL data-producing paths
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-003: Full SnapshotEnvelope on all data-producing tool responses (runtime)", () => {
    /**
     * B2-SV-003: collectPageMap response must include ALL SnapshotEnvelope fields
     * at runtime — not just snapshotId. Validates full envelope structure.
     */
    it("B2-SV-003: collectPageMap returns full SnapshotEnvelope with all required fields", () => {
      const result = collectPageMap({ maxDepth: 2 });

      // All required SnapshotEnvelope fields (B2-SV-003)
      expect(result).toHaveProperty("pageId");
      expect(result).toHaveProperty("frameId");
      expect(result).toHaveProperty("snapshotId");
      expect(result).toHaveProperty("capturedAt");
      expect(result).toHaveProperty("viewport");
      expect(result).toHaveProperty("source");

      // Field-level assertions
      expect(typeof result.pageId).toBe("string");
      expect(result.pageId.length).toBeGreaterThan(0);

      expect(typeof result.frameId).toBe("string");
      expect(result.frameId).toBe("main");

      expect(typeof result.snapshotId).toBe("string");
      expect(result.snapshotId).toMatch(/^[^:]+:\d+$/);

      expect(typeof result.capturedAt).toBe("string");
      const capturedAtDate = new Date(result.capturedAt);
      expect(Number.isNaN(capturedAtDate.getTime())).toBe(false);

      expect(result.viewport).toBeDefined();
      expect(result.viewport.width).toBeGreaterThan(0);
      expect(result.viewport.height).toBeGreaterThan(0);
      expect(result.viewport.devicePixelRatio).toBeGreaterThanOrEqual(1);

      const validSources = ["dom", "a11y", "visual", "layout", "network"];
      expect(validSources).toContain(result.source);
    });

    /**
     * B2-SV-003: inspectElement response must include ALL SnapshotEnvelope fields
     * at runtime — not just snapshotId. Validates full envelope structure.
     */
    it("B2-SV-003: inspectElement returns full SnapshotEnvelope with all required fields", () => {
      // First collect a page map to get valid refs
      const pageMap = collectPageMap({ maxDepth: 2 });
      const targetNode = pageMap.nodes.find((n) => n.nodeId >= 0);

      const result = targetNode
        ? inspectElement({ nodeId: targetNode.nodeId })
        : inspectElement({ selector: "#main" });

      expect(result.found).toBe(true);

      // All required SnapshotEnvelope fields (B2-SV-003)
      expect(result).toHaveProperty("pageId");
      expect(result).toHaveProperty("frameId");
      expect(result).toHaveProperty("snapshotId");
      expect(result).toHaveProperty("capturedAt");
      expect(result).toHaveProperty("viewport");
      expect(result).toHaveProperty("source");

      // Field-level assertions
      expect(typeof result.pageId).toBe("string");
      expect(result.pageId.length).toBeGreaterThan(0);

      expect(typeof result.frameId).toBe("string");
      expect(result.frameId).toBe("main");

      expect(typeof result.snapshotId).toBe("string");
      expect(result.snapshotId).toMatch(/^[^:]+:\d+$/);

      expect(typeof result.capturedAt).toBe("string");
      const capturedAtDate = new Date(result.capturedAt);
      expect(Number.isNaN(capturedAtDate.getTime())).toBe(false);

      expect(result.viewport).toBeDefined();
      expect(result.viewport.width).toBeGreaterThan(0);
      expect(result.viewport.height).toBeGreaterThan(0);
      expect(result.viewport.devicePixelRatio).toBeGreaterThanOrEqual(1);

      const validSources = ["dom", "a11y", "visual", "layout", "network"];
      expect(validSources).toContain(result.source);
    });

    /**
     * B2-SV-003: getDomExcerpt response must include ALL SnapshotEnvelope fields
     * at runtime — not just snapshotId. Validates full envelope structure.
     */
    it("B2-SV-003: getDomExcerpt returns full SnapshotEnvelope with all required fields", () => {
      const result = getDomExcerpt("#main");

      expect(result.found).toBe(true);

      // All required SnapshotEnvelope fields (B2-SV-003)
      expect(result).toHaveProperty("pageId");
      expect(result).toHaveProperty("frameId");
      expect(result).toHaveProperty("snapshotId");
      expect(result).toHaveProperty("capturedAt");
      expect(result).toHaveProperty("viewport");
      expect(result).toHaveProperty("source");

      // Field-level assertions
      expect(typeof result.pageId).toBe("string");
      expect(result.pageId.length).toBeGreaterThan(0);

      expect(typeof result.frameId).toBe("string");
      expect(result.frameId).toBe("main");

      expect(typeof result.snapshotId).toBe("string");
      expect(result.snapshotId).toMatch(/^[^:]+:\d+$/);

      expect(typeof result.capturedAt).toBe("string");
      const capturedAtDate = new Date(result.capturedAt);
      expect(Number.isNaN(capturedAtDate.getTime())).toBe(false);

      expect(result.viewport).toBeDefined();
      expect(result.viewport.width).toBeGreaterThan(0);
      expect(result.viewport.height).toBeGreaterThan(0);
      expect(result.viewport.devicePixelRatio).toBeGreaterThanOrEqual(1);

      const validSources = ["dom", "a11y", "visual", "layout", "network"];
      expect(validSources).toContain(result.source);
    });

    /**
     * B2-SV-003: capture_region response must include ALL SnapshotEnvelope fields
     * at runtime via handleRelayAction. Validates full envelope structure.
     */
    it("B2-SV-003: capture_region returns full SnapshotEnvelope with all required fields", async () => {
      const response = await handleRelayAction({
        requestId: "test-capture-envelope",
        action: "capture_region",
        payload: { rect: { x: 0, y: 0, width: 100, height: 100 }, padding: 0, quality: 70 },
      });

      expect(response.success).toBe(true);

      // All required SnapshotEnvelope fields (B2-SV-003)
      // Note: response.data is CaptureRegionResult which extends SnapshotEnvelope
      const data = response.data as Record<string, unknown>;
      expect(data).toHaveProperty("pageId");
      expect(data).toHaveProperty("frameId");
      expect(data).toHaveProperty("snapshotId");
      expect(data).toHaveProperty("capturedAt");
      expect(data).toHaveProperty("viewport");
      expect(data).toHaveProperty("source");

      // Field-level assertions
      expect(typeof data.pageId).toBe("string");
      expect((data.pageId as string).length).toBeGreaterThan(0);

      expect(typeof data.frameId).toBe("string");
      expect(data.frameId).toBe("main");

      expect(typeof data.snapshotId).toBe("string");
      expect(data.snapshotId as string).toMatch(/^[^:]+:\d+$/);

      expect(typeof data.capturedAt).toBe("string");
      const capturedAtDate = new Date(data.capturedAt as string);
      expect(Number.isNaN(capturedAtDate.getTime())).toBe(false);

      expect(data.viewport).toBeDefined();
      const viewport = data.viewport as { width: number; height: number; devicePixelRatio: number };
      expect(viewport.width).toBeGreaterThan(0);
      expect(viewport.height).toBeGreaterThan(0);
      expect(viewport.devicePixelRatio).toBeGreaterThanOrEqual(1);

      const validSources = ["dom", "a11y", "visual", "layout", "network"];
      expect(validSources).toContain(data.source);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-004: Snapshot storage — 5-slot retention with eviction
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-004: SnapshotStore 5-slot retention", () => {
    it("B2-SV-004: store retains exactly 5 snapshots after 7 saves (eviction)", async () => {
      const store = new SnapshotStore(DEFAULT_RETENTION_SIZE);
      const pageId = "page-11";

      // Save 7 snapshots
      for (let i = 0; i < 7; i++) {
        const snapshot: VersionedSnapshot = {
          pageId,
          frameId: "main",
          snapshotId: `${pageId}:${i}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom",
          nodes: [],
          totalElements: 0,
        };
        await store.save(pageId, snapshot);
      }

      const list = await store.list(pageId);
      expect(list).toHaveLength(5);
    });

    it("B2-SV-004: store keeps the 5 most recent snapshots (newest first)", async () => {
      const store = new SnapshotStore(DEFAULT_RETENTION_SIZE);
      const pageId = "page-12";

      // Save 6 snapshots
      for (let i = 0; i < 6; i++) {
        const snapshot: VersionedSnapshot = {
          pageId,
          frameId: "main",
          snapshotId: `${pageId}:${i}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom",
          nodes: [],
          totalElements: 0,
        };
        await store.save(pageId, snapshot);
      }

      const list = await store.list(pageId);
      // FIX A: Must assert list is non-empty BEFORE accessing list elements to avoid
      // TypeError: Cannot read properties of undefined. Fails because scaffold returns [].
      expect(list.length).toBeGreaterThan(0);
      // Should have snapshots with IDs: page-12:1 through page-12:5 (oldest :0 evicted)
      expect(list[0]!.snapshotId).toBe(`${pageId}:5`);
      expect(list[4]!.snapshotId).toBe(`${pageId}:1`);
      expect(list.some((s) => s.snapshotId === `${pageId}:0`)).toBe(false);
    });

    /**
     * P0-3: Pruned snapshot returns error code 'snapshot-not-found' instead of undefined
     * 
     * Per acceptance criterion: when a snapshot has been evicted from the store,
     * attempting to retrieve it should return an error with code 'snapshot-not-found',
     * NOT undefined.
     */
    it("B2-SV-004: get returns error code 'snapshot-not-found' for pruned snapshot", async () => {
      const store = new SnapshotStore(3); // Use smaller retention for clarity
      const pageId = "page-13";

      for (let i = 0; i < 5; i++) {
        const snapshot: VersionedSnapshot = {
          pageId,
          frameId: "main",
          snapshotId: `${pageId}:${i}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom",
          nodes: [],
          totalElements: 0,
        };
        await store.save(pageId, snapshot);
      }

      // First two snapshots should be pruned (evicted)
      // P0-3: Implementation should return error with code 'snapshot-not-found', not undefined
      const pruned = await store.get(`${pageId}:0`);
      expect(pruned).toEqual({ error: "snapshot-not-found" });

      // Non-pruned snapshots should still be accessible
      const kept = await store.get(`${pageId}:2`);
      expect(kept).not.toBeUndefined();
    });

    it("B2-SV-004: getLatest returns the most recent snapshot", async () => {
      const store = new SnapshotStore(5);
      const pageId = "page-14";

      for (let i = 0; i < 4; i++) {
        const snapshot: VersionedSnapshot = {
          pageId,
          frameId: "main",
          snapshotId: `${pageId}:${i}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom",
          nodes: [],
          totalElements: 0,
        };
        await store.save(pageId, snapshot);
      }

      const latest = await store.getLatest(pageId);
      // FIX A: Must assert latest !== undefined BEFORE accessing properties.
      // Fails because scaffold getLatest() returns undefined.
      expect(latest).not.toBeUndefined();
      expect(latest!.snapshotId).toBe(`${pageId}:3`);
    });

    it("B2-SV-004: list returns snapshots in descending order (newest first)", async () => {
      const store = new SnapshotStore(5);
      const pageId = "page-15";

      // Save 5 snapshots with sequential versions
      for (let i = 0; i < 5; i++) {
        const snapshot: VersionedSnapshot = {
          pageId,
          frameId: "main",
          snapshotId: `${pageId}:${i}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom",
          nodes: [],
          totalElements: 0,
        };
        await store.save(pageId, snapshot);
      }

      const list = await store.list(pageId);

      // FIX B: Scaffold returns [] so the loop never runs and no assertion fails.
      // Assert list is non-empty first so the test fails correctly.
      expect(list.length).toBeGreaterThan(0);

      // P2-6 fix: Compare parsed numeric versions, not lexicographic strings
      // snapshotId strings like "page-15:10" would incorrectly sort before "page-15:9"
      for (let i = 0; i < list.length - 1; i++) {
        const currentVersion = parseInt(list[i]!.snapshotId.split(":")[1]!, 10);
        const nextVersion = parseInt(list[i + 1]!.snapshotId.split(":")[1]!, 10);
        expect(currentVersion).toBeGreaterThan(nextVersion);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-005: Navigation resets version counter
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-005: navigation resets version counter", () => {
    it("B2-SV-005: after navigation, next snapshot version starts at 0 or 1", async () => {
      const manager = new SnapshotManager("page-16");

      // Create 3 snapshots on initial page
      const snap1 = await manager.createSnapshot({ pageUrl: "https://a.com", title: "A", nodes: [], totalElements: 0 });
      const snap2 = await manager.createSnapshot({ pageUrl: "https://a.com", title: "A", nodes: [], totalElements: 0 });
      const snap3 = await manager.createSnapshot({ pageUrl: "https://a.com", title: "A", nodes: [], totalElements: 0 });

      expect(snap1.snapshotId).toMatch(/:0$/);
      expect(snap2.snapshotId).toMatch(/:1$/);
      expect(snap3.snapshotId).toMatch(/:2$/);

      // Simulate navigation
      manager.resetOnNavigation();

      // After navigation, version resets
      const snap4 = await manager.createSnapshot({ pageUrl: "https://b.com", title: "B", nodes: [], totalElements: 0 });
      // P2-7 fix: Non-null assertion justified - split always returns array with at least 1 element
      const resetVersion = parseInt(snap4.snapshotId.split(":")[1]!, 10);
      expect(resetVersion).toBeLessThanOrEqual(1);
    });

    it("B2-SV-005: after navigation, stored snapshots from previous page are inaccessible", async () => {
      const store = new SnapshotStore(5);
      const pageId = "page-17";

      // Save snapshots for initial page
      for (let i = 0; i < 3; i++) {
        const snapshot: VersionedSnapshot = {
          pageId,
          frameId: "main",
          snapshotId: `${pageId}:${i}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom",
          nodes: [],
          totalElements: 0,
        };
        await store.save(pageId, snapshot);
      }

      // Simulate navigation: reset store for new page
      store.resetOnNavigation();

      // Old snapshots should not be accessible after navigation reset
      // B2-SV-005 + B2-SV-004: store discards all snapshots on navigation reset
      const oldSnapshot = await store.get(`${pageId}:0`);
      // After resetOnNavigation, previously stored snapshots are inaccessible
      // — return error code per consistent snapshot-not-found semantics
      expect(oldSnapshot).toEqual({ error: "snapshot-not-found" });

      // New snapshots under the same pageId should work
      const newSnapshot: VersionedSnapshot = {
        pageId,
        frameId: "main",
        snapshotId: `${pageId}:0`, // Version reset
        capturedAt: new Date().toISOString(),
        viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        nodes: [],
        totalElements: 0,
      };
      await store.save(pageId, newSnapshot);
      const kept = await store.get(`${pageId}:0`);
      expect(kept).not.toBeUndefined();
    });

    it("B2-SV-005: store.list returns empty array after navigation reset", async () => {
      const store = new SnapshotStore(5);
      const pageId = "page-18";

      for (let i = 0; i < 3; i++) {
        const snapshot: VersionedSnapshot = {
          pageId,
          frameId: "main",
          snapshotId: `${pageId}:${i}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom",
          nodes: [],
          totalElements: 0,
        };
        await store.save(pageId, snapshot);
      }

      store.resetOnNavigation();

      // FIX B: After reset, old snapshots should be gone (list is empty).
      // Scaffold returns [] (correctly empty after no-op reset).
      expect(await store.list(pageId)).toHaveLength(0);

      // FIX B: After reset, we SHOULD be able to add new snapshots and retrieve them.
      // This fails because scaffold save() is a no-op and get() returns undefined.
      const newSnapshot: VersionedSnapshot = {
        pageId,
        frameId: "main",
        snapshotId: `${pageId}:0`,
        capturedAt: new Date().toISOString(),
        viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        nodes: [],
        totalElements: 0,
      };
      await store.save(pageId, newSnapshot);
      const retrieved = await store.get(`${pageId}:0`);
      // This fails because save is no-op and get returns undefined
      expect(retrieved).not.toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-006: Stable nodeId within snapshot
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-006: stable nodeId within snapshot", () => {
    it("B2-SV-006: two calls to getSnapshotId with same nodeId return same nodeId value", async () => {
      const manager = new SnapshotManager("page-19");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page19",
        title: "Page 19",
        nodes: [
          { tag: "html", children: [], nodeId: 0 },
          { tag: "body", children: [], nodeId: 1 },
        ],
        totalElements: 2,
      });

      // Get nodeId for "body" element
      const nodeId1 = manager.getNodeIdForElement(snapshot, "body");
      const nodeId2 = manager.getNodeIdForElement(snapshot, "body");

      // FIX B: Assert nodeId is a valid non-negative value FIRST so the trivial case
      // (both -1) fails the test. Scaffold returns -1 for all lookups.
      expect(nodeId1).toBeGreaterThanOrEqual(0);
      expect(nodeId2).toBeGreaterThanOrEqual(0);
      expect(nodeId1).toBe(nodeId2);
    });

    it("B2-SV-006: nodeId is an integer within snapshot scope", async () => {
      const manager = new SnapshotManager("page-20");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page20",
        title: "Page 20",
        nodes: [
          { tag: "div", children: [], nodeId: 0 },
          { tag: "span", children: [], nodeId: 1 },
          { tag: "p", children: [], nodeId: 2 },
        ],
        totalElements: 3,
      });

      const nodeId = manager.getNodeIdForElement(snapshot, "div");
      expect(Number.isInteger(nodeId)).toBe(true);
      expect(nodeId).toBeGreaterThanOrEqual(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-007: Experimental persistentId across snapshots
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-007: experimental persistentId across snapshots", () => {
    it("B2-SV-007: unchanged element retains same persistentId across consecutive snapshots", async () => {
      const manager = new SnapshotManager("page-21");

      // Create two snapshots where a "div" element remains unchanged
      const snapshot1 = await manager.createSnapshot({
        pageUrl: "https://example.com/page21",
        title: "Page 21",
        nodes: [
          { tag: "div", id: "main", children: [], text: "unchanged content", nodeId: 0 },
        ],
        totalElements: 1,
      });

      const snapshot2 = await manager.createSnapshot({
        pageUrl: "https://example.com/page21",
        title: "Page 21",
        nodes: [
          { tag: "div", id: "main", children: [], text: "unchanged content", nodeId: 0 },
        ],
        totalElements: 1,
      });

      const node1 = manager.getNodeByTag(snapshot1, "div");
      const node2 = manager.getNodeByTag(snapshot2, "div");

      // FIX A: Assert node is found BEFORE accessing persistentId to avoid TypeError.
      // FIX B: Also assert persistentId is a non-empty string — scaffold returns
      // undefined for both node and persistentId, so undefined === undefined passes.
      expect(node1).not.toBeUndefined();
      expect(node2).not.toBeUndefined();
      expect(node1!.persistentId).toBeDefined();
      expect(node2!.persistentId).toBeDefined();
      expect(typeof node1!.persistentId).toBe("string");
      expect(node1!.persistentId!.length).toBeGreaterThan(0);
      expect(node2!.persistentId!.length).toBeGreaterThan(0);

      // And they should match for unchanged element
      expect(node1!.persistentId).toBe(node2!.persistentId);
    });

    it("B2-SV-007: persistentId is optional and is either a string or undefined (not an error)", async () => {
      const manager = new SnapshotManager("page-22");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page22",
        title: "Page 22",
        nodes: [{ tag: "div", children: [], nodeId: 0 }],
        totalElements: 1,
      });

      const node = manager.getNodeByTag(snapshot, "div");
      expect(node).not.toBeUndefined();

      // persistentId is optional and experimental — implementation may or may not include it.
      // The key invariant is that accessing it does NOT throw and returns a valid type.
      // This assertion is STRICT: persistentId must be either undefined or a non-empty string.
      const pid = node!.persistentId;
      expect(pid === undefined || (typeof pid === "string" && pid.length > 0)).toBe(true);
    });

    it("B2-SV-007: changed element persistentId may differ after content modification", async () => {
      const manager = new SnapshotManager("page-23");

      const snapshot1 = await manager.createSnapshot({
        pageUrl: "https://example.com/page23",
        title: "Page 23",
        nodes: [{ tag: "div", id: "main", children: [], text: "original", nodeId: 0 }],
        totalElements: 1,
      });

      const snapshot2 = await manager.createSnapshot({
        pageUrl: "https://example.com/page23",
        title: "Page 23",
        nodes: [{ tag: "div", id: "main", children: [], text: "modified", nodeId: 0 }],
        totalElements: 1,
      });

      const node1 = manager.getNodeByTag(snapshot1, "div");
      const node2 = manager.getNodeByTag(snapshot2, "div");

      expect(node1).not.toBeUndefined();
      expect(node2).not.toBeUndefined();
      expect(node1!.persistentId).toBeDefined();
      expect(node2!.persistentId).toBeDefined();

      // B2-SV-007: persistentId is derived from tag + id + text content.
      // When text changes, the persistentId SHOULD differ (deterministic hash based on content).
      // This distinguishes changed elements from unchanged ones (which retain same persistentId).
      // The 90% stability requirement applies to unchanged elements; changed elements
      // are expected to potentially have different persistentIds.
      const pid1 = node1!.persistentId;
      const pid2 = node2!.persistentId;

      // Assert both are valid non-empty strings
      expect(typeof pid1).toBe("string");
      expect(typeof pid2).toBe("string");
      expect((pid1 as string).length).toBeGreaterThan(0);
      expect((pid2 as string).length).toBeGreaterThan(0);

      // After content change (text: "original" → "modified"), persistentId should differ
      // because persistentId is computed from tag:id:text tuple
      expect(pid1).not.toBe(pid2);
    });

    /**
     * P0-4 + P2-n: 90% persistentId stability test
     *
     * Creates 10 snapshots of the same page with uniquely-identified elements
     * (using id attributes as stable element keys). Measures persistentId
     * consistency rate for unchanged elements. Acceptance: ≥90%.
     *
     * Uses unique element IDs (#header, #nav, #content, #footer) instead of
     * tag-only selectors to avoid re-selecting the same element repeatedly.
     */
    it("B2-SV-007: persistentId stability ≥90% for unchanged elements across 10 snapshots", async () => {
      const manager = new SnapshotManager("page-stability");
      const SNAPSHOT_COUNT = 10;

      // Stable elements with unique IDs — each will be tracked independently
      const stableNodes = [
        { tag: "button", id: "submit-btn", text: "Submit", nodeId: 0 as const },
        { tag: "div", id: "main", text: "Main content", nodeId: 1 as const },
        { tag: "div", id: "content", text: "Dynamic", nodeId: 2 as const },
        { tag: "div", id: "btn", text: "button element", nodeId: 3 as const },
      ];

      // Create 10 snapshots — all with the same nodeId assignment (unchanged elements)
      const snapshots = await Promise.all(
        Array.from({ length: SNAPSHOT_COUNT }, () =>
          manager.createSnapshot({
            pageUrl: "https://example.com/stability",
            title: "Stability Test",
            nodes: stableNodes.map((n) => ({ ...n })),
            totalElements: stableNodes.length,
          })
        )
      );

      // Track persistentIds per unique element (by nodeId as stable key)
      // nodeId is stable within a snapshot (B2-SV-006) — use it to identify elements
      const nodeIdToPersistentIds: Map<number, (string | undefined)[]> = new Map(
        stableNodes.map((n) => [n.nodeId, []])
      );

      for (const snapshot of snapshots) {
        for (const node of snapshot.nodes) {
          if (nodeIdToPersistentIds.has(node.nodeId)) {
            // Justify: we only push for nodeIds we know exist from stableNodes
            nodeIdToPersistentIds.get(node.nodeId)!.push(node.persistentId);
          }
        }
      }

      // Calculate stability: for each element, all its persistentIds should match
      let totalChecks = 0;
      let stableChecks = 0;

      for (const [, persistentIds] of nodeIdToPersistentIds) {
        // Only count elements that appeared in all snapshots with a persistentId
        const definedIds = persistentIds.filter((pid): pid is string => pid !== undefined);
        if (definedIds.length >= 2) {
          const firstDefined = definedIds[0]!; // justified: definedIds is non-empty
          for (const pid of definedIds) {
            totalChecks++;
            if (pid === firstDefined) stableChecks++;
          }
        }
      }

      const stabilityRate = totalChecks > 0 ? stableChecks / totalChecks : 0;

      // Acceptance criterion: ≥90% stability for unchanged elements
      expect(stabilityRate).toBeGreaterThanOrEqual(0.9);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // B2-SV-001: All data-producing tools include snapshotId
  // ══════════════════════════════════════════════════════════════════════════════

  describe("B2-SV-001: all data-producing responses include snapshotId", () => {
    it("B2-SV-001: PageMapSnapshot includes snapshotId", async () => {
      const manager = new SnapshotManager("page-24");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page24",
        title: "Page 24",
        nodes: [],
        totalElements: 0,
      });

      expect(snapshot).toHaveProperty("snapshotId");
      expect(typeof snapshot.snapshotId).toBe("string");
      // FIX: Also require non-empty snapshotId — empty string passes type check
      // but is not valid per B2-SV-001 format spec {pageId}:{version}.
      expect(snapshot.snapshotId.length).toBeGreaterThan(0);
    });

    it("B2-SV-001: SnapshotEnvelope is embedded in snapshot response", async () => {
      const manager = new SnapshotManager("page-25");
      const snapshot = await manager.createSnapshot({
        pageUrl: "https://example.com/page25",
        title: "Page 25",
        nodes: [],
        totalElements: 0,
      });

      // SnapshotEnvelope fields should be at top level of snapshot
      expect(snapshot).toHaveProperty("pageId");
      expect(snapshot).toHaveProperty("frameId");
      // FIX: Also require non-empty snapshotId — empty string passes toHaveProperty
      // but is not a valid snapshotId per B2-SV-001 spec.
      expect(snapshot).toHaveProperty("snapshotId");
      expect(snapshot.snapshotId.length).toBeGreaterThan(0);
      expect(snapshot).toHaveProperty("capturedAt");
      expect(snapshot).toHaveProperty("viewport");
      expect(snapshot).toHaveProperty("source");
    });

    /**
     * P0-1: Verify tool responses include snapshotId
     * 
     * Tests that the real collectPageMap() function's response includes snapshotId.
     * Since collectPageMap() is implemented but currently doesn't return snapshotId,
     * this test FAILS at the assertion level (not stub-throw level) - demonstrating
     * the gap between current behavior and expected behavior.
     * 
     * P1-5: This test calls a REAL implemented function and makes a real assertion,
     * so it fails at the assertion level, not the stub level.
     */
    it("P1-5 + B2-SV-001: collectPageMap response includes snapshotId from SnapshotEnvelope", () => {
      // Call the real, implemented collectPageMap function
      const result = collectPageMap();
      
      // B2-SV-001: The response SHOULD include snapshotId per M100-SNAP spec
      // This assertion FAILS at the assertion level because collectPageMap
      // currently doesn't return snapshotId - demonstrating the implementation gap
      expect(result).toHaveProperty("snapshotId");
      
      // Additional schema validation for the snapshotId field
      if ("snapshotId" in result) {
        expect(typeof result.snapshotId).toBe("string");
        expect(result.snapshotId).toMatch(/^[^:]+:\d+$/);
      }
    });

    /**
     * P0-1: Runtime test for browser_inspect_element response
     *
     * Calls the real inspectElement() function with a ref obtained from
     * collectPageMap() (which populates the refIndex), then asserts that
     * the response includes snapshotId — currently FAILS at assertion level
     * because inspectElement() does not yet inject SnapshotEnvelope fields.
     *
     * Uses CSS selector fallback (#main div) to ensure the test is robust
     * in jsdom even if refIndex population has environment-specific gaps.
     */
    it("P0-1 + B2-SV-001: inspectElement response includes snapshotId (runtime)", () => {
      // collectPageMap() populates refIndex via its traversal
      const pageMap = collectPageMap({ maxDepth: 2 });

      // Try ref-based lookup first (refIndex path), fall back to CSS selector
      const mainNode = pageMap.nodes.find((n) => n.tag === "div" && n.id === "main");
      const mainRef = mainNode?.ref;

      // Resolve element via ref (refIndex) or CSS selector fallback
      const foundByRef = mainRef ? inspectElement({ ref: mainRef }) : null;
      const result = foundByRef?.found
        ? foundByRef
        : inspectElement({ selector: "#main" });

      // The element must be found — if jsdom DOM traversal has gaps, this test
      // fails with a clear message rather than silently skipping the assertion
      expect(result.found, `inspectElement could not resolve #main (ref=${mainRef}, nodes=${pageMap.nodes.length}). DOM setup may not be populating refIndex correctly in jsdom.`).toBe(true);

      // B2-SV-001: The response MUST include snapshotId per spec
      // This FAILS in RED — inspectElement result has no snapshotId yet
      expect(result).toHaveProperty("snapshotId");

      // Validate format {pageId}:{version}
      if ("snapshotId" in result) {
        expect(typeof result.snapshotId).toBe("string");
        expect(result.snapshotId).toMatch(/^[^:]+:\d+$/);
      }
    });

    /**
     * B2-SV-006: Runtime tool-level test for stable nodeId behavior
     *
     * Validates that calling inspectElement with the same nodeId returns consistent
     * element identification — demonstrating that nodeId is a stable lookup key
     * within a snapshot's refIndex.
     *
     * Each inspectElement call generates its own snapshotId (increments version counter),
     * but the nodeId serves as a stable reference to a specific element in the
     * original snapshot's refIndex.
     *
     * This is the actual runtime tool-level contract (browser_inspect_element tool),
     * not just the manager helper (getNodeIdForElement).
     */
    it("B2-SV-006: two inspectElement calls with same nodeId return consistent element identification", () => {
      // Create a snapshot by collecting a page map
      const pageMap = collectPageMap({ maxDepth: 2 });

      // Find a node with a valid nodeId
      const targetNode = pageMap.nodes.find((n) => n.nodeId >= 0);
      expect(targetNode).toBeDefined();

      const nodeId = targetNode!.nodeId;

      // B2-SV-006: nodeId must be a non-negative integer (stable identifier within snapshot)
      expect(Number.isInteger(nodeId)).toBe(true);
      expect(nodeId).toBeGreaterThanOrEqual(0);

      // First inspectElement call with nodeId
      const result1 = inspectElement({ nodeId });
      expect(result1.found).toBe(true);
      expect(result1).toHaveProperty("snapshotId");

      // Second inspectElement call with same nodeId — should return consistent element
      const result2 = inspectElement({ nodeId });
      expect(result2.found).toBe(true);
      expect(result2).toHaveProperty("snapshotId");

      // Each inspectElement call generates its own snapshotId (version counter increments)
      // but both calls use the same nodeId to look up the element in the refIndex
      expect(typeof result1.snapshotId).toBe("string");
      expect(typeof result2.snapshotId).toBe("string");

      // Both calls should return the same anchorKey (stable element identification via nodeId)
      // This demonstrates nodeId stability: same nodeId → same element → same anchorKey
      expect(result1.anchorKey).toBe(result2.anchorKey);

      // Both calls should return the same element details (tag, id, etc.)
      expect(result1.element?.tag).toBe(result2.element?.tag);
      expect(result1.element?.id).toBe(result2.element?.id);
    });

    /**
     * P0-1: Runtime test for browser_get_dom_excerpt response
     *
     * Calls the real getDomExcerpt() function with a CSS selector, then asserts
     * that the response includes snapshotId — currently FAILS at assertion level
     * because getDomExcerpt() does not yet inject SnapshotEnvelope fields.
     */
    it("P0-1 + B2-SV-001: getDomExcerpt response includes snapshotId (runtime)", () => {
      // getDomExcerpt uses document.querySelector — works against jsdom fixture
      const result = getDomExcerpt("#main");

      expect(result.found).toBe(true);
      // B2-SV-001: The response MUST include snapshotId per spec
      // Currently FAILS here — getDomExcerpt result has no snapshotId
      expect(result).toHaveProperty("snapshotId");

      // Validate format {pageId}:{version}
      if ("snapshotId" in result) {
        expect(typeof result.snapshotId).toBe("string");
        expect(result.snapshotId).toMatch(/^[^:]+:\d+$/);
      }
    });

    /**
     * P0-1 + B2-SV-001: captureRegion response includes snapshotId
     *
     * Calls handleRelayAction with capture_region action and asserts that the
     * response data includes snapshotId in the required {pageId}:{version} format.
     * B2-SV-001 requires ALL data-producing browser tools to include snapshotId.
     */
    it("P0-1 + B2-SV-001: captureRegion response includes snapshotId (runtime)", async () => {
      const response = await handleRelayAction({
        requestId: "test-capture-snapshotid",
        action: "capture_region",
        payload: { rect: { x: 0, y: 0, width: 100, height: 100 }, padding: 0, quality: 70 },
      });

      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty("snapshotId");

      // Validate format {pageId}:{version}
      const data = response.data as { snapshotId?: unknown };
      expect(typeof data.snapshotId).toBe("string");
      expect(data.snapshotId as string).toMatch(/^[^:]+:\d+$/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Edge/invariant tests for runtime functions (collectPageMap, inspectElement, getDomExcerpt)
  // ══════════════════════════════════════════════════════════════════════════════

  describe("collectPageMap: determinism invariant", () => {
    /**
     * C) Edge/invariant test: calling collectPageMap twice with no DOM changes
     * should return the same ref set (same node structure with same refs).
     * This validates that page map collection is deterministic.
     */
    it("B2-SV-001 invariant: collectPageMap returns identical ref set on consecutive calls (determinism)", () => {
      const first = collectPageMap({ maxDepth: 2 });
      const second = collectPageMap({ maxDepth: 2 });

      // The ref field uniquely identifies each node in the page map.
      // If collection is deterministic, the same DOM should produce the same ref set.
      // FIX C: Scaffold page-map-collector may not be producing stable refs,
      // causing this assertion to fail.
      const firstRefs = first.nodes.map((n) => n.ref).filter(Boolean);
      const secondRefs = second.nodes.map((n) => n.ref).filter(Boolean);

      expect(firstRefs).toHaveLength(secondRefs.length);
      // Check that every ref in first appears in second (same set)
      for (const ref of firstRefs) {
        expect(secondRefs).toContain(ref);
      }
    });
  });

  describe("inspectElement: invalid/missing selector behavior", () => {
    /**
     * C) Edge/invariant test: inspectElement with an invalid or non-existent
     * selector should return { found: false } rather than throwing.
     */
    it("B2-SV-001 invariant: inspectElement returns found=false for non-existent selector", () => {
      // Call with a selector that matches nothing in the DOM fixture
      const result = inspectElement({ selector: "#this-element-does-not-exist-12345" });

      // Should gracefully return found=false, not throw
      expect(result).toHaveProperty("found", false);
    });

    /**
     * C) Edge/invariant test: inspectElement with no ref and no selector should
     * return an error result rather than throwing.
     */
    it("B2-SV-001 invariant: inspectElement returns error for empty args", () => {
      // @ts-expect-error — intentionally passing empty object to test validation
      const result = inspectElement({});
      // Should either return found: false or have an error field
      expect(result.found === false || "error" in result).toBe(true);
    });
  });

  describe("getDomExcerpt: maxLength boundary behavior", () => {
    /**
     * C) Edge/invariant test: getDomExcerpt with maxLength=0 should return
     * truncated=true with empty content (edge case at boundary).
     */
    it("B2-SV-001 invariant: getDomExcerpt with maxLength=0 returns truncated empty result", () => {
      const result = getDomExcerpt("#main", 3, 0);

      expect(result.found).toBe(true);
      // With maxLength=0, html should be empty and truncated should be true
      expect(result.truncated).toBe(true);
      expect(result.html).toBe("");
    });

    /**
     * C) Edge/invariant test: getDomExcerpt with very large maxLength should not
     * truncate and should include full content.
     */
    it("B2-SV-001 invariant: getDomExcerpt with very large maxLength returns full content (not truncated)", () => {
      const result = getDomExcerpt("#main", 3, 999999);

      expect(result.found).toBe(true);
      // With a large enough maxLength, truncation should not occur
      expect(result.truncated).toBe(false);
      // html should be present and non-empty
      expect(result.html).toBeDefined();
      expect(result.html!.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Default retention size constant
  // ══════════════════════════════════════════════════════════════════════════════

  describe("DEFAULT_RETENTION_SIZE constant", () => {
    it("DEFAULT_RETENTION_SIZE equals 5", () => {
      expect(DEFAULT_RETENTION_SIZE).toBe(5);
    });
  });
});
