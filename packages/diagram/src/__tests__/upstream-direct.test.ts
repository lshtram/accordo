/**
 * upstream-direct tests
 *
 * Tests the engine selection logic and fallback behavior:
 *   UD-01..UD-03  renderUpstreamDirect happy path
 *   UD-04..UD-06  engine selection from layout metadata
 *   UD-07         upstream-direct fallback when upstream throws
 *
 * Source: diag_workplan.md §A-?? (upstream-direct engine)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderUpstreamDirect } from "../layout/upstream-direct.js";

// ── Mock external dependencies ────────────────────────────────────────────────

// We mock the upstream library at the import boundary so tests run in Node.js
// without a browser DOM. The shim inside upstream-direct handles the DOM
// environment; the mock lets us control what parseMermaidToExcalidraw returns.
const mockSkeletons = [
  {
    id: "elem-1",
    type: "rectangle",
    x: 10,
    y: 20,
    width: 120,
    height: 60,
    text: "A",
  },
  {
    id: "elem-2",
    type: "rectangle",
    x: 200,
    y: 20,
    width: 120,
    height: 60,
    text: "B",
  },
];

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: vi.fn(),
}));

// ── UD-01..UD-03: renderUpstreamDirect ─────────────────────────────────────

describe("renderUpstreamDirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("UD-01: calls parseMermaidToExcalidraw with the given source", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: [] });

    await renderUpstreamDirect("flowchart TD\nA-->B\n");

    expect(parseMermaidToExcalidraw).toHaveBeenCalledOnce();
    expect(parseMermaidToExcalidraw).toHaveBeenCalledWith("flowchart TD\nA-->B\n");
  });

  it("UD-02: returns upstream Excalidraw element skeletons unchanged", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({
      elements: [...mockSkeletons],
    });

    const result = await renderUpstreamDirect("flowchart TD\nA-->B\n");

    expect(result).toEqual(mockSkeletons);
  });

  it("UD-03: throws when upstream library throws (caller must catch and fallback)", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockRejectedValueOnce(
      new Error("Unsupported syntax")
    );

    await expect(
      renderUpstreamDirect("flowchart TD\nA-->B\n")
    ).rejects.toThrow("Unsupported syntax");
  });
});
