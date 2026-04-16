/**
 * A15 — panel-core: core load/post and webview message handling logic.
 *
 * Extracted from DiagramPanel: loadAndPost, handleWebviewMessage, patchLayout,
 * and the node/export event handlers.
 *
 * Source: diag_workplan.md §4.15
 */

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as vscode from "vscode";
import { parseMermaid } from "../parser/adapter.js";
import {
  readLayout,
  writeLayout,
  layoutPathFor,
  createEmptyLayout,
  patchNode,
  patchEdge,
} from "../layout/layout-store.js";
import { reconcile } from "../reconciler/reconciler.js";
import { generateCanvas } from "../canvas/canvas-generator.js";
import { computeInitialLayout } from "../layout/auto-layout.js";
import type { LayoutOptions } from "../layout/auto-layout.js";
import { toExcalidrawPayload } from "./scene-adapter.js";
import { dumpExcalidrawJson } from "./debug-diagram-json.js";
import { appendDiagramFlowLog } from "./debug-flow-log.js";
import type { LayoutStore, SpatialDiagramType, NodeLayout, EdgeLayout } from "../types.js";
import type {
  HostLoadSceneMessage,
  HostErrorOverlayMessage,
  WebviewToHostMessage,
} from "./protocol.js";
import type { PanelState } from "./panel-state.js";
import { PanelFileNotFoundError } from "./panel.js";

export { PanelFileNotFoundError };

// ── Upstream placement helper (runs ONLY at first init) ──────────────────────

type ExcalidrawElementSkeleton = Record<string, unknown>;

// Flag to ensure shim is applied only once.
let _shimApplied = false;

// ── SVG Geometry Polyfills ─────────────────────────────────────────────────────

/** Simple bounding box representation used for SVG geometry estimation. */
interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Estimate bounding box for a rect element from its attributes.
 * Uses any type for el to avoid DOM lib dependency.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromRect(el: any): BBox {
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  const w = parseFloat(el.getAttribute?.("width") ?? "0");
  const h = parseFloat(el.getAttribute?.("height") ?? "0");
  return { x, y, width: w, height: h };
}

/**
 * Estimate bounding box for a circle element from its attributes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromCircle(el: any): BBox {
  const cx = parseFloat(el.getAttribute?.("cx") ?? "0");
  const cy = parseFloat(el.getAttribute?.("cy") ?? "0");
  const r = parseFloat(el.getAttribute?.("r") ?? "0");
  return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
}

/**
 * Estimate bounding box for an ellipse element from its attributes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromEllipse(el: any): BBox {
  const cx = parseFloat(el.getAttribute?.("cx") ?? "0");
  const cy = parseFloat(el.getAttribute?.("cy") ?? "0");
  const rx = parseFloat(el.getAttribute?.("rx") ?? "0");
  const ry = parseFloat(el.getAttribute?.("ry") ?? "0");
  return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
}

/**
 * Estimate bounding box for a line element from its attributes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromLine(el: any): BBox {
  const x1 = parseFloat(el.getAttribute?.("x1") ?? "0");
  const y1 = parseFloat(el.getAttribute?.("y1") ?? "0");
  const x2 = parseFloat(el.getAttribute?.("x2") ?? "0");
  const y2 = parseFloat(el.getAttribute?.("y2") ?? "0");
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const maxX = Math.max(x1, x2);
  const maxY = Math.max(y1, y2);
  return { x: minX, y: minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

/**
 * Estimate bounding box for a polygon/polyline element from its points attribute.
 * Points format: "x1,y1 x2,y2 ..." or "x1,y1,x2,y2,..."
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromPoly(el: any): BBox {
  const raw = el.getAttribute?.("points") ?? "";
  const nums: number[] = [];
  for (const part of raw.trim().split(/[\s,]+/)) {
    const n = parseFloat(part);
    if (!isNaN(n)) nums.push(n);
  }
  if (nums.length < 4) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = nums[0], maxX = nums[0], minY = nums[1], maxY = nums[1];
  for (let i = 0; i < nums.length; i += 2) {
    if (i + 1 >= nums.length) break;
    const px = nums[i], py = nums[i + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

/**
 * Extract numeric coordinates from a path `d` attribute (only M and L commands).
 * Returns flat [x, y, x, y, ...] array.
 */
function _pathCoords(d: string): number[] {
  const nums: number[] = [];
  // Match M x y ... and L x y ... (absolute)
  const re = /(?:^|[ML])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    nums.push(parseFloat(m[1]), parseFloat(m[2]));
  }
  return nums;
}

/**
 * Estimate bounding box for a path element from its `d` attribute.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromPath(el: any): BBox {
  const d = el.getAttribute?.("d") ?? "";
  const nums = _pathCoords(d);
  if (nums.length < 4) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = nums[0], maxX = nums[0], minY = nums[1], maxY = nums[1];
  for (let i = 0; i < nums.length; i += 2) {
    const px = nums[i], py = nums[i + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

/**
 * Estimate bounding box for a text/tspan element by recursively processing children.
 * Falls back to computing from content length estimation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromText(el: any): BBox {
  // First try children (tspan within text)
  const children = el.children;
  if (children && children.length > 0) {
    let union = { x: Infinity, y: Infinity, width: -Infinity, height: -Infinity };
    let hasChildren = false;
    for (let i = 0; i < children.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = children[i] as any;
      const childBbox = _bboxFromElement(child, true);
      if (childBbox.width > 0 || childBbox.height > 0) {
        hasChildren = true;
        const minX = Math.min(union.x, childBbox.x);
        const minY = Math.min(union.y, childBbox.y);
        const maxX = Math.max(union.x + union.width, childBbox.x + childBbox.width);
        const maxY = Math.max(union.y + union.height, childBbox.y + childBbox.height);
        union = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }
    }
    if (hasChildren) return union;
  }

  // Estimate from attributes
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  // Estimate 8px per character
  const text = el.textContent ?? "";
  const approxWidth = Math.max(text.length * 8, 20);
  const approxHeight = 16;
  return { x, y: y - approxHeight * 0.8, width: approxWidth, height: approxHeight };
}

/**
 * Estimate bounding box for a foreignObject element.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromForeignObject(el: any): BBox {
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  const w = parseFloat(el.getAttribute?.("width") ?? "0");
  const h = parseFloat(el.getAttribute?.("height") ?? "0");
  return { x, y, width: w, height: h };
}

/**
 * Estimate bounding box for an image element.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromImage(el: any): BBox {
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  const w = parseFloat(el.getAttribute?.("width") ?? "0");
  const h = parseFloat(el.getAttribute?.("height") ?? "0");
  return { x, y, width: w, height: h };
}

/**
 * Core bbox estimation dispatcher — recurses into children when shape
 * has no direct size (e.g. groups) and `recurse` is true.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bboxFromElement(el: any, recurse = false): BBox {
  const localName = el.localName ?? "";
  switch (localName) {
    case "rect":
      return _bboxFromRect(el);
    case "circle":
      return _bboxFromCircle(el);
    case "ellipse":
      return _bboxFromEllipse(el);
    case "line":
      return _bboxFromLine(el);
    case "polygon":
    case "polyline":
      return _bboxFromPoly(el);
    case "path":
      return _bboxFromPath(el);
    case "text":
    case "tspan":
      return _bboxFromText(el);
    case "foreignObject":
      return _bboxFromForeignObject(el);
    case "image":
      return _bboxFromImage(el);
    default:
      break;
  }

  if (recurse && el.children) {
    let union = { x: Infinity, y: Infinity, width: -Infinity, height: -Infinity };
    let hasChildren = false;
    for (let i = 0; i < el.children.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = el.children[i] as any;
      const cb = _bboxFromElement(child, true);
      if (cb.width > 0 || cb.height > 0) {
        hasChildren = true;
        const minX = Math.min(union.x, cb.x);
        const minY = Math.min(union.y, cb.y);
        const maxX = Math.max(union.x + union.width, cb.x + cb.width);
        const maxY = Math.max(union.y + union.height, cb.y + cb.height);
        union = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }
    }
    if (hasChildren) return union;
  }

  return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Polyfill for SVGElement.getBBox — estimates bounding box from element attributes.
 * Uses any for 'this' to avoid DOM type requirements.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _svgGetBBox(this: any): BBox {
  return _bboxFromElement(this, true);
}

/**
 * Polyfill for getComputedTextLength on SVGTextElement.
 * Returns an estimate based on text content length.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _svgGetComputedTextLength(this: any): number {
  const text = this.textContent ?? "";
  // Rough monospace estimate: 8px per character
  return Math.max(text.length * 8, 20);
}

/**
 * Apply SVG geometry polyfills to a jsdom window's SVG element prototypes.
 * Must be called AFTER the jsdom window is created so we polyfill the right prototypes.
 * Idempotent — only applies once.
 * @param win - The jsdom window object to polyfill
 */
function _applySvgPolyfills(win: Record<string, unknown>): void {
  if (_shimApplied) return;

  // Access SVGElement, SVGTextElement, and SVGTSpanElement from the jsdom window
  const svgProto = win.SVGElement as { prototype: Record<string, unknown> } | undefined;
  const svgTextProto = win.SVGTextElement as { prototype: Record<string, unknown> } | undefined;
  const svgTSpanProto = win.SVGTSpanElement as { prototype: Record<string, unknown> } | undefined;

  // Guard: if the window has no SVGElement at all, the polyfills cannot be
  // applied (e.g. Electron extension-host `window` without SVG support).
  // Do NOT set _shimApplied — a subsequent call with a proper jsdom window
  // must still be able to apply them.
  if (!svgProto?.prototype) return;

  // getBBox — used by mermaid for node sizing
  // Apply to SVGElement first, then explicitly to SVGTextElement and SVGTSpanElement
  // since mermaid calls getBBox directly on SVGTextElement instances.
  if (typeof svgProto.prototype.getBBox !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svgProto.prototype.getBBox = _svgGetBBox as any;
  }
  if (svgTextProto?.prototype && typeof svgTextProto.prototype.getBBox !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svgTextProto.prototype.getBBox = _svgGetBBox as any;
  }
  if (svgTSpanProto?.prototype && typeof svgTSpanProto.prototype.getBBox !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svgTSpanProto.prototype.getBBox = _svgGetBBox as any;
  }

  // getBoundingClientRect — jsdom provides this on Element.prototype,
  // but ensure it's also on SVGElement for compatibility.
  if (typeof svgProto.prototype.getBoundingClientRect !== "function") {
    svgProto.prototype.getBoundingClientRect = function () {
      // Fall back to getBBox when getBoundingClientRect is unavailable.
      return _svgGetBBox.call(this);
    };
  }

  // getComputedTextLength — used by mermaid to measure text node widths
  if (svgTextProto?.prototype && typeof svgTextProto.prototype.getComputedTextLength !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svgTextProto.prototype.getComputedTextLength = _svgGetComputedTextLength as any;
  }
  if (svgTSpanProto?.prototype && typeof svgTSpanProto.prototype.getComputedTextLength !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svgTSpanProto.prototype.getComputedTextLength = _svgGetComputedTextLength as any;
  }

  _shimApplied = true;
}

/**
 * Set up DOM environment using jsdom for use by parseMermaidToExcalidraw.
 * jsdom provides better SVG geometry support than happy-dom.
 * Idempotent — only initializes once.
 * Uses any types to avoid TypeScript DOM lib dependency.
 */
async function applyNodeShim(): Promise<void> {
  if (_shimApplied) return;

  const g = globalThis as Record<string, unknown>;

  // Always create a jsdom window for mermaid-to-excalidraw.
  // The VS Code extension host (Electron) has a `window` object but it lacks
  // SVG geometry support (no SVGElement.prototype.getBBox).  We must replace it
  // with a jsdom window that we can polyfill.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const JSDOM = (await import("jsdom") as any).JSDOM;
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost",
    contentType: "text/html",
    includeNodeLocations: false,
    runScripts: "outside-only",
  });

  const { window } = dom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.window = window as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.document = (window as any).document as any;

  // Apply polyfills to the jsdom window's SVG element prototypes.
  // This MUST happen before any mermaid code runs (including dynamic imports).
  _applySvgPolyfills(window as Record<string, unknown>);
}

/**
 * Run mermaid-to-excalidraw and return element positions/routing for persistence.
 * This is called ONLY at first init (no existing layout) to establish canonical positions.
 *
 * Returns { nodes, edges } where:
 *   - nodes: map of nodeId → { x, y, w, h }
 *   - edges: map of edgeKey → { waypoints: [{x,y}[] }
 *
 * Throws UpstreamImageOnlyError when mermaid-to-excalidraw returns an image-only
 * fallback (no real element geometry available) so callers can fall back to dagre.
 */
async function runUpstreamPlacement(
  source: string,
  clusterIdSet: ReadonlySet<string>,
): Promise<{
  nodes: Record<string, { x: number; y: number; w: number; h: number }>;
  edges: Record<string, { waypoints: Array<{ x: number; y: number }> }>;
  clusters: Record<string, { x: number; y: number; w: number; h: number }>;
}> {
  await applyNodeShim();

  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const result = await parseMermaidToExcalidraw(source);

  // Detect image-only fallback — indicates SVG geometry extraction failed
  // (e.g. due to missing getBBox). Throwing lets caller fall back to dagre.
  const elements = result.elements as ExcalidrawElementSkeleton[];
  if (elements.length === 1 && (elements[0] as ExcalidrawElementSkeleton).type === "image") {
    throw new Error(
      "Upstream placement produced image-only fallback (getBBox unavailable). " +
      "Falling back to dagre layout.",
    );
  }

  const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const edges: Record<string, { waypoints: Array<{ x: number; y: number }> }> = {};
  const clusters: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const edgeOrdinals = new Map<string, number>();

  for (const el of elements) {
    // ── UD-BUG-FIX: Handle arrows FIRST — they contain "->" in mermaidId
    // (e.g. "A->B:0") which would otherwise skip them before waypoints are captured.
    if (el.type === "arrow") {
      const points = el.points as Array<[number, number]> | undefined;
      if (points && points.length > 0) {
        // Edge identity priority:
        // 1) customData.mermaidId (canonical, when upstream provides it)
        // 2) derive canonical key from start/end bindings + ordinal
        // 3) fallback to element id (non-canonical)
        const explicitId = (el.customData as { mermaidId?: string } | undefined)?.mermaidId;
        let edgeKey: string | null = null;
        if (typeof explicitId === "string") {
          edgeKey = explicitId;
        } else {
          const startId = (el as { start?: { id?: unknown } }).start?.id;
          const endId = (el as { end?: { id?: unknown } }).end?.id;
          if (typeof startId === "string" && typeof endId === "string") {
            const pair = `${startId}->${endId}`;
            const ordinal = edgeOrdinals.get(pair) ?? 0;
            edgeOrdinals.set(pair, ordinal + 1);
            edgeKey = `${pair}:${ordinal}`;
          } else if (typeof el.id === "string") {
            edgeKey = el.id;
          }
        }
        if (edgeKey === null) continue;

        const waypoints = points.slice(1, points.length - 1).map((pt: [number, number]) => ({
          x: (el.x as number) + pt[0],
          y: (el.y as number) + pt[1],
        }));
        edges[edgeKey] = { waypoints };
      }
      continue; // arrow processed; do not fall through to node skip logic
    }

    const rawId = (el.customData as { mermaidId?: string } | undefined)?.mermaidId ?? el.id;

    // Guard: skip if mermaidId/id is missing or not a string (avoids .endsWith crash)
    if (typeof rawId !== "string") continue;

    // Skip bound text (:text suffix) and edge labels (:label suffix).
    // Arrow elements are already handled above and do not reach here.
    if (rawId.endsWith(":text") || rawId.endsWith(":label")) {
      continue;
    }

    if (clusterIdSet.has(rawId)) {
      clusters[rawId] = {
        x: el.x as number,
        y: el.y as number,
        w: el.width as number,
        h: el.height as number,
      };
      continue;
    }

    // Node or other non-arrow shape
    nodes[rawId] = {
      x: el.x as number,
      y: el.y as number,
      w: el.width as number,
      h: el.height as number,
    };
  }

  return { nodes, edges, clusters };
}

// ── Extended state type used internally ───────────────────────────────────────

type PanelStateWithPanel = PanelState & {
  _panel: vscode.WebviewPanel;
  _log?: (msg: string) => void;
  _createTime?: number;
  _loadAndPost?: () => Promise<void>;
  _handleNodeMoved?: (id: string, x: number, y: number) => void;
  _handleNodeResized?: (id: string, w: number, h: number) => void;
  _handleExportReady?: (f: string, d: string) => void;
};

// ── loadAndPost ───────────────────────────────────────────────────────────────

/**
 * Core load routine: read .mmd + layout → reconcile → generate → post host:load-scene.
 * On parse failure posts host:error-overlay instead.
 * Rejects with PanelFileNotFoundError if the file cannot be read.
 */
// Build marker — change this value after each build to detect stale extension code.
const _BUILD_MARKER = "2026-04-16T17:00:fix-shim";

export async function loadAndPost(
  state: PanelStateWithPanel,
): Promise<void> {
  const log = state._log ?? ((_msg: string): void => { /* no-op */ });

  // DEBUG: unconditional heartbeat (no env var needed) — proves this code ran.
  try {
    const { mkdir: mkdirHb, appendFile: appendHb } = await import("node:fs/promises");
    const { dirname: dirnameHb, basename: basenameHb, extname: extnameHb, join: joinHb } = await import("node:path");
    const hbDir = joinHb(state._workspaceRoot || dirnameHb(state.mmdPath), ".accordo", "diagrams", "debug");
    await mkdirHb(hbDir, { recursive: true });
    const stem = basenameHb(state.mmdPath, extnameHb(state.mmdPath));
    const hbLine = `${new Date().toISOString()} loadAndPost mmd=${state.mmdPath} build=${_BUILD_MARKER}\n`;
    await appendHb(joinHb(hbDir, `${stem}.heartbeat.log`), hbLine, "utf8");
    log(`[diag-hb] ${stem}.heartbeat.log build=${_BUILD_MARKER}`);
  } catch { /* non-fatal */ }

  const trace = async (stage: string, message: string, data?: unknown): Promise<void> => {
    await appendDiagramFlowLog({
      // Prefer mmd directory when workspaceRoot is unavailable/empty.
      workspaceRoot: state._workspaceRoot || dirname(state.mmdPath),
      mmdPath: state.mmdPath,
      stage,
      message,
      data,
    });
  };

  let source: string;
  try {
    await trace("step-1", "read source start");
    source = await readFile(state.mmdPath, "utf8");
    await trace("step-1", "read source ok", { bytes: source.length });
  } catch (err) {
    log(`[diag-load] read source failed: ${String(err)}`);
    await trace("step-1", "read source failed", { error: String(err) });
    log("loadAndPost — file read FAILED: " + String(err));
    throw new PanelFileNotFoundError(state.mmdPath);
  }

  await trace("step-1", "parseMermaid start");
  const parseResult = await parseMermaid(source);
  if (!parseResult.valid) {
    log(`[diag-load] parse invalid: ${parseResult.error.message}`);
    await trace("step-1", "parseMermaid invalid", { error: parseResult.error.message });
    const errMsg: HostErrorOverlayMessage = {
      type: "host:error-overlay",
      message: parseResult.error.message,
    };
    state._panel.webview.postMessage(errMsg);
    return;
  }
  await trace("step-1", "parseMermaid ok", {
    diagramType: parseResult.diagram.type,
    direction: parseResult.diagram.direction,
    nodeCount: parseResult.diagram.nodes.size,
    edgeCount: parseResult.diagram.edges.length,
    clusterCount: parseResult.diagram.clusters?.length ?? 0,
  });

  const layoutPath = layoutPathFor(state.mmdPath, state._workspaceRoot);
  await trace("step-2", "layout path resolved", { layoutPath });

  let layout = await readLayout(layoutPath);
  await trace("step-2", "readLayout result", { exists: layout !== null });

  // UD-02: Engine selection policy.
  // Default for flowcharts is upstream-direct unless explicitly overridden
  // via layout.metadata.engine = "dagre".
  const requestedEngine = layout?.metadata?.engine as string | undefined;
  const effectiveEngine =
    requestedEngine ?? (parseResult.diagram.type === "flowchart" ? "upstream-direct" : "dagre");
  const useUpstreamDirect =
    effectiveEngine === "upstream-direct" &&
    parseResult.diagram.type === "flowchart";
  await trace("step-2", "engine selected", {
    requestedEngine: requestedEngine ?? null,
    effectiveEngine,
    useUpstreamDirect,
  });

  // First-init path: no existing layout + upstream-direct.
  // Run mermaid-to-excalidraw ONCE to establish canonical positions/routing,
  // persist to layout.json. All renders (first-init and reopen) use
  // generateCanvas + host:load-scene — never host:load-upstream-direct.
  const isFirstInit = layout === null && useUpstreamDirect;
  await trace("step-3", "first-init check", { isFirstInit });

  if (layout === null) {
    if (isFirstInit) {
      // First flowchart open: run upstream placement to get canonical positions
      try {
        log("[diag-load] step3 upstream placement start");
        await trace("step-3", "runUpstreamPlacement start");
        const { nodes: upstreamNodes, edges: upstreamEdges, clusters: upstreamClusters } = await runUpstreamPlacement(
          source,
          new Set(parseResult.diagram.clusters?.map((c) => c.id) ?? []),
        );
        await trace("step-3", "runUpstreamPlacement ok", {
          nodeKeys: Object.keys(upstreamNodes),
          edgeKeys: Object.keys(upstreamEdges),
          edgeWaypoints: Object.fromEntries(
            Object.entries(upstreamEdges).map(([k, v]) => [k, v.waypoints.length]),
          ),
        });

        // Build LayoutStore from upstream positions
        const nodes: Record<string, NodeLayout> = {};
        for (const [id, pos] of Object.entries(upstreamNodes)) {
          nodes[id] = { x: pos.x, y: pos.y, w: pos.w, h: pos.h, style: {} };
        }
        const edges: Record<string, EdgeLayout> = {};
        for (const [key, edgeData] of Object.entries(upstreamEdges)) {
          edges[key] = { routing: "auto", waypoints: edgeData.waypoints, style: {} };
        }
        const clusters = Object.fromEntries(
          (parseResult.diagram.clusters ?? []).map((c) => {
            const up = upstreamClusters[c.id];
            return [
              c.id,
              {
                x: up?.x ?? 0,
                y: up?.y ?? 0,
                w: up?.w ?? 0,
                h: up?.h ?? 0,
                label: c.label,
                style: {},
              },
            ];
          }),
        );

        layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
        layout = { ...layout, nodes, edges, clusters };

        // Persist the canonical layout so subsequent reopens use generateCanvas path
        await writeLayout(layoutPath, layout);
        log(`[diag-load] step3 upstream seeded layout: nodes=${Object.keys(layout.nodes).length} edges=${Object.keys(layout.edges).length}`);
        await trace("step-3", "seeded layout written", {
          nodes: Object.keys(layout.nodes).length,
          edges: Object.keys(layout.edges).length,
          clusters: Object.keys(layout.clusters).length,
        });
      } catch (err) {
        log(`[diag-load] step3 upstream failed, dagre fallback: ${String(err)}`);
        await trace("step-3", "runUpstreamPlacement failed, falling back to dagre", {
          error: String(err),
        });
        // Fall through to dagre if upstream fails
        try {
          const dir = parseResult.diagram.direction;
          const rankdir = (dir === "TD" ? "TB" : dir) as LayoutOptions["rankdir"];
          layout = computeInitialLayout(parseResult.diagram, { rankdir });
        } catch {
          layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
        }
        await writeLayout(layoutPath, layout);
        log(`[diag-load] step3 dagre fallback layout: nodes=${Object.keys(layout.nodes).length} edges=${Object.keys(layout.edges).length}`);
        await trace("step-3", "dagre fallback layout written", {
          nodes: Object.keys(layout.nodes).length,
          edges: Object.keys(layout.edges).length,
          clusters: Object.keys(layout.clusters).length,
        });
      }
    } else {
      // Non-flowchart or explicit dagre: use dagre
      try {
        const dir = parseResult.diagram.direction;
        const rankdir = (dir === "TD" ? "TB" : dir) as LayoutOptions["rankdir"];
        layout = computeInitialLayout(parseResult.diagram, { rankdir });
      } catch {
        layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
      }
      await writeLayout(layoutPath, layout);
      log(`[diag-load] step3 dagre initial layout: nodes=${Object.keys(layout.nodes).length} edges=${Object.keys(layout.edges).length}`);
      await trace("step-3", "dagre initial layout written", {
        nodes: Object.keys(layout.nodes).length,
        edges: Object.keys(layout.edges).length,
        clusters: Object.keys(layout.clusters).length,
      });
    }
  }

  if (state._lastSource !== "" && state._lastSource !== source) {
    try {
      await trace("step-4", "reconcile start");
      const result = await reconcile(state._lastSource, source, layout);
      layout = result.layout;
      await writeLayout(layoutPath, layout);
      await trace("step-4", "reconcile ok and written", {
        nodes: Object.keys(layout.nodes).length,
        edges: Object.keys(layout.edges).length,
        clusters: Object.keys(layout.clusters).length,
      });
    } catch {
      await trace("step-4", "reconcile failed (non-fatal)");
      // Reconcile errors are non-fatal; proceed with existing layout
    }
  } else {
    await trace("step-4", "reconcile skipped", {
      hadLastSource: state._lastSource !== "",
      sourceChanged: state._lastSource !== source,
    });
  }

  state._lastSource = source;

  // Persist default engine choice for flowcharts when metadata is missing so
  // subsequent opens are explicit and deterministic.
  if (parseResult.diagram.type === "flowchart" && requestedEngine === undefined) {
    layout = {
      ...layout,
      metadata: {
        ...(layout.metadata ?? {}),
        engine: "upstream-direct",
      },
    };
    await writeLayout(layoutPath, layout);
  }

  // All renders (first-init and reopen) use generateCanvas + host:load-scene.
  // mermaid-to-excalidraw seeds layout.json at first-init via runUpstreamPlacement,
  // but the runtime render path always uses host:load-scene (SRP-01, SRP-03).
  const scene = await Promise.resolve(generateCanvas(parseResult.diagram, layout));
  log(`[diag-load] step5 scene generated: elements=${scene.elements.length}`);
  await trace("step-5", "generateCanvas produced scene", {
    elementCount: scene.elements.length,
    layoutNodes: Object.keys(scene.layout.nodes).length,
    layoutEdges: Object.keys(scene.layout.edges).length,
    layoutClusters: Object.keys(scene.layout.clusters).length,
  });
  await writeLayout(layoutPath, scene.layout);
  state._currentLayout = scene.layout;
  await trace("step-6", "scene layout persisted", {
    edgeKeys: Object.keys(scene.layout.edges),
    edgeWaypointCounts: Object.fromEntries(
      Object.entries(scene.layout.edges).map(([k, v]) => [k, v.waypoints.length]),
    ),
  });

  const apiElements = toExcalidrawPayload(scene.elements);

  // DEBUG: dump exact Excalidraw JSON before rendering.
  // Enabled when ACCORDO_DEBUG_DIAGRAM_JSON=1; no-op otherwise (zero cost).
  await dumpExcalidrawJson({
    mmdPath: state.mmdPath,
    workspaceRoot: state._workspaceRoot,
    source,
    elements: apiElements,
  });

  const msg: HostLoadSceneMessage = {
    type: "host:load-scene",
    elements: apiElements,
    appState: {},
  };
  state._panel.webview.postMessage(msg);
  await trace("step-7", "posted host:load-scene", { elementCount: apiElements.length });
}

// ── handleWebviewMessage ──────────────────────────────────────────────────────

/**
 * Routes incoming webview messages to the appropriate handler on the state.
 * Delegates to methods attached to the state object when present, so callers
 * can inject test spies without subclassing.
 */
export function handleWebviewMessage(
  state: PanelStateWithPanel,
  msg: WebviewToHostMessage,
): void {
  const log = state._log ?? ((_m: string): void => { /* no-op */ });

  switch (msg.type) {
    case "canvas:ready": {
      const createTime = state._createTime ?? 0;
      log(`canvas:ready received — ${Date.now() - createTime}ms since create`);
      if (state.mmdPath === "") {
        const emptyMsg: HostLoadSceneMessage = {
          type: "host:load-scene",
          elements: [],
          appState: {},
        };
        state._panel.webview.postMessage(emptyMsg);
      } else {
        const doLoad = state._loadAndPost ?? (() => loadAndPost(state));
        void doLoad().then(() => {
          state._commentsBridge?.loadThreadsForUri();
        });
      }
      break;
    }
    case "canvas:node-moved": {
      const handler = state._handleNodeMoved ??
        ((id: string, x: number, y: number) => handleNodeMoved(state, id, x, y));
      handler(msg.nodeId, msg.x, msg.y);
      break;
    }
    case "canvas:node-resized": {
      const handler = state._handleNodeResized ??
        ((id: string, w: number, h: number) => handleNodeResized(state, id, w, h));
      handler(msg.nodeId, msg.w, msg.h);
      break;
    }
    case "canvas:node-styled": {
      handleNodeStyled(state, msg.nodeId, msg.style);
      break;
    }
    case "canvas:export-ready": {
      const handler = state._handleExportReady ??
        ((f: string, d: string) => handleExportReady(state, f, d));
      handler(msg.format, msg.data);
      break;
    }
    case "canvas:js-error":
      log("webview JS error: " + msg.message);
      break;
    case "canvas:timing":
      log(`[TIMING webview] ${msg.label}: ${msg.ms}ms`);
      break;
    case "canvas:edge-routed":
      // Validates canvas:edge-routed payload, persists waypoints to layout.json
      // via patchEdge, and schedules a debounced re-render.
      // Source: diagram-update-plan.md §12.5 (P-B)
      persistEdgeWaypoints(state, msg);
      break;
    case "canvas:node-added":
    case "canvas:node-deleted":
    case "canvas:edge-added":
    case "canvas:edge-deleted":
      log(`[diag.2] ${msg.type} — not yet implemented`);
      break;
    case "comment:create":
    case "comment:reply":
    case "comment:resolve":
    case "comment:reopen":
    case "comment:delete": {
      log(`webview → host: ${msg.type} received; bridge=${state._commentsBridge ? "active" : "null"}`);
      if (state._commentsBridge) {
        void state._commentsBridge.handleWebviewMessage(msg).catch((err: unknown) => {
          log(`bridge.handleWebviewMessage error: ${String(err)}`);
        });
      } else {
        log("comment message dropped — bridge not initialised");
      }
      break;
    }
    default:
      log("webview → host: unhandled message type: " + (msg as { type: string }).type);
      break;
  }
}

// ── patchLayout ───────────────────────────────────────────────────────────────

/**
 * Apply an in-memory layout patch and schedule a debounced async disk write.
 */
export function patchLayout(
  state: PanelState,
  apply: (layout: LayoutStore) => LayoutStore,
): void {
  const layoutPath = layoutPathFor(state.mmdPath, state._workspaceRoot);
  // FIX: If _currentLayout is null, the initial layout hasn't loaded yet.
  // Drop this mutation — the real layout will be written by loadAndPost.
  if (state._currentLayout === null) {
    return;
  }

  const base = state._currentLayout;
  state._currentLayout = apply(base);

  if (state._layoutWriteTimer !== null) clearTimeout(state._layoutWriteTimer);
  state._layoutWriteTimer = setTimeout(() => {
    state._layoutWriteTimer = null;
    const snapshot = state._currentLayout;
    if (snapshot === null) return;
    writeLayout(layoutPath, snapshot).catch(() => {
      // Non-fatal: the next _loadAndPost or interaction will write again.
    });
  }, 100);
}

// ── Edge waypoint persistence ────────────────────────────────────────────────

/**
 * Persist user-placed edge waypoints from the canvas back to layout.json.
 *
 * Contract: receives `{ edgeKey: string; waypoints: Array<{ x: number; y: number }> }`
 * from the webview's `canvas:edge-routed` message, and patches the corresponding
 * edge entry via `patchEdge(layout, edgeKey, { waypoints })`.
 *
 * Validation:
 *   1. edgeKey must be a non-empty string
 *   2. waypoints must be a finite number array
 *   3. Malformed payloads are silently dropped
 *
 * @internal — diagram-update-plan.md §12.5 (P-B)
 */
function persistEdgeWaypoints(
  state: PanelState,
  msg: { type: string; edgeKey?: string; waypoints?: Array<{ x: number; y: number }> },
): void {
  // Validate payload shape before touching any state.
  if (!msg.edgeKey || !Array.isArray(msg.waypoints)) {
    return;
  }
  // Ignore clearly malformed coordinates (e.g. from a buggy canvas hook).
  for (const wp of msg.waypoints) {
    if (
      typeof wp.x !== "number" || !Number.isFinite(wp.x) ||
      typeof wp.y !== "number" || !Number.isFinite(wp.y)
    ) {
      return;
    }
  }

  // Validated above: edgeKey is non-empty string, waypoints is finite-number array.
  const edgeKey: string = msg.edgeKey;
  const waypoints = msg.waypoints;
  patchLayout(state, (layout) => patchEdge(layout, edgeKey, { waypoints }));
}

// ── Node / export event handlers ──────────────────────────────────────────────

/**
 * Handle canvas:node-moved — patches x,y for the given nodeId.
 */
export function handleNodeMoved(
  state: PanelState,
  nodeId: string,
  x: number,
  y: number,
): void {
  patchLayout(state, (layout) => patchNode(layout, nodeId, { x, y }));
}

/**
 * Handle canvas:node-resized — patches w,h for the given nodeId.
 */
export function handleNodeResized(
  state: PanelState,
  nodeId: string,
  w: number,
  h: number,
): void {
  patchLayout(state, (layout) => patchNode(layout, nodeId, { w, h }));
}

/**
 * Handle canvas:node-styled — patches style for the given nodeId.
 * Edge IDs (containing "->") are routed to patchEdge; all others to patchNode.
 */
export function handleNodeStyled(
  state: PanelState,
  nodeId: string,
  stylePatch: Record<string, unknown>,
): void {
  patchLayout(state, (layout) => {
    if (nodeId.includes("->")) {
      // Edge — route to layout.edges
      const existing = layout.edges[nodeId]?.style ?? {};
      return patchEdge(layout, nodeId, {
        style: { ...existing, ...stylePatch } as import("../types.js").EdgeStyle,
      });
    }
    // Node — existing behaviour
    const existing = layout.nodes[nodeId]?.style ?? {};
    return patchNode(layout, nodeId, {
      style: { ...existing, ...stylePatch } as import("../types.js").NodeStyle,
    });
  });
}

/**
 * Handle canvas:export-ready — resolves the pending export promise with a Buffer.
 */
export function handleExportReady(
  state: PanelState,
  format: string,
  data: string,
): void {
  if (!state._pendingExport) return;
  const { resolve, format: expectedFormat } = state._pendingExport;
  if (format !== expectedFormat) return;
  state._pendingExport = null;
  resolve(Buffer.from(data, "base64"));
}
