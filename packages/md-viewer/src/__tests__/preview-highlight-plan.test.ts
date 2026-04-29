/**
 * Preview highlight planning tests.
 *
 * Requirements tested:
 *   M41b-HLT-02  apply command accepts one object-shaped args payload
 *   M41b-HLT-03  source line ranges map to unique rendered block IDs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewHighlightApplyArgs } from "@accordo/capabilities";
import { CommentablePreview } from "../commentable-preview.js";

interface PreviewHighlightApi {
  applyHighlight?: (args: PreviewHighlightApplyArgs) => boolean;
}

function makePanel() {
  return {
    reveal: vi.fn(),
    webview: {
      postMessage: vi.fn().mockResolvedValue(true),
    },
  };
}

describe("PreviewHighlightPlan (M41b-HLT-02, M41b-HLT-03)", () => {
  beforeEach(() => {
    CommentablePreview.livePanels.clear();
    CommentablePreview.liveResolvers.clear();
    CommentablePreview.readyUris.clear();
    vi.clearAllMocks();
  });

  it("M41b-HLT-02: applyHighlight accepts one object payload and posts the decoration metadata unchanged", () => {
    const api = CommentablePreview as unknown as PreviewHighlightApi;
    expect(typeof api.applyHighlight).toBe("function");
    if (!api.applyHighlight) return;

    const uri = "file:///workspace/README.md";
    const panel = makePanel();
    const resolver = { blockIdToLine: vi.fn(), lineToBlockId: vi.fn().mockReturnValue("block-a") };
    CommentablePreview.livePanels.set(uri, panel as never);
    CommentablePreview.liveResolvers.set(uri, resolver);
    CommentablePreview.readyUris.add(uri);

    const args: PreviewHighlightApplyArgs = {
      uri,
      decorationId: "accordo-decoration-1",
      startLine: 4,
      endLine: 6,
      color: "rgba(255,0,0,0.5)",
    };

    expect(api.applyHighlight(args)).toBe(true);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "preview:applyHighlight",
      decorationId: "accordo-decoration-1",
      blockIds: ["block-a"],
      color: "rgba(255,0,0,0.5)",
    });
  });

  it("M41b-HLT-03: maps every source line in the inclusive range and de-duplicates block IDs", () => {
    const api = CommentablePreview as unknown as PreviewHighlightApi;
    expect(typeof api.applyHighlight).toBe("function");
    if (!api.applyHighlight) return;

    const uri = "file:///workspace/README.md";
    const panel = makePanel();
    const lineToBlockId = vi.fn((line: number) => {
      if (line === 4 || line === 5) return "paragraph-a";
      if (line === 6) return "paragraph-b";
      return null;
    });
    CommentablePreview.livePanels.set(uri, panel as never);
    CommentablePreview.liveResolvers.set(uri, { blockIdToLine: vi.fn(), lineToBlockId });
    CommentablePreview.readyUris.add(uri);

    expect(api.applyHighlight({
      uri,
      decorationId: "accordo-decoration-2",
      startLine: 4,
      endLine: 6,
      color: "rgba(255,255,0,0.3)",
    })).toBe(true);

    expect(lineToBlockId).toHaveBeenCalledTimes(3);
    expect(lineToBlockId).toHaveBeenNthCalledWith(1, 4);
    expect(lineToBlockId).toHaveBeenNthCalledWith(2, 5);
    expect(lineToBlockId).toHaveBeenNthCalledWith(3, 6);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ blockIds: ["paragraph-a", "paragraph-b"] }),
    );
  });
});
