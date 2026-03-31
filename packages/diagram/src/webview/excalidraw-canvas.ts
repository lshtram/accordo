/**
 * A16 — Excalidraw canvas module.
 *
 * Pure browser code. No Node.js imports. No VSCode extension-host APIs.
 * Bundled by esbuild via webview.ts IIFE entry.
 *
 * Responsibilities:
 *   1. Mount the Excalidraw React component into #excalidraw-root.
 *   2. Wire onChange → detectNodeMutations → vscode.postMessage for layout
 *      mutations (canvas:node-moved / canvas:node-resized / canvas:node-styled).
 *   3. Provide ExcalidrawExportFns by wrapping standalone Excalidraw export
 *      utilities (exportToSvg, exportToBlob).
 *   4. Expose handle, exportFns, ui via window for use by comment-overlay.ts.
 *
 * Source: diag_arch_v4.2.md §9.4 / diag_workplan.md §4.16 (A18-W)
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

import { detectNodeMutations } from "./message-handler.js";
import type {
  ExcalidrawHandle,
  WebviewUI,
  ExcalidrawExportFns,
  NodeMutation,
} from "./message-handler.js";
import type { ExcalidrawAPIElement } from "./scene-adapter.js";
import type { WebviewToHostMessage } from "./protocol.js";

// ── Toast / Error overlay helpers ─────────────────────────────────────────────

let _toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string): void {
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
  if (_toastTimer !== null) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    if (el) el.style.opacity = "0";
  }, 3000);
}

export function showErrorOverlay(message: string): void {
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

export function clearErrorOverlay(): void {
  const el = document.getElementById("accordo-error-overlay");
  if (el) el.style.display = "none";
}

// ── Virgil font injection ──────────────────────────────────────────────────────

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

// ── Module-level state ────────────────────────────────────────────────────────

// Snapshots the previous element list for mutation detection on each onChange.
let prevElements: ReadonlyArray<ExcalidrawAPIElement> = [];

// Snapshots the previous viewport state for pin repositioning on pan/zoom.
let prevViewportState = { scrollX: 0, scrollY: 0, zoom: 1 };

// Timing reference set by webview.ts bootstrap
let _webviewT0 = 0;
export function setWebviewT0(t: number): void {
  _webviewT0 = t;
}

// The vscode API is set once by webview.ts bootstrap before React mounts
let _vscode: { postMessage(msg: unknown): void } | null = null;
export function setVscodeApi(vs: { postMessage(msg: unknown): void }): void {
  _vscode = vs;
  // Expose on window so comment-overlay.ts can post comment messages
  const win = window as Window & { __accordoVscode?: typeof _vscode };
  win.__accordoVscode = vs;
}

// ── ExcalidrawApp ─────────────────────────────────────────────────────────────

export function ExcalidrawApp() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const handleExcalidrawApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      const vscode = _vscode!;

      // ── Build ExcalidrawHandle ──────────────────────────────────────────────
      const handle: ExcalidrawHandle = {
        updateScene(opts) {
          const restored = restoreElements(
            opts.elements as unknown as Parameters<typeof restoreElements>[0],
            null,
            { refreshDimensions: true },
          );
          api.updateScene({
            elements: restored,
            ...(opts.appState ? { appState: opts.appState } : {}),
          } as unknown as Parameters<typeof api.updateScene>[0]);
          // Snapshot with value copies to avoid Excalidraw mutating in-place
          prevElements = (restored as unknown as ExcalidrawAPIElement[]).map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];
        },
        getSceneElements() {
          return api.getSceneElements() as unknown as readonly ExcalidrawAPIElement[];
        },
        getAppState() {
          return api.getAppState() as unknown as Record<string, unknown>;
        },
      };

      // ── Build ExcalidrawExportFns ──────────────────────────────────────────
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

      // ── Build WebviewUI ───────────────────────────────────────────────────
      const ui: WebviewUI = {
        postMessage: (msg) => vscode.postMessage(msg),
        showToast,
        showErrorOverlay,
        clearErrorOverlay,
      };

      // Expose for use by comment-overlay.ts
      const win = window as Window & {
        __accordoHandle?: ExcalidrawHandle;
        __accordoExportFns?: ExcalidrawExportFns;
        __accordoUI?: WebviewUI;
        __accordoCanvasReady?: boolean;
      };
      win.__accordoHandle = handle;
      win.__accordoExportFns = exportFns;
      win.__accordoUI = ui;
      win.__accordoCanvasReady = true;
      (win as Window & { __accordoShowToast?: (msg: string) => void }).__accordoShowToast = showToast;

      // Signal to the host that the webview is ready
      vscode.postMessage({ type: "canvas:timing", label: "script-to-excalidraw-ready", ms: Math.round(performance.now() - _webviewT0) });
      vscode.postMessage({ type: "canvas:ready" });
    },
    [],
  );

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appStateRaw: Record<string, unknown>,
    ) => {
      const vscode = _vscode!;

      // G-3: Detect viewport pan/zoom — Excalidraw uses CSS transforms, not DOM scroll,
      // so PinPositioner (which listens for DOM scroll) never fires. We detect changes
      // here in handleChange and call repositionPins to re-position all comment pins.
      const scrollX = (appStateRaw["scrollX"] as number) ?? 0;
      const scrollY = (appStateRaw["scrollY"] as number) ?? 0;
      const zoom = (appStateRaw["zoom"] as { value: number } | undefined)?.value ?? 1;
      if (
        scrollX !== prevViewportState.scrollX ||
        scrollY !== prevViewportState.scrollY ||
        zoom !== prevViewportState.zoom
      ) {
        prevViewportState = { scrollX, scrollY, zoom };
        const win = window as Window & { __accordoRepositionPins?: (zoom?: number) => void };
        win.__accordoRepositionPins?.(zoom);
      }

      const next = elements as unknown as readonly ExcalidrawAPIElement[];
      const mutations: NodeMutation[] = detectNodeMutations(
        prevElements as ExcalidrawAPIElement[],
        next as ExcalidrawAPIElement[],
      );
      prevElements = (next as ExcalidrawAPIElement[]).map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];

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
    },
    [],
  );

  const handlePointerUpdate = useCallback(
    (payload: { button: string; [key: string]: unknown }) => {
      if (payload.button !== "up" || !apiRef.current) return;
      const vscode = _vscode!;
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
