/**
 * Style Persistence Tests — §13 Priority D Batch
 *
 * Tests for per-node and per-edge corner roundness style persistence.
 *
 * Phase B — RED until Phase C implementation, except:
 *   - toExcalidrawPayload roundness mapping (PD-09/09b/09c): already-green baseline
 *     — scene-adapter.ts already maps roundness → { type: N } / null correctly
 *   - handleNodeStyled panel-core wiring (PD-07/08): already-green guard
 *     — patchNode/patchEdge already receive the roundness value from handleNodeStyled
 *
 * RED batch (assertion-level failures until Phase C):
 *   generateCanvas roundness override (PD-01/01b/02/03/03b/04/04b/10)
 *     — canvas-generator does not yet read nl.style.roundness for nodes/edges
 *   detectNodeMutations roundness detection (PD-05/06/06b)
 *     — message-handler does not yet detect roundness changes
 *
 * Requirements covered (§13):
 *   PD-01  rectangle-family node with explicit style.roundness → overrides shape default
 *   PD-02  node with style.roundness: null → renders sharp even if shape default is rounded
 *   PD-03  non-rectangle-family shapes → ignore roundness override
 *   PD-04  edge with style.roundness → roundness persists separately from routing
 *   PD-05  changing edge roundness in webview → emits style mutation for edge key
 *   PD-06  changing node roundness in webview → emits canvas:node-styled with { roundness }
 *   PD-07  panel-core persists node style roundness via patchNode
 *   PD-08  panel-core persists edge style roundness via patchEdge (edge key path)
 *   PD-09  scene-adapter maps numeric roundness to Excalidraw payload and null to sharp
 *   PD-10  routing mode unchanged when only edge roundness changes
 *
 * API checklist:
 *   generateCanvas — 8 tests (PD-01, PD-01b, PD-02, PD-03, PD-03b, PD-04, PD-04b, PD-10)
 *   detectNodeMutations — 2 tests (PD-06, PD-06b)
 *   detectNodeMutations (arrow) — 1 test (PD-05)
 *   toExcalidrawPayload — 3 tests (PD-09, PD-09b, PD-09c)  [already-green]
 *   handleNodeStyled / patchNode / patchEdge — 4 tests (PD-07, PD-07b, PD-08, PD-08b)  [already-green]
 *
 * Note: panel-core roundness persistence (PD-07, PD-08) is exercised through
 * existing panel-core.test.ts handleNodeStyled coverage (PCore-22, PCore-23).
 * Here we verify roundness is included in the style patch passed to patchNode/patchEdge
 * via the handleNodeStyled integration path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LayoutStore,
  NodeLayout,
  ParsedDiagram,
  ExcalidrawElement,
  PanelState,
} from "../types.js";
import { generateCanvas } from "../canvas/canvas-generator.js";
import {
  detectNodeMutations,
} from "../webview/message-handler.js";
import type { ExcalidrawAPIElement } from "../webview/scene-adapter.js";
import {
  toExcalidrawPayload,
} from "../webview/scene-adapter.js";
import {
  handleNodeStyled,
  patchLayout,
} from "../webview/panel-core.js";
import type { WebviewToHostMessage } from "../webview/protocol.js";

// ── Mock layout-store at module scope ─────────────────────────────────────────
// Mock functions must be declared before vi.mock so they're in scope when
// the factory function runs (vi.mock is hoisted to the top of the file).

const mockPatchNode = vi.fn();
const mockPatchEdge = vi.fn();
const mockWriteLayout = vi.fn();

vi.mock("../layout/layout-store.js", () => ({
  patchNode: (...args: unknown[]) => mockPatchNode(...args),
  patchEdge: (...args: unknown[]) => mockPatchEdge(...args),
  writeLayout: (...args: unknown[]) => mockWriteLayout(...args),
  layoutPathFor: vi.fn(() => "/fake/path"),
  readLayout: vi.fn(),
  createEmptyLayout: vi.fn(),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeLayout(overrides: Partial<LayoutStore> = {}): LayoutStore {
  return {
    version: "1.0",
    diagram_type: "flowchart",
    nodes: {},
    edges: {},
    clusters: {},
    unplaced: [],
    aesthetics: { roughness: 1 },
    ...overrides,
  };
}

function makeParsed(overrides: Partial<ParsedDiagram> = {}): ParsedDiagram {
  return {
    type: "flowchart",
    nodes: new Map(),
    edges: [],
    clusters: [],
    renames: [],
    ...overrides,
  };
}

function makeNode(
  id: string,
  shape: "rectangle" | "rounded" | "diamond" | "ellipse" | "stadium" = "rectangle",
): { id: string; label: string; shape: typeof shape; classes: readonly string[] } {
  return { id, label: id, shape, classes: [] };
}

function makeEdge(
  from: string,
  to: string,
  ordinal = 0,
): { from: string; to: string; label: string; ordinal: number; type: string } {
  return { from, to, label: "", ordinal, type: "arrow" };
}

function makeNodeLayout(overrides?: Partial<NodeLayout>): NodeLayout {
  return { x: 100, y: 100, w: 180, h: 60, style: {}, ...overrides };
}

function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

// ── PD-01, PD-02, PD-03, PD-04, PD-10: generateCanvas roundness ───────────────

describe("generateCanvas — node roundness override", () => {
  it("PD-01: rectangle node with style.roundness: 16 → element roundness is 16 (overrides shape default null)", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A", "rectangle")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: { roundness: 16 } }) },
    });
    const scene = generateCanvas(parsed, layout);
    // Find the main shape element for node A (not the text label)
    const shapeEl = scene.elements.find(
      (e) => e.mermaidId === "A" && e.type === "rectangle",
    );
    expect(shapeEl).toBeDefined();
    // Explicit roundness: 16 should be used, not shape default (null for rectangle)
    expect(shapeEl!.roundness).toBe(16);
  });

  it("PD-01b: rounded node (shape default 8) with style.roundness: 32 → element roundness is 32", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A", "rounded")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: { roundness: 32 } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find(
      (e) => e.mermaidId === "A" && e.type === "rectangle",
    );
    expect(shapeEl).toBeDefined();
    // Explicit override wins over shape default (8 for rounded)
    expect(shapeEl!.roundness).toBe(32);
  });

  it("PD-02: rounded node with style.roundness: null → element roundness is null (sharp)", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A", "rounded")]]),
    });
    // shape default for "rounded" is 8, but explicit null should force sharp
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: { roundness: null } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find(
      (e) => e.mermaidId === "A" && e.type === "rectangle",
    );
    expect(shapeEl).toBeDefined();
    // null means sharp corners — override wins over shape default (8)
    expect(shapeEl!.roundness).toBeNull();
  });

  it("PD-03: diamond node with style.roundness: 16 → element has no roundness (shape ignores it)", () => {
    const parsed = makeParsed({
      nodes: new Map([["D", makeNode("D", "diamond")]]),
    });
    const layout = makeLayout({
      nodes: { D: makeNodeLayout({ style: { roundness: 16 } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find(
      (e) => e.mermaidId === "D" && e.type === "diamond",
    );
    expect(shapeEl).toBeDefined();
    // Diamond is not a rectangle-family shape — roundness is not applicable
    expect(shapeEl!.roundness == null).toBe(true);
  });

  it("PD-03b: ellipse node with style.roundness: 16 → roundness is null (shape ignores override)", () => {
    const parsed = makeParsed({
      nodes: new Map([["E", makeNode("E", "ellipse")]]),
    });
    const layout = makeLayout({
      nodes: { E: makeNodeLayout({ style: { roundness: 16 } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find(
      (e) => e.mermaidId === "E" && e.type === "ellipse",
    );
    expect(shapeEl).toBeDefined();
    // Ellipse is not a rectangle-family shape — roundness is not applicable
    expect(shapeEl!.roundness == null).toBe(true);
  });

  it("PD-04: edge with style.roundness: 8 → arrow element has roundness: 8 (routing unchanged)", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([
        ["A", makeNode("A", "rectangle")],
        ["B", makeNode("B", "rectangle")],
      ]),
      edges: [makeEdge("A", "B", 0)],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: {
        [k]: {
          routing: "auto",
          waypoints: [],
          style: { roundness: 8 },
        },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    // Edge roundness should be set on the arrow element
    expect(arrow!.roundness).toBe(8);
  });

  it("PD-04b: edge with style.roundness: null → arrow element has roundness: null", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([
        ["A", makeNode("A", "rectangle")],
        ["B", makeNode("B", "rectangle")],
      ]),
      edges: [makeEdge("A", "B", 0)],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: {
        [k]: {
          routing: "curved",
          waypoints: [],
          style: { roundness: null },
        },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    // Explicit null on edge = sharp corners
    expect(arrow!.roundness).toBeNull();
  });

  it("PD-10: edge routing is derived from layout.edges[key].routing, not from style.roundness", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([
        ["A", makeNode("A", "rectangle")],
        ["B", makeNode("B", "rectangle")],
      ]),
      edges: [makeEdge("A", "B", 0)],
    });
    // routing: "orthogonal", but roundness is set — routing should still be orthogonal
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 0, y: 200 }),
      },
      edges: {
        [k]: {
          routing: "orthogonal",
          waypoints: [],
          style: { roundness: 8 },
        },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    // Orthogonal routing produces ≥3 points (L-shape or Z-shape)
    expect(arrow!.points!.length).toBeGreaterThanOrEqual(3);
    // roundness is a visual property separate from routing geometry
    expect(arrow!.roundness).toBe(8);
  });
});

// ── PD-06: detectNodeMutations emits roundness changes ────────────────────────

describe("detectNodeMutations — roundness changes", () => {
  // Helper: minimal rectangle element factory
  function makeRect(
    id: string,
    mermaidId: string,
    roundness: number | null | { type: number },
  ): ExcalidrawAPIElement {
    return {
      id,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      version: 1,
      versionNonce: 0,
      isDeleted: false,
      fillStyle: "hachure",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      seed: 0,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: 0,
      link: null,
      locked: false,
      fontFamily: 1,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      roundness: roundness as ExcalidrawAPIElement["roundness"],
      customData: { mermaidId },
    };
  }

  it("PD-06: rectangle roundness changed (null → { type: 2 }) → emits exactly one styled mutation with roundness: 2 (numeric, normalized from Excalidraw format)", () => {
    const prev = [makeRect("exc-1", "A", null)];
    // User changed corner radius via Excalidraw UI — roundness is now { type: 2 }
    const next = [makeRect("exc-1", "A", { type: 2 })];

    const mutations = detectNodeMutations(prev, next);

    // Exactly one mutation emitted
    expect(mutations).toHaveLength(1);
    // detectNodeMutations normalizes Excalidraw roundness { type: N } to numeric N
    // for internal storage (NodeStyle.roundness: number | null per types.ts §13)
    expect(mutations[0]).toEqual({
      type: "styled",
      nodeId: "A",
      style: { roundness: 2 },
    });
  });

  it("PD-06b: rectangle roundness changed ({ type: 2 } → { type: 8 }) → emits exactly one styled mutation with roundness: 8 (numeric, normalized from Excalidraw format)", () => {
    const prev = [makeRect("exc-1", "B", { type: 2 })];
    const next = [makeRect("exc-1", "B", { type: 8 })];

    const mutations = detectNodeMutations(prev, next);

    // Exactly one mutation emitted
    expect(mutations).toHaveLength(1);
    // detectNodeMutations normalizes Excalidraw roundness { type: N } to numeric N
    expect(mutations[0]).toEqual({
      type: "styled",
      nodeId: "B",
      style: { roundness: 8 },
    });
  });
});

// ── PD-07 & PD-08: panel-core persists node/edge roundness ────────────────────

describe("panel-core — node and edge roundness persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchNode.mockReturnValue({});
    mockPatchEdge.mockReturnValue({});
    mockWriteLayout.mockResolvedValue(undefined);
  });

  // Minimal PanelState factory
  function makePanelState(): PanelState {
    return {
      mmdPath: "/fake/test.mmd",
      _workspaceRoot: "/fake",
      _panel: {},
      _currentLayout: {
        version: "1.0" as const,
        diagram_type: "flowchart" as const,
        nodes: {
          A: { x: 0, y: 0, w: 100, h: 50, style: {} },
        },
        edges: {
          "A->B:0": { routing: "auto", waypoints: [], style: {} },
        },
        clusters: {},
        aesthetics: {},
        unplaced: [],
      },
      _layoutWriteTimer: null,
    } as unknown as PanelState;
  }

  it("PD-07: handleNodeStyled with roundness on a node → calls patchNode (not patchEdge)", () => {
    vi.useFakeTimers();
    const panelState = makePanelState();

    handleNodeStyled(panelState, "A", { roundness: 16 });

    // Node roundness goes through patchNode
    expect(mockPatchNode).toHaveBeenCalled();
    expect(mockPatchEdge).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("PD-08: handleNodeStyled with roundness on an edge key (contains '->') → calls patchEdge", () => {
    vi.useFakeTimers();
    const panelState = makePanelState();

    handleNodeStyled(panelState, "A->B:0", { roundness: 8 });

    // Edge roundness goes through patchEdge (edge key path)
    expect(mockPatchEdge).toHaveBeenCalled();
    expect(mockPatchNode).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("PD-07b: roundness style is merged with existing node style in patchNode call", () => {
    vi.useFakeTimers();
    const panelState = makePanelState();

    handleNodeStyled(panelState, "A", { roundness: 16 });

    // The patch should include roundness merged into the existing style
    expect(mockPatchNode).toHaveBeenCalledWith(
      expect.anything(), // layout
      "A",
      expect.objectContaining({
        style: expect.objectContaining({ roundness: 16 }),
      }),
    );
    vi.useRealTimers();
  });

  it("PD-08b: roundness style is merged with existing edge style in patchEdge call", () => {
    vi.useFakeTimers();
    const panelState = makePanelState();

    handleNodeStyled(panelState, "A->B:0", { roundness: null });

    expect(mockPatchEdge).toHaveBeenCalledWith(
      expect.anything(), // layout
      "A->B:0",
      expect.objectContaining({
        style: expect.objectContaining({ roundness: null }),
      }),
    );
    vi.useRealTimers();
  });
});

// ── PD-09: scene-adapter maps roundness to Excalidraw payload ─────────────────

describe("toExcalidrawPayload — roundness mapping", () => {
  it("PD-09: element with roundness: 16 → Excalidraw payload roundness is { type: 2 }", () => {
    // Internal ExcalidrawElement roundness is number | null
    const elements: ExcalidrawElement[] = [
      {
        id: "el-1",
        mermaidId: "A",
        kind: "node",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        roughness: 1,
        fontFamily: "Excalifont",
        roundness: 16,
      },
    ];

    const payload = toExcalidrawPayload(elements);
    const el = payload.find((e) => e.id === "el-1");
    expect(el).toBeDefined();
    // Scene-adapter maps numeric roundness → Excalidraw { type: 2 } format
    expect(el!.roundness).toEqual({ type: 2 });
  });

  it("PD-09b: element with roundness: null → Excalidraw payload roundness is null (sharp)", () => {
    const elements: ExcalidrawElement[] = [
      {
        id: "el-2",
        mermaidId: "B",
        kind: "node",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        roughness: 1,
        fontFamily: "Excalifont",
        roundness: null,
      },
    ];

    const payload = toExcalidrawPayload(elements);
    const el = payload.find((e) => e.id === "el-2");
    expect(el).toBeDefined();
    // null roundness → null in Excalidraw (crisp corners)
    expect(el!.roundness).toBeNull();
  });

  it("PD-09c: element with no roundness (undefined) → Excalidraw payload roundness is null", () => {
    const elements: ExcalidrawElement[] = [
      {
        id: "el-3",
        mermaidId: "C",
        kind: "node",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        roughness: 1,
        fontFamily: "Excalifont",
        // roundness is absent/undefined
      },
    ];

    const payload = toExcalidrawPayload(elements);
    const el = payload.find((e) => e.id === "el-3");
    expect(el).toBeDefined();
    // Absent roundness → Excalidraw null (use shape default)
    expect(el!.roundness).toBeNull();
  });
});

// ── PD-05: edge roundness mutation detection ───────────────────────────────────

describe("detectNodeMutations — edge roundness changes", () => {
  // Helper: minimal arrow element factory
  function makeArrow(
    id: string,
    mermaidId: string,
    roundness: { type: number } | null,
  ): ExcalidrawAPIElement {
    return {
      id,
      type: "arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      version: 1,
      versionNonce: 0,
      isDeleted: false,
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      seed: 0,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: 0,
      link: null,
      locked: false,
      fontFamily: 1,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      roundness: roundness as ExcalidrawAPIElement["roundness"],
      points: [[0, 0], [100, 100]],
      customData: { mermaidId },
    };
  }

  it("PD-05: edge roundness changed (null → { type: 2 }) → emits exactly one styled mutation for edge key with roundness: 2 (numeric, normalized from Excalidraw format)", () => {
    // When an edge's roundness changes, it should emit a styled mutation with the edge key
    const prev = [makeArrow("exc-arrow", "A->B:0", null)];
    const next = [makeArrow("exc-arrow", "A->B:0", { type: 2 })];

    const mutations = detectNodeMutations(prev, next);

    // Exactly one mutation emitted
    expect(mutations).toHaveLength(1);
    // detectNodeMutations normalizes Excalidraw roundness { type: N } to numeric N
    // for internal storage (EdgeStyle.roundness: number | null per types.ts §13)
    expect(mutations[0]).toEqual({
      type: "styled",
      nodeId: "A->B:0", // edge key contains "->"
      style: { roundness: 2 },
    });
  });
});
