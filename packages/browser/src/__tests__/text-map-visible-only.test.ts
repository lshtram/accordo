import { describe, expect, it, vi } from "vitest";
import { buildTextMapTool, type GetTextMapArgs } from "../text-map-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import type { BrowserRelayLike } from "../types.js";

function createRelay() {
  return {
    request: vi.fn().mockResolvedValue({
      success: true,
      requestId: "test",
      data: {
        pageId: "p1",
        frameId: "main",
        snapshotId: "p1:1",
        capturedAt: "2025-01-01T00:00:00.000Z",
        viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        pageUrl: "https://example.com",
        title: "Example",
        segments: [
          { textRaw: "A", textNormalized: "A", nodeId: 0, bbox: { x: 0, y: 0, width: 10, height: 10 }, visibility: "visible", readingOrderIndex: 0 },
          { textRaw: "B", textNormalized: "B", nodeId: 1, bbox: { x: 0, y: 20, width: 10, height: 10 }, visibility: "visible", readingOrderIndex: 1 },
          { textRaw: "C", textNormalized: "C", nodeId: 2, bbox: { x: 0, y: 40, width: 10, height: 10 }, visibility: "visible", readingOrderIndex: 2 },
        ],
        totalSegments: 3,
        truncated: false,
      },
    }),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

describe("text map visibleOnly contract", () => {
  it("exposes visibleOnly in the public input schema and description", () => {
    const tool = buildTextMapTool(createRelay(), new SnapshotRetentionStore());

    expect(tool.inputSchema.properties.visibleOnly).toEqual({
      type: "boolean",
      description: "When true, return only segments with visibility='visible'.",
    });
    expect(tool.description).toContain("bbox");
    expect(tool.description).toContain("visibleOnly=true");
    expect(tool.description).not.toContain("isVisible");
    expect(tool.description).not.toContain("isInViewport");
  });

  it("forwards visibleOnly to the relay payload", async () => {
    const relay = createRelay();
    const tool = buildTextMapTool(relay, new SnapshotRetentionStore());

    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({ visibleOnly: true });

    expect(relay.request).toHaveBeenCalledWith(
      "get_text_map",
      expect.objectContaining({ visibleOnly: true }),
      expect.any(Number),
    );
  });

  it("keeps pagination metadata aligned with the filtered visibleOnly set", async () => {
    const relay = createRelay();
    const tool = buildTextMapTool(relay, new SnapshotRetentionStore());

    const result = await (tool.handler as (args: GetTextMapArgs) => Promise<any>)({
      visibleOnly: true,
      offset: 1,
      limit: 1,
    });

    expect(result.segments.map((segment: { textNormalized: string }) => segment.textNormalized)).toEqual(["B"]);
    expect(result.totalAvailable).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(2);
  });
});
