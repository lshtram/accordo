import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDiffSnapshots } from "../src/relay-diff-snapshots-handler.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("diff implicit target fallback", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("uses the shared implicit target when store lookup misses and tabId is omitted", async () => {
    chrome.tabs.query = vi.fn().mockResolvedValue([
      { id: 33, url: "https://focused.example", active: true, windowId: 8 },
    ] as chrome.tabs.Tab[]);
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({
      data: {
        pageId: "p1",
        frameId: "main",
        snapshotId: "p1:9",
        capturedAt: "2025-01-01T00:00:00Z",
        viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        fromSnapshotId: "missing:1",
        toSnapshotId: "missing:2",
        added: [],
        removed: [],
        changed: [],
        summary: { addedCount: 0, removedCount: 0, changedCount: 0, textDelta: "no changes" },
      },
    });

    const response = await handleDiffSnapshots({
      requestId: "diff-implicit",
      action: "diff_snapshots",
      payload: { fromSnapshotId: "missing:1", toSnapshotId: "missing:2" },
    } as never);

    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      33,
      expect.objectContaining({ action: "diff_snapshots" }),
    );
    expect(response.success).toBe(true);
  });
});
