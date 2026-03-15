/**
 * A16 — Webview entry point: Excalidraw canvas + host messaging.
 *
 * Runs entirely in the VS Code webview browser context. Bundled by esbuild into
 * dist/webview/webview.bundle.js (see package.json build:webview script).
 *
 * Responsibilities:
 *   1. Mount the Excalidraw React component into #excalidraw-root.
 *   2. Wire onChange → detectNodeMutations → vscode.postMessage for layout
 *      mutations (canvas:node-moved / canvas:node-resized).
 *   3. Wire window.addEventListener("message") → applyHostMessage to handle
 *      host:load-scene / host:request-export / host:toast / host:error-overlay.
 *   4. Provide ExcalidrawExportFns by wrapping the standalone Excalidraw export
 *      utilities (exportToSvg, exportToBlob) around the imperative API state.
 *
 * No Node.js imports. No VSCode extension-host APIs. Browser globals only.
 *
 * Source: diag_arch_v4.2.md §9.4 / diag_workplan.md §4.16
 */

import React, { useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  exportToSvg,
  exportToBlob,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

import { applyHostMessage, detectNodeMutations } from "./message-handler.js";
import type {
  ExcalidrawHandle,
  WebviewUI,
  ExcalidrawExportFns,
  NodeMutation,
} from "./message-handler.js";
import type { HostToWebviewMessage, WebviewToHostMessage } from "./protocol.js";
import type { ExcalidrawAPIElement } from "./scene-adapter.js";

// ── VS Code webview acquireVsCodeApi ─────────────────────────────────────────

// The VS Code runtime injects acquireVsCodeApi into the webview global scope.
// Declared here so TypeScript doesn't complain; the function exists at runtime.
// acquireVsCodeApi() may only be called ONCE per webview context (VS Code throws
// on second call). The inline diagnostic script in html.ts does NOT call it —
// this is the sole call site.
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};

const vscode = acquireVsCodeApi();

// Flush any JS errors that were buffered by the inline diagnostic script
// (html.ts) before the bundle executed. This makes pre-bundle startup errors
// visible in the Accordo Diagram output channel without opening DevTools.
{
  const win = window as Window & { __accordoErrors?: string[] };
  if (Array.isArray(win.__accordoErrors)) {
    for (const msg of win.__accordoErrors) {
      vscode.postMessage({ type: "canvas:js-error", message: msg });
    }
    win.__accordoErrors = [];
  }
}

// ── Toast overlay ─────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  let el = document.getElementById("accordo-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "accordo-toast";
    Object.assign(el.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.75)",
      color: "#fff",
      padding: "8px 16px",
      borderRadius: "4px",
      fontSize: "13px",
      zIndex: "9999",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.2s",
    });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = "1";
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el) el.style.opacity = "0";
  }, 3000);
}

// ── Error overlay ─────────────────────────────────────────────────────────────

function showErrorOverlay(message: string): void {
  let el = document.getElementById("accordo-error-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "accordo-error-overlay";
    Object.assign(el.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      background: "rgba(200, 50, 50, 0.92)",
      color: "#fff",
      padding: "12px 16px",
      fontSize: "13px",
      zIndex: "9998",
      whiteSpace: "pre-wrap",
      fontFamily: "monospace",
    });
    document.body.appendChild(el);
  }
  el.textContent = `Parse error: ${message}`;
  el.style.display = "block";
}

function clearErrorOverlay(): void {
  const el = document.getElementById("accordo-error-overlay");
  if (el) el.style.display = "none";
}

// ── Virgil font injection ────────────────────────────────────────────────────

// Load the Virgil hand-drawn font via the FontFace API so we get a promise for
// when loading completes. We wait for this before applying host:load-scene so
// that restoreElements({refreshDimensions}) measures text with the correct font
// and Canvas 2D renders Virgil from the first frame.
//
// On fast reopens the old CSS-only @font-face approach lost the race: the scene
// was rendered before the font finished downloading, locking in system-font
// metrics and appearance.
let _fontReady: Promise<void> = Promise.resolve();
{
  const win = window as Window & { __virgilFontUri?: string };
  if (win.__virgilFontUri) {
    const uri = win.__virgilFontUri;
    try {
      const face = new FontFace("Virgil", `url("${uri}")`, { display: "block" });
      _fontReady = Promise.race([
        face.load().then(() => { document.fonts.add(face); }),
        // Safety timeout — don't block the canvas forever if font fails to load
        new Promise<void>(resolve => setTimeout(resolve, 3000)),
      ]).catch(() => { /* proceed with fallback font */ });
    } catch {
      // FontFace API unavailable — fall back to CSS injection
      const style = document.createElement("style");
      style.textContent = `@font-face{font-family:"Virgil";src:url("${uri}") format("woff2");font-display:block;}`;
      document.head.appendChild(style);
    }
  }
}

// ── ExcalidrawApp ─────────────────────────────────────────────────────────────

// Snapshots the previous element list for mutation detection on each onChange.
let prevElements: ReadonlyArray<ExcalidrawAPIElement> = [];

function ExcalidrawApp() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const handleExcalidrawApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;

      // Build the ExcalidrawHandle required by applyHostMessage / detectNodeMutations
      const handle: ExcalidrawHandle = {
        updateScene(opts) {
          // restoreElements fills any missing required fields and, with
          // refreshDimensions:true, uses the DOM to measure text widths so that
          // bound label elements render immediately (without needing a
          // double-click) and arrows snap their tips to element boundaries.
          const restored = restoreElements(
            opts.elements as unknown as Parameters<typeof restoreElements>[0],
            null,
            { refreshDimensions: true },
          );
          api.updateScene({
            elements: restored,
            ...(opts.appState ? { appState: opts.appState } : {}),
          } as unknown as Parameters<typeof api.updateScene>[0]);
          // Snapshot with value copies: if Excalidraw mutates element objects in place
          // during drag, prevElements[i].x would otherwise equal next[i].x (same ref).
          prevElements = (restored as unknown as ExcalidrawAPIElement[]).map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];
        },
        getSceneElements() {
          // Cast is safe: we only interact with elements we produced via
          // toExcalidrawPayload(), which guarantees the ExcalidrawAPIElement shape.
          return api.getSceneElements() as unknown as readonly ExcalidrawAPIElement[];
        },
        getAppState() {
          return api.getAppState() as unknown as Record<string, unknown>;
        },
      };

      // Build the ExcalidrawExportFns required by applyHostMessage
      const exportFns: ExcalidrawExportFns = {
        async exportToSvg(elements, appState) {
          const svgEl = await exportToSvg({
            elements: elements as unknown as readonly ExcalidrawElement[],
            appState: appState as Partial<AppState>,
            files: null,
          });
          return new XMLSerializer().serializeToString(svgEl);
        },
        async exportToBlob(elements, appState) {
          const blob = await exportToBlob({
            elements: elements as unknown as readonly ExcalidrawElement[],
            appState: appState as Partial<AppState>,
            files: null,
          });
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        },
      };

      // Build the WebviewUI required by applyHostMessage
      const ui: WebviewUI = {
        postMessage: (msg) => vscode.postMessage(msg),
        showToast,
        showErrorOverlay,
        clearErrorOverlay,
      };

      // Wire host → webview messages.
      // host:load-scene waits for Virgil font readiness so text renders with the
      // hand-drawn font from the first frame (avoids timing race on fast reopens).
      window.addEventListener("message", (event: MessageEvent) => {
        const msg = event.data as HostToWebviewMessage;
        if (msg.type === "host:load-scene") {
          void _fontReady.then(() => applyHostMessage(msg, handle, ui, exportFns));
        } else {
          void applyHostMessage(msg, handle, ui, exportFns);
        }
      });

      // Signal to the host that the webview is ready to receive scenes
      vscode.postMessage({ type: "canvas:ready" });
    },
    [],
  );

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      // Cast is safe for the same reason as getSceneElements above.
      const next = elements as unknown as readonly ExcalidrawAPIElement[];
      const mutations: NodeMutation[] = detectNodeMutations(
        prevElements as ExcalidrawAPIElement[],
        next as ExcalidrawAPIElement[],
      );
      // Snapshot with value copies (same reason as in handle.updateScene above).
      prevElements = (next as ExcalidrawAPIElement[]).map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];

      for (const mutation of mutations) {
        if (mutation.type === "moved") {
          // x and y are always set for "moved" mutations (detectNodeMutations contract)
          vscode.postMessage({
            type: "canvas:node-moved",
            nodeId: mutation.nodeId,
            x: mutation.x ?? 0,
            y: mutation.y ?? 0,
          } satisfies WebviewToHostMessage);
        } else if (mutation.type === "resized") {
          // w and h are always set for "resized" mutations (detectNodeMutations contract)
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
    },
    [],
  );

  // Backup mutation detector: fires on every pointer event.
  // When the pointer button is released (button="up"), we diff the live scene
  // against prevElements. This catches all drag/resize mutations regardless of
  // whether Excalidraw's onChange prop fired during the interaction.
  const handlePointerUpdate = useCallback(
    (payload: { button: string; [key: string]: unknown }) => {
      if (payload.button !== "up" || !apiRef.current) return;
      const current = apiRef.current.getSceneElements() as unknown as ExcalidrawAPIElement[];
      const missed = detectNodeMutations(
        prevElements as ExcalidrawAPIElement[],
        current,
      );
      if (missed.length > 0) {
        prevElements = current.map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];
        for (const mutation of missed) {
          if (mutation.type === "moved") {
            vscode.postMessage({ type: "canvas:node-moved", nodeId: mutation.nodeId, x: mutation.x ?? 0, y: mutation.y ?? 0 } satisfies WebviewToHostMessage);
          } else if (mutation.type === "resized") {
            vscode.postMessage({ type: "canvas:node-resized", nodeId: mutation.nodeId, w: mutation.w ?? 0, h: mutation.h ?? 0 } satisfies WebviewToHostMessage);
          } else if (mutation.type === "styled") {
            vscode.postMessage({ type: "canvas:node-styled", nodeId: mutation.nodeId, style: mutation.style ?? {} } satisfies WebviewToHostMessage);
          }
        }
      }
    },
    [],
  );

  return React.createElement(Excalidraw, {
    excalidrawAPI: handleExcalidrawApi,
    onChange: handleChange,
    onPointerUpdate: handlePointerUpdate as never,
    initialData: { elements: [], appState: {} },
    // UIOptions: hide the hamburger menu items that make no sense in this context
    UIOptions: {
      canvasActions: {
        export: false,
        loadScene: false,
        saveToActiveFile: false,
        saveAsImage: false,
      },
    },
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const rootEl = document.getElementById("excalidraw-root");
if (!rootEl) {
  throw new Error("Accordo diagram webview: #excalidraw-root element not found");
}

const root = createRoot(rootEl);
root.render(React.createElement(ExcalidrawApp));
