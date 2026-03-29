/**
 * M101-DIFF — diff-engine.test.ts
 *
 * Tests for M101-DIFF — Diff Snapshots Engine (B2-DE-001..B2-DE-007).
 *
 * These tests validate the pure diff computation functions:
 * - B2-DE-002: computeDiff returns added, removed, changed arrays
 * - B2-DE-005: summary counts match array lengths
 * - B2-DE-006: snapshot-not-found error for missing snapshots
 * - B2-DE-007: snapshot-stale error for pre-navigation snapshots
 *
 * The diff engine operates entirely on in-memory VersionedSnapshot data
 * with no DOM access or Chrome APIs.
 *
 * API checklist (computeDiff):
 * - returns added array    → B2-DE-002: 3 tests (add, remove, change text, no change)
 * - returns removed array  → B2-DE-002: 2 tests
 * - returns changed array  → B2-DE-002: 2 tests
 * - returns summary       → B2-DE-005: 2 tests
 *
 * API checklist (flattenNodes):
 * - extracts nodeId, persistentId, tag, text, role, id → 2 tests
 *
 * API checklist (buildNodeIndex):
 * - builds persistentId → FlatNode map → 1 test
 *
 * API checklist (formatTextDelta):
 * - formats human-readable delta string → 2 tests
 *
 * API checklist (DiffError):
 * - snapshot-not-found → B2-DE-006: 1 test
 * - snapshot-stale     → B2-DE-007: 1 test
 */

import { describe, it, expect } from "vitest";
import {
  computeDiff,
  flattenNodes,
  buildNodeIndex,
  formatTextDelta,
  DiffNode,
  DiffChange,
  DiffSummary,
  DiffResult,
  DiffError,
} from "../src/diff-engine.js";
import type { VersionedSnapshot, NodeIdentity } from "../src/snapshot-versioning.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────────

function makeNodeIdentity(
  tag: string,
  nodeId: number,
  opts: { id?: string; text?: string; role?: string; persistentId?: string; children?: NodeIdentity[] } = {}
): NodeIdentity {
  return {
    tag,
    nodeId,
    id: opts.id,
    text: opts.text,
    role: opts.role,
    persistentId: opts.persistentId,
    children: opts.children ?? [],
  };
}

function makeVersionedSnapshot(
  pageId: string,
  version: number,
  nodes: NodeIdentity[]
): VersionedSnapshot {
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

// ── B2-DE-002: Diff between two snapshots ─────────────────────────────────────

describe("B2-DE-002: computeDiff returns added, removed, changed arrays", () => {
  /**
   * B2-DE-002: When a <div> is added between snapshots,
   * the `added` array contains a node with the correct `tag` and `text`.
   */
  it("B2-DE-002: added element appears in added array with correct tag", () => {
    const from = makeVersionedSnapshot("page-1", 0, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("body", 1, { persistentId: "body:0:" }),
    ]);

    const to = makeVersionedSnapshot("page-1", 1, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("body", 1, { persistentId: "body:0:" }),
      makeNodeIdentity("div", 2, { persistentId: "div:0:Hello", text: "Hello" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.added).toBeDefined();
    expect(Array.isArray(result!.added)).toBe(true);
    expect(result!.added.length).toBeGreaterThan(0);
    const addedDiv = result!.added.find((n: DiffNode) => n.tag === "div");
    expect(addedDiv).toBeDefined();
    expect(addedDiv!.text).toBe("Hello");
  });

  it("B2-DE-002: removed element appears in removed array with correct tag", () => {
    const from = makeVersionedSnapshot("page-2", 0, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("body", 1, { persistentId: "body:0:" }),
      makeNodeIdentity("div", 2, { persistentId: "div:0:Goodbye", text: "Goodbye" }),
    ]);

    const to = makeVersionedSnapshot("page-2", 1, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("body", 1, { persistentId: "body:0:" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.removed).toBeDefined();
    expect(Array.isArray(result!.removed)).toBe(true);
    expect(result!.removed.length).toBeGreaterThan(0);
    const removedDiv = result!.removed.find((n: DiffNode) => n.tag === "div");
    expect(removedDiv).toBeDefined();
    expect(removedDiv!.text).toBe("Goodbye");
  });

  it("B2-DE-002: changed text content appears in changed array with field=textContent", () => {
    const from = makeVersionedSnapshot("page-3", 0, [
      makeNodeIdentity("div", 0, { id: "msg", persistentId: "div:msg:Hello", text: "Hello" }),
    ]);

    const to = makeVersionedSnapshot("page-3", 1, [
      makeNodeIdentity("div", 0, { id: "msg", persistentId: "div:msg:Hello", text: "Hello World" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.changed).toBeDefined();
    expect(Array.isArray(result!.changed)).toBe(true);
    expect(result!.changed.length).toBeGreaterThan(0);
    const textChange = result!.changed.find((c: DiffChange) => c.field === "textContent");
    expect(textChange).toBeDefined();
    expect(textChange!.before).toBe("Hello");
    expect(textChange!.after).toBe("Hello World");
  });

  it("B2-DE-002: changed attribute appears in changed array with field=attribute:...", () => {
    const from = makeVersionedSnapshot("page-4", 0, [
      makeNodeIdentity("input", 0, { id: "field", persistentId: "input:field:", role: "textbox" }),
    ]);

    const to = makeVersionedSnapshot("page-4", 1, [
      makeNodeIdentity("input", 0, { id: "field", persistentId: "input:field:", role: "button" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.changed).toBeDefined();
    const roleChange = result!.changed.find((c: DiffChange) => c.field === "role");
    expect(roleChange).toBeDefined();
    expect(roleChange!.before).toBe("textbox");
    expect(roleChange!.after).toBe("button");
  });

  it("B2-DE-002: no changes — all arrays are empty", () => {
    const from = makeVersionedSnapshot("page-5", 0, [
      makeNodeIdentity("div", 0, { id: "a", persistentId: "div:a:foo", text: "foo" }),
      makeNodeIdentity("span", 1, { id: "b", persistentId: "span:b:bar", text: "bar" }),
    ]);

    const to = makeVersionedSnapshot("page-5", 1, [
      makeNodeIdentity("div", 0, { id: "a", persistentId: "div:a:foo", text: "foo" }),
      makeNodeIdentity("span", 1, { id: "b", persistentId: "span:b:bar", text: "bar" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.added).toHaveLength(0);
    expect(result!.removed).toHaveLength(0);
    expect(result!.changed).toHaveLength(0);
  });

  it("B2-DE-002: complex page with multiple adds/removes/changes", () => {
    const from = makeVersionedSnapshot("page-6", 0, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("body", 1, { persistentId: "body:0:" }),
      makeNodeIdentity("div", 2, { id: "header", persistentId: "div:header:Old Header", text: "Old Header" }),
      makeNodeIdentity("div", 3, { id: "sidebar", persistentId: "div:sidebar:", text: "" }),
    ]);

    const to = makeVersionedSnapshot("page-6", 1, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("body", 1, { persistentId: "body:0:" }),
      makeNodeIdentity("div", 2, { id: "header", persistentId: "div:header:Old Header", text: "New Header" }), // changed
      makeNodeIdentity("nav", 4, { id: "newnav", persistentId: "nav:newnav:Nav", text: "Nav" }), // added
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    // Sidebar removed
    expect(result!.removed.some((n: DiffNode) => n.id === "sidebar")).toBe(true);
    // New nav added
    expect(result!.added.some((n: DiffNode) => n.id === "newnav")).toBe(true);
    // Header text changed
    const headerChange = result!.changed.find((c: DiffChange) => c.field === "textContent");
    expect(headerChange).toBeDefined();
    expect(headerChange!.before).toBe("Old Header");
    expect(headerChange!.after).toBe("New Header");
  });
});

// ── B2-DE-005: Diff summary ───────────────────────────────────────────────────

describe("B2-DE-005: computeDiff returns summary with counts matching array lengths", () => {
  it("B2-DE-005: summary.addedCount matches added.length", () => {
    const from = makeVersionedSnapshot("page-s1", 0, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
    ]);
    const to = makeVersionedSnapshot("page-s1", 1, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("div", 1, { persistentId: "div:0:a" }),
      makeNodeIdentity("div", 2, { persistentId: "div:0:b" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.summary).toBeDefined();
    expect(result!.summary.addedCount).toBe(result!.added.length);
    expect(result!.summary.addedCount).toBe(2);
  });

  it("B2-DE-005: summary.removedCount matches removed.length", () => {
    const from = makeVersionedSnapshot("page-s2", 0, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("p", 1, { persistentId: "p:0:a" }),
      makeNodeIdentity("p", 2, { persistentId: "p:0:b" }),
    ]);
    const to = makeVersionedSnapshot("page-s2", 1, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.summary.removedCount).toBe(result!.removed.length);
    expect(result!.summary.removedCount).toBe(2);
  });

  it("B2-DE-005: summary.changedCount matches changed.length", () => {
    const from = makeVersionedSnapshot("page-s3", 0, [
      makeNodeIdentity("div", 0, { id: "a", persistentId: "div:a:x", text: "x" }),
      makeNodeIdentity("div", 1, { id: "b", persistentId: "div:b:y", text: "y" }),
    ]);
    const to = makeVersionedSnapshot("page-s3", 1, [
      makeNodeIdentity("div", 0, { id: "a", persistentId: "div:a:x", text: "X" }), // changed
      makeNodeIdentity("div", 1, { id: "b", persistentId: "div:b:y", text: "y" }), // unchanged
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.summary.changedCount).toBe(result!.changed.length);
    expect(result!.summary.changedCount).toBe(1);
  });

  it("B2-DE-005: summary.textDelta is a non-empty human-readable string", () => {
    const from = makeVersionedSnapshot("page-s4", 0, [
      makeNodeIdentity("div", 0, { persistentId: "div:0:" }),
    ]);
    const to = makeVersionedSnapshot("page-s4", 1, [
      makeNodeIdentity("div", 0, { persistentId: "div:0:" }),
      makeNodeIdentity("span", 1, { persistentId: "span:0:" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.summary.textDelta).toBeDefined();
    expect(typeof result!.summary.textDelta).toBe("string");
    expect(result!.summary.textDelta.length).toBeGreaterThan(0);
  });

  it("B2-DE-005: summary reflects zero counts when no changes", () => {
    const from = makeVersionedSnapshot("page-s5", 0, [
      makeNodeIdentity("div", 0, { persistentId: "div:0:", text: "same" }),
    ]);
    const to = makeVersionedSnapshot("page-s5", 1, [
      makeNodeIdentity("div", 0, { persistentId: "div:0:", text: "same" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!.summary.addedCount).toBe(0);
    expect(result!.summary.removedCount).toBe(0);
    expect(result!.summary.changedCount).toBe(0);
    expect(result!.summary.textDelta).toBe("no changes");
  });
});

// ── B2-DE-002 / B2-DE-005: DiffResult extends SnapshotEnvelope ───────────────

describe("B2-DE-002 + B2-DE-005: DiffResult extends SnapshotEnvelope with from/to snapshot IDs", () => {
  it("DiffResult includes fromSnapshotId and toSnapshotId", () => {
    const from = makeVersionedSnapshot("page-env", 0, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
    ]);
    const to = makeVersionedSnapshot("page-env", 1, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
      makeNodeIdentity("body", 1, { persistentId: "body:0:" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    expect(result!).toHaveProperty("fromSnapshotId");
    expect(result!).toHaveProperty("toSnapshotId");
    expect(result!.fromSnapshotId).toBe("page-env:0");
    expect(result!.toSnapshotId).toBe("page-env:1");
  });

  it("DiffResult includes full SnapshotEnvelope from the 'to' snapshot", () => {
    const from = makeVersionedSnapshot("page-env2", 0, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
    ]);
    const to = makeVersionedSnapshot("page-env2", 1, [
      makeNodeIdentity("html", 0, { persistentId: "html:0:" }),
    ]);

    let result: DiffResult | undefined;
    try {
      result = computeDiff(from, to);
    } catch (err) {
      expect.fail(`computeDiff threw unexpectedly: ${(err as Error).message}`);
    }

    expect(result).toBeDefined();
    // SnapshotEnvelope fields
    expect(result!).toHaveProperty("pageId");
    expect(result!).toHaveProperty("frameId");
    expect(result!).toHaveProperty("snapshotId");
    expect(result!).toHaveProperty("capturedAt");
    expect(result!).toHaveProperty("viewport");
    expect(result!).toHaveProperty("source");

    // SnapshotId matches the 'to' snapshot
    expect(result!.snapshotId).toBe("page-env2:1");
    expect(result!.pageId).toBe("page-env2");
    expect(result!.frameId).toBe("main");
    expect(result!.source).toBe("dom");
  });
});

// ── flattenNodes ───────────────────────────────────────────────────────────────

describe("flattenNodes: extracts identity fields from recursive NodeIdentity tree", () => {
  it("extracts nodeId, persistentId, tag, text, role, id from flat node", () => {
    const nodes: NodeIdentity[] = [
      makeNodeIdentity("div", 5, {
        id: "main",
        text: "Hello",
        role: "main",
        persistentId: "div:main:Hello",
        children: [
          makeNodeIdentity("span", 6, {
            id: "child",
            text: "World",
            persistentId: "span:child:World",
          }),
        ],
      }),
    ];

    let flat: ReturnType<typeof flattenNodes>;
    try {
      flat = flattenNodes(nodes);
    } catch (err) {
      expect.fail(`flattenNodes threw unexpectedly: ${(err as Error).message}`);
    }

    expect(flat).toHaveLength(2);
    const [div, span] = flat;

    expect(div.nodeId).toBe(5);
    expect(div.tag).toBe("div");
    expect(div.id).toBe("main");
    expect(div.text).toBe("Hello");
    expect(div.role).toBe("main");
    expect(div.persistentId).toBe("div:main:Hello");

    expect(span.nodeId).toBe(6);
    expect(span.tag).toBe("span");
    expect(span.id).toBe("child");
    expect(span.text).toBe("World");
    expect(span.persistentId).toBe("span:child:World");
  });

  it("returns empty array for empty node list", () => {
    let flat: ReturnType<typeof flattenNodes>;
    try {
      flat = flattenNodes([]);
    } catch (err) {
      expect.fail(`flattenNodes threw unexpectedly: ${(err as Error).message}`);
    }

    expect(flat).toHaveLength(0);
  });
});

// ── buildNodeIndex ────────────────────────────────────────────────────────────

describe("buildNodeIndex: builds persistentId → FlatNode lookup map", () => {
  it("builds map with persistentId as key", () => {
    const flatNodes = [
      { nodeId: 0, persistentId: "div:0:", tag: "div", text: undefined, role: undefined, id: undefined },
      { nodeId: 1, persistentId: "span:1:", tag: "span", text: undefined, role: undefined, id: undefined },
    ];

    let index: ReturnType<typeof buildNodeIndex> | undefined;
    try {
      index = buildNodeIndex(flatNodes);
    } catch (err) {
      expect.fail(`buildNodeIndex threw unexpectedly: ${(err as Error).message}`);
    }

    expect(index).toBeInstanceOf(Map);
    expect(index!.has("div:0:")).toBe(true);
    expect(index!.has("span:1:")).toBe(true);
    expect(index!.get("div:0:")!.nodeId).toBe(0);
    expect(index!.get("span:1:")!.nodeId).toBe(1);
  });
});

// ── formatTextDelta ───────────────────────────────────────────────────────────

describe("formatTextDelta: formats human-readable diff summary string", () => {
  it("formats pluralized 'added' count", () => {
    let result: string;
    try {
      result = formatTextDelta(1, 0, 0);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("1 added");

    try {
      result = formatTextDelta(3, 0, 0);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("3 added");
  });

  it("formats pluralized 'removed' count", () => {
    let result: string;
    try {
      result = formatTextDelta(0, 1, 0);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("1 removed");

    try {
      result = formatTextDelta(0, 2, 0);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("2 removed");
  });

  it("formats pluralized 'changed' count", () => {
    let result: string;
    try {
      result = formatTextDelta(0, 0, 1);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("1 changed");

    try {
      result = formatTextDelta(0, 0, 5);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("5 changed");
  });

  it("formats combined multi-kind changes", () => {
    let result: string;
    try {
      result = formatTextDelta(2, 1, 3);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("2 added, 1 removed, 3 changed");
  });

  it('returns "no changes" when all counts are zero', () => {
    let result: string;
    try {
      result = formatTextDelta(0, 0, 0);
    } catch (err) {
      expect.fail(`formatTextDelta threw unexpectedly: ${(err as Error).message}`);
    }
    expect(result).toBe("no changes");
  });
});

// ── DiffError type ────────────────────────────────────────────────────────────

describe("DiffError: error result types for snapshot-not-found and snapshot-stale", () => {
  it("DiffError allows error: 'snapshot-not-found'", () => {
    const error: DiffError = { success: false, error: "snapshot-not-found" };
    expect(error.success).toBe(false);
    expect(error.error).toBe("snapshot-not-found");
  });

  it("DiffError allows error: 'snapshot-stale'", () => {
    const error: DiffError = { success: false, error: "snapshot-stale" };
    expect(error.success).toBe(false);
    expect(error.error).toBe("snapshot-stale");
  });
});
