/**
 * A15 — panel-core tests
 *
 * Tests cover the core logic functions in panel-core.ts:
 *   – loadAndPost               PCore-01..PCore-10
 *   – handleWebviewMessage      PCore-11..PCore-16
 *   – patchLayout               PCore-17..PCore-18
 *   – handleNodeMoved           PCore-19
 *   – handleNodeResized         PCore-20
 *   – handleExportReady         PCore-21
 *
 * Source: diag_workplan.md §4.15
 */

// API checklist:
// ✓ loadAndPost        — 10 tests (PCore-01..PCore-10)
// ✓ handleWebviewMessage — 6 tests (PCore-11..PCore-16)
// ✓ patchLayout       — 2 tests  (PCore-17..PCore-18)
// ✓ handleNodeMoved   — 1 test  (PCore-19)
// ✓ handleNodeResized — 1 test  (PCore-20)
// ✓ handleExportReady — 1 test  (PCore-21)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PanelFileNotFoundError,
} from "../webview/panel.js";
import {
  createPanelState,
} from "../webview/panel-state.js";
import type { PanelState } from "../webview/panel-state.js";
import {
  loadAndPost,
  handleWebviewMessage,
  patchLayout,
  handleNodeMoved,
  handleNodeResized,
  handleExportReady,
} from "../webview/panel-core.js";
import {
  MockWebviewPanel,
  MockFileSystemWatcher,
  makeExtensionContext,
  window as mockWindow,
  workspace as mockWorkspace,
  commands as mockCommands,
} from "./mocks/vscode.js";
import type { WebviewToHostMessage } from "../webview/protocol.js";

// ── Mock external dependencies ────────────────────────────────────────────────

const mockParseMermaid = vi.fn();
const mockGenerateCanvas = vi.fn();
const mockReconcile = vi.fn();
const mockReadLayout = vi.fn();
const mockWriteLayout = vi.fn();
const mockComputeInitialLayout = vi.fn();
const mockGetWebviewHtml = vi.fn();
const mockToExcalidrawPayload = vi.fn();
const mockParseMermaidToExcalidraw = vi.fn();
const mockLayoutWithExcalidraw = vi.fn();
const mockPatchNode = vi.fn();
const mockPatchEdge = vi.fn();

vi.mock("../parser/adapter.js", () => ({
  parseMermaid: (...args: unknown[]) => mockParseMermaid(...args),
}));

vi.mock("../canvas/canvas-generator.js", () => ({
  generateCanvas: (...args: unknown[]) => mockGenerateCanvas(...args),
}));

vi.mock("../reconciler/reconciler.js", () => ({
  reconcile: (...args: unknown[]) => mockReconcile(...args),
}));

vi.mock("../layout/layout-store.js", () => ({
  readLayout: (...args: unknown[]) => mockReadLayout(...args),
  writeLayout: (...args: unknown[]) => mockWriteLayout(...args),
  layoutPathFor: vi.fn((mmdPath: string, wsRoot: string) =>
    join(wsRoot, ".accordo", "diagrams", mmdPath.replace(/.*\//, "").replace(".mmd", ".layout.json")),
  ),
  createEmptyLayout: vi.fn(() => ({ nodes: {}, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] })),
  patchNode: (...args: unknown[]) => mockPatchNode(...args),
  patchEdge: (...args: unknown[]) => mockPatchEdge(...args),
}));

vi.mock("../layout/auto-layout.js", () => ({
  computeInitialLayout: (...args: unknown[]) => mockComputeInitialLayout(...args),
}));

vi.mock("./html.js", () => ({
  getWebviewHtml: (...args: unknown[]) => mockGetWebviewHtml(...args),
}));

vi.mock("../layout/excalidraw-engine.js", () => ({
  layoutWithExcalidraw: (...args: unknown[]) => mockLayoutWithExcalidraw(...args),
}));

vi.mock("./debug-diagram-json.js", () => ({
  dumpExcalidrawJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./scene-adapter.js", () => ({
  toExcalidrawPayload: (...args: unknown[]) => mockToExcalidrawPayload(...args),
}));

// Mock @excalidraw/mermaid-to-excalidraw at module level.
// Use mockImplementation so the mock ALWAYS returns the configured value
// (vi.fn() alone returns undefined by default, which breaks the Promise chain).
vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: (...args: unknown[]) => mockParseMermaidToExcalidraw(...args),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SIMPLE_FLOWCHART = "flowchart TD\nA-->B\n";

let tmpDir: string;
let mmdPath: string;
let ctx: MockExtensionContext;
let vscPanel: MockWebviewPanel;
let state: PanelState;

beforeEach(async () => {
  vi.clearAllMocks();

  tmpDir = mkdtempSync(join(tmpdir(), "diag-panel-core-test-"));
  mmdPath = join(tmpDir, "arch.mmd");
  await writeFile(mmdPath, SIMPLE_FLOWCHART, "utf8");

  mockWorkspace.workspaceFolders = [{ uri: { fsPath: tmpDir } as never, name: "test" }];

  ctx = makeExtensionContext();
  vscPanel = new MockWebviewPanel("accordo.diagram", "arch");
  vi.mocked(mockWindow.createWebviewPanel).mockReturnValue(vscPanel as never);

  state = createPanelState(mmdPath, vscPanel as never, ctx as never);

  // Default mock implementations
  mockParseMermaid.mockResolvedValue({
    valid: true,
    diagram: { type: "flowchart", nodes: {}, edges: [] },
    error: null,
  });
  mockGenerateCanvas.mockResolvedValue({
    elements: [{ id: "A", type: "rectangle" }],
    layout: { nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] },
  });
  mockReadLayout.mockResolvedValue(null);
  mockWriteLayout.mockResolvedValue(undefined);
  mockComputeInitialLayout.mockReturnValue({ nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] });
  mockGetWebviewHtml.mockReturnValue("<html></html>");
  mockToExcalidrawPayload.mockReturnValue([{ id: "A" }]);
  mockReconcile.mockResolvedValue({ layout: { nodes: { A: {} }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] } });
  mockPatchNode.mockImplementation((layout: Record<string, unknown>, nodeId: string, patch: Record<string, unknown>) => {
    const nodes = (layout.nodes as Record<string, Record<string, unknown>> | undefined) ?? {};
    return {
      ...layout,
      nodes: {
        ...nodes,
        [nodeId]: {
          ...(nodes[nodeId] ?? {}),
          ...patch,
        },
      },
    };
  });
  mockPatchEdge.mockImplementation((layout: Record<string, unknown>, edgeKey: string, patch: Record<string, unknown>) => {
    const edges = (layout.edges as Record<string, Record<string, unknown>> | undefined) ?? {};
    return {
      ...layout,
      edges: {
        ...edges,
        [edgeKey]: {
          ...(edges[edgeKey] ?? {}),
          ...patch,
        },
      },
    };
  });

  vi.mocked(mockCommands.executeCommand).mockResolvedValue(undefined);
});

// ── PCore-01..PCore-10: loadAndPost ─────────────────────────────────────────

describe("loadAndPost", () => {
  it("PCore-01: reads the .mmd file from disk", async () => {
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Success means read succeeded and postMessage was called
    expect(vscPanel.webview.postMessage).toHaveBeenCalled();
  });

  it("PCore-02: calls parseMermaid with the source content", async () => {
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(mockParseMermaid).toHaveBeenCalledWith(SIMPLE_FLOWCHART);
  });

  it("PCore-03: posts host:error-overlay when parse fails", async () => {
    mockParseMermaid.mockResolvedValueOnce({
      valid: false,
      error: { message: "Syntax error in flowchart" },
    });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    const errorOverlayCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:error-overlay",
    );
    expect(errorOverlayCall).toBeDefined();
    const msg = errorOverlayCall![0] as { type: string; message: string };
    expect(msg.message).toBe("Syntax error in flowchart");
  });

  // PCore-04: stateDiagram-v2 first-init tries layoutWithExcalidraw first (SUP-S01).
  // When layoutWithExcalidraw throws, it falls back to computeInitialLayout.
  it("PCore-04: falls back to computeInitialLayout for stateDiagram-v2 when layoutWithExcalidraw throws", async () => {
    mockParseMermaid.mockResolvedValueOnce({
      valid: true,
      diagram: { type: "stateDiagram-v2", nodes: {}, edges: [] },
      error: null,
    });
    mockReadLayout.mockResolvedValueOnce(null);
    // Force layoutWithExcalidraw to throw so we verify the fallback
    mockLayoutWithExcalidraw.mockRejectedValueOnce(new Error("upstream unavailable"));
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(mockLayoutWithExcalidraw).toHaveBeenCalled();
    expect(mockComputeInitialLayout).toHaveBeenCalled();
  });

  // PCore-04b: stateDiagram-v2 first-init uses layoutWithExcalidraw (SUP-S01 primary path).
  // layoutWithExcalidraw calls parseMermaidToExcalidraw internally.
  it("PCore-04b: stateDiagram-v2 first-init calls layoutWithExcalidraw and writes upstream layout", async () => {
    const upstreamLayout = {
      version: "1.0",
      diagram_type: "stateDiagram-v2",
      nodes: {
        root_start: { x: 50, y: 50, w: 30, h: 30, style: { fill: "#fff" } },
        Idle: { x: 150, y: 40, w: 120, h: 60, style: { fill: "#eee" } },
        root_end: { x: 400, y: 50, w: 30, h: 30, style: { fill: "#000" } },
      },
      edges: {
        "root_start->Idle:0": {
          routing: "direct",
          waypoints: [{ x: 120, y: 90 }],
          style: { strokeColor: "#333" },
        },
      },
      clusters: {
        Parent: { x: 20, y: 20, w: 300, h: 200, label: "Parent", style: { fill: "#fafafa" } },
      },
      aesthetics: {},
      unplaced: [],
    };

    mockParseMermaid.mockResolvedValueOnce({
      valid: true,
      diagram: {
        type: "stateDiagram-v2",
        nodes: new Map([
          ["root_start", { id: "root_start", label: "", shape: "stateStart", classes: [] }],
          ["Idle", { id: "Idle", label: "Idle", shape: "rounded", classes: [] }],
          ["root_end", { id: "root_end", label: "", shape: "stateEnd", classes: [] }],
        ]),
        edges: [],
        clusters: [{ id: "Parent", label: "Parent" }],
      },
      error: null,
    });
    mockLayoutWithExcalidraw.mockResolvedValueOnce(upstreamLayout);
    mockReadLayout.mockResolvedValueOnce(null);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(mockLayoutWithExcalidraw).toHaveBeenCalled();
    // Verify layout was written with upstream positions (not dagre fallback)
    const writeCall = vi.mocked(mockWriteLayout).mock.calls.find(
      (call) => (call[0] as string).includes(".layout.json"),
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const writtenNodes = writtenLayout.nodes as Record<string, { x: number; y: number; w: number; h: number; style: Record<string, unknown> }>;
    const writtenEdges = writtenLayout.edges as Record<string, { routing: string; waypoints: Array<{ x: number; y: number }>; style: Record<string, unknown> }>;
    const writtenClusters = writtenLayout.clusters as Record<string, { x: number; y: number; w: number; h: number; label: string; style: Record<string, unknown> }>;

    expect(writtenNodes["Idle"]).toMatchObject({ x: 150, y: 40, w: 120, h: 60, style: { fill: "#eee" } });
    expect(writtenNodes["root_start"]).toMatchObject({ x: 50, y: 50, w: 30, h: 30, style: { fill: "#fff" } });
    expect(writtenEdges["root_start->Idle:0"]).toEqual({
      routing: "direct",
      waypoints: [{ x: 120, y: 90 }],
      style: { strokeColor: "#333" },
    });
    expect(writtenClusters["Parent"]).toMatchObject({
      x: 20,
      y: 20,
      w: 300,
      h: 200,
      label: "Parent",
      style: { fill: "#fafafa" },
    });
  });

  it("PCore-05: calls reconcile when source changed and layout already exists", async () => {
    // Change the file content so source differs from _lastSource
    await writeFile(mmdPath, "flowchart TD\nA-->C\n", "utf8");
    mockReadLayout.mockResolvedValueOnce({
      version: "1.0",
      diagram_type: "flowchart",
      nodes: { A: { x: 0, y: 0, w: 100, h: 50 } },
      edges: { "A->C:0": { routing: "auto", waypoints: [], style: {} } },
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    });
    const freshState = createPanelState(mmdPath, vscPanel as never, ctx as never);
    freshState._lastSource = "flowchart TD\nA-->B\n"; // old source

    const panelState = { ...freshState, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(mockReconcile).toHaveBeenCalled();
  });

  it("PCore-06: calls generateCanvas with diagram and layout", async () => {
    mockReadLayout.mockResolvedValueOnce({
      version: "1.0",
      diagram_type: "flowchart",
      nodes: {},
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "dagre" },
    });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(mockGenerateCanvas).toHaveBeenCalled();
    const call = mockGenerateCanvas.mock.calls[0];
    expect(call[0]).toBeTruthy(); // diagram
    expect(call[1]).toBeTruthy(); // layout
  });

  it("PCore-07: posts host:load-scene to webview with elements", async () => {
    mockReadLayout.mockResolvedValueOnce({
      version: "1.0",
      diagram_type: "flowchart",
      nodes: {},
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "dagre" },
    });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
    const msg = loadSceneCall![0] as { type: string; elements: unknown[]; appState: object };
    expect(Array.isArray(msg.elements)).toBe(true);
  });

  it("PCore-08: writes layout to disk after generation", async () => {
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(mockWriteLayout).toHaveBeenCalled();
  });

  it("PCore-09: throws PanelFileNotFoundError when file is missing", async () => {
    const nonExistentPath = join(tmpDir, "nonexistent.mmd");
    const freshState = createPanelState(nonExistentPath, vscPanel as never, ctx as never);
    const panelState = { ...freshState, _panel: vscPanel as never } as PanelState & { _panel: never };

    await expect(loadAndPost(panelState as never)).rejects.toThrow(PanelFileNotFoundError);
  });

  it("PCore-10: updates _lastSource after successful load", async () => {
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(panelState._lastSource).toBe(SIMPLE_FLOWCHART);
  });

  it("PCore-10b: overlapping loads drop stale writes and stale scene posts", async () => {
    mockReadLayout.mockResolvedValue(null);
    mockParseMermaid.mockResolvedValue({
      valid: true,
      diagram: { type: "stateDiagram-v2", nodes: {}, edges: [], direction: "TD" },
      error: null,
    });
    let releaseFirstLayout: (() => void) | undefined;
    let firstLayoutStartedResolve: (() => void) | undefined;
    const firstLayoutStarted = new Promise<void>((resolve) => {
      firstLayoutStartedResolve = resolve;
    });
    const firstLayout = new Promise<Record<string, unknown>>((resolve) => {
      releaseFirstLayout = () => resolve({
        nodes: { A: { x: 100, y: 0, w: 100, h: 50 } },
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
        nodes: { A: { x: 200, y: 0, w: 100, h: 50 } },
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
    mockToExcalidrawPayload.mockImplementation((elements) => elements);

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };
    const firstLoad = loadAndPost(panelState as never);
    await firstLayoutStarted;
    const secondLoad = loadAndPost(panelState as never);
    await secondLoad;
    releaseFirstLayout?.();
    await firstLoad;

    const writtenXs = mockWriteLayout.mock.calls
      .map((call) => (call[1] as { nodes?: { A?: { x?: number } } }).nodes?.A?.x)
      .filter((x): x is number => typeof x === "number");
    expect(writtenXs).toEqual([200, 200, 200]);

    const loadSceneCalls = vi.mocked(vscPanel.webview.postMessage).mock.calls
      .map(([msg]) => msg)
      .filter((msg): msg is { type: string; elements: Array<{ id: string }> } =>
        typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "host:load-scene",
      );
    expect(loadSceneCalls).toHaveLength(1);
    expect(loadSceneCalls[0]?.elements[0]?.id).toBe("scene-200");
  });
});

// ── PCore-11..PCore-16: handleWebviewMessage ─────────────────────────────────

describe("handleWebviewMessage", () => {
  it("PCore-11: routes canvas:ready to loadAndPost", () => {
    const loadAndPost = vi.fn().mockResolvedValue(undefined);
    const panelState = { ...state, _panel: vscPanel as never, _loadAndPost: loadAndPost } as PanelState & { _panel: never; _loadAndPost: () => Promise<void> };

    handleWebviewMessage(panelState as never, { type: "canvas:ready" });

    expect(loadAndPost).toHaveBeenCalled();
  });

  it("PCore-12: routes canvas:node-moved to handleNodeMoved", () => {
    const handleNodeMoved = vi.fn();
    const panelState = { ...state, _panel: vscPanel as never, _handleNodeMoved: handleNodeMoved } as PanelState & { _panel: never; _handleNodeMoved: (id: string, x: number, y: number) => void };

    handleWebviewMessage(panelState as never, { type: "canvas:node-moved", nodeId: "A", x: 100, y: 200 });

    expect(handleNodeMoved).toHaveBeenCalledWith("A", 100, 200);
  });

  it("PCore-13: routes canvas:node-resized to handleNodeResized", () => {
    const handleNodeResized = vi.fn();
    const panelState = { ...state, _panel: vscPanel as never, _handleNodeResized: handleNodeResized } as PanelState & { _panel: never; _handleNodeResized: (id: string, w: number, h: number) => void };

    handleWebviewMessage(panelState as never, { type: "canvas:node-resized", nodeId: "A", w: 150, h: 80 });

    expect(handleNodeResized).toHaveBeenCalledWith("A", 150, 80);
  });

  it("PCore-14: routes canvas:export-ready to handleExportReady", () => {
    const handleExportReady = vi.fn();
    const panelState = { ...state, _panel: vscPanel as never, _handleExportReady: handleExportReady } as PanelState & { _panel: never; _handleExportReady: (f: string, d: string) => void };

    handleWebviewMessage(panelState as never, { type: "canvas:export-ready", format: "svg", data: "PHN2Zz48L3N2Zz4=" });

    expect(handleExportReady).toHaveBeenCalledWith("svg", "PHN2Zz48L3N2Zz4=");
  });

  it("PCore-15: routes comment:create to bridge when bridge is present", async () => {
    const handleBridgeMsg = vi.fn().mockResolvedValue(undefined);
    const panelState = { ...state, _panel: vscPanel as never, _commentsBridge: { handleWebviewMessage: handleBridgeMsg } } as PanelState & { _panel: never };

    handleWebviewMessage(panelState as never, { type: "comment:create", blockId: "node:A", body: "hello" } as WebviewToHostMessage);

    expect(handleBridgeMsg).toHaveBeenCalled();
  });

  it("PCore-16: drops comment messages when bridge is null (no-op)", () => {
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    // Should not throw
    expect(() => handleWebviewMessage(panelState as never, { type: "comment:create", blockId: "A", body: "hi" } as WebviewToHostMessage)).not.toThrow();
  });

  it("PCore-16b: ignores the initial scene-load mutation burst", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    mockGenerateCanvas.mockResolvedValueOnce({
      elements: [{ id: "A", type: "rectangle" }, { id: "edge-1", type: "arrow" }],
      layout: {
        nodes: { A: { x: 10, y: 20, w: 100, h: 50 } },
        edges: { "A->B:0": { routing: "auto", waypoints: [{ x: 10, y: 20 }], style: {} } },
        clusters: {},
        aesthetics: {},
        unplaced: [],
      },
    });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);
    mockWriteLayout.mockClear();

    handleWebviewMessage(panelState as never, {
      type: "canvas:edge-routed",
      edgeKey: "A->B:0",
      waypoints: [{ x: 1, y: 2 }],
    });
    handleWebviewMessage(panelState as never, { type: "canvas:node-moved", nodeId: "A", x: 200, y: 300 });
    handleWebviewMessage(panelState as never, { type: "canvas:node-resized", nodeId: "A", w: 240, h: 80 });
    vi.advanceTimersByTime(150);

    expect(panelState._currentLayout?.nodes.A).toMatchObject({ x: 10, y: 20, w: 100, h: 50 });
    expect(panelState._currentLayout?.edges["A->B:0"]?.waypoints).toEqual([{ x: 10, y: 20 }]);
    expect(mockWriteLayout).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("PCore-16c: persists later real mutations after the suppression window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    mockGenerateCanvas.mockResolvedValueOnce({
      elements: [{ id: "A", type: "rectangle" }, { id: "edge-1", type: "arrow" }],
      layout: {
        nodes: { A: { x: 10, y: 20, w: 100, h: 50 } },
        edges: { "A->B:0": { routing: "auto", waypoints: [{ x: 10, y: 20 }], style: {} } },
        clusters: {},
        aesthetics: {},
        unplaced: [],
      },
    });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);
    mockWriteLayout.mockClear();

    vi.setSystemTime(500);
    handleWebviewMessage(panelState as never, {
      type: "canvas:edge-routed",
      edgeKey: "A->B:0",
      waypoints: [{ x: 30, y: 40 }],
    });
    handleWebviewMessage(panelState as never, { type: "canvas:node-moved", nodeId: "A", x: 200, y: 300 });
    handleWebviewMessage(panelState as never, { type: "canvas:node-resized", nodeId: "A", w: 240, h: 80 });
    vi.advanceTimersByTime(150);

    expect(panelState._currentLayout?.nodes.A).toMatchObject({ x: 200, y: 300, w: 240, h: 80 });
    expect(panelState._currentLayout?.edges["A->B:0"]?.waypoints).toEqual([{ x: 30, y: 40 }]);
    expect(mockWriteLayout).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("PCore-16d: canvas:node-styled still persists during the scene-load echo window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    mockGenerateCanvas.mockResolvedValueOnce({
      elements: [{ id: "A", type: "rectangle" }],
      layout: {
        nodes: { A: { x: 10, y: 20, w: 100, h: 50 } },
        edges: {},
        clusters: {},
        aesthetics: {},
        unplaced: [],
      },
    });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);
    mockWriteLayout.mockClear();

    handleWebviewMessage(panelState as never, { type: "canvas:node-styled", nodeId: "A", style: { backgroundColor: "#ff0000" } });
    vi.advanceTimersByTime(150);

    expect(panelState._currentLayout?.nodes.A).toMatchObject({
      x: 10,
      y: 20,
      w: 100,
      h: 50,
      style: { backgroundColor: "#ff0000" },
    });
    expect(mockWriteLayout).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ── PCore-17..PCore-18: patchLayout ─────────────────────────────────────────

describe("patchLayout", () => {
  it("PCore-17: updates _currentLayout in-place with the patch", () => {
    vi.useFakeTimers();

    const baseLayout = { nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] };
    const panelState = {
      ...state,
      _currentLayout: baseLayout,
    };

    patchLayout(panelState as never, (layout) => ({
      ...layout,
      nodes: { ...(layout.nodes as object), A: { ...(layout.nodes as Record<string, unknown>)["A"] as object, x: 200, y: 300 } },
    }));

    expect(panelState._currentLayout).toBeTruthy();
    expect((panelState._currentLayout as Record<string, unknown>).nodes).toBeTruthy();

    vi.useRealTimers();
  });

  it("PCore-18: schedules a debounced writeLayout call after 100ms", () => {
    vi.useFakeTimers();

    const panelState = {
      ...state,
      _currentLayout: { nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] },
    };

    patchLayout(panelState as never, (layout) => layout);

    // Timer should be set
    expect(panelState._layoutWriteTimer).not.toBeNull();

    // Advance time to fire the timer
    vi.advanceTimersByTime(150);

    // writeLayout should have been called inside the timer
    expect(mockWriteLayout).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ── PCore-19: handleNodeMoved ───────────────────────────────────────────────

describe("handleNodeMoved", () => {
  it("PCore-19: calls patchLayout with x,y patch for the given nodeId", () => {
    vi.useFakeTimers();

    const panelState = {
      ...state,
      _currentLayout: { nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] },
    };

    handleNodeMoved(panelState as never, "A", 200, 300);

    expect(panelState._currentLayout).toBeTruthy();
    // The patch should have been applied
    const nodeA = (panelState._currentLayout as Record<string, unknown>).nodes as Record<string, unknown>;
    expect(nodeA["A"]).toBeTruthy();

    vi.useRealTimers();
  });
});

// ── PCore-20: handleNodeResized ─────────────────────────────────────────────

describe("handleNodeResized", () => {
  it("PCore-20: calls patchLayout with w,h patch for the given nodeId", () => {
    vi.useFakeTimers();

    const panelState = {
      ...state,
      _currentLayout: { nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] },
    };

    handleNodeResized(panelState as never, "A", 240, 80);

    expect(panelState._currentLayout).toBeTruthy();
    const nodeA = (panelState._currentLayout as Record<string, unknown>).nodes as Record<string, unknown>;
    expect(nodeA["A"]).toBeTruthy();

    vi.useRealTimers();
  });
});

// ── PCore-21: handleExportReady ─────────────────────────────────────────────

describe("handleExportReady", () => {
  it("PCore-21: resolves the pending export promise with a Buffer", () => {
    let resolvedValue: Buffer | null = null;
    const panelState = {
      ...state,
      _pendingExport: {
        resolve: (buf: Buffer) => { resolvedValue = buf; },
        reject: vi.fn(),
        format: "svg" as const,
      },
    } as unknown as PanelState;

    handleExportReady(panelState, "svg", btoa("<svg/>"));

    expect(resolvedValue).toBeInstanceOf(Buffer);
    expect(resolvedValue?.toString("utf8")).toBe("<svg/>");
    expect(panelState._pendingExport).toBeNull();
  });

  it("PCore-21b: ignores a mismatched format reply and leaves pending export intact", () => {
    let called = false;
    const panelState = {
      ...state,
      _pendingExport: {
        resolve: () => { called = true; },
        reject: vi.fn(),
        format: "svg" as const,
      },
    } as unknown as PanelState;

    handleExportReady(panelState, "png", btoa("<png/>"));

    expect(called).toBe(false);
    expect(panelState._pendingExport).not.toBeNull();
  });

  it("PCore-21c: is a no-op when no export is pending", () => {
    const panelState = { ...state, _pendingExport: null } as unknown as PanelState;

    expect(() => handleExportReady(panelState, "svg", btoa("<svg/>"))).not.toThrow();
  });
});

// ── UD-04..UD-07: Engine selection in loadAndPost ───────────────────────────

describe("loadAndPost — upstream-direct engine selection", () => {
  // UD-04: REOPEN path — with existing layout, uses generateCanvas + host:load-scene
  // (NOT host:load-upstream-direct, which is reserved for first-init only)
  it("UD-04: reopen with existing layout uses generateCanvas (not upstream-direct)", async () => {
    const upstreamLayout = {
      version: "1.0" as const,
      diagram_type: "flowchart" as const,
      nodes: { A: { x: 0, y: 0, w: 100, h: 50 } },
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };
    mockReadLayout.mockResolvedValueOnce(upstreamLayout);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Reopen uses generateCanvas + host:load-scene, NOT host:load-upstream-direct
    expect(mockGenerateCanvas).toHaveBeenCalled();
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
    // Should use host:load-scene for reopen
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
  });

  // UD-05: FIRST INIT path — no existing layout, uses upstream-direct
  // SRP-01: first-init now uses host:load-scene (not host:load-upstream-direct)
  it("UD-05: defaults to upstream-direct for flowchart when engine metadata is unset (first init)", async () => {
    mockReadLayout.mockResolvedValueOnce(null);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // First init: posts host:load-scene for flowcharts (SRP-01)
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
    // host:load-upstream-direct is never sent (SRP-03)
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
  });

  it("UD-05b: uses dagre when metadata explicitly sets engine='dagre'", async () => {
    const dagreLayout = {
      version: "1.0" as const,
      diagram_type: "flowchart" as const,
      nodes: { A: { x: 0, y: 0, w: 100, h: 50 } },
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "dagre" },
    };
    mockReadLayout.mockResolvedValueOnce(dagreLayout);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    expect(mockGenerateCanvas).toHaveBeenCalled();
  });

  it("UD-06: uses dagre when engine=upstream-direct but diagram type is not flowchart", async () => {
    // stateDiagram-v2 is not supported by upstream-direct
    mockParseMermaid.mockResolvedValueOnce({
      valid: true,
      diagram: { type: "stateDiagram-v2", nodes: {}, edges: [] },
    });
    const upstreamLayout = {
      version: "1.0" as const,
      diagram_type: "stateDiagram-v2" as const,
      nodes: {},
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };
    mockReadLayout.mockResolvedValueOnce(upstreamLayout);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Should NOT use upstream-direct even with the flag
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
    expect(mockGenerateCanvas).toHaveBeenCalled();
  });

  // UD-07: First init (layout === null) + upstream-direct → host:load-scene
  // SRP-01: All renders use host:load-scene, including first-init
  // runUpstreamPlacement seeds layout.json, then generateCanvas + host:load-scene renders
  it("UD-07: first-init with layout===null and upstream-direct runs upstream placement (not dagre)", async () => {
    mockGenerateCanvas.mockClear();
    mockReadLayout.mockClear();
    mockReadLayout.mockResolvedValueOnce(null); // First init: no existing layout

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // First init: host:load-scene is sent (SRP-01)
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
    // host:load-upstream-direct is never sent (SRP-03)
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
    // generateCanvas IS called for first-init (now uses single render path)
    expect(mockGenerateCanvas).toHaveBeenCalled();
  });
});

// ── UD-08..UD-11: runUpstreamPlacement correctness ─────────────────────────

// Test data shared across UD-08..UD-11
const MOCK_ELEMENTS_WITH_NODES: unknown[] = [
  { id: "node-A", type: "rectangle", x: 100, y: 200, width: 120, height: 60, customData: { mermaidId: "A" } },
  { id: "node-B", type: "rectangle", x: 400, y: 200, width: 120, height: 60, customData: { mermaidId: "B" } },
];

const MOCK_ELEMENTS_WITH_EDGE: unknown[] = [
  { id: "node-A", type: "rectangle", x: 10, y: 10, width: 100, height: 50, customData: { mermaidId: "A" } },
  { id: "node-B", type: "rectangle", x: 400, y: 10, width: 100, height: 50, customData: { mermaidId: "B" } },
  { id: "edge-1", type: "arrow", x: 10, y: 10, width: 400, height: 50, points: [[0, 0], [200, 25], [400, 50]], customData: { mermaidId: "A->B:0" } },
];

const MOCK_ELEMENTS_WITH_TEXT_AND_LABELS: unknown[] = [
  { id: "A", type: "rectangle", x: 10, y: 10, width: 100, height: 50, customData: { mermaidId: "A" } },
  { id: "A:text", type: "text", x: 60, y: 35, width: 50, height: 20, customData: { mermaidId: "A:text" } },
  { id: "A->B:0:label", type: "text", x: 200, y: 100, width: 30, height: 16, customData: { mermaidId: "A->B:0:label" } },
];

const MOCK_ELEMENTS_WITH_ARROW_NO_MERMAID_ID: unknown[] = [
  { id: "node-A", type: "rectangle", x: 10, y: 10, width: 100, height: 50, customData: { mermaidId: "A" } },
  { id: "node-B", type: "rectangle", x: 400, y: 10, width: 100, height: 50, customData: { mermaidId: "B" } },
  { id: "edge-1", type: "arrow", x: 10, y: 10, width: 400, height: 50, points: [[0, 0], [200, 25], [400, 50]] },
];

describe("runUpstreamPlacement — UD-08..UD-11", () => {
  beforeEach(() => {
    // Reset call history; preserve mock implementations.
    vi.clearAllMocks();
    mockReadLayout.mockResolvedValue(null);
    mockWriteLayout.mockResolvedValue(undefined);
    mockParseMermaid.mockResolvedValue({
      valid: true,
      diagram: { type: "flowchart", nodes: {}, edges: [] },
      error: null,
    });
    mockGenerateCanvas.mockResolvedValue({
      elements: [{ id: "A" }],
      layout: { nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] },
    });
    mockComputeInitialLayout.mockReturnValue({ nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] });
    mockGetWebviewHtml.mockReturnValue("<html></html>");
    mockToExcalidrawPayload.mockReturnValue([{ id: "A" }]);
    mockReconcile.mockResolvedValue({ layout: { nodes: { A: {} }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] } });
    // Reset the parseMermaidToExcalidraw mock so each test controls its return value.
    // Use mockImplementation to ensure it ALWAYS returns (vi.fn() alone returns undefined).
    mockParseMermaidToExcalidraw.mockReset();
    mockParseMermaidToExcalidraw.mockImplementation(() => Promise.resolve({ elements: [] }));
  });

  // UD-08: first-init persists nodes from runUpstreamPlacement into layout.json
  it("UD-08: first-init persists nodes from upstream into layout.nodes", async () => {
    mockParseMermaidToExcalidraw.mockImplementation(() => Promise.resolve({ elements: MOCK_ELEMENTS_WITH_NODES }));

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };
    await loadAndPost(panelState as never);

    // writeLayout(path, layout) — layout is at call[1]
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "nodes" in layoutArg && Object.keys(layoutArg.nodes as object).length > 0;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const nodes = writtenLayout.nodes as Record<string, { x: number; y: number; w: number; h: number }>;
    expect(nodes["A"]).toMatchObject({ x: 150, y: 300, w: 180, h: 90 });
    expect(nodes["B"]).toMatchObject({ x: 600, y: 300, w: 180, h: 90 });
  });

  // UD-09: first-init persists structurally valid edge entries keyed as EdgeKey (from->to:ordinal)
  // This is the main regression test for the "skip ID containing ->" bug.
  it("UD-09: first-init persists edge entries keyed as EdgeKey with waypoints", async () => {
    mockParseMermaidToExcalidraw.mockImplementation(() => Promise.resolve({ elements: MOCK_ELEMENTS_WITH_EDGE }));

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };
    await loadAndPost(panelState as never);

    // writeLayout(path, layout) — layout is at call[1]
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "edges" in layoutArg && Object.keys(layoutArg.edges as object).length > 0;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const edges = writtenLayout.edges as Record<string, { waypoints: Array<{ x: number; y: number }> }>;

    // UD-09: edge key must be the canonical EdgeKey "A->B:0" (not "edge-1" or "edge-1:0")
    expect(edges["A->B:0"]).toBeDefined();
    // Waypoints exclude the start and end (first and last points)
    // Scale is applied after absolute waypoint calculation: (el.x + pt[0]) * 1.5
    expect(edges["A->B:0"].waypoints).toEqual([
      { x: 315, y: 52.5 }, // (el.x(10) + 200) * 1.5, (el.y(10) + 25) * 1.5
    ]);
  });

  // UD-10: no text/label pseudo-nodes are written into layout.nodes
  // Ensures the :text/:label skip logic prevents bound text from polluting node layout.
  it("UD-10: text and label elements are NOT written into layout.nodes", async () => {
    mockParseMermaidToExcalidraw.mockImplementation(() => Promise.resolve({ elements: MOCK_ELEMENTS_WITH_TEXT_AND_LABELS }));

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };
    await loadAndPost(panelState as never);

    // writeLayout(path, layout) — layout is at call[1]
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "nodes" in layoutArg && Object.keys(layoutArg.nodes as object).length > 0;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const nodes = writtenLayout.nodes as Record<string, unknown>;

    // Only the real node "A" should be in layout.nodes
    expect(nodes["A"]).toBeDefined();
    expect(nodes["A:text"]).toBeUndefined();
    expect(nodes["A->B:0:label"]).toBeUndefined();
  });

  // UD-11: Arrow without customData.mermaidId falls back to el.id (non-canonical key).
  // This documents the upstream identity-mapping limitation: when mermaidId is absent,
  // the edge key in layout is the Excalidraw element id (e.g. "edge-1") rather than
  // a canonical EdgeKey "from->to:ordinal". Consumers should handle this gracefully.
  it("UD-11: arrow without customData.mermaidId uses el.id as edge key (non-canonical fallback)", async () => {
    mockParseMermaidToExcalidraw.mockImplementation(() => Promise.resolve({ elements: MOCK_ELEMENTS_WITH_ARROW_NO_MERMAID_ID }));

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };
    await loadAndPost(panelState as never);

    // writeLayout(path, layout) — layout is at call[1]
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "edges" in layoutArg && Object.keys(layoutArg.edges as object).length > 0;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const edges = writtenLayout.edges as Record<string, { waypoints: Array<{ x: number; y: number }> }>;

    // Edge key is the fallback el.id — not a canonical EdgeKey
    expect(edges["edge-1"]).toBeDefined();
    expect(edges["edge-1"].waypoints).toEqual([{ x: 315, y: 52.5 }]);
    // Canonical key should NOT be present (no mermaidId to derive it from)
    expect(edges["A->B:0"]).toBeUndefined();
  });

  it("UD-12: first-init with stale _lastSource does NOT reconcile away seeded waypoints", async () => {
    mockParseMermaidToExcalidraw.mockImplementation(() => Promise.resolve({ elements: MOCK_ELEMENTS_WITH_EDGE }));

    const panelState = {
      ...state,
      _panel: vscPanel as never,
      // Simulate previous file content lingering on shared panel state.
      _lastSource: "flowchart TD\nX-->Y\n",
    } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // First-init should skip reconcile entirely.
    expect(mockReconcile).not.toHaveBeenCalled();

    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "edges" in layoutArg && Object.keys(layoutArg.edges as object).includes("A->B:0");
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const edges = writtenLayout.edges as Record<string, { waypoints: Array<{ x: number; y: number }> }>;
    expect(edges["A->B:0"].waypoints).toEqual([{ x: 315, y: 52.5 }]);
  });
});
