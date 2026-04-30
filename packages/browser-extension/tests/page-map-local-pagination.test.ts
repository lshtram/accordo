import { describe, it, expect, beforeEach } from "vitest";
import { handleRelayAction } from "../src/relay-actions.js";
import { defaultStore } from "../src/relay-definitions.js";
import { applyPagination } from "../src/relay-get-page-map-local.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("get_page_map local pagination", () => {
  beforeEach(() => {
    resetChromeMocks();
    defaultStore.clear();
    document.body.innerHTML = `
      <button>One</button><button>Two</button><button>Three</button>
      <button>Four</button><button>Five</button>
    `;
  });

  it("applies offset and limit once and preserves node identity order", async () => {
    const response = await handleRelayAction({
      requestId: "test-pum-pagination",
      action: "get_page_map",
      payload: { interactiveOnly: true, offset: 1, limit: 2 },
    });

    expect(response.success).toBe(true);
    const data = response.data as {
      nodes: Array<{ nodeId: number; uid?: string; ref: string; text?: string; name?: string }>;
      totalAvailable?: number;
      hasMore?: boolean;
      nextOffset?: number;
    };

    expect(data.nodes).toHaveLength(2);
    expect(data.nodes.map((node) => node.nodeId)).toEqual([1, 2]);
    expect(data.nodes.map((node) => node.uid)).toEqual(["main:1", "main:2"]);
    expect(data.nodes.map((node) => node.ref)).toEqual(["ref-1", "ref-2"]);
    expect(data.nodes.map((node) => node.text ?? node.name)).toEqual(["Two", "Three"]);
    expect(data.totalAvailable).toBe(5);
    expect(data.hasMore).toBe(true);
    expect(data.nextOffset).toBe(3);
  });

  it("keeps paginated response nodes structured and stores the full snapshot", async () => {
    document.body.innerHTML = `
      <section id="first"><h2>First</h2><p>Nested one</p></section>
      <section id="second"><h2>Second</h2><p>Nested two</p></section>
    `;

    const response = await handleRelayAction({
      requestId: "test-pum-nested-pagination",
      action: "get_page_map",
      payload: { maxDepth: 3, offset: 0, limit: 1 },
    });

    expect(response.success).toBe(true);
    const data = response.data as {
      pageId: string;
      snapshotId: string;
      nodes: Array<{ id?: string; children?: unknown[] }>;
    };
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0]?.id).toBe("first");
    expect(data.nodes[0]?.children).toEqual(expect.any(Array));

    const stored = await defaultStore.get(data.snapshotId);
    expect("error" in stored).toBe(false);
    expect((stored as { nodes: unknown[] }).nodes).toHaveLength(2);
  });

  it("paginates nested page maps by top-level nodes without duplicate page entries", async () => {
    document.body.innerHTML = `
      <section id="first"><h2>First</h2><p>Nested one</p></section>
      <section id="second"><h2>Second</h2><p>Nested two</p></section>
    `;

    const first = await handleRelayAction({
      requestId: "test-pum-nested-page-1",
      action: "get_page_map",
      payload: { maxDepth: 3, offset: 0, limit: 1 },
    });
    const second = await handleRelayAction({
      requestId: "test-pum-nested-page-2",
      action: "get_page_map",
      payload: { maxDepth: 3, offset: 1, limit: 1 },
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const firstNodes = (first.data as { nodes: Array<{ id?: string; nodeId: number; children?: unknown[] }> }).nodes;
    const secondNodes = (second.data as { nodes: Array<{ id?: string; nodeId: number; children?: unknown[] }> }).nodes;

    expect(firstNodes.map((node) => node.id)).toEqual(["first"]);
    expect(secondNodes.map((node) => node.id)).toEqual(["second"]);
    expect(firstNodes[0]?.children).toEqual(expect.any(Array));
    expect(secondNodes[0]?.children).toEqual(expect.any(Array));
    expect(new Set([...firstNodes, ...secondNodes].map((node) => node.nodeId)).size).toBe(2);
  });

  it("uses top-level node count for pagination metadata when filterSummary counts descendants", () => {
    const result: Record<string, unknown> = {
      nodes: [
        { uid: "main:1", children: [{ uid: "main:2" }] },
        { uid: "main:3", children: [{ uid: "main:4" }] },
      ],
      filterSummary: { totalAfterFilter: 4 },
    };

    applyPagination(result, { offset: 1, limit: 1 });

    expect((result.nodes as unknown[])).toHaveLength(1);
    expect(result.totalAvailable).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextOffset).toBe(2);
  });

  it("diff_snapshots still works after paginated get_page_map calls", async () => {
    document.body.innerHTML = `
      <section id="first"><h2>First</h2><p>Nested one</p></section>
      <section id="second"><h2>Second</h2><p>Nested two</p></section>
    `;
    const first = await handleRelayAction({
      requestId: "test-pum-diff-first",
      action: "get_page_map",
      payload: { maxDepth: 3, offset: 0, limit: 1 },
    });
    expect(first.success).toBe(true);
    const firstSnapshotId = (first.data as { snapshotId: string }).snapshotId;

    document.querySelector("#second p")!.textContent = "Nested two changed";
    const second = await handleRelayAction({
      requestId: "test-pum-diff-second",
      action: "get_page_map",
      payload: { maxDepth: 3, offset: 0, limit: 1 },
    });
    expect(second.success).toBe(true);
    const secondSnapshotId = (second.data as { snapshotId: string }).snapshotId;

    const diff = await handleRelayAction({
      requestId: "test-pum-diff",
      action: "diff_snapshots",
      payload: { fromSnapshotId: firstSnapshotId, toSnapshotId: secondSnapshotId },
    });

    expect(diff.success).toBe(true);
    expect(diff.error).toBeUndefined();
    const diffData = diff.data as {
      added?: Array<{ text?: string }>;
      removed?: Array<{ text?: string }>;
      changed?: unknown[];
      summary?: { addedCount: number; removedCount: number; changedCount: number };
    };
    const summary = diffData.summary;
    expect((summary?.addedCount ?? 0) + (summary?.removedCount ?? 0) + (summary?.changedCount ?? 0)).toBeGreaterThan(0);
    expect(diffData.removed).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Nested two" })]));
    expect(diffData.added).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Nested two changed" })]));
  });
});
