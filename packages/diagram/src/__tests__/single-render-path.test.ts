/**
 * Single Render Path Architecture — Phase B Failing Tests
 *
 * Architecture summary:
 *   1. Init may use upstream-direct seeding of layout.json (mermaid-to-excalidraw → layout.json)
 *   2. Runtime render path is unified: host:load-scene for BOTH first-init and reopen
 *   3. host:load-upstream-direct is NOT used for rendering
 *   4. Seeded layout includes canonical edge keys and waypoints from upstream placement
 *   5. Edge reroute (waypoints) and edge style (roundness) persist and re-apply on reopen
 *   6. text/edge-label pseudo-elements (:text, :label suffixes) are NOT persisted as layout nodes
 *
 * Render path contract:
 *   - host:load-scene: used for ALL renders (first-init, reopen, any scenario)
 *   - host:load-upstream-direct: NEVER used for rendering (only seeding may occur)
 *
 * Requirements covered:
 *   SRP-01: first-init uses host:load-scene (not host:load-upstream-direct)
 *   SRP-02: reopen uses host:load-scene (existing behavior, regression guard)
 *   SRP-03: host:load-upstream-direct is never sent for any render
 *   SRP-04: seeded layout.json includes canonical edge keys (from->to:ordinal)
 *   SRP-05: seeded layout.json includes edge waypoints from mermaid-to-excalidraw
 *   SRP-06: edge waypoints from canvas:edge-routed persist to layout.json
 *   SRP-07: edge waypoints are re-applied on reopen via host:load-scene
 *   SRP-08: edge style.roundness persists via canvas:node-styled to patchEdge
 *   SRP-09: edge roundness is re-applied on reopen via host:load-scene
 *   SRP-10: text pseudo-elements (:text suffix) are not persisted as layout nodes
 *   SRP-11: edge-label pseudo-elements (:label suffix) are not persisted as layout nodes
 *
 * API checklist:
 *   loadAndPost — 11 tests (SRP-01..SRP-11)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "os";
import { join } from "node:path";

import {
  createPanelState,
} from "../webview/panel-state.js";
import type { PanelState } from "../webview/panel-state.js";
import {
  loadAndPost,
  handleWebviewMessage,
} from "../webview/panel-core.js";
import {
  MockWebviewPanel,
  MockFileSystemWatcher,
  makeExtensionContext,
  window as mockWindow,
  workspace as mockWorkspace,
  commands as mockCommands,
} from "./mocks/vscode.js";
import { layoutPathFor } from "../layout/layout-store.js";
import { readFile } from "node:fs/promises";

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

vi.mock("./scene-adapter.js", () => ({
  toExcalidrawPayload: (...args: unknown[]) => mockToExcalidrawPayload(...args),
}));

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: (...args: unknown[]) => mockParseMermaidToExcalidraw(...args),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SIMPLE_FLOWCHART = "flowchart TD\nA-->B\n";

// 4 points = 2 intermediate waypoints (after slice(1, -1))
// Points: [[0, 0], [100, 25], [200, 50], [300, 75]]
// Intermediate (index 1 and 2): points[1]=[100,25], points[2]=[200,50]
// el.x=100, el.y=200 → waypoint[0] = {x: 100+100, y: 200+25} = {x: 200, y: 225}
//                           waypoint[1] = {x: 100+200, y: 200+50} = {x: 300, y: 250}
const MOCK_ELEMENTS_WITH_NODES_AND_EDGE: unknown[] = [
  { id: "node-A", type: "rectangle", x: 100, y: 200, width: 120, height: 60, customData: { mermaidId: "A" } },
  { id: "node-B", type: "rectangle", x: 400, y: 200, width: 120, height: 60, customData: { mermaidId: "B" } },
  { id: "edge-1", type: "arrow", x: 100, y: 200, width: 300, height: 75,
    points: [[0, 0], [100, 25], [200, 50], [300, 75]],
    customData: { mermaidId: "A->B:0" } },
];

const MOCK_ELEMENTS_WITH_TEXT_AND_LABELS: unknown[] = [
  { id: "A", type: "rectangle", x: 10, y: 10, width: 100, height: 50, customData: { mermaidId: "A" } },
  { id: "A:text", type: "text", x: 60, y: 35, width: 50, height: 20, customData: { mermaidId: "A:text" } },
  { id: "A->B:0:label", type: "text", x: 200, y: 100, width: 30, height: 16, customData: { mermaidId: "A->B:0:label" } },
];

let tmpDir: string;
let mmdPath: string;
let ctx: MockExtensionContext;
let vscPanel: MockWebviewPanel;
let state: PanelState;

beforeEach(async () => {
  vi.clearAllMocks();

  tmpDir = mkdtempSync(join(tmpdir(), "diag-srp-test-"));
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
  mockPatchNode.mockReturnValue({});
  mockPatchEdge.mockReturnValue({});

  vi.mocked(mockCommands.executeCommand).mockResolvedValue(undefined);

  // Default parseMermaidToExcalidraw returns elements with nodes and edge
  mockParseMermaidToExcalidraw.mockResolvedValue({ elements: MOCK_ELEMENTS_WITH_NODES_AND_EDGE });
});

// ── SRP-01..SRP-03: Single render path enforcement ───────────────────────────

describe("single render path — host:load-scene always, host:load-upstream-direct never", () => {
  // SRP-01: First-init MUST use host:load-scene (NOT host:load-upstream-direct)
  // This is the core architectural constraint: one render path for all scenarios
  it("SRP-01: first-init flowchart uses host:load-scene (NOT host:load-upstream-direct)", async () => {
    mockReadLayout.mockResolvedValueOnce(null); // No existing layout = first init
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // MUST post host:load-scene for first-init
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();

    // MUST NOT post host:load-upstream-direct for first-init
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
  });

  // SRP-02: Reopen with existing layout MUST use host:load-scene (regression guard)
  it("SRP-02: reopen with existing layout uses host:load-scene", async () => {
    const existingLayout = {
      version: "1.0" as const,
      diagram_type: "flowchart" as const,
      nodes: { A: { x: 0, y: 0, w: 100, h: 50 } },
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };
    mockReadLayout.mockResolvedValueOnce(existingLayout);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // MUST post host:load-scene for reopen
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
  });

  // SRP-03: host:load-upstream-direct is NEVER sent for rendering
  // This tests that even when engine=upstream-direct, we still use host:load-scene
  it("SRP-03: engine=upstream-direct still uses host:load-scene (never host:load-upstream-direct)", async () => {
    mockReadLayout.mockResolvedValueOnce(null); // First init
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // host:load-upstream-direct must NEVER be sent
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
  });

  // SRP-03b: Explicit engine=upstream-direct in metadata still uses host:load-scene
  it("SRP-03b: existing layout with engine=upstream-direct still posts host:load-scene", async () => {
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

    // Must use host:load-scene
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
    // Must NOT use host:load-upstream-direct
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
  });
});

// ── SRP-04..SRP-05: Seeded layout contains canonical edge keys and waypoints ───

describe("seeded layout includes canonical edge keys and waypoints", () => {
  // SRP-04: First-init must persist canonical edge keys (from->to:ordinal format)
  it("SRP-04: first-init persists canonical edge keys (from->to:ordinal) in layout.edges", async () => {
    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: MOCK_ELEMENTS_WITH_NODES_AND_EDGE });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Find the writeLayout call that persisted a non-empty edges object
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "edges" in layoutArg && Object.keys(layoutArg.edges as object).length > 0;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const edges = writtenLayout.edges as Record<string, unknown>;

    // Edge key MUST be canonical "A->B:0" (not "edge-1" or other non-canonical ID)
    expect(edges["A->B:0"]).toBeDefined();
    expect(edges["edge-1"]).toBeUndefined();
  });

  // SRP-05: Seeded layout includes waypoints extracted from mermaid-to-excalidraw
  it("SRP-05: first-init persists waypoints from mermaid-to-excalidraw into layout.edges", async () => {
    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: MOCK_ELEMENTS_WITH_NODES_AND_EDGE });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Find the writeLayout call that persisted edges
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "edges" in layoutArg && Object.keys(layoutArg.edges as object).length > 0;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const edges = writtenLayout.edges as Record<string, { waypoints: Array<{ x: number; y: number }> }>;

    // Waypoints exclude start and end anchors (first/last points)
    // With 4 points: [[0, 0], [100, 25], [200, 50], [300, 75]]
    // Intermediate waypoints (slice(1, -1)): [[100, 25], [200, 50]]
    // el.x=100, el.y=200, points[1]=[100,25] → x=100+100=200, y=200+25=225
    // el.x=100, el.y=200, points[2]=[200,50] → x=100+200=300, y=200+50=250
    expect(edges["A->B:0"].waypoints).toEqual([
      { x: 200, y: 225 },
      { x: 300, y: 250 },
    ]);
  });
});

// ── SRP-06..SRP-07: Edge waypoints persist and re-apply on reopen ──────────────

describe("edge waypoint persistence and reopen", () => {
  // SRP-06: canvas:edge-routed persists waypoints to layout.json
  it("SRP-06: canvas:edge-routed message calls patchEdge and schedules writeLayout", () => {
    const existingLayout = {
      version: "1.0" as const,
      diagram_type: "flowchart" as const,
      nodes: {
        A: { x: 100, y: 100, w: 100, h: 50 },
        B: { x: 400, y: 100, w: 100, h: 50 },
      },
      edges: {
        "A->B:0": { routing: "auto", waypoints: [], style: {} },
      },
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };

    const panelState = {
      ...state,
      _panel: vscPanel as never,
      _currentLayout: existingLayout,
    } as PanelState & { _panel: never; _currentLayout: typeof existingLayout };

    // Use fake timers so the debounced writeLayout is scheduled
    vi.useFakeTimers();

    handleWebviewMessage(panelState as never, {
      type: "canvas:edge-routed",
      edgeKey: "A->B:0",
      waypoints: [{ x: 200, y: 150 }, { x: 300, y: 150 }],
    });

    // Advance time to trigger the debounced write
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    // patchEdge must have been called with the correct edge key and waypoints
    expect(mockPatchEdge).toHaveBeenCalled();
    const patchCall = mockPatchEdge.mock.calls.find(
      (call) => call[1] === "A->B:0",
    );
    expect(patchCall).toBeDefined();
    const [, edgeKey, patch] = patchCall!;
    expect(edgeKey).toBe("A->B:0");
    expect(patch).toEqual({ waypoints: [{ x: 200, y: 150 }, { x: 300, y: 150 }] });

    // writeLayout must have been called to persist the patch
    expect(mockWriteLayout).toHaveBeenCalled();
  });

  // SRP-07: Edge waypoints from layout are re-applied on reopen via host:load-scene
  it("SRP-07: reopen with persisted edge waypoints uses host:load-scene (not host:load-upstream-direct)", async () => {
    const existingLayout = {
      version: "1.0" as const,
      diagram_type: "flowchart" as const,
      nodes: {
        A: { x: 100, y: 100, w: 100, h: 50 },
        B: { x: 400, y: 100, w: 100, h: 50 },
      },
      edges: {
        "A->B:0": {
          routing: "auto",
          waypoints: [{ x: 200, y: 150 }, { x: 300, y: 150 }],
          style: {},
        },
      },
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };
    mockReadLayout.mockResolvedValueOnce(existingLayout);

    // toExcalidrawPayload must be called and produce elements with mermaidId
    mockToExcalidrawPayload.mockReturnValueOnce([
      { id: "A", mermaidId: "A", type: "rectangle", x: 100, y: 100, width: 100, height: 50 },
      { id: "B", mermaidId: "B", type: "rectangle", x: 400, y: 100, width: 100, height: 50 },
      { id: "edge-1", mermaidId: "A->B:0", type: "arrow", x: 100, y: 100,
        points: [[0, 0], [100, 50], [200, 50], [300, 50]] },
    ]);

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Must post host:load-scene (not host:load-upstream-direct)
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();

    // Must NOT use host:load-upstream-direct for reopen
    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();

    // generateCanvas must have been called with layout containing the waypoints
    expect(mockGenerateCanvas).toHaveBeenCalled();
    const generateCall = mockGenerateCanvas.mock.calls[0];
    const layoutArg = generateCall?.[1] as typeof existingLayout;
    expect(layoutArg.edges["A->B:0"].waypoints).toEqual([{ x: 200, y: 150 }, { x: 300, y: 150 }]);
  });
});

// ── SRP-08..SRP-09: Edge style roundness persists and re-applies on reopen ───

describe("edge style roundness persistence and reopen", () => {
  // SRP-08: canvas:node-styled with edge key (contains "->") persists roundness via patchEdge
  it("SRP-08: canvas:node-styled with edge key persists roundness via patchEdge", async () => {
    vi.useFakeTimers();

    const panelState = {
      ...state,
      _panel: vscPanel as never,
      _currentLayout: {
        version: "1.0" as const,
        diagram_type: "flowchart" as const,
        nodes: { A: { x: 0, y: 0, w: 100, h: 50 } },
        edges: { "A->B:0": { routing: "auto", waypoints: [], style: {} } },
        clusters: {},
        aesthetics: {},
        unplaced: [],
      },
    } as PanelState & { _panel: never };

    handleWebviewMessage(panelState as never, {
      type: "canvas:node-styled",
      nodeId: "A->B:0",
      style: { roundness: 8 },
    });

    // Advance debounce timer
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    // patchEdge must have been called (NOT patchNode) for edge roundness
    // Use module-level mock variables (mockPatchEdge, mockPatchNode)
    expect(mockPatchEdge).toHaveBeenCalled();
    // patchNode should NOT be called for an edge key
    expect(mockPatchNode).not.toHaveBeenCalled();
  });

  // SRP-09: Edge roundness is re-applied on reopen via host:load-scene
  it("SRP-09: reopen with persisted edge roundness re-applies it via host:load-scene", async () => {
    const existingLayout = {
      version: "1.0" as const,
      diagram_type: "flowchart" as const,
      nodes: {
        A: { x: 100, y: 100, w: 100, h: 50 },
        B: { x: 400, y: 100, w: 100, h: 50 },
      },
      edges: {
        "A->B:0": {
          routing: "auto",
          waypoints: [],
          style: { roundness: 8 },
        },
      },
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };
    mockReadLayout.mockResolvedValueOnce(existingLayout);

    // Mock generateCanvas to verify it receives the roundness from layout
    mockGenerateCanvas.mockResolvedValueOnce({
      elements: [
        { id: "A", mermaidId: "A", type: "rectangle", x: 100, y: 100, width: 100, height: 50 },
        { id: "B", mermaidId: "B", type: "rectangle", x: 400, y: 100, width: 100, height: 50 },
        { id: "edge-1", mermaidId: "A->B:0", type: "arrow", x: 100, y: 100,
          points: [[0, 0], [300, 0]], roundness: 8 },
      ],
      layout: existingLayout,
    });

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Must post host:load-scene
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();

    // generateCanvas must have been called with the layout containing roundness
    expect(mockGenerateCanvas).toHaveBeenCalled();
    const [, layoutArg] = mockGenerateCanvas.mock.calls[0];
    const layout = layoutArg as { edges: { "A->B:0": { style: { roundness?: number } } } };
    expect(layout.edges["A->B:0"].style.roundness).toBe(8);
  });
});

// ── SRP-10..SRP-11: text/label pseudo-elements not persisted ─────────────────

describe("text/edge-label pseudo-elements are not persisted as layout nodes", () => {
  // SRP-10: Elements with :text suffix are not written to layout.nodes
  it("SRP-10: elements with :text suffix are NOT persisted into layout.nodes", async () => {
    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: MOCK_ELEMENTS_WITH_TEXT_AND_LABELS });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Find the writeLayout call that persisted nodes
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "nodes" in layoutArg;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const nodes = writtenLayout.nodes as Record<string, unknown>;

    // Real node "A" should be in layout.nodes
    expect(nodes["A"]).toBeDefined();
    // "A:text" (text pseudo-element) must NOT be in layout.nodes
    expect(nodes["A:text"]).toBeUndefined();
  });

  // SRP-11: Elements with :label suffix are not written to layout.nodes
  it("SRP-11: elements with :label suffix are NOT persisted into layout.nodes", async () => {
    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: MOCK_ELEMENTS_WITH_TEXT_AND_LABELS });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Find the writeLayout call that persisted nodes
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "nodes" in layoutArg;
      },
    );
    expect(writeCall).toBeDefined();
    const writtenLayout = writeCall![1] as Record<string, unknown>;
    const nodes = writtenLayout.nodes as Record<string, unknown>;

    // "A->B:0:label" (edge label pseudo-element) must NOT be in layout.nodes
    expect(nodes["A->B:0:label"]).toBeUndefined();
  });

  // SRP-11b: text/label elements are also excluded from layout.edges
  it("SRP-11b: text/label pseudo-elements are not written to layout.edges", async () => {
    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: MOCK_ELEMENTS_WITH_TEXT_AND_LABELS });
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Find the writeLayout call that persisted edges
    const writeCall = mockWriteLayout.mock.calls.find(
      (call) => {
        const layoutArg = call[1] as Record<string, unknown> | undefined;
        return layoutArg != null && "edges" in layoutArg;
      },
    );

    if (writeCall) {
      const writtenLayout = writeCall![1] as Record<string, unknown>;
      const edges = writtenLayout.edges as Record<string, unknown>;
      // "A:text" and "A->B:0:label" must not appear as edge keys
      expect(edges["A:text"]).toBeUndefined();
      expect(edges["A->B:0:label"]).toBeUndefined();
    }
  });
});

// ── Integration: full reopen cycle with waypoints and roundness ────────────────

describe("full reopen cycle: waypoints and roundness persist across sessions", () => {
  it("reopen: waypoints and roundness from previous session are re-applied via host:load-scene", async () => {
    // Pre-condition: layout.json already exists with edge waypoints and roundness
    const savedLayout = {
      version: "1.0" as const,
      diagram_type: "flowchart" as const,
      nodes: {
        A: { x: 100, y: 100, w: 100, h: 50 },
        B: { x: 400, y: 100, w: 100, h: 50 },
      },
      edges: {
        "A->B:0": {
          routing: "auto",
          waypoints: [{ x: 200, y: 150 }, { x: 300, y: 150 }],
          style: { roundness: 8 },
        },
      },
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };

    mockReadLayout.mockResolvedValueOnce(savedLayout);

    // Mock generateCanvas to verify it receives the saved layout
    mockGenerateCanvas.mockResolvedValueOnce({
      elements: [
        { id: "A", mermaidId: "A", type: "rectangle", x: 100, y: 100, width: 100, height: 50 },
        { id: "B", mermaidId: "B", type: "rectangle", x: 400, y: 100, width: 100, height: 50 },
        { id: "edge-1", mermaidId: "A->B:0", type: "arrow", x: 100, y: 100,
          points: [[0, 0], [100, 50], [200, 50], [300, 50]], roundness: 8 },
      ],
      layout: savedLayout,
    });

    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Assert: host:load-scene is posted (never host:load-upstream-direct)
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();

    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();

    // Assert: generateCanvas was called with the saved layout containing waypoints and roundness
    expect(mockGenerateCanvas).toHaveBeenCalled();
    const [, layoutArg] = mockGenerateCanvas.mock.calls[0];
    const layout = layoutArg as typeof savedLayout;
    expect(layout.edges["A->B:0"].waypoints).toEqual([{ x: 200, y: 150 }, { x: 300, y: 150 }]);
    expect(layout.edges["A->B:0"].style.roundness).toBe(8);
  });
});
