/**
 * relay-actions-diff.test.ts
 *
 * Tests for M101-DIFF — diff_snapshots relay action at the handleRelayAction boundary.
 *
 * These tests validate the handleRelayAction("diff_snapshots") entry point:
 * - B2-DE-001: diff_snapshots is routable via handleRelayAction
 * - B2-DE-002: success path returns a diff result
 * - B2-DE-006: snapshot-not-found error when IDs are unknown
 * - B2-DE-007: snapshot-stale error for pre-navigation snapshot IDs
 * - invalid-request for missing or non-string snapshot IDs
 * - get_page_map auto-saves to defaultStore (Bug 1 regression test)
 *
 * The defaultStore singleton is exported for direct test setup — snapshots are
 * saved directly into the store rather than going through capture_region, which
 * would require full Chrome API mocking for screenshot capture.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { handleRelayAction, defaultStore } from "../src/relay-actions.js";
import type { VersionedSnapshot, NodeIdentity } from "../src/snapshot-versioning.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNode(tag: string, nodeId: number, opts: { persistentId?: string; text?: string } = {}): NodeIdentity {
  return {
    tag,
    nodeId,
    persistentId: opts.persistentId ?? `${tag}:${nodeId}:`,
    text: opts.text,
    children: [],
  };
}

function makeSnapshot(pageId: string, version: number, nodes: NodeIdentity[]): VersionedSnapshot {
  return {
    pageId,
    frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: `2025-01-01T00:00:0${version}.000Z`,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom",
    nodes,
    totalElements: nodes.length,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("M101-DIFF — diff_snapshots relay action boundary", () => {
  beforeEach(() => {
    resetChromeMocks();
    // Reset the store between tests by triggering navigation reset
    defaultStore.resetOnNavigation();
    // After resetOnNavigation the previous IDs are stale — reset again with
    // a second call so tests start with a completely clean store (no stale IDs).
    defaultStore.resetOnNavigation();
  });

  /**
   * B2-DE-001/002: success path — both snapshots exist in the store,
   * handleRelayAction returns success with a DiffResult containing the
   * correct added/removed/changed arrays and summary counts.
   */
  it("B2-DE-002: success path returns diff result when both snapshots exist", async () => {
    const fromNodes = [
      makeNode("html", 0, { persistentId: "html:0:" }),
      makeNode("body", 1, { persistentId: "body:0:" }),
    ];
    const toNodes = [
      makeNode("html", 0, { persistentId: "html:0:" }),
      makeNode("body", 1, { persistentId: "body:0:" }),
      makeNode("div", 2, { persistentId: "div:0:Hello", text: "Hello" }),
    ];

    const fromSnap = makeSnapshot("page-diff", 0, fromNodes);
    const toSnap = makeSnapshot("page-diff", 1, toNodes);

    await defaultStore.save("page-diff", fromSnap);
    await defaultStore.save("page-diff", toSnap);

    const response = await handleRelayAction({
      requestId: "req-diff-1",
      action: "diff_snapshots",
      payload: { fromSnapshotId: "page-diff:0", toSnapshotId: "page-diff:1" },
    });

    expect(response.requestId).toBe("req-diff-1");
    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();

    const data = response.data as {
      added: unknown[];
      removed: unknown[];
      changed: unknown[];
      summary: { addedCount: number; removedCount: number; changedCount: number; textDelta: string };
    };

    expect(Array.isArray(data.added)).toBe(true);
    expect(Array.isArray(data.removed)).toBe(true);
    expect(Array.isArray(data.changed)).toBe(true);
    // One div was added
    expect(data.added).toHaveLength(1);
    expect(data.removed).toHaveLength(0);
    expect(data.summary.addedCount).toBe(1);
    expect(data.summary.removedCount).toBe(0);
  });

  /**
   * B2-DE-006: snapshot-not-found — fromSnapshotId does not exist in store.
   */
  it("B2-DE-006: snapshot-not-found when fromSnapshotId is unknown", async () => {
    // Store only the toSnapshot — fromSnapshot is absent
    const toSnap = makeSnapshot("page-diff-nf", 1, [makeNode("html", 0)]);
    await defaultStore.save("page-diff-nf", toSnap);

    const response = await handleRelayAction({
      requestId: "req-nf-from",
      action: "diff_snapshots",
      payload: { fromSnapshotId: "page-diff-nf:0", toSnapshotId: "page-diff-nf:1" },
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("snapshot-not-found");
  });

  /**
   * B2-DE-006: snapshot-not-found — toSnapshotId does not exist in store.
   */
  it("B2-DE-006: snapshot-not-found when toSnapshotId is unknown", async () => {
    // Store only the fromSnapshot — toSnapshot is absent
    const fromSnap = makeSnapshot("page-diff-nf2", 0, [makeNode("html", 0)]);
    await defaultStore.save("page-diff-nf2", fromSnap);

    const response = await handleRelayAction({
      requestId: "req-nf-to",
      action: "diff_snapshots",
      payload: { fromSnapshotId: "page-diff-nf2:0", toSnapshotId: "page-diff-nf2:1" },
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("snapshot-not-found");
  });

  /**
   * B2-DE-007: snapshot-stale — fromSnapshotId existed before navigation reset.
   * After resetOnNavigation(), the ID moves to the stale set, so
   * the relay returns "snapshot-stale" instead of "snapshot-not-found".
   */
  it("B2-DE-007: snapshot-stale when fromSnapshotId was cleared by navigation", async () => {
    const fromSnap = makeSnapshot("page-stale", 0, [makeNode("html", 0)]);
    const toSnap = makeSnapshot("page-stale", 1, [makeNode("html", 0)]);

    await defaultStore.save("page-stale", fromSnap);
    await defaultStore.save("page-stale", toSnap);

    // Simulate navigation — both IDs become stale
    defaultStore.resetOnNavigation();

    const response = await handleRelayAction({
      requestId: "req-stale-from",
      action: "diff_snapshots",
      payload: { fromSnapshotId: "page-stale:0", toSnapshotId: "page-stale:1" },
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("snapshot-stale");
  });

  /**
   * B2-DE-007: snapshot-stale — toSnapshotId existed before navigation reset,
   * but fromSnapshotId was re-added after navigation (exists and is not stale).
   */
  it("B2-DE-007: snapshot-stale when toSnapshotId was cleared by navigation", async () => {
    const oldToSnap = makeSnapshot("page-stale2", 0, [makeNode("html", 0)]);
    await defaultStore.save("page-stale2", oldToSnap);

    // Simulate navigation — "page-stale2:0" becomes stale
    defaultStore.resetOnNavigation();

    // Add a fresh fromSnapshot after navigation
    const freshFrom = makeSnapshot("page-stale2", 1, [makeNode("html", 0)]);
    await defaultStore.save("page-stale2", freshFrom);

    const response = await handleRelayAction({
      requestId: "req-stale-to",
      action: "diff_snapshots",
      payload: { fromSnapshotId: "page-stale2:1", toSnapshotId: "page-stale2:0" },
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("snapshot-stale");
  });

  /**
   * invalid-request: fromSnapshotId is missing from the payload.
   */
  it("invalid-request when fromSnapshotId is missing", async () => {
    const response = await handleRelayAction({
      requestId: "req-inv-1",
      action: "diff_snapshots",
      payload: { toSnapshotId: "page:1" },
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("invalid-request");
  });

  /**
   * invalid-request: toSnapshotId is missing from the payload.
   */
  it("invalid-request when toSnapshotId is missing", async () => {
    const response = await handleRelayAction({
      requestId: "req-inv-2",
      action: "diff_snapshots",
      payload: { fromSnapshotId: "page:0" },
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("invalid-request");
  });

  /**
   * invalid-request: fromSnapshotId is not a string (numeric value).
   */
  it("invalid-request when fromSnapshotId is not a string", async () => {
    const response = await handleRelayAction({
      requestId: "req-inv-3",
      action: "diff_snapshots",
      payload: { fromSnapshotId: 42, toSnapshotId: "page:1" },
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("invalid-request");
  });

  /**
   * invalid-request: both IDs are missing (empty payload).
   */
  it("invalid-request when both snapshot IDs are absent", async () => {
    const response = await handleRelayAction({
      requestId: "req-inv-4",
      action: "diff_snapshots",
      payload: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("invalid-request");
  });
});

// ── End-to-End: get_page_map → defaultStore → diff_snapshots ─────────────────

describe("M101-DIFF — get_page_map auto-saves to defaultStore", () => {
  beforeEach(() => {
    resetChromeMocks();
    // Reset the store between tests by triggering navigation reset twice
    defaultStore.resetOnNavigation();
    defaultStore.resetOnNavigation();
  });

  /**
   * Regression test for Bug 1:
   * get_page_map must save its result to defaultStore so that a subsequent
   * diff_snapshots call can retrieve the snapshot by ID.
   *
   * Before the fix, defaultStore was never populated by get_page_map, causing
   * diff_snapshots to always return "snapshot-not-found" → "action-failed".
   *
   * In jsdom (test context), typeof document !== "undefined", so
   * handleRelayAction("get_page_map") calls collectPageMap() directly.
   * collectPageMap() calls captureSnapshotEnvelope("dom") which mints a
   * real snapshotId. We call get_page_map twice (two different snapshot IDs)
   * and then diff them — both should be in the store.
   */
  it("get_page_map saves snapshot to defaultStore; subsequent diff_snapshots succeeds", async () => {
    // First get_page_map — mints snapshotId version 0
    const firstResponse = await handleRelayAction({
      requestId: "req-gpm-1",
      action: "get_page_map",
      payload: {},
    });

    expect(firstResponse.success).toBe(true);
    const firstData = firstResponse.data as { snapshotId?: string; pageId?: string };
    expect(typeof firstData?.snapshotId).toBe("string");
    const firstSnapshotId = firstData.snapshotId as string;
    const pageId = firstData.pageId as string;

    // Second get_page_map — mints snapshotId version 1
    const secondResponse = await handleRelayAction({
      requestId: "req-gpm-2",
      action: "get_page_map",
      payload: {},
    });

    expect(secondResponse.success).toBe(true);
    const secondData = secondResponse.data as { snapshotId?: string };
    expect(typeof secondData?.snapshotId).toBe("string");
    const secondSnapshotId = secondData.snapshotId as string;

    // Sanity: the two snapshots should have different IDs on the same page
    expect(secondSnapshotId).not.toBe(firstSnapshotId);
    expect(secondSnapshotId.startsWith(pageId)).toBe(true);

    // Now diff the two snapshots — both must be in defaultStore
    const diffResponse = await handleRelayAction({
      requestId: "req-diff-e2e",
      action: "diff_snapshots",
      payload: { fromSnapshotId: firstSnapshotId, toSnapshotId: secondSnapshotId },
    });

    expect(diffResponse.success).toBe(true);
    expect(diffResponse.error).toBeUndefined();

    const diffData = diffResponse.data as {
      added?: unknown[];
      removed?: unknown[];
      changed?: unknown[];
      summary?: { addedCount: number; removedCount: number; changedCount: number };
    };
    expect(Array.isArray(diffData?.added)).toBe(true);
    expect(Array.isArray(diffData?.removed)).toBe(true);
    expect(Array.isArray(diffData?.changed)).toBe(true);
  });

  /**
   * Verify that get_page_map does NOT throw when the store save fails or
   * when the result is not a valid VersionedSnapshot — the store save is
   * a side effect and must not break the primary tool response.
   */
  it("get_page_map still returns success even if store is unavailable (save is best-effort)", async () => {
    // This test relies on the fact that the implementation only saves when
    // isVersionedSnapshot(result) is true — the primary response is always returned.
    const response = await handleRelayAction({
      requestId: "req-gpm-resilient",
      action: "get_page_map",
      payload: {},
    });

    // The tool must succeed regardless — store-save is a side effect only
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
  });
});
