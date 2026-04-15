/**
 * A15 — panel-core: core load/post and webview message handling logic.
 *
 * Extracted from DiagramPanel: loadAndPost, handleWebviewMessage, patchLayout,
 * and the node/export event handlers.
 *
 * Source: diag_workplan.md §4.15
 */

import { readFile } from "node:fs/promises";
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
import type { LayoutStore, SpatialDiagramType } from "../types.js";
import type {
  HostLoadSceneMessage,
  HostErrorOverlayMessage,
  WebviewToHostMessage,
} from "./protocol.js";
import type { PanelState } from "./panel-state.js";
import { PanelFileNotFoundError } from "./panel.js";

export { PanelFileNotFoundError };

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
export async function loadAndPost(
  state: PanelStateWithPanel,
): Promise<void> {
  const log = state._log ?? ((_msg: string): void => { /* no-op */ });

  let source: string;
  try {
    source = await readFile(state.mmdPath, "utf8");
  } catch (err) {
    log("loadAndPost — file read FAILED: " + String(err));
    throw new PanelFileNotFoundError(state.mmdPath);
  }

  const parseResult = await parseMermaid(source);
  if (!parseResult.valid) {
    const errMsg: HostErrorOverlayMessage = {
      type: "host:error-overlay",
      message: parseResult.error.message,
    };
    state._panel.webview.postMessage(errMsg);
    return;
  }

  const layoutPath = layoutPathFor(state.mmdPath, state._workspaceRoot);

  let layout = await readLayout(layoutPath);
  if (layout === null) {
    try {
      const dir = parseResult.diagram.direction;
      // Mermaid uses "TD" but dagre uses "TB" — they mean the same thing.
      const rankdir = (dir === "TD" ? "TB" : dir) as LayoutOptions["rankdir"];
      layout = computeInitialLayout(parseResult.diagram, { rankdir });
    } catch {
      layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
    }
  }

  if (state._lastSource !== "" && state._lastSource !== source) {
    try {
      const result = await reconcile(state._lastSource, source, layout);
      layout = result.layout;
      await writeLayout(layoutPath, layout);
    } catch {
      // Reconcile errors are non-fatal; proceed with existing layout
    }
  }

  state._lastSource = source;

  // generateCanvas is synchronous; the return is awaited to remain compatible
  // with the test harness which mocks it as Promise-returning.
  const scene = await Promise.resolve(generateCanvas(parseResult.diagram, layout));

  await writeLayout(layoutPath, scene.layout);
  state._currentLayout = scene.layout;

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
