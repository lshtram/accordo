/**
 * A16 — Webview message handler: pure functions for the webview's message loop.
 *
 * Extracted as pure, injectable functions so they can be unit-tested in Node.js
 * without any browser globals or VSCode mocks.
 *
 * Two functions:
 *
 *   applyHostMessage(msg, api, ui, exportFns)
 *     Dispatches one HostToWebviewMessage to the Excalidraw API and/or UI.
 *     Returns void for sync messages; Promise<void> for host:request-export.
 *
 *   detectNodeMutations(prev, next)
 *     Diffs two Excalidraw element snapshots and returns layout mutations for
 *     elements that carry customData.mermaidId (cluster backgrounds / text
 *     overlays with empty mermaidId are skipped).
 *
 * Production wiring (webview.ts):
 *   – api: wired to ExcalidrawImperativeAPI (updateScene, getSceneElements,
 *          getAppState are all native imperative API methods).
 *   – exportFns: wired to standalone @excalidraw/excalidraw export utilities
 *     (exportToSvg, exportToBlob) fed by api.getSceneElements() + api.getAppState().
 *     These are NOT methods on ExcalidrawImperativeAPI — they are standalone
 *     utility functions imported from the package.
 *   – ui: wired to vscode.postMessage + DOM overlay elements.
 *
 * No VSCode import. No window/document access. Fully testable in vitest / Node.js.
 *
 * Source: diag_workplan.md §4.16 / diag_arch_v4.2.md §9.4
 *
 * Requirements:
 *   WF-01  host:load-scene → calls api.updateScene with elements and appState
 *   WF-02  host:load-scene → calls ui.clearErrorOverlay()
 *   WF-03  host:request-export "svg" → calls exportFns.exportToSvg, posts canvas:export-ready
 *   WF-04  host:request-export "png" → calls exportFns.exportToBlob, posts canvas:export-ready
 *   WF-05  host:toast → calls ui.showToast(message)
 *   WF-06  host:error-overlay → calls ui.showErrorOverlay(message)
 *   WF-07  detectNodeMutations: x/y changed → { type:"moved", nodeId, x, y }
 *   WF-08  detectNodeMutations: width/height changed → { type:"resized", nodeId, w, h }
 *   WF-09  detectNodeMutations: element with empty mermaidId → skipped
 *   WF-10  detectNodeMutations: fillStyle changed on shape → emitted
 *   WF-11  detectNodeMutations: strokeStyle changed on shape → emitted
 *   WF-12  detectNodeMutations: fillStyle changed on text element → NOT emitted
 *   WF-13  detectNodeMutations: fontFamily changed on text → emitted (reverse-mapped)
 *   WF-14  detectNodeMutations: fontFamily changed on shape → NOT emitted
 *   WF-15  detectNodeMutations: unknown fontFamily numeric → NOT emitted
 *   WF-16  detectNodeMutations: fillStyle changed on edge arrow → NOT emitted
 */

import type { HostToWebviewMessage, WebviewToHostMessage } from "./protocol.js";
import { type ExcalidrawAPIElement, REVERSE_FONT_FAMILY_MAP } from "./scene-adapter.js";

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * What we need from the Excalidraw imperative API.
 * Tests inject plain object fakes; production wires to ExcalidrawImperativeAPI.
 *
 * Note: export utilities (exportToSvg, exportToBlob) are NOT here — they are
 * standalone @excalidraw/excalidraw functions, injected via ExcalidrawExportFns.
 */
export interface ExcalidrawHandle {
  updateScene(opts: {
    elements: ExcalidrawAPIElement[];
    appState?: Record<string, unknown>;
  }): void;
  getSceneElements(): readonly ExcalidrawAPIElement[];
  getAppState(): Record<string, unknown>;
}

/**
 * UI surfaces the handler can write to.
 * Tests inject plain object fakes; production wires to DOM + vscode.postMessage.
 */
export interface WebviewUI {
  postMessage(msg: unknown): void;
  showToast(msg: string): void;
  showErrorOverlay(msg: string): void;
  clearErrorOverlay(): void;
}

/**
 * Standalone Excalidraw export utilities, injected by webview.ts.
 * In production, these wrap @excalidraw/excalidraw exportToSvg/exportToBlob,
 * fed by api.getSceneElements() + api.getAppState().
 * exportToSvg returns serialized SVG markup; exportToBlob returns base64 PNG.
 * message-handler encodes SVG to base64 before posting canvas:export-ready.
 */
export interface ExcalidrawExportFns {
  /** Returns serialized SVG markup string. */
  exportToSvg(
    elements: readonly ExcalidrawAPIElement[],
    appState: Record<string, unknown>,
  ): Promise<string>;
  /** Returns base64-encoded PNG string. */
  exportToBlob(
    elements: readonly ExcalidrawAPIElement[],
    appState: Record<string, unknown>,
  ): Promise<string>;
}

/** One layout mutation detected by detectNodeMutations. */
export interface NodeMutation {
  type: "moved" | "resized" | "styled";
  nodeId: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  style?: Record<string, unknown>;
}

/** Edge route mutation when an arrow's waypoints change. */
export interface EdgeRoutedMutation {
  type: "edge-routed";
  edgeKey: string;
  waypoints: Array<{ x: number; y: number }>;
}

/** UTF-8-safe base64 encoder for SVG text payloads. */
function encodeUtf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// ── applyHostMessage ──────────────────────────────────────────────────────────

/**
 * WF-01 through WF-06
 * Dispatch one host→webview message to the Excalidraw API and/or UI.
 * Returns void for sync messages (load-scene, toast, error-overlay).
 * Returns Promise<void> for host:request-export (async export path).
 */
export async function applyHostMessage(
  msg: HostToWebviewMessage,
  api: ExcalidrawHandle,
  ui: WebviewUI,
  exportFns: ExcalidrawExportFns,
): Promise<void> {
  switch (msg.type) {
    case "host:load-upstream-direct": {
      ui.clearErrorOverlay();
      try {
        const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
          import("@excalidraw/mermaid-to-excalidraw"),
          import("@excalidraw/excalidraw"),
        ]);
        const parsed = await parseMermaidToExcalidraw(msg.source);
        // READ-path (H0-01): preserve upstream element IDs so layout-node replay
        // maps correctly on reopen. Without regenerateIds:false, Excalidraw
        // library v0.x regenerates IDs on every parse, breaking the mapping
        // between layout.json mermaidId keys and the rendered element list.
        let elements = convertToExcalidrawElements(
          parsed.elements as never,
          { regenerateIds: false },
        ) as ExcalidrawAPIElement[];

        // Read-path: apply persisted node positions from layout.json.
        // This runs AFTER the upstream render so the placement engine only
        // fires once (at initiation). On reopen, positions are restored from
        // layout.json — no recompute.
        //
        // Mapping strategy:
        //   - Prefer el.customData.mermaidId (set by toExcalidrawPayload / dagre path)
        //   - Fall back to el.id directly (upstream library uses Mermaid IDs as Excalidraw IDs)
        // Skipped: bound text (:text suffix), edge labels (:label suffix), arrows (contain "->")
        if (msg.layoutNodes) {
          const elByMermaidId = new Map<string, ExcalidrawAPIElement>();
          for (const el of elements) {
            const mid = el.customData?.mermaidId ?? el.id;
            elByMermaidId.set(mid, el);
          }

          for (const [mermaidId, pos] of Object.entries(msg.layoutNodes)) {
            // Skip bound text elements (:text), edge labels (:label), and
            // arrow elements (contain "->") — their positions are derived
            // from their parent nodes and must not be independently overridden.
            if (
              mermaidId.endsWith(":text") ||
              mermaidId.endsWith(":label") ||
              mermaidId.includes("->")
            ) continue;

            const el = elByMermaidId.get(mermaidId);
            if (!el) continue;

            if (el.x !== pos.x || el.y !== pos.y) {
              el.x = pos.x; el.y = pos.y;
            }
            if (el.width !== pos.w || el.height !== pos.h) {
              el.width = pos.w; el.height = pos.h;
            }
          }
        }

        api.updateScene({ elements, appState: {} });
      } catch (err) {
        ui.showErrorOverlay(`upstream-direct render failed: ${String(err)}`);
      }
      return;
    }

    case "host:load-scene":
      ui.clearErrorOverlay();
      {
        const appState = { ...(msg.appState ?? {}) } as Record<string, unknown>;
        const elementsAreSkeletons = appState["__upstreamSkeletons"] === true;
        delete appState["__upstreamSkeletons"];

        const elements = elementsAreSkeletons
          ? await import("@excalidraw/excalidraw").then(
            ({ convertToExcalidrawElements }) =>
              convertToExcalidrawElements(msg.elements as never) as ExcalidrawAPIElement[]
          )
          : (msg.elements as ExcalidrawAPIElement[]);

        api.updateScene({ elements, appState });
      }
      return;

    case "host:request-export": {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      if (msg.format === "svg") {
        const svgText = await exportFns.exportToSvg(elements, appState);
        const data = encodeUtf8ToBase64(svgText);
        ui.postMessage({ type: "canvas:export-ready", format: "svg", data });
      } else {
        const data = await exportFns.exportToBlob(elements, appState);
        ui.postMessage({ type: "canvas:export-ready", format: "png", data });
      }
      return;
    }

    case "host:toast":
      ui.showToast(msg.message);
      return;

    case "host:error-overlay":
      ui.showErrorOverlay(msg.message);
      return;
  }
}

// ── detectNodeMutations ───────────────────────────────────────────────────────

/**
 * WF-07 through WF-09
 * Diff two Excalidraw element snapshots captured by the onChange callback.
 * Only elements with a non-empty customData.mermaidId are inspected —
 * cluster background rects and text overlay elements (empty mermaidId) are skipped.
 * Returns mutations in the order they are detected (prev element order).
 */
export function detectNodeMutations(
  prev: ExcalidrawAPIElement[],
  next: ExcalidrawAPIElement[],
): NodeMutation[] {
  const nextById = new Map(next.map((el) => [el.id, el]));
  const mutations: NodeMutation[] = [];

  for (const prevEl of prev) {
    // H0-02: customData may exist but mermaidId be absent (upstream-direct path).
    // Only skip when customData itself is missing — not when mermaidId is absent.
    // Elements without customData entirely are cluster backgrounds or anonymous shapes
    // that should not contribute layout mutations.
    const customData = prevEl.customData;
    if (!customData) continue;

    const mermaidId = customData.mermaidId;
    // Empty string mermaidId (from scene-adapter for cluster backgrounds) → skip
    if (mermaidId === "") continue;

    const nextEl = nextById.get(prevEl.id);
    if (!nextEl) continue;

    // H0-02: text elements (type:text) without mermaidId are standalone canvas text
    // boxes, not Mermaid nodes — they must be skipped entirely. This is distinct
    // from the :text suffix check which handles bound labels on nodes.
    if (prevEl.type === "text" && !mermaidId) continue;

    // Only emit moved/resized for actual Mermaid node elements.
    // Bound text elements (":text" suffix), edge arrows ("->" in id), and
    // edge labels (":label" suffix) move or resize when their parent changes —
    // they are not addressable layout nodes and must not create spurious entries.
    //
    // WRITE-path (H0-02): fallback to el.id when mermaidId is absent/undefined.
    // Upstream elements carry Mermaid IDs as Excalidraw element IDs; using el.id
    // directly is stable and correct when no customData.mermaidId is present.
    const isNodeElement =
      !mermaidId?.endsWith(":text") &&
      !mermaidId?.endsWith(":label") &&
      !mermaidId?.includes("->");
    if (isNodeElement) {
      const nodeId = mermaidId || prevEl.id;
      if (nextEl.x !== prevEl.x || nextEl.y !== prevEl.y) {
        mutations.push({ type: "moved", nodeId, x: nextEl.x, y: nextEl.y });
      } else if (nextEl.width !== prevEl.width || nextEl.height !== prevEl.height) {
        mutations.push({ type: "resized", nodeId, w: nextEl.width, h: nextEl.height });
      }
    }

    // Detect visual style changes on shape and text elements.
    // Extract the base nodeId — text bound elements have mermaidId "nodeId:text".
    // Only emit style patches when mermaidId is present — style mutations need
    // a string nodeId to populate the layout, and undefined cannot be used.
    const isText = mermaidId ? mermaidId.endsWith(":text") : false;
    const shapeNodeId = mermaidId
      ? (isText ? mermaidId.slice(0, -5) : mermaidId)
      : prevEl.id;

    const style: Record<string, unknown> = {};

    if (nextEl.backgroundColor !== prevEl.backgroundColor) style.backgroundColor = nextEl.backgroundColor;
    if (nextEl.strokeWidth    !== prevEl.strokeWidth)    style.strokeWidth    = nextEl.strokeWidth;
    if (nextEl.opacity        !== prevEl.opacity)        style.opacity        = nextEl.opacity;

    if (nextEl.strokeColor !== prevEl.strokeColor) {
      // In Excalidraw, text color is the text element's strokeColor.
      // Map it to fontColor on the parent node so it persists correctly.
      if (isText) {
        style.fontColor = nextEl.strokeColor;
      } else {
        style.strokeColor = nextEl.strokeColor;
      }
    }

    // F-2: Detect fillStyle/strokeStyle changes on shape elements only.
    // Guard: exclude text elements (fillStyle has no visual effect on text).
    // Also exclude edge labels (":label" suffix).
    // Note: strokeStyle changes on edges ARE emitted now — handleNodeStyled
    // routes them to patchEdge (layout.edges) to avoid data corruption.
    if (!isText && !mermaidId?.endsWith(":label") && !mermaidId?.includes("->")) {
      if (nextEl.fillStyle !== prevEl.fillStyle) style.fillStyle = nextEl.fillStyle;
    }
    // strokeStyle — for non-text, non-label elements (including edges)
    if (!isText && !mermaidId?.endsWith(":label")) {
      if (nextEl.strokeStyle !== prevEl.strokeStyle) style.strokeStyle = nextEl.strokeStyle;
    }

    // Detect strokeDash changes — applies to all elements including edges.
    // strokeDash on edges IS a valid layout property (unlike fillStyle/strokeStyle).
    // strokeDash is not in ExcalidrawAPIElement, so we cast through Record.
    if (!isText && !mermaidId?.endsWith(":label")) {
      const nextSd = (nextEl as unknown as Record<string, unknown>).strokeDash as boolean | undefined;
      const prevSd = (prevEl as unknown as Record<string, unknown>).strokeDash as boolean | undefined;
      if (nextSd !== prevSd) {
        style.strokeDash = nextSd;
      }
    }

    // Detect roundness changes — applies to all shape/arrow elements.
    // Excalidraw roundness is { type: number } | null. Normalize to numeric format
    // for internal storage (NodeStyle.roundness / EdgeStyle.roundness = number | null).
    // This applies to both node elements (rectangles with roundness) and arrow elements.
    if (!isText && !mermaidId?.endsWith(":label")) {
      const nextRn = nextEl.roundness;
      const prevRn = prevEl.roundness;
      if (nextRn !== prevRn) {
        // Normalize Excalidraw format to numeric: { type: N } → N, null → null
        if (nextRn !== null) {
          style.roundness = (nextRn as { type: number }).type;
        } else {
          style.roundness = null;
        }
      }
    }

    // F-3: Detect fontFamily changes on text elements only.
    // Excalidraw stores fontFamily as a number (1=Excalifont, 2=Nunito, 3=Comic Shanns).
    // Reverse-map to the string name before emitting; skip unknown numeric values
    // so we never persist an invalid fontFamily string (WF-15).
    if (isText) {
      const nextFf = (nextEl as unknown as Record<string, unknown>).fontFamily as number | undefined;
      const prevFf = (prevEl as unknown as Record<string, unknown>).fontFamily as number | undefined;
      if (nextFf != null && prevFf != null && nextFf !== prevFf) {
        const fontName = REVERSE_FONT_FAMILY_MAP[nextFf];
        if (fontName != null) {
          style.fontFamily = fontName;
        }
      }
    }

    // Detect font size changes on text elements.
    const prevFs = (prevEl as unknown as Record<string, unknown>).fontSize as number | undefined;
    const nextFs = (nextEl as unknown as Record<string, unknown>).fontSize as number | undefined;
    if (isText && nextFs != null && prevFs != null && nextFs !== prevFs) {
      style.fontSize = nextFs;
    }

    if (Object.keys(style).length > 0) {
      mutations.push({ type: "styled", nodeId: shapeNodeId, style });
    }
  }

  return mutations;
}

// ── detectArrowRouteMutations ─────────────────────────────────────────────────

/**
 * REQ-01..REQ-06d
 * Diff two Excalidraw element snapshots and returns edge-routed mutations
 * for arrow elements whose relative `points` array has changed.
 *
 * Only elements that:
 *   1. Have type "arrow"
 *   2. Carry a non-empty customData.mermaidId containing "->" (valid EdgeKey)
 *   3. Have a different `points` array between prev and next
 *
 * Waypoints are converted from relative (element-local) to absolute canvas
 * coordinates before being returned: absoluteX = element.x + point[0].
 *
 * Returns [] for all other cases — no mutation is emitted.
 */
export function detectArrowRouteMutations(
  prev: ExcalidrawAPIElement[],
  next: ExcalidrawAPIElement[],
): EdgeRoutedMutation[] {
  const nextById = new Map(next.map((el) => [el.id, el]));
  const mutations: EdgeRoutedMutation[] = [];

  for (const prevEl of prev) {
    // Condition 1: must be an arrow
    if (prevEl.type !== "arrow") continue;

    const mermaidId = prevEl.customData?.mermaidId;
    // Condition 2: must have a valid edge key (contains "->")
    if (!mermaidId || !mermaidId.includes("->")) continue;

    const nextEl = nextById.get(prevEl.id);
    if (!nextEl) continue;

    const prevPoints = prevEl.points;
    const nextPoints = nextEl.points;

    // Condition 3: points must actually differ
    if (!prevPoints || !nextPoints) continue;
    if (prevPoints.length !== nextPoints.length) {
      // Different length → definitely changed
    } else {
      const len = prevPoints.length;
      let same = true;
      for (let i = 0; i < len; i++) {
        if (prevPoints[i][0] !== nextPoints[i][0] || prevPoints[i][1] !== nextPoints[i][1]) {
          same = false;
          break;
        }
      }
      if (same) continue;
    }

    // Convert relative points to absolute waypoints.
    // Excalidraw's points[] includes the start anchor (index 0) and end anchor
    // (last index). EdgeLayout.waypoints are intermediate control points only —
    // the router re-attaches endpoints on each render. Strip first and last to
    // avoid double-prepending/appending anchors after repeated edits.
    const interiorPoints = nextPoints.slice(1, nextPoints.length - 1);
    const waypoints = interiorPoints.map((pt) => ({
      x: nextEl.x + pt[0],
      y: nextEl.y + pt[1],
    }));

    mutations.push({ type: "edge-routed", edgeKey: mermaidId, waypoints });
  }

  return mutations;
}

// ── handleChangeCallback ───────────────────────────────────────────────────────

/**
 * Core change-detection and message-emission logic for the webview canvas.
 *
 * Extracted as a pure function with explicit dependencies so it can be
 * unit-tested without React or browser globals (message-handler.ts has no
 * browser imports).
 *
 * @param elements        — current Excalidraw elements from onChange
 * @param appStateRaw     — current Excalidraw appState from onChange
 * @param prevElements    — previous element snapshot for diffing
 * @param vscode          — postMessage target (vscode API or test mock)
 * @returns updated prevElements snapshot to pass to next call
 */
export function handleChangeCallback(
  elements: unknown,
  appStateRaw: Record<string, unknown>,
  prevElements: readonly ExcalidrawAPIElement[],
  vscode: { postMessage(msg: unknown): void },
  options?: { suppressEdgeRouteEmission?: boolean },
): readonly ExcalidrawAPIElement[] {
  const next = elements as readonly ExcalidrawAPIElement[];

  // Node mutations (existing)
  const mutations: NodeMutation[] = detectNodeMutations(
    prevElements as ExcalidrawAPIElement[],
    next as ExcalidrawAPIElement[],
  );

  // Arrow route mutations (P-B: missing emission path — REQ-01)
  const arrowMutations = options?.suppressEdgeRouteEmission
    ? []
    : detectArrowRouteMutations(
      prevElements as ExcalidrawAPIElement[],
      next as ExcalidrawAPIElement[],
    );

  // Snapshot with deep-clone of nested points array to prevent aliasing:
  // Excalidraw mutates arrow points in-place between onChange callbacks.
  // A shallow { ...el } leaves points aliased — detectArrowRouteMutations
  // would compare prevPoints === nextPoints (same reference) and silently
  // drop the canvas:edge-routed emission.
  const nextSnapshot = (next as ExcalidrawAPIElement[]).map(el => ({
    ...el,
    points: el.points != null
      ? el.points.map(pt => ([...pt] as [number, number]))
      : el.points,
  })) as unknown as readonly ExcalidrawAPIElement[];

  // Emit node mutations (existing)
  for (const mutation of mutations) {
    if (mutation.type === "moved") {
      vscode.postMessage({
        type: "canvas:node-moved",
        nodeId: mutation.nodeId,
        x: mutation.x ?? 0,
        y: mutation.y ?? 0,
      } satisfies WebviewToHostMessage);
    } else if (mutation.type === "resized") {
      vscode.postMessage({
        type: "canvas:node-resized",
        nodeId: mutation.nodeId,
        w: mutation.w ?? 0,
        h: mutation.h ?? 0,
      } satisfies WebviewToHostMessage);
    } else if (mutation.type === "styled") {
      vscode.postMessage({
        type: "canvas:node-styled",
        nodeId: mutation.nodeId,
        style: mutation.style ?? {},
      } satisfies WebviewToHostMessage);
    }
  }

  // Emit arrow route mutations (P-B: REQ-01)
  for (const arrowMutation of arrowMutations) {
    if (arrowMutation.type === "edge-routed") {
      vscode.postMessage({
        type: "canvas:edge-routed",
        edgeKey: arrowMutation.edgeKey,
        waypoints: arrowMutation.waypoints,
      } satisfies WebviewToHostMessage);
    }
  }

  return nextSnapshot;
}
