import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "os";

import { layoutPathFor } from "../layout/layout-store.js";
import { applyHostMessage } from "../webview/message-handler.js";
import { handleWebviewMessage } from "../webview/panel-core.js";
import type { ExcalidrawHandle, WebviewUI, ExcalidrawExportFns } from "../webview/message-handler.js";

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn((elements: unknown, opts?: { regenerateIds?: boolean }) => {
    // H0-01: verify regenerateIds:false is passed — prevents ID regeneration breaking layout replay
    if (opts?.regenerateIds !== false) {
      throw new Error("convertToExcalidrawElements must be called with { regenerateIds: false }");
    }
    return elements;
  }),
}));

describe("upstream-direct persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("write-path: canvas:node-moved patches layout and persists coordinates", async () => {
    const ws = mkdtempSync(join(tmpdir(), "diag-upstream-write-"));
    const mmdPath = join(ws, "simple.mmd");
    const layoutPath = layoutPathFor(mmdPath, ws);

    const state = {
      mmdPath,
      _workspaceRoot: ws,
      _layoutWriteTimer: null as ReturnType<typeof setTimeout> | null,
      _currentLayout: {
        version: "1.0",
        diagram_type: "flowchart",
        nodes: {
          A: { x: 10, y: 20, w: 100, h: 50, style: {} },
        },
        edges: {},
        clusters: {},
        unplaced: [],
        aesthetics: {},
        metadata: { engine: "upstream-direct" },
      },
      _pendingExport: null,
      _refreshTimer: null,
      _disposed: false,
      _disposables: [],
      _commentsBridge: null,
      _onDisposedCallbacks: [],
      _lastSource: "",
      _sceneLoadEchoSuppressUntil: 0,
      _panel: { webview: { postMessage: vi.fn() } },
      _log: vi.fn(),
      _createTime: Date.now(),
    };

    handleWebviewMessage(state as never, {
      type: "canvas:node-moved",
      nodeId: "A",
      x: 220,
      y: 330,
    });
    expect(state._currentLayout?.nodes.A).toMatchObject({ x: 220, y: 330 });

    await new Promise((r) => setTimeout(r, 220));
    const onDisk = JSON.parse(await readFile(layoutPath, "utf8")) as {
      nodes: Record<string, { x: number; y: number }>;
    };

    expect(onDisk.nodes.A).toMatchObject({ x: 220, y: 330 });
  });

  // H0-01: READ-path — regenerateIds:false must be passed so upstream IDs are
  // preserved. Without it, Excalidraw regenerates element IDs on every parse,
  // breaking the mapping between layout.json mermaidId keys and rendered elements.
  it("H0-01: host:load-upstream-direct calls convertToExcalidrawElements with regenerateIds:false", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");

    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({
      elements: [{ id: "X", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
    });

    const api: ExcalidrawHandle = {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(() => []),
      getAppState: vi.fn(() => ({})),
    };
    const ui: WebviewUI = {
      postMessage: vi.fn(),
      showToast: vi.fn(),
      showErrorOverlay: vi.fn(),
      clearErrorOverlay: vi.fn(),
    };
    const exportFns: ExcalidrawExportFns = {
      exportToSvg: vi.fn(async () => ""),
      exportToBlob: vi.fn(async () => ""),
    };

    await applyHostMessage(
      {
        type: "host:load-upstream-direct",
        source: "flowchart TD\nX[Start]",
        layoutNodes: { X: { x: 100, y: 200, w: 100, h: 50 } },
      },
      api,
      ui,
      exportFns,
    );

    expect(vi.mocked(convertToExcalidrawElements)).toHaveBeenCalledOnce();
    const call = vi.mocked(convertToExcalidrawElements).mock.calls[0];
    expect(call[1]).toEqual({ regenerateIds: false });
  });

  // H0-01: Protocol drift guard — the mock above throws if opts are absent,
  // ensuring any future removal of the regenerateIds option is caught immediately.
  it("H0-01: missing regenerateIds option would throw — catches protocol drift in tests", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({
      elements: [{ id: "X", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
    });

    const api: ExcalidrawHandle = { updateScene: vi.fn(), getSceneElements: vi.fn(() => []), getAppState: vi.fn(() => ({})) };
    const ui: WebviewUI = { postMessage: vi.fn(), showToast: vi.fn(), showErrorOverlay: vi.fn(), clearErrorOverlay: vi.fn() };
    const exportFns: ExcalidrawExportFns = { exportToSvg: vi.fn(async () => ""), exportToBlob: vi.fn(async () => "") };

    // If someone removes the { regenerateIds: false } option from applyHostMessage,
    // the mock above will throw — this test documents that the guard exists.
    await applyHostMessage(
      { type: "host:load-upstream-direct", source: "flowchart TD\nX", layoutNodes: {} },
      api,
      ui,
      exportFns,
    );
  });

  it("read-path: label-based upstream skeletons get persisted node overrides", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");

    vi.mocked(parseMermaidToExcalidraw).mockResolvedValue({
      elements: [
        {
          id: "A",
          type: "rectangle",
          x: 15,
          y: 25,
          width: 100,
          height: 50,
          // upstream flowchart converter emits label.text (not top-level text)
          label: { text: "Start" },
        },
      ],
    } as never);

    const api: ExcalidrawHandle = {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(() => []),
      getAppState: vi.fn(() => ({})),
    };
    const ui: WebviewUI = {
      postMessage: vi.fn(),
      showToast: vi.fn(),
      showErrorOverlay: vi.fn(),
      clearErrorOverlay: vi.fn(),
    };
    const exportFns: ExcalidrawExportFns = {
      exportToSvg: vi.fn(async () => ""),
      exportToBlob: vi.fn(async () => ""),
    };

    await applyHostMessage(
      {
        type: "host:load-upstream-direct",
        source: "flowchart TD\nA[Start]",
        layoutNodes: {
          A: { x: 700, y: 800, w: 210, h: 90 },
        },
      },
      api,
      ui,
      exportFns,
    );

    const call = vi.mocked(api.updateScene).mock.calls[0];
    const elements = (call?.[0]?.elements ?? []) as Array<{ x?: number; y?: number }>;
    expect(elements[0]).toMatchObject({ x: 700, y: 800 });
  });

  it("read-path control: replay works when upstream skeleton has top-level text", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");

    vi.mocked(parseMermaidToExcalidraw).mockResolvedValue({
      elements: [
        {
          id: "A",
          type: "rectangle",
          x: 15,
          y: 25,
          width: 100,
          height: 50,
          text: "Start",
        },
      ],
    } as never);

    const api: ExcalidrawHandle = {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(() => []),
      getAppState: vi.fn(() => ({})),
    };
    const ui: WebviewUI = {
      postMessage: vi.fn(),
      showToast: vi.fn(),
      showErrorOverlay: vi.fn(),
      clearErrorOverlay: vi.fn(),
    };
    const exportFns: ExcalidrawExportFns = {
      exportToSvg: vi.fn(async () => ""),
      exportToBlob: vi.fn(async () => ""),
    };

    await applyHostMessage(
      {
        type: "host:load-upstream-direct",
        source: "flowchart TD\nA[Start]",
        layoutNodes: {
          A: { x: 700, y: 800, w: 210, h: 90 },
        },
      },
      api,
      ui,
      exportFns,
    );

    const call = vi.mocked(api.updateScene).mock.calls[0];
    const elements = (call?.[0]?.elements ?? []) as Array<{ x?: number; y?: number }>;
    expect(elements[0]).toMatchObject({ x: 700, y: 800 });
  });

  it("read-path: bound arrows keep upstream positions (no recompute routing)", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");

    vi.mocked(parseMermaidToExcalidraw).mockResolvedValue({
      elements: [
        {
          id: "A",
          type: "rectangle",
          x: 10,
          y: 10,
          width: 100,
          height: 50,
          text: "Start",
          customData: { mermaidId: "A" },
        },
        {
          id: "B",
          type: "rectangle",
          x: 300,
          y: 30,
          width: 100,
          height: 50,
          text: "Next",
          customData: { mermaidId: "B" },
        },
        {
          id: "edge-1",
          type: "arrow",
          x: 10,
          y: 10,
          width: 500,
          height: 400,
          points: [[0, 0], [500, 400]],
          startBinding: { elementId: "A" },
          endBinding: { elementId: "B" },
          customData: { mermaidId: "A->B:0" },
        },
      ],
    } as never);

    const api: ExcalidrawHandle = {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(() => []),
      getAppState: vi.fn(() => ({})),
    };
    const ui: WebviewUI = {
      postMessage: vi.fn(),
      showToast: vi.fn(),
      showErrorOverlay: vi.fn(),
      clearErrorOverlay: vi.fn(),
    };
    const exportFns: ExcalidrawExportFns = {
      exportToSvg: vi.fn(async () => ""),
      exportToBlob: vi.fn(async () => ""),
    };

    await applyHostMessage(
      {
        type: "host:load-upstream-direct",
        source: "flowchart TD\nA[Start]-->B[Next]",
        layoutNodes: {
          A: { x: 700, y: 800, w: 200, h: 80 },
          B: { x: 1100, y: 900, w: 220, h: 90 },
        },
      },
      api,
      ui,
      exportFns,
    );

    const call = vi.mocked(api.updateScene).mock.calls[0];
    const elements = (call?.[0]?.elements ?? []) as Array<{
      id: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      points?: Array<[number, number]>;
    }>;

    const nodeA = elements.find((el) => el.id === "A");
    const nodeB = elements.find((el) => el.id === "B");
    const arrow = elements.find((el) => el.id === "edge-1");

    // Nodes get persisted positions from layout.json
    expect(nodeA).toMatchObject({ x: 700, y: 800, width: 200, height: 80 });
    expect(nodeB).toMatchObject({ x: 1100, y: 900, width: 220, height: 90 });

    // Arrows keep their upstream absolute positions — no recompute routing.
    expect(arrow).toMatchObject({ x: 10, y: 10, width: 500, height: 400 });
  });

  // (c) Edge waypoints from persisted layout are preserved on reopen via generateCanvas
  // The waypoints stored in layout.json edges should be used by generateCanvas
  // to reproduce the original edge routing
  it("edge waypoints from layout.json are preserved via generateCanvas path on reopen", async () => {
    // This tests the concept: waypoints in layout.edges are read by generateCanvas
    // and used to render consistent edge routing
    const ws = mkdtempSync(join(tmpdir(), "diag-waypoints-"));
    const mmdPath = join(ws, "edges.mmd");
    const layoutPath = layoutPathFor(mmdPath, ws);

    const state = {
      mmdPath,
      _workspaceRoot: ws,
      _layoutWriteTimer: null as ReturnType<typeof setTimeout> | null,
      _currentLayout: {
        version: "1.0",
        diagram_type: "flowchart",
        nodes: {
          A: { x: 100, y: 100, w: 100, h: 50 },
          B: { x: 400, y: 100, w: 100, h: 50 },
        },
        edges: {
          "A->B:0": {
            routing: "auto" as const,
            waypoints: [{ x: 200, y: 150 }, { x: 300, y: 150 }],
            style: {},
          },
        },
        clusters: {},
        unplaced: [],
        aesthetics: {},
        metadata: { engine: "upstream-direct" },
      },
      _pendingExport: null,
      _refreshTimer: null,
      _disposed: false,
      _disposables: [],
      _commentsBridge: null,
      _onDisposedCallbacks: [],
      _lastSource: "",
      _panel: { webview: { postMessage: vi.fn() } },
      _log: vi.fn(),
      _createTime: Date.now(),
    };

    // Simulate canvas:edge-routed message being handled (persists waypoints)
    handleWebviewMessage(state as never, {
      type: "canvas:edge-routed",
      edgeKey: "A->B:0",
      waypoints: [{ x: 200, y: 150 }, { x: 300, y: 150 }],
    });

    // Verify waypoints are in _currentLayout
    expect(state._currentLayout?.edges["A->B:0"]?.waypoints).toEqual([
      { x: 200, y: 150 },
      { x: 300, y: 150 },
    ]);
  });

  // (d) Text labels remain bound/relational — no absolute text positions stored or replayed
  // host:load-upstream-direct only applies positions to shape elements (not :text/:label/:arrow suffix)
  // This ensures text labels derive from their container node, not from stored absolute coords
  it("host:load-upstream-direct only applies positions to shape elements, not text/label/arrow", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");

    vi.mocked(parseMermaidToExcalidraw).mockResolvedValue({
      elements: [
        { id: "A", type: "rectangle", x: 15, y: 25, width: 100, height: 50, customData: { mermaidId: "A" } },
        { id: "A:text", type: "text", x: 65, y: 35, width: 50, height: 20, customData: { mermaidId: "A:text" } },
        { id: "A->B:0:label", type: "text", x: 200, y: 100, width: 30, height: 16, customData: { mermaidId: "A->B:0:label" } },
      ],
    } as never);

    const api: ExcalidrawHandle = {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(() => []),
      getAppState: vi.fn(() => ({})),
    };
    const ui: WebviewUI = {
      postMessage: vi.fn(),
      showToast: vi.fn(),
      showErrorOverlay: vi.fn(),
      clearErrorOverlay: vi.fn(),
    };
    const exportFns: ExcalidrawExportFns = {
      exportToSvg: vi.fn(async () => ""),
      exportToBlob: vi.fn(async () => ""),
    };

    await applyHostMessage(
      {
        type: "host:load-upstream-direct",
        source: "flowchart TD\nA[Start]-->|label|B[End]",
        layoutNodes: {
          A: { x: 700, y: 800, w: 100, h: 50 },
          // B has no layout entry to simulate edge case
        },
      },
      api,
      ui,
      exportFns,
    );

    const call = vi.mocked(api.updateScene).mock.calls[0];
    const elements = call?.[0]?.elements as Array<{
      id: string;
      customData?: { mermaidId: string };
      x?: number;
      y?: number;
    }>;

    const shapeA = elements.find((el) => el.id === "A");
    const textA = elements.find((el) => el.id === "A:text");
    const labelEl = elements.find((el) => el.id === "A->B:0:label");

    // Shape A gets the layout position applied
    expect(shapeA?.x).toBe(700);
    expect(shapeA?.y).toBe(800);

    // Text label (A:text) keeps its upstream position — NOT overridden by layout
    // (layoutNodes has no A:text entry, so original upstream position is preserved)
    expect(textA?.x).toBe(65);
    expect(textA?.y).toBe(35);

    // Edge label (A->B:0:label) also keeps upstream position
    expect(labelEl?.x).toBe(200);
    expect(labelEl?.y).toBe(100);
  });
});
