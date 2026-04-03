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

import type { HostToWebviewMessage } from "./protocol.js";
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
 * Both return serialized strings (SVG markup or base64 PNG) so message-handler
 * never touches DOM or Blob APIs.
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
    case "host:load-scene":
      ui.clearErrorOverlay();
      // Cast is safe: panel.ts converts via toExcalidrawPayload() before posting
      // host:load-scene. protocol.ts uses unknown[] to keep the wire type JSON-safe
      // without coupling protocol.ts to the Excalidraw API shape.
      api.updateScene({ elements: msg.elements as ExcalidrawAPIElement[], appState: msg.appState });
      return;

    case "host:request-export": {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      if (msg.format === "svg") {
        const data = await exportFns.exportToSvg(elements, appState);
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
    const mermaidId = prevEl.customData?.mermaidId;
    if (!mermaidId) continue;

    const nextEl = nextById.get(prevEl.id);
    if (!nextEl) continue;

    // Only emit moved/resized for actual Mermaid node elements.
    // Bound text elements (":text" suffix), edge arrows ("->" in id), and
    // edge labels (":label" suffix) move or resize when their parent changes —
    // they are not addressable layout nodes and must not create spurious entries.
    const isNodeElement =
      !mermaidId.endsWith(":text") &&
      !mermaidId.endsWith(":label") &&
      !mermaidId.includes("->");
    if (isNodeElement) {
      if (nextEl.x !== prevEl.x || nextEl.y !== prevEl.y) {
        mutations.push({ type: "moved", nodeId: mermaidId, x: nextEl.x, y: nextEl.y });
      } else if (nextEl.width !== prevEl.width || nextEl.height !== prevEl.height) {
        mutations.push({ type: "resized", nodeId: mermaidId, w: nextEl.width, h: nextEl.height });
      }
    }

    // Detect visual style changes on shape and text elements.
    // Extract the base nodeId — text bound elements have mermaidId "nodeId:text".
    const isText = mermaidId.endsWith(":text");
    const shapeNodeId = isText ? mermaidId.slice(0, -5) : mermaidId;

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
    // Guard: exclude text elements (fillStyle has no visual effect on text) AND
    // edge arrows (mermaidId contains "->") — arrows are not addressable layout
    // nodes; emitting a styled mutation for "A->B:0" would create a spurious
    // entry in layout.nodes via handleNodeStyled (data corruption).
    // Also exclude edge labels (":label" suffix) for the same reason.
    if (!isText && !mermaidId.endsWith(":label") && !mermaidId.includes("->")) {
      if (nextEl.fillStyle !== prevEl.fillStyle) style.fillStyle = nextEl.fillStyle;
      if (nextEl.strokeStyle !== prevEl.strokeStyle) style.strokeStyle = nextEl.strokeStyle;
    }

    // Detect strokeDash changes — applies to all elements including edges.
    // strokeDash on edges IS a valid layout property (unlike fillStyle/strokeStyle).
    // strokeDash is not in ExcalidrawAPIElement, so we cast through Record.
    if (!isText && !mermaidId.endsWith(":label")) {
      const nextSd = (nextEl as unknown as Record<string, unknown>).strokeDash as boolean | undefined;
      const prevSd = (prevEl as unknown as Record<string, unknown>).strokeDash as boolean | undefined;
      if (nextSd !== prevSd) {
        style.strokeDash = nextSd;
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
