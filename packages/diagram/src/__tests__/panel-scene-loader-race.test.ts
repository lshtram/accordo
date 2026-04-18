import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HostContext } from "../host/host-context.js";

const mockReadFile = vi.fn();
const mockParseMermaid = vi.fn();
const mockReadLayout = vi.fn();
const mockWriteLayout = vi.fn();
const mockGenerateCanvas = vi.fn();
const mockLayoutWithExcalidraw = vi.fn();
const mockToExcalidrawPayload = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock("../parser/adapter.js", () => ({
  parseMermaid: (...args: unknown[]) => mockParseMermaid(...args),
}));

vi.mock("../layout/layout-store.js", () => ({
  readLayout: (...args: unknown[]) => mockReadLayout(...args),
  writeLayout: (...args: unknown[]) => mockWriteLayout(...args),
  layoutPathFor: vi.fn(() => "/tmp/diagram.layout.json"),
  createEmptyLayout: vi.fn((diagramType: string) => ({
    version: "1.0",
    diagram_type: diagramType,
    nodes: {},
    edges: {},
    clusters: {},
    aesthetics: {},
    unplaced: [],
  })),
}));

vi.mock("../reconciler/reconciler.js", () => ({
  reconcile: vi.fn(),
}));

vi.mock("../canvas/canvas-generator.js", () => ({
  generateCanvas: (...args: unknown[]) => mockGenerateCanvas(...args),
}));

vi.mock("../layout/auto-layout.js", () => ({
  computeInitialLayout: vi.fn(),
}));

vi.mock("../layout/excalidraw-engine.js", () => ({
  layoutWithExcalidraw: (...args: unknown[]) => mockLayoutWithExcalidraw(...args),
}));

vi.mock("../webview/scene-adapter.js", () => ({
  toExcalidrawPayload: (...args: unknown[]) => mockToExcalidrawPayload(...args),
}));

vi.mock("../webview/debug-diagram-json.js", () => ({
  dumpExcalidrawJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../layout/upstream-direct.js", () => ({
  renderUpstreamDirect: vi.fn(),
}));

function makeCtx(): HostContext {
  return {
    state: {
      mmdPath: "/tmp/diagram.mmd",
      _disposed: false,
      _pendingExport: null,
      _refreshTimer: null,
      _layoutWriteTimer: null,
      _disposables: [],
      _commentsBridge: null,
      _onDisposedCallbacks: [],
      _workspaceRoot: "/tmp",
      _lastSource: "",
      _currentLayout: null,
    },
    panel: {
      webview: {
        postMessage: vi.fn().mockResolvedValue(true),
      },
    } as unknown as HostContext["panel"],
    log: vi.fn(),
    createTime: Date.now(),
  };
}

describe("panel-scene-loader race protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue("stateDiagram-v2\n  A --> B\n");
    mockParseMermaid.mockResolvedValue({
      valid: true,
      diagram: { type: "stateDiagram-v2", nodes: {}, edges: [], direction: "TD" },
      error: null,
    });
    mockWriteLayout.mockResolvedValue(undefined);
    mockToExcalidrawPayload.mockImplementation((elements) => elements);
  });

  it("keeps only the latest overlapping load writes and scene post", async () => {
    const { loadAndPost } = await import("../host/panel-scene-loader.js");
    const ctx = makeCtx();

    mockReadLayout.mockResolvedValue(null);

    let releaseFirstLayout: (() => void) | undefined;
    let firstLayoutStartedResolve: (() => void) | undefined;
    const firstLayoutStarted = new Promise<void>((resolve) => {
      firstLayoutStartedResolve = resolve;
    });
    const firstLayout = new Promise<Record<string, unknown>>((resolve) => {
      releaseFirstLayout = () => resolve({
        version: "1.0",
        diagram_type: "stateDiagram-v2",
        nodes: { A: { x: 100, y: 0, w: 100, h: 50, style: {} } },
        edges: {},
        clusters: {},
        aesthetics: {},
        unplaced: [],
      });
    });
    let excalidrawCalls = 0;
    mockLayoutWithExcalidraw.mockImplementation(() => {
      excalidrawCalls += 1;
      if (excalidrawCalls === 1) {
        firstLayoutStartedResolve?.();
        return firstLayout;
      }
      return Promise.resolve({
        version: "1.0",
        diagram_type: "stateDiagram-v2",
        nodes: { A: { x: 200, y: 0, w: 100, h: 50, style: {} } },
        edges: {},
        clusters: {},
        aesthetics: {},
        unplaced: [],
      });
    });

    mockGenerateCanvas.mockImplementation((_diagram, layout) => Promise.resolve({
      elements: [{ id: `scene-${(layout as { nodes: { A: { x: number } } }).nodes.A.x}` }],
      layout,
    }));

    const firstLoad = loadAndPost(ctx);
    await firstLayoutStarted;
    const secondLoad = loadAndPost(ctx);
    await secondLoad;
    releaseFirstLayout?.();
    await firstLoad;

    const writtenXs = mockWriteLayout.mock.calls
      .map((call) => (call[1] as { nodes?: { A?: { x?: number } } }).nodes?.A?.x)
      .filter((x): x is number => typeof x === "number");
    expect(writtenXs).toEqual([200, 200, 200]);

    const loadSceneCalls = vi.mocked(ctx.panel.webview.postMessage).mock.calls
      .map(([msg]) => msg)
      .filter((msg): msg is { type: string; elements: Array<{ id: string }> } =>
        typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "host:load-scene",
      );
    expect(loadSceneCalls).toHaveLength(1);
    expect(loadSceneCalls[0]?.elements).toEqual([{ id: "scene-200" }]);
  });

  it("scales state first-init layout before persisting nodes, clusters, and waypoints", async () => {
    const { loadAndPost } = await import("../host/panel-scene-loader.js");
    const ctx = makeCtx();

    mockReadLayout.mockResolvedValue(null);
    mockParseMermaid.mockResolvedValue({
      valid: true,
      diagram: {
        type: "stateDiagram-v2",
        nodes: {},
        edges: [],
        clusters: [{ id: "Parent", label: "Parent" }],
        direction: "TD",
      },
      error: null,
    });
    mockLayoutWithExcalidraw.mockResolvedValue({
      version: "1.0",
      diagram_type: "stateDiagram-v2",
      nodes: {
        Idle: { x: 100, y: 40, w: 120, h: 60, style: { fill: "#eee" } },
      },
      edges: {
        "Idle->Done:0": {
          routing: "direct",
          waypoints: [{ x: 180, y: 120 }],
          style: { strokeColor: "#333" },
        },
      },
      clusters: {
        Parent: { x: 20, y: 10, w: 240, h: 180, label: "Parent", style: { fill: "#fafafa" } },
      },
      aesthetics: {},
      unplaced: [],
    });
    mockGenerateCanvas.mockImplementation((_diagram, layout) => Promise.resolve({
      elements: [{ id: `scene-${(layout as { nodes: { Idle: { x: number } } }).nodes.Idle.x}` }],
      layout,
    }));

    await loadAndPost(ctx);

    const firstPersistedLayout = mockWriteLayout.mock.calls[0]?.[1] as {
      nodes: { Idle: { x: number; y: number; w: number; h: number; style: Record<string, unknown> } };
      edges: { "Idle->Done:0": { routing: string; waypoints: Array<{ x: number; y: number }>; style: Record<string, unknown> } };
      clusters: { Parent: { x: number; y: number; w: number; h: number; label: string; style: Record<string, unknown> } };
    };

    expect(firstPersistedLayout.nodes.Idle).toMatchObject({
      x: 100,
      y: 40,
      w: 120,
      h: 60,
      style: { fill: "#eee" },
    });
    expect(firstPersistedLayout.edges["Idle->Done:0"]).toEqual({
      routing: "direct",
      waypoints: [{ x: 180, y: 120 }],
      style: { strokeColor: "#333" },
    });
    expect(firstPersistedLayout.clusters.Parent).toMatchObject({
      x: 20,
      y: 10,
      w: 240,
      h: 180,
      label: "Parent",
      style: { fill: "#fafafa" },
    });
  });
});
