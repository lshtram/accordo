/**
 * state-placement.test.ts — Phase B failing tests for diag.2.6 SUP-S
 *
 * Tests the upstream placement integration for stateDiagram-v2:
 *   - First-time layout.json creation (upstream placement)
 *   - Reopen/view using existing layout.json
 *   - Fallback for unmatched nodes
 *   - Supported shape types
 *
 * Requirements covered (SUP-S01..SUP-S07):
 *   SUP-S01: layoutWithExcalidraw() accepts stateDiagram-v2 without throwing
 *   SUP-S02: Pseudostate identity matching (shape+position heuristic)
 *   SUP-S03: Composite state cluster mapping with CLUSTER_MARGIN/CLUSTER_LABEL_HEIGHT
 *   SUP-S04: Dagre fallback for unmatched nodes
 *   SUP-S05: State-specific post-processing after upstream placement
 *   SUP-S06: Debug instrumentation (layout-debug.ts, gated)
 *   SUP-S07: SUPPORTED_TYPES includes rectangle, diamond, ellipse, circle
 *
 * API checklist:
 *   layoutWithExcalidraw       — SUP-S01, SUP-S04, SUP-S05, SUP-S02, SUP-S03
 *   extractGeometry             — SUP-S07
 *   isPseudostateGeometry      — SUP-S02
 *   matchStatePseudostates     — SUP-S02
 *   mapStateGeometryToLayout   — SUP-S02, SUP-S03
 *   layoutDebug                 — SUP-S06
 *   loadAndPost (panel-core)   — reopen path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "os";
import { join } from "node:path";

import {
  layoutWithExcalidraw,
} from "../layout/excalidraw-engine.js";
import {
  extractGeometry,
} from "../layout/element-mapper.js";
import {
  isPseudostateGeometry,
} from "../layout/state-identity.js";
import {
  createPanelState,
} from "../webview/panel-state.js";
import {
  loadAndPost,
} from "../webview/panel-core.js";
import {
  MockWebviewPanel,
  makeExtensionContext,
  window as mockWindow,
  workspace as mockWorkspace,
} from "./mocks/vscode.js";
import type {
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
  UpstreamGeometry,
  PanelState,
} from "../types.js";

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
  createEmptyLayout: vi.fn((diagramType: string) => ({
    version: "1.0",
    diagram_type: diagramType ?? "stateDiagram-v2",
    nodes: {},
    edges: {},
    clusters: {},
    aesthetics: {},
    unplaced: [],
  })),
  patchNode: vi.fn((layout: Record<string, unknown>, nodeId: string, patch: Record<string, unknown>) => layout),
}));

vi.mock("../layout/auto-layout.js", () => {
  // Default fallback: place every node at (0,0) with standard dimensions.
  // Tests that need specific dagre positions can override via mockLayoutWithDagre.mockReturnValueOnce.
  const defaultDagreFallback = (parsed: Record<string, unknown>) => {
    const nodes: Record<string, { x: number; y: number; w: number; h: number; style: Record<string, unknown> }> = {};
    // parsed.nodes is a Map in real usage; iterate with forEach to handle both Map and plain object
    const parsedNodes = parsed.nodes as Map<string, unknown> | undefined;
    if (parsedNodes != null && typeof parsedNodes.forEach === "function") {
      parsedNodes.forEach((_, id) => {
        nodes[id] = { x: 0, y: 0, w: 180, h: 60, style: {} };
      });
    }
    // Return a complete LayoutStore so that spreading dagreLayout properties doesn't
    // accidentally overwrite base layout properties (version, diagram_type).
    return {
      nodes,
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      version: "1.0",
      diagram_type: "stateDiagram-v2",
    };
  };
  return {
    computeInitialLayout: (...args: unknown[]) => mockComputeInitialLayout(...args),
    layoutWithDagre: vi.fn(defaultDagreFallback as (...args: unknown[]) => unknown),
  };
});

vi.mock("./html.js", () => ({
  getWebviewHtml: (...args: unknown[]) => mockGetWebviewPayload(...args),
}));

vi.mock("./scene-adapter.js", () => ({
  toExcalidrawPayload: (...args: unknown[]) => mockToExcalidrawPayload(...args),
}));

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: (...args: unknown[]) =>
    mockParseMermaidToExcalidraw(...args),
}));

// ── Default mock implementations ─────────────────────────────────────────────

function setupDefaultMocks(): void {
  mockParseMermaid.mockResolvedValue({
    valid: true,
    diagram: { type: "stateDiagram-v2", nodes: {}, edges: [] },
    error: null,
  });
  mockGenerateCanvas.mockResolvedValue({
    elements: [{ id: "A" }],
    layout: { nodes: { A: { x: 0, y: 0, w: 100, h: 50 } }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] },
  });
  mockReadLayout.mockResolvedValue(null);
  mockWriteLayout.mockResolvedValue(undefined);
  mockComputeInitialLayout.mockReturnValue({
    nodes: { A: { x: 0, y: 0, w: 100, h: 50 } },
    edges: {},
    clusters: {},
    aesthetics: {},
    unplaced: [],
  });
  mockGetWebviewHtml.mockReturnValue("<html></html>");
  mockToExcalidrawPayload.mockReturnValue([{ id: "A" }]);
  mockReconcile.mockResolvedValue({
    layout: { nodes: { A: {} }, edges: {}, clusters: {}, aesthetics: {}, unplaced: [] },
  });
}

// ── Fixture helpers ─────────────────────────────────────────────────────────────

function makeDiagram(
  type: ParsedDiagram["type"] = "flowchart",
  nodes: ParsedNode[] = [],
  edges: ParsedEdge[] = [],
  clusters: ParsedCluster[] = [],
): ParsedDiagram {
  return {
    type,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
    clusters,
    renames: [],
  };
}

function makeNode(
  id: string,
  label: string = id,
  shape: ParsedNode["shape"] = "rounded",
): ParsedNode {
  return { id, label, shape, classes: [] };
}

function makeEdge(
  from: string,
  to: string,
  ordinal = 0,
  label = "",
): ParsedEdge {
  return { from, to, ordinal, label, type: "arrow" };
}

function makeCluster(
  id: string,
  label: string,
  members: string[],
  parent?: string,
): ParsedCluster {
  return { id, label, members, ...(parent && { parent }) };
}

// ── Upstream element fixtures ───────────────────────────────────────────────────
// Adapted from @excalidraw/mermaid-to-excalidraw playground/testcases/state.ts

/** state-01: Simple Transition — [*] --> Idle --> Active --> [*] */
const UPSTREAM_STATE_01: unknown[] = [
  { id: "s0", type: "circle", x: 50, y: 50, width: 30, height: 30 },
  { id: "s1", type: "rectangle", x: 150, y: 40, width: 120, height: 60, label: "Idle" },
  { id: "s2", type: "rectangle", x: 400, y: 40, width: 120, height: 60, label: "Active" },
  { id: "s3", type: "circle", x: 600, y: 50, width: 30, height: 30 },
  { id: "e0", type: "arrow", x: 80, y: 65, width: 70, height: 10, points: [[0,0],[35,5],[70,10]] },
  { id: "e1", type: "arrow", x: 270, y: 65, width: 130, height: 10, points: [[0,0],[65,5],[130,10]] },
  { id: "e2", type: "arrow", x: 520, y: 65, width: 80, height: 10, points: [[0,0],[40,5],[80,10]] },
];

/** state-03: Composite State — Session { [*] --> Ready --> Busy } */
const UPSTREAM_STATE_03: unknown[] = [
  { id: "g0", type: "rectangle", x: 100, y: 20, width: 400, height: 200, label: "Session", groupId: "g-session" },
  { id: "s0", type: "circle", x: 130, y: 50, width: 24, height: 24 },
  { id: "s1", type: "rectangle", x: 180, y: 40, width: 100, height: 50, label: "Ready" },
  { id: "s2", type: "rectangle", x: 180, y: 120, width: 100, height: 50, label: "Busy" },
  { id: "e0", type: "arrow", x: 230, y: 90, width: 10, height: 30, points: [[0,0],[5,15],[10,30]] },
];

/** state-04: Multiple Composite State Transitions */
const UPSTREAM_STATE_04: unknown[] = [
  { id: "g0", type: "rectangle", x: 20, y: 20, width: 120, height: 120, label: "First", groupId: "g-first" },
  { id: "f0", type: "circle", x: 40, y: 40, width: 20, height: 20 },
  { id: "g1", type: "rectangle", x: 180, y: 20, width: 120, height: 120, label: "Second", groupId: "g-second" },
  { id: "f1", type: "circle", x: 200, y: 40, width: 20, height: 20 },
  { id: "g2", type: "rectangle", x: 340, y: 20, width: 120, height: 120, label: "Third", groupId: "g-third" },
  { id: "f2", type: "circle", x: 360, y: 40, width: 20, height: 20 },
  { id: "e0", type: "arrow", x: 80, y: 120, width: 140, height: 0, points: [[0, 0], [80, 0], [140, 0]] },
];

/** state-05: Nested Composite States */
const UPSTREAM_STATE_05: unknown[] = [
  { id: "g0", type: "rectangle", x: 10, y: 10, width: 280, height: 200, label: "First", groupId: "g-first" },
  { id: "g1", type: "rectangle", x: 30, y: 30, width: 200, height: 150, label: "Second", groupId: "g-second" },
  { id: "s0", type: "rectangle", x: 50, y: 50, width: 80, height: 40, label: "InnerA" },
];

/** state-06: Concurrency — Active { [*] --> Left -- [*] --> Right } */
const UPSTREAM_STATE_06: unknown[] = [
  { id: "g0", type: "rectangle", x: 100, y: 20, width: 300, height: 180, label: "Active", groupId: "g-active" },
  { id: "s0", type: "circle", x: 130, y: 50, width: 20, height: 20 },
  { id: "s1", type: "circle", x: 130, y: 130, width: 20, height: 20 },
  { id: "s2", type: "rectangle", x: 180, y: 40, width: 80, height: 40, label: "Left" },
  { id: "s3", type: "rectangle", x: 180, y: 120, width: 80, height: 40, label: "Right" },
];

/** state-07: Fork and Join */
const UPSTREAM_STATE_07: unknown[] = [
  { id: "f0", type: "diamond", x: 150, y: 60, width: 80, height: 60, label: "fork" },
  { id: "j0", type: "diamond", x: 400, y: 60, width: 80, height: 60, label: "join" },
  { id: "s0", type: "rectangle", x: 280, y: 30, width: 80, height: 40, label: "State2" },
  { id: "s1", type: "rectangle", x: 280, y: 100, width: 80, height: 40, label: "State3" },
  { id: "s2", type: "rectangle", x: 520, y: 60, width: 80, height: 40, label: "State4" },
];

/** state-02: Choice and Notes — diamond shape for decision */
const UPSTREAM_STATE_02: unknown[] = [
  { id: "s0", type: "rectangle", x: 100, y: 40, width: 100, height: 60, label: "Input" },
  { id: "d0", type: "diamond",   x: 280, y: 30, width: 80, height: 80, label: "Decision" },
  { id: "s1", type: "rectangle", x: 420, y: 20, width: 80, height: 40, label: "Accept" },
  { id: "s2", type: "rectangle", x: 420, y: 80, width: 80, height: 40, label: "Reject" },
];

/** Partial: only "Known" returned by upstream — "Orphan" must fall back to dagre */
const UPSTREAM_PARTIAL: unknown[] = [
  { id: "known", type: "rectangle", x: 200, y: 100, width: 120, height: 60, label: "Known" },
];

/** Circle with empty label — pseudostate from upstream */
const UPSTREAM_PSEUDOSTATE: unknown[] = [
  { id: "p0", type: "circle", x: 50, y: 50, width: 30, height: 30 },
];

/** Ellipse with empty label — real upstream pseudostate runtime shape */
const UPSTREAM_ELLIPSE_PSEUDOSTATE: unknown[] = [
  { id: "p1", type: "ellipse", x: 75, y: 85, width: 24, height: 24 },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUP-S01: Type gate accepts stateDiagram-v2
// ─────────────────────────────────────────────────────────────────────────────

describe("SUP-S01: layoutWithExcalidraw accepts stateDiagram-v2", () => {
  it("SUP-S01: does not throw for stateDiagram-v2 source", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [
      makeNode("Idle", "Idle"),
      makeNode("Active", "Active"),
    ], [
      makeEdge("Idle", "Active"),
    ]);

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: [] });

    // SUP-S01: must resolve, not throw
    await expect(
      layoutWithExcalidraw("stateDiagram-v2\n  Idle --> Active", parsed),
    ).resolves.not.toThrow();
  });

  it("SUP-S01: resolved layout has diagram_type='stateDiagram-v2'", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [
      makeNode("Idle", "Idle"),
    ], []);

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: [] });

    const layout = await layoutWithExcalidraw("stateDiagram-v2\n  Idle", parsed);
    expect(layout.diagram_type).toBe("stateDiagram-v2");
  });

  it("SUP-S01: resolved layout has version='1.0'", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [makeNode("Idle", "Idle")], []);
    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: [] });
    const layout = await layoutWithExcalidraw("stateDiagram-v2\n  Idle", parsed);
    expect(layout.version).toBe("1.0");
  });

  it("SUP-S01: resolved layout has all required fields", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [makeNode("Idle", "Idle")], []);
    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: [] });
    const layout = await layoutWithExcalidraw("stateDiagram-v2\n  Idle", parsed);
    expect(typeof layout.nodes).toBe("object");
    expect(typeof layout.edges).toBe("object");
    expect(typeof layout.clusters).toBe("object");
    expect(typeof layout.aesthetics).toBe("object");
    expect(Array.isArray(layout.unplaced)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUP-S07: Supported shape types
// ─────────────────────────────────────────────────────────────────────────────

describe("SUP-S07: SUPPORTED_TYPES — rectangle, diamond, ellipse, circle", () => {
  const STATE_DIAGRAM_SHAPES: readonly unknown[] = [
    { type: "rectangle", x: 0, y: 0, width: 100, height: 50, label: "State" },
    { type: "diamond",    x: 0, y: 0, width: 80,  height: 80,  label: "Choice" },
    { type: "ellipse",   x: 0, y: 0, width: 100, height: 50, label: "End" },
    { type: "circle",    x: 0, y: 0, width: 30,  height: 30, label: "Start" },
  ];

  it("SUP-S07: rectangle is NOT filtered out", () => {
    const result = extractGeometry(STATE_DIAGRAM_SHAPES);
    expect(result.some((g) => g.type === "rectangle")).toBe(true);
  });

  it("SUP-S07: diamond is NOT filtered out", () => {
    const result = extractGeometry(STATE_DIAGRAM_SHAPES);
    expect(result.some((g) => g.type === "diamond")).toBe(true);
  });

  it("SUP-S07: ellipse is NOT filtered out", () => {
    const result = extractGeometry(STATE_DIAGRAM_SHAPES);
    expect(result.some((g) => g.type === "ellipse")).toBe(true);
  });

  it("SUP-S07: circle (with label) is NOT filtered out", () => {
    const result = extractGeometry(STATE_DIAGRAM_SHAPES);
    expect(result.some((g) => g.type === "circle")).toBe(true);
  });

  it("SUP-S07: all 4 state-diagram types appear in extractGeometry output", () => {
    const result = extractGeometry(STATE_DIAGRAM_SHAPES);
    expect(result).toHaveLength(4);
  });

  it("SUP-S07: circle with empty label IS included by extractGeometry (pseudostates filtered later)", () => {
    // extractGeometry now passes circles through regardless of label so that
    // matchStatePseudostates can match them by shape+position downstream.
    // The filtering to actual pseudostates happens in isPseudostateGeometry.
    const result = extractGeometry(UPSTREAM_PSEUDOSTATE);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("circle");
    expect(result[0]!.label).toBe("");
  });

  it("SUP-S07: ellipse with empty label IS included by extractGeometry", () => {
    const result = extractGeometry(UPSTREAM_ELLIPSE_PSEUDOSTATE);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("ellipse");
    expect(result[0]!.label).toBe("");
  });

  it("SUP-S07: state labels emitted as label.text objects are extracted", () => {
    const result = extractGeometry([
      { type: "rectangle", x: 150, y: 40, width: 120, height: 60, label: { text: "Idle" } },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("Idle");
  });

  it("SUP-S07: unsupported type (hexagon) is excluded", () => {
    const mixed: readonly unknown[] = [
      { type: "rectangle", x: 0, y: 0, width: 100, height: 50, label: "R" },
      { type: "hexagon",   x: 0, y: 0, width: 80,  height: 60, label: "H" },
    ];
    const result = extractGeometry(mixed);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("rectangle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUP-S02: Pseudostate identity matching
// ─────────────────────────────────────────────────────────────────────────────

describe("SUP-S02: Pseudostate identity matching — shape+position heuristic", () => {
  it("SUP-S02: isPseudostateGeometry returns true for small circle (≤40×40) with empty label", () => {
    const geo: UpstreamGeometry = { label: "", x: 50, y: 50, width: 30, height: 30, type: "circle" };
    // SUP-S02: must return true for small empty-label circles
    expect(isPseudostateGeometry(geo)).toBe(true);
  });

  it("SUP-S02: isPseudostateGeometry returns false for rectangle (even if small)", () => {
    const geo: UpstreamGeometry = { label: "Idle", x: 150, y: 40, width: 30, height: 30, type: "rectangle" };
    expect(isPseudostateGeometry(geo)).toBe(false);
  });

  it("SUP-S02: isPseudostateGeometry returns false for large circle (>40px)", () => {
    const geo: UpstreamGeometry = { label: "", x: 50, y: 50, width: 60, height: 60, type: "circle" };
    expect(isPseudostateGeometry(geo)).toBe(false);
  });

  it("SUP-S02: isPseudostateGeometry returns true for small ellipse with empty label", () => {
    const geo: UpstreamGeometry = { label: "", x: 50, y: 50, width: 40, height: 30, type: "ellipse" };
    expect(isPseudostateGeometry(geo)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUP-S03: Composite state cluster mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("SUP-S03: Composite state cluster mapping", () => {
  it("SUP-S03: composite state produces ClusterLayout with correct bounds", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("Ready", "Ready"), makeNode("Busy", "Busy")],
      [makeEdge("Ready", "Busy")],
      [makeCluster("Session", "Session", ["Ready", "Busy"])],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_03 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state Session { [*] --> Ready --> Busy }",
      parsed,
    );

    // SUP-S03: composite state → ClusterLayout with canonical scaled bounds.
    // UPSTREAM_STATE_03 group normalizes to x=80, y=-28, w=440, h=268,
    // then the state engine applies the canonical 1.5x scale.
    expect(layout.clusters["Session"]).toBeDefined();
    const c = layout.clusters["Session"]!;
    expect(c.x).toBe(120);
    expect(c.y).toBe(-42);
    expect(c.w).toBe(660);
    expect(c.h).toBe(402);
    expect(c.label).toBe("Session");
  });

  it("SUP-S03: nested composite states have parent field set", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("InnerA", "InnerA")],
      [],
      [
        makeCluster("First", "First", ["InnerA"], undefined),
        makeCluster("Second", "Second", ["InnerA"], "First"),
      ],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_05 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state First { state Second { InnerA } }",
      parsed,
    );

    expect(layout.clusters["First"]).toBeDefined();
    expect(layout.clusters["Second"]).toBeDefined();
    expect((layout.clusters["Second"] as Record<string, unknown>).parent).toBe("First");
  });

  it("SUP-S03: concurrency regions map as sibling clusters", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("Left", "Left"), makeNode("Right", "Right")],
      [],
      [makeCluster("Active", "Active", ["Left", "Right"])],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_06 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state Active { [*] --> Left -- [*] --> Right }",
      parsed,
    );

    expect(layout.clusters["Active"]).toBeDefined();
    expect(layout.nodes["Left"]).toBeDefined();
    expect(layout.nodes["Right"]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUP-S04: Dagre fallback for unmatched nodes
// ─────────────────────────────────────────────────────────────────────────────

describe("SUP-S04: Dagre fallback for unmatched state nodes", () => {
  it("SUP-S04: Orphan node (no upstream geometry) gets dagre position", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [
      makeNode("Known", "Known"),
      makeNode("Orphan", "Orphan"),
    ], []);

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_PARTIAL });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  Known\n  Orphan",
      parsed,
    );

    // SUP-S04: Orphan falls back to dagre — must have finite coordinates
    expect(layout.nodes["Orphan"]).toBeDefined();
    expect(Number.isFinite(layout.nodes["Orphan"]!.x)).toBe(true);
    expect(Number.isFinite(layout.nodes["Orphan"]!.y)).toBe(true);
    expect(layout.nodes["Orphan"]!.w).toBeGreaterThan(0);
    expect(layout.nodes["Orphan"]!.h).toBeGreaterThan(0);
  });

  it("SUP-S04: Known node gets upstream position (not replaced by dagre)", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [
      makeNode("Known", "Known"),
      makeNode("Orphan", "Orphan"),
    ], []);

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_PARTIAL });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  Known\n  Orphan",
      parsed,
    );

    // SUP-S04: Known gets canonical scaled upstream geometry (from UPSTREAM_PARTIAL)
    expect(layout.nodes["Known"]!.x).toBe(300);
    expect(layout.nodes["Known"]!.y).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUP-S05: State-specific post-processing — upstream placement overrides dagre
// These tests CANNOT pass via dagre fallback — they assert exact upstream positions
// ─────────────────────────────────────────────────────────────────────────────

describe("SUP-S05: State-specific post-processing — upstream overrides dagre", () => {
  it("SUP-S05: upstream cluster bounds override dagre fallback", async () => {
    // UPSTREAM_STATE_03: Session at (100,20) 400×200
    // Dagre would compute different cluster bounds — this fails if fallback is used
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("Ready", "Ready"), makeNode("Busy", "Busy")],
      [makeEdge("Ready", "Busy")],
      [makeCluster("Session", "Session", ["Ready", "Busy"])],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_03 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state Session { [*] --> Ready --> Busy }",
      parsed,
    );

    // SUP-S05: cluster bounds stay on the canonical scaled geometry path.
    expect(layout.clusters["Session"]!.x).toBe(120);
    expect(layout.clusters["Session"]!.y).toBe(-42);
    expect(layout.clusters["Session"]!.w).toBe(660);
    expect(layout.clusters["Session"]!.h).toBe(402);
  });

  it("SUP-S05: composite children Y positions match upstream (dagre would differ)", async () => {
    // UPSTREAM_STATE_03: Ready at y=40, Busy at y=120
    // Dagre TB would give them different Y coordinates
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("Ready", "Ready"), makeNode("Busy", "Busy")],
      [makeEdge("Ready", "Busy")],
      [makeCluster("Session", "Session", ["Ready", "Busy"])],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_03 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state Session { [*] --> Ready --> Busy }",
      parsed,
    );

    // SUP-S05: exact canonical scaled upstream positions — dagre would differ.
    expect(layout.nodes["Ready"]!.x).toBe(270);
    expect(layout.nodes["Ready"]!.y).toBe(60);
    expect(layout.nodes["Busy"]!.x).toBe(270);
    expect(layout.nodes["Busy"]!.y).toBe(180);
  });

  it("SUP-S05: all parsed.nodes appear in layout.nodes", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [
      makeNode("Idle", "Idle"),
      makeNode("Active", "Active"),
    ], [
      makeEdge("Idle", "Active"),
    ]);

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: [] });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  Idle --> Active",
      parsed,
    );

    expect(layout.nodes["Idle"]).toBeDefined();
    expect(layout.nodes["Active"]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUP-S06: Debug instrumentation
// ─────────────────────────────────────────────────────────────────────────────

describe("SUP-S06: Debug instrumentation (layout-debug.ts, gated)", () => {
  it("SUP-S06: layoutDebug is a callable function", async () => {
    const { layoutDebug } = await import("../layout/layout-debug.js");
    expect(typeof layoutDebug).toBe("function");
  });

  it("SUP-S06: layoutDebug is off by default (gated — no-op when disabled)", async () => {
    const { layoutDebug, isLayoutDebugEnabled } = await import("../layout/layout-debug.js");
    expect(isLayoutDebugEnabled()).toBe(false);
    expect(() => layoutDebug({ category: "test", message: "test" })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// First-init: upstream placement with real upstream fixtures (state-01 through state-07)
// ─────────────────────────────────────────────────────────────────────────────

describe("First-init: upstream placement with state-01..state-07 fixtures", () => {
  it("state-01: Simple Transition — all 4 nodes placed (pseudostates included)", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [
      makeNode("root_start", "", "stateStart"),
      makeNode("Idle", "Idle", "rounded"),
      makeNode("Active", "Active", "rounded"),
      makeNode("root_end", "", "stateEnd"),
    ], [
      makeEdge("root_start", "Idle"),
      makeEdge("Idle", "Active"),
      makeEdge("Active", "root_end"),
    ]);

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_01 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  [*] --> Idle --> Active --> [*]",
      parsed,
    );

    expect(layout.nodes["Idle"]).toBeDefined();
    expect(layout.nodes["Active"]).toBeDefined();
    expect(layout.nodes["root_start"]).toBeDefined();
    expect(layout.nodes["root_end"]).toBeDefined();

    // SUP-S02 assertion: pseudostates are placed from canonical scaled upstream geometry, not dagre.
    // UPSTREAM_STATE_01: start [*] at (50,50), end [*] at (600,50), scaled by 1.5x.
    // If dagre fallback were used, these would be (0,0).
    expect(layout.nodes["root_start"]!.x).toBe(75);
    expect(layout.nodes["root_start"]!.y).toBe(75);
    expect(layout.nodes["root_end"]!.x).toBe(900);
    expect(layout.nodes["root_end"]!.y).toBe(75);

    // Regular states also use canonical scaled upstream positions.
    expect(layout.nodes["Idle"]!.x).toBe(225);
    expect(layout.nodes["Idle"]!.y).toBe(60);
    expect(layout.nodes["Active"]!.x).toBe(600);
    expect(layout.nodes["Active"]!.y).toBe(60);
    expect(layout.nodes["Idle"]!.w).toBeGreaterThan(80);
    expect(layout.nodes["Idle"]!.h).toBeGreaterThan(40);
  });

  it("state-02: Choice — diamond shape appears in layout (SUP-S07)", async () => {
    const parsed = makeDiagram("stateDiagram-v2", [
      makeNode("Input", "Input"),
      makeNode("Decision", "Decision"),
      makeNode("Accept", "Accept"),
      makeNode("Reject", "Reject"),
    ], []);

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_02 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  [*] --> Input --> Decision --> Accept\n  Decision --> Reject",
      parsed,
    );

    // SUP-S07: diamond (Decision) must appear — cannot be filtered
    expect(layout.nodes["Decision"]).toBeDefined();
  });

  it("state-03: Composite State — cluster + children all placed", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("Ready", "Ready"), makeNode("Busy", "Busy")],
      [makeEdge("Ready", "Busy")],
      [makeCluster("Session", "Session", ["Ready", "Busy"])],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_03 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state Session { [*] --> Ready --> Busy }",
      parsed,
    );

    expect(layout.clusters["Session"]).toBeDefined();
    expect(layout.nodes["Ready"]).toBeDefined();
    expect(layout.nodes["Busy"]).toBeDefined();
  });

  it("state-04: Multiple Composite Transitions — three composites each with children", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [],
      [makeEdge("First", "Second")],
      [
        makeCluster("First", "First", ["fir"]),
        makeCluster("Second", "Second", ["sec"]),
        makeCluster("Third", "Third", ["thi"]),
      ],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_04 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state First { fir } state Second { sec } state Third { thi }",
      parsed,
    );

    expect(layout.clusters["First"]).toBeDefined();
    expect(layout.clusters["Second"]).toBeDefined();
    expect(layout.clusters["Third"]).toBeDefined();
    expect(layout.edges["First->Second:0"]).toMatchObject({
      routing: "direct",
      waypoints: [{ x: 240, y: 180 }],
    });
  });

  it("state-05: Nested Composite States — innerA placed inside nested Second>First", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("InnerA", "InnerA")],
      [],
      [
        makeCluster("First", "First", ["InnerA"], undefined),
        makeCluster("Second", "Second", ["InnerA"], "First"),
      ],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_05 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state First { state Second { InnerA } }",
      parsed,
    );

    expect(layout.nodes["InnerA"]).toBeDefined();
    expect(layout.clusters["Second"]).toBeDefined();
    expect(layout.clusters["First"]).toBeDefined();
  });

  it("state-06: Concurrency — Active cluster with two concurrent child states", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("Left", "Left"), makeNode("Right", "Right")],
      [],
      [makeCluster("Active", "Active", ["Left", "Right"])],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_06 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state Active { [*] --> Left -- [*] --> Right }",
      parsed,
    );

    expect(layout.clusters["Active"]).toBeDefined();
    expect(layout.nodes["Left"]).toBeDefined();
    expect(layout.nodes["Right"]).toBeDefined();
  });

  it("state-07: Fork and Join — fork/join diamonds preserved (SUP-S07)", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [
        makeNode("fork_state", "fork"),
        makeNode("join_state", "join"),
        makeNode("State2", "State2"),
        makeNode("State3", "State3"),
        makeNode("State4", "State4"),
      ],
      [],
    );

    mockParseMermaidToExcalidraw.mockResolvedValueOnce({ elements: UPSTREAM_STATE_07 });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  [*] --> fork --> State2\n  fork --> State3\n  State2 --> join\n  State3 --> join\n  join --> State4 --> [*]",
      parsed,
    );

    // SUP-S07: fork and join are diamonds — must not be filtered
    expect(layout.nodes["fork_state"]).toBeDefined();
    expect(layout.nodes["join_state"]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reopen: existing layout.json for stateDiagram-v2
// ─────────────────────────────────────────────────────────────────────────────

describe("Reopen: existing layout.json for stateDiagram-v2", () => {
  let tmpDir: string;
  let mmdPath: string;
  let ctx: MockExtensionContext;
  let vscPanel: MockWebviewPanel;
  let state: PanelState;

  beforeEach(async () => {
    vi.clearAllMocks();
    setupDefaultMocks();

    tmpDir = mkdtempSync(join(tmpdir(), "diag-reopen-state-"));
    mmdPath = join(tmpDir, "test.mmd");
    await writeFile(mmdPath, "stateDiagram-v2\n  Idle --> Active", "utf8");
    mockWorkspace.workspaceFolders = [{ uri: { fsPath: tmpDir } as never, name: "test" }];

    ctx = makeExtensionContext();
    vscPanel = new MockWebviewPanel("accordo.diagram", "test");
    vi.mocked(mockWindow.createWebviewPanel).mockReturnValue(vscPanel as never);

    state = createPanelState(mmdPath, vscPanel as never, ctx as never);
  });

  it("SUP-S01: reopen with existing stateDiagram-v2 layout uses host:load-scene", async () => {
    const existingLayout = {
      version: "1.0" as const,
      diagram_type: "stateDiagram-v2" as const,
      nodes: {
        Idle: { x: 100, y: 200, w: 120, h: 60 },
        Active: { x: 400, y: 200, w: 120, h: 60 },
      },
      edges: {
        "Idle->Active:0": { routing: "auto", waypoints: [], style: {} },
      },
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };

    mockReadLayout.mockResolvedValueOnce(existingLayout);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // Reopen: MUST post host:load-scene (NOT host:load-upstream-direct)
    const loadSceneCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();

    const upstreamCall = vi.mocked(vscPanel.webview.postMessage).mock.calls.find(
      ([msg]) => (msg as { type: string }).type === "host:load-upstream-direct",
    );
    expect(upstreamCall).toBeUndefined();
  });

  it("SUP-S01: reopen preserves diagram_type='stateDiagram-v2' from layout metadata", async () => {
    const existingLayout = {
      version: "1.0" as const,
      diagram_type: "stateDiagram-v2" as const,
      nodes: {
        root_start: { x: 50, y: 50, w: 30, h: 30 },
        Idle: { x: 150, y: 40, w: 120, h: 60 },
      },
      edges: {},
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };

    mockReadLayout.mockResolvedValueOnce(existingLayout);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // generateCanvas receives the stateDiagram-v2 layout
    expect(mockGenerateCanvas).toHaveBeenCalled();
    const [, layoutArg] = mockGenerateCanvas.mock.calls[0];
    expect((layoutArg as Record<string, string>).diagram_type).toBe("stateDiagram-v2");
  });

  it("SUP-S04: reopen preserves upstream positions from layout (no dagre override)", async () => {
    // Layout seeded with upstream coordinates for both states.
    // On reopen the layout is passed through as-is — no dagre recomputation.
    const existingLayout = {
      version: "1.0" as const,
      diagram_type: "stateDiagram-v2" as const,
      nodes: {
        Idle:   { x: 150, y: 40,  w: 120, h: 60 },
        Active: { x: 450, y: 40,  w: 120, h: 60 },
      },
      edges: {
        "Idle->Active:0": { routing: "auto", waypoints: [], style: {} },
      },
      clusters: {},
      aesthetics: {},
      unplaced: [],
      metadata: { engine: "upstream-direct" },
    };

    mockReadLayout.mockResolvedValueOnce(existingLayout);
    const panelState = { ...state, _panel: vscPanel as never } as PanelState & { _panel: never };

    await loadAndPost(panelState as never);

    // generateCanvas receives the persisted upstream layout unchanged.
    // This confirms reopen reads layout.json and feeds it to the render pipeline
    // without re-running dagre (which would likely give different Y/rank positions).
    expect(mockGenerateCanvas).toHaveBeenCalled();
    const [, layoutArg] = mockGenerateCanvas.mock.calls[0];
    const layout = layoutArg as Record<string, unknown>;
    expect((layout as Record<string, string>).diagram_type).toBe("stateDiagram-v2");
    // Upstream Y positions must be preserved as-is (not overwritten by dagre rankdir)
    const nodes = layout.nodes as Record<string, { x: number; y: number; w: number; h: number }>;
    expect(nodes["Idle"]!.y).toBe(40);
    expect(nodes["Active"]!.y).toBe(40);
  });
});
